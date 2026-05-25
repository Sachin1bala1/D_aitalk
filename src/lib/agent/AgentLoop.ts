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
import { withRetry } from "../ai/resilience";
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
  /** Called with a status string while thinking/running tools, null to clear. */
  onThinking?: (status: string | null) => void;
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
    const cols = currentResults.fields.map((f) => f.name);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const sample = JSON.stringify(currentResults.rows.slice(0, 2), null, 2);
    parts.push(
      `LAST RESULTS: ${currentResults.rowCount} rows.\n` +
      `EXACT COLUMN NAMES (use verbatim in create_chart — do NOT invent names): ${colList}\n` +
      `Sample:\n${sample}`
    );
    const profile = buildLoadedResultsProfile(currentResults);
    if (profile) parts.push(profile);
    parts.push(
      `CHART RULE: create_chart requires column names from the list above.\n` +
      `After analyze_loaded_feature_importance, the chart is created AUTOMATICALLY in Graph Builder — do NOT call create_analysis_chart, it is handled automatically.\n` +
      `After create_derived_table opens a new tab with rows, if the user wants to chart it, call create_chart (NOT create_analysis_chart) using the column names visible in that tab's results.\n` +
      `For derived columns (e.g. ratios), write SQL with alias, execute_sql, then create_chart with the alias.\n` +
      `CORRELATION: If user asks what factors affect a column — try analyze_loaded_correlation first. If it fails, use execute_sql with CORR() e.g. SELECT CORR("col_a","target") AS c1, CORR("col_b","target") AS c2 FROM "schema"."table". Never attempt more than 2 approaches.`
    );
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
    const cols = currentResults.fields.map((f) => f.name);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const sample = JSON.stringify(currentResults.rows.slice(0, 3), null, 2);
    parts.push(
      `LAST QUERY RESULTS: ${currentResults.rowCount} rows in ${currentResults.elapsedMs}ms\n` +
      `EXACT COLUMN NAMES (use these verbatim — do NOT invent column names): ${colList}\n` +
      `Sample:\n${sample}`
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
- When you discover a statistically significant relationship (R > 0.6 or importance > 10%), call propose_workspace_rule with kind="analysis" to save it. Example: title="UDI drives Tool wear", instruction="UDI has 57.97% feature importance for Tool wear [min] with R=0.999 — always check UDI when analyzing tool wear". Do this at the END of the turn after your main answer.

## Correlation Analysis — Preferred Workflow
When the user asks "what factors affect X" or "correlation" or "what impacts Y":
1. FIRST try: analyze_loaded_correlation with targetColumn="<target>" if results are already loaded (>0 rows in LAST QUERY RESULTS).
2. If that returns an error OR no results are loaded: use execute_sql with PostgreSQL CORR():
   Example — finding what affects "Tool wear [min]":
   SELECT
     CORR("Air temperature [K]", "Tool wear [min]") AS corr_air_temp,
     CORR("Process temperature [K]", "Tool wear [min]") AS corr_proc_temp,
     CORR("Rotational speed [rpm]", "Tool wear [min]") AS corr_rpm,
     CORR("Torque [Nm]", "Tool wear [min]") AS corr_torque
   FROM "schema"."table"
   Then create_chart with the result columns.
3. Do NOT attempt more than 2 different approaches. If both fail, explain what happened.
4. Never loop through 4+ tool attempts on the same request.

## CRITICAL: Two Chart Tools — Do Not Confuse Them
- **create_chart**: plots columns from the CURRENTLY LOADED SQL RESULTS. Only use column names that appear verbatim in "EXACT COLUMN NAMES" above. NEVER invent column names.
- **create_analysis_chart**: plots rows you supply directly (e.g. correlation summaries or custom computed rows). Do NOT use after analyze_loaded_feature_importance.

## After Analysis Tools — Results and Derived Tables
After analyze_loaded_feature_importance: the chart is AUTOMATICALLY created in Graph Builder. Do NOT call create_analysis_chart — handled automatically. Just confirm the analysis is done.

If the user says "save as table", "I want to analyze this data", "keep these factors", or "create a derived table": call create_derived_table with:
  name: "feature_importance_<target_column>" (snake_case)
  rows: the detailed_factors array from the analysis result
  title: "Feature Importance — <Target Column>"
After calling create_derived_table, tell the user: "The data is now in a new tab — you can chart it by clicking the chart icon or asking me to chart it."
If the user then asks to chart the derived table data, call create_chart (NOT create_analysis_chart) using the column names shown in that tab's results.

After analyze_loaded_correlation returns, the result has correlations: [{column, correlation, ...}].
To chart it: call create_analysis_chart with rows=result.correlations, xKey="column", yKey="correlation", chartType="bar".
If user asks to save it: call create_derived_table with name="correlation_<target>", rows=result.correlations.

Derived tables open automatically in a new tab — the user can inspect, filter, and chart from there.

## Creating Derived Columns for Analysis
When the user wants to analyze a relationship that requires a computed column (ratio, difference, log transform, etc.):
1. Write SQL that computes it with an alias: SELECT col_a, col_b, (col_a / NULLIF(col_b, 0)) AS ratio_a_b FROM "schema"."table"
2. Call execute_sql to run it — the derived column will appear in LAST QUERY RESULTS
3. Then use create_chart with the derived column name (e.g. xColumn: "ratio_a_b")
NEVER call create_chart with a column name that isn't in the loaded results.

## Visualization Execution Rules
- If the user asks for a plot/chart and the request is underspecified, ask a clarifying question instead of guessing.
- If no suitable rows are loaded yet, execute_sql first, then create_chart using the returned columns.
- If the user says "by type", "by group", "colored by", wants separate categories, pass that grouping column as colorColumn.
- Use create_gog_chart only when the table is too large for interactive Graph Builder (100k+ rows).
- Never say a chart was created unless the chart tool returned success.
- If a chart tool fails, read the error carefully — it usually says which column was missing. Fix the column name and retry.
- For plotting requests, do not stop after only writing SQL into the editor unless the user explicitly asked for SQL only.`);

  if (memoryContext) {
    if (memoryContext.recentEpisodes.length > 0) {
      const episodeLines = memoryContext.recentEpisodes
        .slice(0, 3)
        .map((ep) => {
          const date = new Date(ep.createdAt).toLocaleDateString();
          const summary = ep.outcome ?? (typeof ep.findings?.["summary"] === "string" ? ep.findings["summary"] as string : "");
          const toolResults = typeof ep.findings?.["toolResults"] === "string" ? ep.findings["toolResults"] as string : "";
          const tables = Array.isArray(ep.findings?.["tablesAccessed"]) ? (ep.findings["tablesAccessed"] as string[]).join(", ") : "";
          const lines = [
            `- [${date}] "${ep.problem.slice(0, 100)}"`,
            `  Finding: ${summary.slice(0, 200)}`,
            tables ? `  Tables accessed: ${tables}` : null,
            toolResults ? `  Data seen: ${toolResults.slice(0, 120)}` : null,
          ].filter(Boolean);
          return lines.join("\n");
        })
        .join("\n");
      parts.push(
        `## PRIOR SESSION CONTEXT (from memory — these are snapshots from past sessions, not the current conversation)\n` +
        `Use these to recall prior findings and avoid repeating work. Re-verify if the user's question depends on them.\n` +
        episodeLines
      );
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
    onThinking,
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
  let finalText = "";
  const pendingApprovalSteps: string[] = [];
  const MAX_ROUNDS = queryDepth === "fast" ? 6 : 12;
  const toolSignatureCounts = new Map<string, number>();
  let resultFetchingAttempts = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Show a single updating "Thinking…" status while waiting for the first token.
    const roundStart = Date.now();
    let firstTokenReceived = false;
    onThinking?.("Thinking…");
    const thinkingTimer = setInterval(() => {
      if (!firstTokenReceived) {
        const elapsed = Math.round((Date.now() - roundStart) / 1000);
        onThinking?.(`Thinking… ${elapsed}s`);
      }
    }, 1_000);
    const wrappedOnToken = (tok: string) => {
      if (!firstTokenReceived) {
        firstTokenReceived = true;
        clearInterval(thinkingTimer);
        onThinking?.(null);
      }
      onToken(tok);
    };

    const { text, toolCalls, stopReason } = await withRetry(
      () =>
        provider.stream({
          system,
          history: working,
          model,
          tools: allTools,
          onToken: wrappedOnToken,
        }),
      {
        maxAttempts: 4,
        baseDelayMs: 2_000,
        onRetry: (attempt, delayMs, err) => {
          const isTimeout = err instanceof Error && (err.message.toLowerCase().includes("timed out") || err.message.toLowerCase().includes("timeout"));
          if (isTimeout) {
            onToken(`\n\n⏳ Model is taking longer than expected — retrying (attempt ${attempt}/4)…\n\n`);
          } else {
            onToken(`\n\n⚠ Rate limited — retrying in ${(delayMs / 1000).toFixed(0)}s (attempt ${attempt}/4)…\n\n`);
          }
        },
      }
    ).finally(() => clearInterval(thinkingTimer));

    finalText += text;

    // Record assistant turn
    const assistantTurn: ConversationTurn = { role: "assistant", text };
    if (toolCalls.length > 0) assistantTurn.toolCalls = toolCalls;
    working.push(assistantTurn);

    if (stopReason === "end_turn" || toolCalls.length === 0) break;

    // Execute tools in parallel — each gets an 8s individual timeout
    const toolResults: ConversationTurn["toolResults"] = [];

    const toolResultEntries = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolSignature = `${tc.name}:${JSON.stringify(tc.input ?? {})}`;
        const priorSignatureCount = toolSignatureCounts.get(toolSignature) ?? 0;
        toolSignatureCounts.set(toolSignature, priorSignatureCount + 1);

        if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) {
          if (queryDepth === "fast" && resultFetchingAttempts >= 2) {
            return {
              toolCallId: tc.id,
              name: tc.name,
              content:
                "Skipped additional data-fetch attempt because this fast analysis already exhausted its live-query budget. Use the currently loaded results or answer with the best available evidence.",
              isError: true,
            };
          }
          if (priorSignatureCount >= 1) {
            return {
              toolCallId: tc.id,
              name: tc.name,
              content:
                "Skipped duplicate data-fetch attempt. Do not repeat the same live query path; summarize the current evidence or choose a narrower alternative.",
              isError: true,
            };
          }
        }

        const cmd = toolCallToCommand(tc, connectionId);
        if (!cmd) {
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Unknown tool or missing connectionId: ${tc.name}`,
            isError: true,
          };
        }

        sessionCtx.toolsCalledSoFar.push(tc.name);
        try {
          await DATAIQ_HOOKS.onBeforeToolCall?.(tc.name, tc.input, sessionCtx);
        } catch (policyErr) {
          const errMsg = policyErr instanceof Error ? policyErr.message : String(policyErr);
          onToolEnd(tc.name, { success: false, error: errMsg });
          return { toolCallId: tc.id, name: tc.name, content: errMsg, isError: true };
        }

        onToolStart(tc.name, tc.input);

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
            command: cmd,
          });
          // Auto-reject after 30s so the agent never hangs indefinitely
          setTimeout(() => {
            const { planQueue, setPlanStepStatus } = useWorkspaceStore.getState();
            const still = planQueue.find((s) => s.id === stepId && s.status === "pending");
            if (still) {
              setPlanStepStatus(stepId, "rejected");
              onToken("\n\n⏱ Plan step auto-rejected after 30s inactivity.\n\n");
            }
          }, 30_000);
          onPlanQueued(stepId, description);
          pendingApprovalSteps.push(stepId);
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Queued for approval: "${description}". Waiting for user to approve in the Plan Queue.`,
            isError: false,
          };
        }

        try {
          const toolStartTime = Date.now();
          // No hard timeout — tools run to completion.
          // Show elapsed-time ETA every 5s for slow tools so the user sees progress.
          const INSTANT_TOOLS = new Set(["create_chart", "create_analysis_chart", "create_gog_chart",
            "set_editor_content", "focus_schema_node", "close_tab", "notify_user",
            "declare_hypotheses", "declare_confidence", "propose_workspace_rule"]);

          let progressTimer: ReturnType<typeof setInterval> | null = null;
          if (!INSTANT_TOOLS.has(tc.name)) {
            onThinking?.(`Running ${tc.name}…`);
            progressTimer = setInterval(() => {
              const elapsed = Math.round((Date.now() - toolStartTime) / 1000);
              onThinking?.(`Running ${tc.name}… ${elapsed}s`);
            }, 1_000);
          }

          const result = await commandBus.dispatch(cmd).finally(() => {
            if (progressTimer) clearInterval(progressTimer);
            if (!INSTANT_TOOLS.has(tc.name)) onThinking?.(null);
          });
          if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) resultFetchingAttempts++;

          // Push to undo stack on successful non-safe mutations
          if (result.success && cmd.risk !== "safe") {
            useWorkspaceStore.getState().pushUndo({
              id: tc.id,
              humanReadable: describeCommand(cmd),
              command: cmd,
              timestamp: Date.now(),
            });
          }

          const afterDurationMs = Date.now() - toolStartTime;
          try {
            await DATAIQ_HOOKS.onAfterToolCall?.(tc.name, tc.input, result, afterDurationMs, sessionCtx);
          } catch {
            // non-fatal hook error
          }
          if (!result.success) {
            sessionCtx.errorsSoFar.push({ tool: tc.name, error: result.error ?? 'unknown' });
          }
          onToolEnd(tc.name, result);
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: result.success
              ? JSON.stringify(result.result ?? "done")
              : `Error: ${result.error}`,
            isError: !result.success,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          onToolEnd(tc.name, { success: false, error: errMsg });
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Tool error: ${errMsg}`,
            isError: true,
          };
        }
      })
    );

    toolResults.push(...toolResultEntries);

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

  onThinking?.(null);
  // Trim to last 40 turns to keep context manageable
  const compacted = ContextEngine.compactHistory(working);
  return { finalText, updatedHistory: compacted, queryDepth, pendingApprovalSteps };
}
