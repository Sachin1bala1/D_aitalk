import { DbClient, ConnectionConfig } from "../db/DbClient";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { ConversationTurn } from "../ai/types";

// ── Error classification ───────────────────────────────────────────────────

export type ErrorClass =
  | "prepared_statement"   // PgBouncer/Supavisor: prepared statement conflict
  | "ssl_required"         // SSL connection required by server
  | "ssl_cert_error"       // SSL cert verification failed
  | "auth_failure"         // Wrong username/password
  | "host_unreachable"     // Network / DNS / firewall
  | "port_refused"         // Connection refused (wrong port)
  | "database_not_found"   // DB name doesn't exist
  | "timeout"              // Connection timed out
  | "unknown";             // Everything else → send to AI

export interface FixAttempt {
  description: string;
  change: string;              // what was modified
  success: boolean;
  fixedConfig?: ConnectionConfig;
}

export interface DiagnosisResult {
  errorClass: ErrorClass;
  originalError: string;
  fixAttempts: FixAttempt[];
  fixed: boolean;
  fixedConfig?: ConnectionConfig;
  explanation: string;          // human-readable root cause
  actionSteps: string[];        // copy-paste instructions for user
  aiDiagnosis?: string;         // Qwen's raw analysis (if used)
}

// ── Pattern matcher ────────────────────────────────────────────────────────

function classifyError(errorMsg: string): ErrorClass {
  const msg = errorMsg.toLowerCase();
  if (msg.includes("prepared statement") && msg.includes("already exists")) return "prepared_statement";
  if (msg.includes("prepared statement") && msg.includes("does not exist")) return "prepared_statement";
  if (msg.includes("ssl") && (msg.includes("required") || msg.includes("must use"))) return "ssl_required";
  if (msg.includes("ssl") && msg.includes("certif")) return "ssl_cert_error";
  if (msg.includes("password authentication failed") || msg.includes("invalid password") || msg.includes("authentication failed")) return "auth_failure";
  if (msg.includes("connection refused")) return "port_refused";
  if (msg.includes("no such host") || msg.includes("name resolution") || msg.includes("failed to lookup") || msg.includes("dns")) return "host_unreachable";
  if (msg.includes("timed out") || msg.includes("timeout")) return "timeout";
  if (msg.includes("database") && (msg.includes("does not exist") || msg.includes("not found"))) return "database_not_found";
  return "unknown";
}

// ── Auto-fix strategies ────────────────────────────────────────────────────

function buildFixConfigs(
  config: ConnectionConfig,
  errorClass: ErrorClass
): Array<{ description: string; change: string; config: ConnectionConfig }> {
  const fixes: Array<{ description: string; change: string; config: ConnectionConfig }> = [];
  const cs = config.connection_string;

  if (errorClass === "prepared_statement") {
    // Fix 1: add pgbouncer=true param (Supabase Supavisor hint)
    if (!cs.includes("pgbouncer=true")) {
      const sep = cs.includes("?") ? "&" : "?";
      fixes.push({
        description: "Adding pgbouncer=true pooler hint",
        change: "Appended ?pgbouncer=true to connection string",
        config: { ...config, id: `conn-fix-${Date.now()}`, connection_string: `${cs}${sep}pgbouncer=true` },
      });
    }
    // Fix 2: switch from pooler port 6543 to direct port 5432
    if (cs.includes(":6543")) {
      fixes.push({
        description: "Trying direct connection (port 5432 instead of pooler 6543)",
        change: "Changed port from 6543 to 5432",
        config: { ...config, id: `conn-fix-${Date.now() + 1}`, connection_string: cs.replace(":6543", ":5432") },
      });
    }
    // Fix 3: switch from direct port 5432 to pooler 6543 (opposite)
    if (cs.includes(":5432") && cs.includes("pooler")) {
      fixes.push({
        description: "Trying pooler port 6543",
        change: "Changed port from 5432 to 6543",
        config: { ...config, id: `conn-fix-${Date.now() + 2}`, connection_string: cs.replace(":5432", ":6543") },
      });
    }
  }

  if (errorClass === "ssl_required") {
    if (!cs.includes("sslmode=")) {
      const sep = cs.includes("?") ? "&" : "?";
      fixes.push({
        description: "Adding sslmode=require",
        change: "Appended sslmode=require to connection string",
        config: { ...config, id: `conn-fix-${Date.now()}`, connection_string: `${cs}${sep}sslmode=require` },
      });
    } else if (cs.includes("sslmode=disable")) {
      fixes.push({
        description: "Changing sslmode from disable to require",
        change: "Changed sslmode=disable to sslmode=require",
        config: { ...config, id: `conn-fix-${Date.now()}`, connection_string: cs.replace("sslmode=disable", "sslmode=require") },
      });
    }
  }

  if (errorClass === "ssl_cert_error") {
    if (!cs.includes("sslmode=")) {
      const sep = cs.includes("?") ? "&" : "?";
      fixes.push({
        description: "Adding sslmode=require (skip cert verification)",
        change: "Appended sslmode=require",
        config: { ...config, id: `conn-fix-${Date.now()}`, connection_string: `${cs}${sep}sslmode=require` },
      });
    }
  }

  if (errorClass === "port_refused") {
    // Try common alternative ports
    const portAlts: Array<[string, string]> = [
      [":5432", ":5433"], [":5433", ":5432"],
      [":3306", ":3307"], [":3307", ":3306"],
    ];
    for (const [from, to] of portAlts) {
      if (cs.includes(from)) {
        fixes.push({
          description: `Trying port ${to.slice(1)}`,
          change: `Changed port from ${from.slice(1)} to ${to.slice(1)}`,
          config: { ...config, id: `conn-fix-${Date.now()}`, connection_string: cs.replace(from, to) },
        });
        break;
      }
    }
  }

  return fixes;
}

// ── Explanation strings ────────────────────────────────────────────────────

function buildExplanation(
  errorClass: ErrorClass,
  error: string
): { explanation: string; actionSteps: string[] } {
  switch (errorClass) {
    case "prepared_statement":
      return {
        explanation:
          "Your database is behind a connection pooler (PgBouncer or Supabase Supavisor) in transaction mode, which doesn't support PostgreSQL prepared statements. A previous connection left a prepared statement registered on the server.",
        actionSteps: [
          "Add ?pgbouncer=true to your connection string",
          "Or switch to the direct connection URL (port 5432 instead of 6543)",
          "For Supabase: use the 'Transaction' mode pooler URL from your project Settings → Database",
        ],
      };
    case "ssl_required":
      return {
        explanation: "The database server requires an SSL/TLS encrypted connection.",
        actionSteps: [
          "Add ?sslmode=require to your connection string",
          "Example: postgresql://user:pass@host:5432/db?sslmode=require",
        ],
      };
    case "ssl_cert_error":
      return {
        explanation:
          "SSL certificate verification failed. The server's certificate could not be validated.",
        actionSteps: [
          "Add ?sslmode=require to skip strict certificate verification",
          "Or add ?sslrootcert=/path/to/ca.crt to trust a specific CA",
        ],
      };
    case "auth_failure":
      return {
        explanation: "Authentication failed — wrong username or password.",
        actionSteps: [
          "Double-check your username and password",
          "For Supabase: use the password from Settings → Database (not your account password)",
          "Ensure the user has CONNECT privilege on the database",
        ],
      };
    case "host_unreachable":
      return {
        explanation:
          "The database host could not be reached. DNS resolution or network routing failed.",
        actionSteps: [
          "Check the hostname in your connection string",
          "Ensure you're not behind a firewall or VPN that blocks the port",
          "Try pinging the host from a terminal: ping <hostname>",
        ],
      };
    case "port_refused":
      return {
        explanation:
          "The connection was refused — nothing is listening on that port, or a firewall blocked it.",
        actionSteps: [
          "Verify the port number (PostgreSQL default: 5432, MySQL: 3306)",
          "Check your database server is running",
          "Check firewall rules allow outbound connections on that port",
        ],
      };
    case "database_not_found":
      return {
        explanation: "The specified database name does not exist on the server.",
        actionSteps: [
          "Check the database name in your connection string",
          "Create the database: CREATE DATABASE <name>",
          "List existing databases: SELECT datname FROM pg_database",
        ],
      };
    case "timeout":
      return {
        explanation:
          "The connection attempt timed out — the server is unreachable or very slow.",
        actionSteps: [
          "Check your internet connection",
          "Verify the database server is running and reachable",
          "Try increasing the connection timeout in your database settings",
        ],
      };
    default:
      return {
        explanation: `An unexpected error occurred: ${error}`,
        actionSteps: [
          "Check the connection string format for your database type",
          "Verify the server is running and accessible",
          "Check the database server logs for more details",
        ],
      };
  }
}

// ── NVIDIA Qwen AI diagnosis ───────────────────────────────────────────────

async function askNvidiaQwen(
  config: ConnectionConfig,
  errorMsg: string,
  apiKey: string
): Promise<string> {
  const provider = new OpenAIProvider(apiKey, "nvidia", "https://integrate.api.nvidia.com/v1");

  // Sanitize connection string — remove password before sending to AI
  const safeConnStr = config.connection_string
    .replace(/:[^:@]+@/, ":***@")
    .replace(/password=[^&\s]+/gi, "password=***");

  const history: ConversationTurn[] = [
    {
      role: "user",
      text: `Database type: ${config.driver}
Connection string (password masked): ${safeConnStr}
Error message: ${errorMsg}

Diagnose this connection error and provide the fix.`,
    },
  ];

  const { text } = await provider.stream({
    system: `You are a database connection expert. Analyze connection errors and suggest precise fixes.
Always respond in this exact JSON format:
{
  "root_cause": "one sentence explanation",
  "severity": "fixable" | "configuration" | "infrastructure",
  "top_fix": "the single most likely fix",
  "fix_steps": ["step 1", "step 2", "step 3"],
  "additional_context": "any extra useful info"
}`,
    history,
    model: "qwen/qwen3.5-397b-a17b",
    tools: [],
    onToken: () => {},
  });

  return text;
}

// ── Main orchestrator ──────────────────────────────────────────────────────

export async function diagnoseConnection(
  config: ConnectionConfig,
  errorMsg: string,
  nvidiaApiKey?: string,
  onStep?: (step: string) => void
): Promise<DiagnosisResult> {
  const errorClass = classifyError(errorMsg);
  const fixCandidates = buildFixConfigs(config, errorClass);
  const { explanation, actionSteps } = buildExplanation(errorClass, errorMsg);
  const attempts: FixAttempt[] = [];

  onStep?.(`Detected: ${errorClass.replace(/_/g, " ")}`);

  // Try auto-fixes
  for (const candidate of fixCandidates) {
    onStep?.(`Trying: ${candidate.description}…`);
    try {
      await DbClient.connect(candidate.config);
      // Success!
      attempts.push({
        description: candidate.description,
        change: candidate.change,
        success: true,
        fixedConfig: candidate.config,
      });
      onStep?.(`✓ Fixed with: ${candidate.change}`);
      return {
        errorClass,
        originalError: errorMsg,
        fixAttempts: attempts,
        fixed: true,
        fixedConfig: candidate.config,
        explanation,
        actionSteps: [`Applied automatically: ${candidate.change}`],
      };
    } catch {
      attempts.push({
        description: candidate.description,
        change: candidate.change,
        success: false,
      });
      onStep?.(`✗ ${candidate.description} didn't work`);
      // Clean up failed connection attempt
      try {
        await DbClient.disconnect(candidate.config.id);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  // If unknown or all fixes failed → ask NVIDIA Qwen
  let aiDiagnosis: string | undefined;
  if (
    nvidiaApiKey &&
    (errorClass === "unknown" ||
      (fixCandidates.length > 0 && attempts.every((a) => !a.success)))
  ) {
    onStep?.("Asking AI for diagnosis…");
    try {
      aiDiagnosis = await askNvidiaQwen(config, errorMsg, nvidiaApiKey);
      onStep?.("AI diagnosis complete");
    } catch {
      onStep?.("AI diagnosis unavailable");
    }
  }

  return {
    errorClass,
    originalError: errorMsg,
    fixAttempts: attempts,
    fixed: false,
    explanation,
    actionSteps,
    aiDiagnosis,
  };
}
