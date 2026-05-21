/**
 * AgentLoop — provider-agnostic agentic loop.
 *
 * Works with any AIProvider (Claude, Gemini, OpenAI, NVIDIA NIM).
 * Dispatches tool calls through CommandBus and enforces approval gating.
 */
import { commandBus } from "./CommandBus";
import { AGENT_TOOLS } from "./toolDefinitions";
import { isDestructive, describeCommand } from "./commands";
import type { AgentCommand, RunUserToolCmd, DeclareHypothesesCmd, DeclareConfidenceCmd, CreateGoGChartCmd } from "./commands";
import { useUserToolStore } from "../stores/UserToolStore";
import { userToolToUnifiedTool } from "../tools/user.tools";
import { statToolToKernelKey } from "../tools/stat.tools";
import type { CommandResult } from "./CommandBus";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { WorkspaceRule } from "../memory/WorkspaceRuleStore";
import type { FullSchema } from "../db/DbClient";
import type { QueryResults } from "../stores/WorkspaceStore";
import type { AIProvider, ConversationTurn, ToolCall } from "../ai/types";
import { withRetry, withTimeout } from "../ai/resilience";
import { ContextEngine } from './harness/ContextEngine';
import { DATAIQ_HOOKS, detectStruggle } from './harness/HarnessLifecycle';
import type { SessionContext } from './harness/HarnessLifecycle';
import type { PolicyContext } from './harness/PolicyEngine';
import { FailureTraceStore } from './harness/FailureTraceStore';
import { ImpactMapEngine } from './harness/ImpactMapEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryContext {
  recentEpisodes: import("../memory/EpisodicMemory").Episode[];
  priorityParams: string[];
  expertiseLevel: string;
  workspaceRules?: WorkspaceRule[];
  customerBrief?: Array<{
    name: string;
    company?: string | null;
    stage: string;
    priority: string;
    notes?: string | null;
  }>;
  pendingOutcomes?: Array<{
    title: string;
    status: string;
    due_at?: number | null;
  }>;
}

export interface AgentLoopOptions {
  provider: AIProvider;
  model: string;
  connectionId: string | null;
  schema: FullSchema | null;
  currentSQL: string | null;
  currentResults: QueryResults | null;
  onToken: (token: string) => void;
  onToolStart: (toolName: string, input: unknown) => void;
  onToolEnd: (toolName: string, result: CommandResult) => void;
  onPlanQueued: (stepId: string, description: string) => void;
  memoryContext?: MemoryContext;
}

// ── Query Depth Classifier ────────────────────────────────────────────────────

function classifyQueryDepth(question: string): 'fast' | 'deep' {
  const q = question.toLowerCase();

  // Deep path indicators
  const deepKeywords = ['why', 'root cause', 'anomaly', 'unusual', 'problem',
    'investigate', 'analyze', 'analyse', 'diagnose', 'correlate', 'cause'];
  if (deepKeywords.some(k => q.includes(k))) return 'deep';

  // Multiple variables indicator
  const commaCount = (q.match(/,/g) || []).length;
  const andCount = (q.match(/\band\b/g) || []).length;
  if (commaCount > 2 || andCount > 2) return 'deep';

  // Fast path indicators
  if (q.includes('how many') || q.includes('count') || q.includes('list') ||
      q.includes('show me') || q.includes('what columns')) return 'fast';

  // SQL request
  if (q.startsWith('select') || q.includes('run query') || q.includes('execute')) return 'fast';

  // Very short questions default to fast
  if (question.trim().split(/\s+/).length < 8) return 'fast';

  return 'fast'; // default
}

export function isVisualizationRequest(question: string): boolean {
  return /\b(plot|chart|graph|visuali[sz]e|scatter|histogram|bar chart|line chart)\b/i.test(question);
}

const RESULT_FETCHING_TOOL_NAMES = new Set(["execute_sql", "open_table", "run_duckdb_analysis"]);
const FAST_MODE_ROUND_TIMEOUT_MS = 22_000;
const DEEP_MODE_ROUND_TIMEOUT_MS = 45_000;

export function isUnderspecifiedVisualizationRequest(question: string): boolean {
  if (!isVisualizationRequest(question)) return false;
  const q = question.toLowerCase().trim();
  const hasRelationshipHint =
    /\b(vs|versus|against|by|over|between|distribution|correlation|trend|histogram|scatter|bar|line|heatmap|box)\b/.test(q) ||
    /".+?"/.test(question);
  const shortGeneric =
    /^(hi|hey|please\s+)?(make|create|show|plot|graph|visuali[sz]e)(\s+(a|me|the))?\s*(plot|chart|graph|data)?\s*$/i.test(question.trim()) ||
    question.trim().split(/\s+/).length <= 4;
  return shortGeneric && !hasRelationshipHint;
}

export function inferNumericColumns(currentResults: QueryResults | null): string[] {
  if (!currentResults || currentResults.fields.length === 0) return [];
  return currentResults.fields
    .map((field) => field.name)
    .filter((name) => {
      for (const row of currentResults.rows.slice(0, 20)) {
        const value = row[name];
        if (value === null || value === undefined) continue;
        if (typeof value === "number") return true;
        if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return true;
        return false;
      }
      return false;
    });
}

function buildLoadedResultsProfile(currentResults: QueryResults | null): string | null {
  if (!currentResults) return null;
  const numeric = inferNumericColumns(currentResults);
  const categorical = currentResults.fields
    .map((field) => field.name)
    .filter((name) => !numeric.includes(name))
    .slice(0, 8);

  const numericSummary = numeric.slice(0, 8).map((column) => {
    const values = currentResults.rows
      .map((row) => row[column])
      .filter((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
      .map((value) => Number(value));
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return `${column}: n=${values.length}, min=${Number(min.toFixed(4))}, max=${Number(max.toFixed(4))}`;
  }).filter(Boolean);

  return [
    `LOADED RESULT PROFILE: ${currentResults.rowCount} in-memory row${currentResults.rowCount === 1 ? "" : "s"} available for direct analysis.`,
    numeric.length > 0 ? `Numeric columns: ${numeric.join(", ")}` : null,
    categorical.length > 0 ? `Other columns: ${categorical.join(", ")}` : null,
    numericSummary.length > 0 ? `Numeric ranges: ${numericSummary.join(" | ")}` : null,
  ].filter(Boolean).join("\n");
}

export function buildVisualizationClarifier(
  question: string,
  currentResults: QueryResults | null,
): string | null {
  if (!isUnderspecifiedVisualizationRequest(question)) return null;

  const fields = currentResults?.fields.map((field) => field.name) ?? [];
  if (fields.length >= 2) {
    const numeric = inferNumericColumns(currentResults);
    const examples: string[] = [];
    if (numeric.length >= 2) {
      examples.push(`${numeric[0]} vs ${numeric[1]}`);
      if (numeric.length >= 4) examples.push(`${numeric[2]} vs ${numeric[3]}`);
    } else {
      examples.push(`${fields[0]} vs ${fields[1]}`);
    }
    return `Which relationship do you want plotted? Please tell me the X and Y columns, for example "${examples.join('" or "')}".`;
  }

  return "Which columns or relationship do you want plotted? Please tell me the X and Y fields, or name the table plus the columns to use.";
}

function buildCompactSchemaSummary(schema: FullSchema | null): string | null {
  if (!schema) return null;
  const tableLines = schema.tables
    .slice(0, 12)
    .map((t) => {
      const key = `${t.schema}.${t.name}`;
      const cols = (schema.columns[key] ?? []).slice(0, 8).map((c) => c.name).join(", ");
      return `- ${key}${cols ? `: ${cols}` : ""}`;
    })
    .join("\n");
  return `DATABASE SCHEMA (${schema.driver}):\n${tableLines}`;
}

function buildFastSystemPrompt(
  schema: FullSchema | null,
  currentSQL: string | null,
  currentResults: QueryResults | null,
  agentMode: "plan" | "auto",
  memoryContext?: MemoryContext,
): string {
  const parts: string[] = [];
  parts.push("You are APEX inside Daitalk, a desktop SQL IDE. Be fast, accurate, and pragmatic for routine requests.");
  parts.push(
    `FAST MODE RULES:
- Prefer one focused tool call.
- Use execute_sql for live data requests like show, pull, get, run, count, summarize, and plot.
- Do not stop after only writing SQL into the editor if the user asked you to run it.
- If results are already loaded and a chart is requested, prefer create_chart.
- Avoid multi-step plans unless the request is clearly investigative or ambiguous.
- Keep the answer concise and evidence-based.`,
  );
  parts.push(
    agentMode === "plan"
      ? "PLAN MODE: destructive commands queue for approval."
      : "AUTO MODE: safe commands run immediately; destructive commands still require approval.",
  );

  const schemaSummary = buildCompactSchemaSummary(schema);
  if (schemaSummary) parts.push(schemaSummary);

  if (currentSQL) {
    parts.push(`CURRENT SQL:\n\`\`\`sql\n${currentSQL}\n\`\`\``);
  }

  if (currentResults) {
    const cols = currentResults.fields.map((f) => f.name).join(", ");
    const sample = JSON.stringify(currentResults.rows.slice(0, 2), null, 2);
    parts.push(`LAST RESULTS: ${currentResults.rowCount} rows. Columns: ${cols}\nSample:\n${sample}`);
    const profile = buildLoadedResultsProfile(currentResults);
    if (profile) parts.push(profile);
  }

  if (memoryContext?.workspaceRules?.length) {
    const lines = memoryContext.workspaceRules
      .slice(0, 4)
      .map((rule) => `- ${rule.title}: ${rule.instruction}`)
      .join("\n");
    parts.push(`APPROVED RULES:\n${lines}`);
  }

  return parts.join("\n\n");
}

// ── Column Type Resolver ──────────────────────────────────────────────────────

async function resolveColumnTypes(
  _connectionId: string,
  tableName: string,
  columns: string[],
  schemas: Record<string, import("../db/DbClient").FullSchema>
): Promise<Record<string, string>> {
  // First: try to get from the cached schema
  const schemaKeys = Object.keys(schemas);
  for (const connId of schemaKeys) {
    const s = schemas[connId];
    // Try both schema-qualified and unqualified keys
    for (const colKey of Object.keys(s.columns)) {
      if (colKey.includes(tableName)) {
        const cols = s.columns[colKey] ?? [];
        const relevant = cols.filter((c) => columns.includes(c.name));
        if (relevant.length > 0) {
          return Object.fromEntries(relevant.map((c) => [c.name, c.type_name]));
        }
      }
    }
  }
  // Fallback: return empty (APEX will guess from column name heuristics)
  return {};
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  schema: FullSchema | null,
  currentSQL: string | null,
  currentResults: QueryResults | null,
  agentMode: "plan" | "auto",
  memoryContext?: MemoryContext,
  queryDepth?: 'fast' | 'deep',
  harnessAdditions?: string | null
): string {
  if (queryDepth === "fast") {
    return buildFastSystemPrompt(schema, currentSQL, currentResults, agentMode, memoryContext);
  }

  const parts: string[] = [];

  if (queryDepth === 'deep') {
    parts.push(
      `DEEP ANALYSIS MODE: This question requires careful multi-step reasoning. You MUST: (1) call declare_hypotheses first, (2) run at least 2 independent tools before concluding, (3) call declare_confidence last.`
    );
  } else if (queryDepth === 'fast') {
    parts.push(
      `FAST MODE: Respond concisely. Use at most 1 tool. Skip hypothesis declaration unless the user is clearly asking about a process problem.`
    );
  }

  parts.push(
    `You are APEX — Autonomous Process Engineering eXpert, embedded in Daitalk: a desktop SQL IDE.
You reason and communicate like a 30-year senior process engineer: precise, evidence-driven, and always honest about uncertainty.
You have full agentic control: write and execute SQL, run statistical analyses, inspect schemas, modify tables, manage data.
You operate in ${agentMode.toUpperCase()} MODE.

${
  agentMode === "plan"
    ? "PLAN MODE: Destructive commands (delete_rows, drop_column, rename_table, bulk_transform) are queued for user approval before executing. Safe commands run immediately."
    : "AUTO MODE: Safe and caution-level commands can execute immediately. Destructive commands (delete_rows, drop_column, rename_table, bulk_transform) are still queued for explicit user approval before executing."
}`
  );

  parts.push(
    `## Process Engineering First Principles
When analyzing process or quality data, always reason in this sequence — never skip steps:
1. **Control**: Is the process in statistical control? Check for SPC rule violations (use stat__western_electric) before anything else. An out-of-control process cannot be meaningfully characterized.
2. **Capability**: What is Cp/Cpk/Ppk? Is it meeting spec? (use stat__capability). Cp > 1.33 is the minimum acceptable threshold for most manufacturing processes.
3. **Drivers**: Which input variables explain output variation? (use stat__regression, stat__fft for cyclic patterns, stat__anomaly_zscore for outliers). Quantify relationships — never be vague.
4. **Experiments**: What structured test would confirm causation? Suggest a DOE (Design of Experiment) when the data is observational and causation is unclear.

## Reasoning Protocol (apply every turn)
1. **Frame the problem** — What exactly is being asked? What is the risk if you answer incorrectly?
2. **Generate competing hypotheses** — List 1–5 explanations with rough probabilities. State what evidence supports or contradicts each.
3. **Choose reasoning depth** — Use fast heuristics when confidence is high and the pattern is familiar. Use explicit chain-of-thought when the problem is novel, ambiguous, or high-stakes.
4. **Select tools** — Which tool confirms or rejects your top hypothesis? Call multiple independent tools in parallel when possible.
5. **Quantify uncertainty** — State your confidence. State explicitly what single piece of evidence would change your conclusion.

## Statistical Tools Available (use proactively for process data)
- **stat__describe** — First step for any numeric column: n, mean, std, min/max, quartiles, skewness, kurtosis
- **stat__spc_xbar_r** — X-bar/R control chart: subgroup means, ranges, UCL/LCL
- **stat__capability** — Cp, Cpk, Cpu, Cpl, Pp, Ppk, sigma level (requires USL + LSL)
- **stat__western_electric** — Detects 4 Nelson/Western Electric rule violations
- **stat__regression** — Linear or polynomial regression: slope, R², p-value, residuals
- **stat__fft** — Fast Fourier Transform: dominant frequencies and amplitudes for vibration/cyclical analysis
- **stat__anomaly_zscore** — Z-score outlier detection with configurable threshold

Always prefer stat tools over manual SQL aggregations for statistical work — they run in WASM and return richer results.`
  );

  if (schema) {
    const tableLines = schema.tables
      .slice(0, 50)
      .map((t) => {
        const key = `${t.schema}.${t.name}`;
        const cols = (schema.columns[key] ?? [])
          .map(
            (c) =>
              `${c.name} ${c.type_name}${c.nullable ? "" : " NOT NULL"}${c.is_primary_key ? " PK" : ""}`
          )
          .join(", ");
        const est = t.row_estimate != null ? ` (~${t.row_estimate.toLocaleString()} rows)` : "";
        return `  ${key}${est}: ${cols}`;
      })
      .join("\n");

    parts.push(`DATABASE SCHEMA (${schema.driver}):\n${tableLines}`);
  }

  parts.push(
    `## Column Type Hints for Visualization
When creating charts, use these column type rules:
- data_type contains "timestamp" or "date" AND y is numeric → geom: line (time series)
- both x and y are numeric (float, integer, numeric, real) → geom: scatter
- x is text/varchar AND y is numeric → geom: box (distribution by category)
- x is numeric AND no y specified → geom: histogram
- x is text AND no y → geom: bar (count by category)

WHERE clause extraction rules:
- "for unit A" or "unit = A" → where_clause: "unit = 'A'"
- "last 30 days" → where_clause: "timestamp > NOW() - INTERVAL '30 days'"
- "above 100" on column X → where_clause: "X > 100"
- "between 20 and 50" → where_clause: "column BETWEEN 20 AND 50"`
  );

  if (currentSQL) {
    parts.push(`CURRENT SQL IN EDITOR:\n\`\`\`sql\n${currentSQL}\n\`\`\``);
  }

  if (currentResults) {
    const cols = currentResults.fields.map((f) => f.name).join(", ");
    const sample = JSON.stringify(currentResults.rows.slice(0, 3), null, 2);
    parts.push(
      `LAST QUERY RESULTS: ${currentResults.rowCount} rows in ${currentResults.elapsedMs}ms\nColumns: ${cols}\nSample:\n${sample}`
    );
    const profile = buildLoadedResultsProfile(currentResults);
    if (profile) parts.push(profile);
  }

  // Driver-specific guidance
  if (schema) {
    const driver = schema.driver;
    if (driver === "mongodb") {
      parts.push(`DRIVER: MongoDB
- To scan a collection, call execute_sql with the collection name as the sql parameter (not a SQL statement)
- Collections are listed in the schema as tables; the schema field is the database name
- Do NOT generate SQL SELECT statements for MongoDB — use the collection name directly
- Aggregation pipelines are not yet supported; use collection scans only`);
    } else if (driver === "redis") {
      parts.push(`DRIVER: Redis
- To scan keys by prefix, call execute_sql with the prefix (e.g. "session" scans session:* keys)
- Schema "tables" represent key prefixes grouped from SCAN results
- Columns: key (string), type (string), ttl (integer, -1 = no expiry), value (string for string-type keys)
- Do NOT generate SQL statements for Redis`);
    } else if (driver === "clickhouse") {
      parts.push(`DRIVER: ClickHouse
- Use ClickHouse SQL dialect (not PostgreSQL)
- Column types: UInt64, Int32, Float64, String, DateTime, Date, Array(T), Nullable(T), etc.
- Use toUInt64(), toFloat64() for casting — NOT CAST(x AS bigint)
- ORDER BY is required for LIMIT queries on MergeTree tables
- Aggregation: use groupBy, uniqExact(), quantile(), etc.`);
    } else if (driver === "timescaledb") {
      parts.push(`DRIVER: TimescaleDB (PostgreSQL + time-series extensions)
- Hypertables are standard PostgreSQL tables partitioned by time
- Use time_bucket() for time-series aggregation: SELECT time_bucket('1 hour', ts) AS bucket, avg(val) FROM sensor_data GROUP BY bucket ORDER BY bucket
- Use first() / last() aggregate functions for time-series selects
- Schema is otherwise identical to PostgreSQL

For TimescaleDB hypertables: prefer time_bucket() aggregation before running stat tools.
Use stat__time_series_decompose for trend analysis on hypertable data.
Avoid SELECT * on large hypertables — always add a time range WHERE clause.`);
    }
  }

  const userToolList = useUserToolStore.getState().tools;
  if (userToolList.length > 0) {
    const lines = userToolList
      .map((t) => {
        const paramHint =
          t.parameters.length > 0
            ? `\n  Parameters: ${t.parameters.map((p) => p.name).join(", ")}`
            : "";
        return `- **user__${t.id}** (${t.category}) — ${t.description}${paramHint}`;
      })
      .join("\n");
    parts.push(`## Your Custom Tools (call these proactively when user intent matches)\n${lines}`);
  }

  parts.push(
    `## Billion-Scale Visualization Protocol
Use create_gog_chart only when you are plotting directly from a table/query shape that is too large for interactive Graph Builder or when the user explicitly wants a table-scale aggregate visualization.

AUTO GEOMETRY SELECTION:
- timestamp/date column + numeric column → geom: line
- numeric + numeric → geom: scatter
- categorical (text/varchar) + numeric → geom: box
- single numeric column, no y → geom: histogram
- categorical + numeric with many categories → geom: bar

WHERE CLAUSE: if the user says "for unit A" or "where pressure > 100", include as where_clause (without the WHERE keyword).

OVERLAYS: if user mentions spec limits, control limits, or reference lines:
- "USL=95 LSL=20" → overlays: [{type:"spec_limits", lsl:20, usl:95}]
- "trend line" → overlays: [{type:"trend_line", method:"ols"}]
- "mean line" → overlays: [{type:"mean_line"}]
- "reference at 100" → overlays: [{type:"ref_line", axis:"y", value:100}]

When you create a chart using binned strategy, mention it briefly:
Example: "I've created a scatter plot of temperature vs pressure. Your table has 10M rows — I've aggregated them into a 200×200 bin grid so the chart renders instantly. Each dot represents multiple data points (dot size = number of points)."
Keep this to 2-3 sentences. Do not over-explain.`
  );

  parts.push(`## Mandatory Hypothesis Protocol
For any question about anomalies, quality issues, process upsets, or unexplained changes: you MUST call declare_hypotheses BEFORE calling any analysis tool. List 2-5 competing explanations with rough probabilities. After each tool result, update your hypotheses (call declare_hypotheses again with revised probabilities). State which hypothesis was confirmed or eliminated.`);

  parts.push(`GUIDELINES:
- Explain what you are doing before calling tools
- For basic statistics, correlations, parameter-ranking, and other read-only exploratory questions, prefer one focused execute_sql pass over a long multi-step decomposition
- If relevant rows are already loaded in LAST QUERY RESULTS, prefer analyze_loaded_correlation or analyze_loaded_feature_importance before reaching for DuckDB.
- Use execute_sql to fetch data for answering questions
- If the user asks for a specific number of rows, filters, ordering, or "pull/show/get data", use execute_sql instead of open_table
- Use open_table only for a generic default preview of a table when no specific SQL shape was requested
- Use set_editor_content when the user wants to review SQL before running
- For requests that ask you to run, execute, pull, fetch, or show live data, do not end by telling the user to click Run in the editor. Either execute the safe read query or clearly state why execution failed.
- Quote all SQL identifiers: "schema"."table"."column"
- Never call delete_rows or drop_column without explicit user confirmation
- When the user states a durable preference, governance rule, or reporting convention that should persist across sessions, call propose_workspace_rule so it can be explicitly reviewed and approved

## Visualization Execution Rules
- If the user asks for a plot/chart and the request is underspecified, ask a clarifying question instead of guessing.
- If the needed rows are already loaded in LAST QUERY RESULTS, prefer create_chart so the plot opens in editable Graph Builder.
- If the needed rows are already loaded and the user asks which factors drive an outcome, what correlates with it, or what is most important, use analyze_loaded_correlation or analyze_loaded_feature_importance before fetching more data.
- If the user wants coefficient-style detail, how much each factor matters, or a more rigorous explanation of the effect sizes, use analyze_loaded_regression on the loaded rows.
- If no suitable rows are loaded yet, execute_sql first, then create_chart using the returned columns.
- If the user says "by type", "by group", "colored by", or wants separate categories in the same plot, pass that grouping column as colorColumn when calling create_chart.
- If you are plotting computed analysis outputs such as feature rankings, percent importance, or correlation summaries, use create_analysis_chart instead of create_chart.
- Use create_gog_chart only when aggregation/binning is genuinely required.
- Never say a chart was created unless the chart tool returned success.
- If a chart tool fails, choose the next valid fallback and continue in the same turn before concluding.
- For plotting requests, do not stop after only writing SQL into the editor unless the user explicitly asked for SQL only.`);

  if (memoryContext) {
    if (memoryContext.recentEpisodes.length > 0) {
      const episodeLines = memoryContext.recentEpisodes
        .slice(0, 5)
        .map((ep) => {
          const date = new Date(ep.createdAt).toLocaleDateString();
          const rawSummary = ep.findings?.["summary"];
          const summary = ep.outcome ?? (typeof rawSummary === "string" ? rawSummary : "");
          return `- [${date}] User asked: "${ep.problem.slice(0, 80)}". Finding: ${summary}`;
        })
        .join("\n");
      parts.push(`## Your Memory of Past Analyses\n${episodeLines}`);
    }
    if (memoryContext.priorityParams.length > 0) {
      parts.push(
        `## User Priority Parameters\nBased on past sessions, this user frequently analyzes: ${memoryContext.priorityParams.join(", ")}\nCalibrated expertise level: ${memoryContext.expertiseLevel}`
      );
    }
    if (memoryContext.workspaceRules && memoryContext.workspaceRules.length > 0) {
      const lines = memoryContext.workspaceRules
        .slice(0, 8)
        .map((rule) => {
          const scope = rule.scope === "connection" && rule.connectionId ? `connection=${rule.connectionId}` : "workspace";
          return `- [${rule.kind} · ${scope}] ${rule.title}: ${rule.instruction}`;
        })
        .join("\n");
      parts.push(
        `## Approved Workspace Rules\nThese are explicitly approved user or team preferences and must be followed unless the user overrides them in the current session.\n${lines}`
      );
    }
    if (memoryContext.customerBrief && memoryContext.customerBrief.length > 0) {
      const lines = memoryContext.customerBrief
        .slice(0, 6)
        .map((customer) =>
          `- ${customer.name}${customer.company ? ` @ ${customer.company}` : ""} · stage=${customer.stage} · priority=${customer.priority}${customer.notes ? ` · ${customer.notes.slice(0, 80)}` : ""}`
        )
        .join("\n");
      parts.push(`## Founder / Customer Context\n${lines}`);
    }
    if (memoryContext.pendingOutcomes && memoryContext.pendingOutcomes.length > 0) {
      const lines = memoryContext.pendingOutcomes
        .slice(0, 5)
        .map((outcome) => {
          const due = outcome.due_at ? new Date(outcome.due_at).toLocaleDateString() : "unscheduled";
          return `- ${outcome.title.slice(0, 80)} · ${outcome.status} · due ${due}`;
        })
        .join("\n");
      parts.push(`## Open Learning Loops\n${lines}`);
    }
  }

  if (harnessAdditions) {
    parts.push(`## Harness Guidance (Auto-Updated)\n${harnessAdditions}`);
  }

  return parts.join("\n\n");
}

function getRoundTimeoutMs(
  providerId: string,
  model: string,
  queryDepth: "fast" | "deep",
  userMessage: string,
): number {
  let timeoutMs = queryDepth === "fast" ? FAST_MODE_ROUND_TIMEOUT_MS : DEEP_MODE_ROUND_TIMEOUT_MS;
  const lowerProvider = providerId.toLowerCase();
  const lowerModel = model.toLowerCase();
  const wordCount = userMessage.trim().split(/\s+/).filter(Boolean).length;

  if (wordCount > 20) timeoutMs += 4_000;
  if (queryDepth === "deep") timeoutMs += Math.min(wordCount, 40) * 250;
  if (lowerProvider.includes("ollama") || lowerProvider.includes("nim")) timeoutMs += 8_000;
  if (lowerModel.includes("opus") || lowerModel.includes("gpt-5") || lowerModel.includes("claude")) timeoutMs += 6_000;

  return Math.min(timeoutMs, 75_000);
}

// ── Tool input → AgentCommand ─────────────────────────────────────────────────

function toolCallToCommand(
  tc: ToolCall,
  connectionId: string | null
): AgentCommand | null {
  const i = tc.input;
  if (tc.name === "analyze_loaded_correlation") {
    return {
      type: "analyze_loaded_correlation",
      targetColumn: i.targetColumn as string | undefined,
      columns: i.columns as string[] | undefined,
      risk: "safe",
    };
  }
  if (tc.name === "analyze_loaded_feature_importance") {
    return {
      type: "analyze_loaded_feature_importance",
      targetColumn: i.targetColumn as string,
      featureColumns: i.featureColumns as string[] | undefined,
      risk: "safe",
    };
  }
  if (tc.name === "analyze_loaded_regression") {
    return {
      type: "analyze_loaded_regression",
      targetColumn: i.targetColumn as string,
      featureColumns: i.featureColumns as string[] | undefined,
      risk: "safe",
    };
  }
  // Route all stat__* tool calls through run_stat_tool
  if (tc.name.startsWith("stat__")) {
    return {
      type: "run_stat_tool",
      method: statToolToKernelKey(tc.name),
      params: i as Record<string, unknown>,
      risk: "safe",
    };
  }
  // Route all user__* tool calls through run_user_tool
  if (tc.name.startsWith("user__")) {
    const toolId = tc.name.slice("user__".length);
    const userTool = useUserToolStore.getState().tools.find((t) => t.id === toolId);
    if (!userTool) return null;
    const risk = userTool.body.type === "notify" ? "safe" : "caution";
    return {
      type: "run_user_tool",
      toolId,
      params: i as Record<string, unknown>,
      connectionId,
      risk,
    } satisfies RunUserToolCmd;
  }
  switch (tc.name) {
    case "set_editor_content":
      return { type: "set_editor_content", sql: i.sql as string, risk: "safe" };
    case "execute_sql":
      if (!connectionId) return null;
      return { type: "execute_sql", sql: i.sql as string, connectionId, risk: "safe" };
    case "open_table":
      return { type: "open_table", schema: i.schema as string, table: i.table as string, risk: "safe" };
    case "open_new_tab":
      return { type: "open_new_tab", title: i.title as string | undefined, risk: "safe" };
    case "add_column":
      return {
        type: "add_column",
        schema: i.schema as string,
        table: i.table as string,
        columnName: i.columnName as string,
        dataType: i.dataType as string,
        nullable: i.nullable as boolean,
        defaultValue: i.defaultValue as string | undefined,
        risk: "caution",
      };
    case "drop_column":
      return {
        type: "drop_column",
        schema: i.schema as string,
        table: i.table as string,
        columnName: i.columnName as string,
        risk: "destructive",
      };
    case "rename_table":
      return {
        type: "rename_table",
        schema: i.schema as string,
        oldName: i.oldName as string,
        newName: i.newName as string,
        risk: "destructive",
      };
    case "delete_rows":
      return {
        type: "delete_rows",
        schema: i.schema as string,
        table: i.table as string,
        where: i.where as string,
        estimatedCount: i.estimatedCount as number | undefined,
        risk: "destructive",
      };
    case "bulk_transform":
      return { type: "bulk_transform", sql: i.sql as string, risk: "destructive" };
    case "create_index":
      return {
        type: "create_index",
        schema: i.schema as string,
        table: i.table as string,
        columns: i.columns as string[],
        unique: i.unique as boolean,
        indexName: i.indexName as string | undefined,
        risk: "caution",
      };
    case "focus_schema_node":
      return {
        type: "focus_schema_node",
        schema: i.schema as string,
        table: i.table as string,
        risk: "safe",
      };
    case "insert_row":
      return {
        type: "insert_row",
        schema: i.schema as string,
        table: i.table as string,
        values: i.values as Record<string, unknown>,
        risk: "caution",
      };
    case "update_cell":
      return {
        type: "update_cell",
        schema: i.schema as string,
        table: i.table as string,
        pkColumn: i.pkColumn as string,
        pkValue: i.pkValue,
        column: i.column as string,
        newValue: i.newValue,
        risk: "caution",
      };
    case "run_duckdb_analysis":
      return { type: "run_duckdb_analysis", sql: i.sql as string, risk: "safe" };
    case "close_tab":
      return { type: "close_tab", tabId: i.tabId as string | undefined, risk: "safe" };
    case "create_chart":
      return {
        type: "create_chart",
        chartType: i.chartType as "bar" | "line" | "scatter" | "pie" | "area",
        xColumn: i.xColumn as string,
        yColumn: i.yColumn as string,
        colorColumn: i.colorColumn as string | undefined,
        title: i.title as string | undefined,
        xLabel: i.xLabel as string | undefined,
        yLabel: i.yLabel as string | undefined,
        risk: "safe",
      };
    case "create_analysis_chart":
      return {
        type: "create_analysis_chart",
        chartType: i.chartType as "bar" | "line" | "scatter" | "pie" | "area",
        rows: i.rows as Record<string, unknown>[],
        xKey: i.xKey as string,
        yKey: i.yKey as string,
        colorKey: i.colorKey as string | undefined,
        title: i.title as string | undefined,
        xLabel: i.xLabel as string | undefined,
        yLabel: i.yLabel as string | undefined,
        risk: "safe",
      };
    case "create_gog_chart":
      return {
        type: "create_gog_chart",
        table: i.table as string,
        schema: i.schema as string | undefined,
        geom: i.geom as CreateGoGChartCmd["geom"],
        x: i.x as string,
        y: i.y as string | undefined,
        color: i.color as string | undefined,
        facet: i.facet as string | undefined,
        title: i.title as string | undefined,
        x_label: i.x_label as string | undefined,
        y_label: i.y_label as string | undefined,
        where_clause: i.where_clause as string | undefined,
        overlays: i.overlays as CreateGoGChartCmd["overlays"],
        risk: "safe",
      };
    case "create_pipeline":
      return {
        type: "create_pipeline",
        name: i.name as string,
        sourceConnectionId: i.sourceConnectionId as string,
        sourceQuery: i.sourceQuery as string,
        targetConnectionId: i.targetConnectionId as string,
        targetTable: i.targetTable as string,
        risk: "caution",
      };
    case "list_pipelines":
      return {
        type: "list_pipelines",
        risk: "safe",
      };
    case "run_pipeline":
      return {
        type: "run_pipeline",
        pipelineId: i.pipelineId as string,
        risk: "destructive",
      };
    case "search_workspace":
      return {
        type: "search_workspace",
        query: i.query as string,
        limit: i.limit as number | undefined,
        kind: i.kind as "schema" | "artifacts" | "pipelines" | "background_agents" | "history" | "memory" | undefined,
        connectionId: i.connectionId as string | undefined,
        recentDays: i.recentDays as number | undefined,
        risk: "safe",
      };
    case "propose_workspace_rule":
      return {
        type: "propose_workspace_rule",
        title: i.title as string,
        instruction: i.instruction as string,
        kind: i.kind as "analysis" | "sql" | "safety" | "reporting",
        scope: i.scope as "workspace" | "connection",
        connectionId: i.connectionId as string | null | undefined,
        rationale: i.rationale as string | undefined,
        evidence: i.evidence as string[] | undefined,
        risk: "safe",
      };
    case "notify_user":
      return {
        type: "notify_user",
        message: i.message as string,
        level: i.level as "info" | "success" | "warning" | "error",
        risk: "safe",
      };
    case "declare_hypotheses":
      return {
        type: "declare_hypotheses",
        hypotheses: i.hypotheses as DeclareHypothesesCmd["hypotheses"],
        problemFrame: i.problem_frame as string,
        risk: "safe" as const,
      };
    case "declare_confidence":
      return {
        type: "declare_confidence",
        confidence: i.confidence as number,
        confidenceLabel: i.confidence_label as DeclareConfidenceCmd["confidenceLabel"],
        dataQuality: i.data_quality as DeclareConfidenceCmd["dataQuality"] | undefined,
        whatWouldChangeConclusion: i.what_would_change_conclusion as string,
        dataGaps: i.data_gaps as string | undefined,
        risk: "safe" as const,
      };
    case "pi_search_tags":
      if (!connectionId) return null;
      return {
        type: "pi_search_tags",
        connectionId,
        query: i.query as string,
        maxCount: i.max_count as number | undefined,
        risk: "safe",
      };
    case "pi_get_history":
      if (!connectionId) return null;
      return {
        type: "pi_get_history",
        connectionId,
        webIds: i.web_ids as string[],
        start: i.start as string,
        end: i.end as string,
        interval: i.interval as string | undefined,
        risk: "safe",
      };
    case "pi_get_current":
      if (!connectionId) return null;
      return {
        type: "pi_get_current",
        connectionId,
        webIds: i.web_ids as string[],
        risk: "safe",
      };
    default:
      return null;
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────────

export async function runAgentLoop(
  userMessage: string,
  history: ConversationTurn[],
  options: AgentLoopOptions
): Promise<{ finalText: string; updatedHistory: ConversationTurn[]; queryDepth: 'fast' | 'deep'; pendingApprovalSteps: string[] }> {
  const {
    provider,
    model,
    connectionId,
    schema,
    currentSQL,
    currentResults,
    onToken,
    onToolStart,
    onToolEnd,
    onPlanQueued,
  } = options;

  const { agentMode, addPlanStep, currentTask } = useWorkspaceStore.getState();
  const currentSubtask = currentTask?.subtasks[currentTask.currentIndex] ?? null;
  const queryDepth = classifyQueryDepth(userMessage);
  const clarifier = buildVisualizationClarifier(userMessage, currentResults);
  if (clarifier) {
    const updatedHistory: ConversationTurn[] = [
      ...history,
      { role: "user", text: userMessage },
      { role: "assistant", text: clarifier },
    ];
    return { finalText: clarifier, updatedHistory: updatedHistory.slice(-40), queryDepth, pendingApprovalSteps: [] };
  }

  let harnessAdditions: string | null = null;
  try {
    const activeVersion = await FailureTraceStore.getActiveVersion();
    harnessAdditions = activeVersion?.system_prompt_additions ?? null;
  } catch {
    // non-critical — proceed without harness additions
  }

  const system = buildSystemPrompt(schema, currentSQL, currentResults, agentMode, options.memoryContext, queryDepth, harnessAdditions);

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Append the user message to working history
  const working: ConversationTurn[] = [
    ...history,
    { role: "user", text: userMessage },
  ];

  ContextEngine.trackContextBuild(sessionId, system, working);

  const connections = useWorkspaceStore.getState().connections;
  const activeConn = connections.find(c => c.id === connectionId);
  const policyCtx: PolicyContext = {
    sessionId,
    connectionId,
    question: userMessage,
    isReadOnly: activeConn?.read_only ?? false,
    connectionType: activeConn?.driver ?? '',
    piiColumns: [],
  };
  const sessionCtx: SessionContext = {
    sessionId,
    connectionId,
    question: userMessage,
    toolsCalledSoFar: [],
    errorsSoFar: [],
    startTime: Date.now(),
    iterationCount: 0,
    policyContext: policyCtx,
  };
  await DATAIQ_HOOKS.onSessionStart?.(sessionCtx);

  const userToolDefs = useUserToolStore.getState().tools.map(userToolToUnifiedTool);
  const allTools = [...AGENT_TOOLS, ...userToolDefs];
  const roundTimeoutMs = getRoundTimeoutMs(provider.id, model, queryDepth, userMessage);

  let finalText = "";
  const pendingApprovalSteps: string[] = [];
  const MAX_ROUNDS = queryDepth === "fast" ? 4 : 8;
  const toolSignatureCounts = new Map<string, number>();
  let resultFetchingAttempts = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { text, toolCalls, stopReason } = await withRetry(
      () =>
        withTimeout(
          provider.stream({
            system,
            history: working,
            model,
            tools: allTools,
            onToken,
          }),
          roundTimeoutMs,
          "Agent model round",
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        onRetry: (attempt, delayMs, _err) => {
          onToken(`\n\n⚠ Rate limited — retrying in ${(delayMs / 1000).toFixed(0)}s (attempt ${attempt}/3)…\n\n`);
        },
      }
    );

    finalText += text;

    // Record assistant turn
    const assistantTurn: ConversationTurn = { role: "assistant", text };
    if (toolCalls.length > 0) assistantTurn.toolCalls = toolCalls;
    working.push(assistantTurn);

    if (stopReason === "end_turn" || toolCalls.length === 0) break;

    // Execute tools and collect results
    const toolResults: ConversationTurn["toolResults"] = [];

    for (const tc of toolCalls) {
      const toolSignature = `${tc.name}:${JSON.stringify(tc.input ?? {})}`;
      const priorSignatureCount = toolSignatureCounts.get(toolSignature) ?? 0;
      toolSignatureCounts.set(toolSignature, priorSignatureCount + 1);

      if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) {
        if (queryDepth === "fast" && resultFetchingAttempts >= 2) {
          toolResults!.push({
            toolCallId: tc.id,
            name: tc.name,
            content: "Skipped additional data-fetch attempt because this fast analysis already exhausted its live-query budget. Use the currently loaded results or answer with the best available evidence.",
            isError: true,
          });
          continue;
        }

        if (priorSignatureCount >= 1) {
          toolResults!.push({
            toolCallId: tc.id,
            name: tc.name,
            content: "Skipped duplicate data-fetch attempt. Do not repeat the same live query path; summarize the current evidence or choose a narrower alternative.",
            isError: true,
          });
          continue;
        }
      }

      const cmd = toolCallToCommand(tc, connectionId);

      if (!cmd) {
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: `Unknown tool or missing connectionId: ${tc.name}`,
          isError: true,
        });
        continue;
      }

      sessionCtx.toolsCalledSoFar.push(tc.name);
      try {
        await DATAIQ_HOOKS.onBeforeToolCall?.(tc.name, tc.input, sessionCtx);
      } catch (policyErr) {
        // Policy block — short-circuit this tool
        const errMsg = policyErr instanceof Error ? policyErr.message : String(policyErr);
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: errMsg,
          isError: true,
        });
        onToolEnd(tc.name, { success: false, error: errMsg });
        continue;
      }

      onToolStart(tc.name, tc.input);

      let result: CommandResult;

      if (agentMode === "plan") {
        const impactMap = ImpactMapEngine.fromCommands([cmd], connectionId);
        useWorkspaceStore.getState().setImpactMapResolution(impactMap);
      }

      if (isDestructive(cmd)) {
        const stepId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const description = describeCommand(cmd);

        addPlanStep({
          id: stepId,
          commandType: cmd.type,
          humanReadable: description,
          sqlPreview:
            "sql" in cmd && typeof cmd.sql === "string"
              ? cmd.sql
              : cmd.type === "delete_rows"
                ? `DELETE FROM "${cmd.schema}"."${cmd.table}" WHERE ${cmd.where};`
                : cmd.type === "drop_column"
                  ? `ALTER TABLE "${cmd.schema}"."${cmd.table}" DROP COLUMN "${cmd.columnName}";`
                  : cmd.type === "rename_table"
                    ? `ALTER TABLE "${cmd.schema}"."${cmd.oldName}" RENAME TO "${cmd.newName}";`
                    : undefined,
          taskId: currentTask?.id,
          subtaskId: currentSubtask?.id,
          riskLevel: cmd.risk,
          status: "pending",
          command: cmd, // stored so PlanQueue can dispatch on approval
        });

        onPlanQueued(stepId, description);
        pendingApprovalSteps.push(stepId);

        result = {
          success: true,
          result: `Queued for approval: "${description}". Waiting for user to approve in the Plan Queue.`,
        };
      } else {
        result = await commandBus.dispatch(cmd);
        if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) {
          resultFetchingAttempts += 1;
        }

        // Push to undo stack on successful non-safe mutations
        if (result.success && cmd.risk !== "safe") {
          useWorkspaceStore.getState().pushUndo({
            id: tc.id,
            humanReadable: describeCommand(cmd),
            command: cmd,
            timestamp: Date.now(),
          });
        }
      }

      onToolEnd(tc.name, result);

      const afterDurationMs = Date.now() - sessionCtx.startTime;
      await DATAIQ_HOOKS.onAfterToolCall?.(tc.name, tc.input, result, afterDurationMs, sessionCtx);
      if (!result.success) {
        sessionCtx.errorsSoFar.push({ tool: tc.name, error: result.error ?? 'unknown' });
      }

      toolResults!.push({
        toolCallId: tc.id,
        name: tc.name,
        content: result.success
          ? JSON.stringify(result.result ?? "done")
          : `Error: ${result.error}`,
        isError: !result.success,
      });
    }

    // Add tool results as a user turn
    working.push({ role: "user", toolResults });

    // Struggle detection at end of each round
    sessionCtx.iterationCount = round + 1;
    const struggle = detectStruggle(sessionCtx);
    if (struggle) {
      const hint = await DATAIQ_HOOKS.onStruggleDetected?.(sessionCtx, struggle);
      if (hint) {
        // Inject struggle hint as a user message into working history
        working.push({ role: 'user', text: hint });
      }
    }
  }

  const sessionSuccess = finalText.length > 0;
  await DATAIQ_HOOKS.onSessionComplete?.(sessionCtx, {
    success: sessionSuccess,
    toolsUsed: sessionCtx.toolsCalledSoFar,
    totalDurationMs: Date.now() - sessionCtx.startTime,
    tokenEstimate: ContextEngine.estimateTokenUsage(system, working).total,
    errorCount: sessionCtx.errorsSoFar.length,
  });

  // Trim to last 40 turns to keep context manageable
  const compacted = ContextEngine.compactHistory(working);
  return { finalText, updatedHistory: compacted, queryDepth, pendingApprovalSteps };
}
