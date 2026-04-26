/**
 * AgentLoop — provider-agnostic agentic loop.
 *
 * Works with any AIProvider (Claude, Gemini, OpenAI, NVIDIA NIM).
 * Dispatches tool calls through CommandBus, handles Plan Mode queuing.
 */
import { commandBus } from "./CommandBus";
import { AGENT_TOOLS } from "./toolDefinitions";
import { isDestructive, describeCommand } from "./commands";
import type { AgentCommand, RunUserToolCmd } from "./commands";
import { useUserToolStore } from "../stores/UserToolStore";
import { userToolToUnifiedTool } from "../tools/user.tools";
import { statToolToKernelKey } from "../tools/stat.tools";
import type { CommandResult } from "./CommandBus";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { FullSchema } from "../db/DbClient";
import type { QueryResults } from "../stores/WorkspaceStore";
import type { AIProvider, ConversationTurn, ToolCall } from "../ai/types";
import { withRetry } from "../ai/resilience";

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  schema: FullSchema | null,
  currentSQL: string | null,
  currentResults: QueryResults | null,
  agentMode: "plan" | "auto"
): string {
  const parts: string[] = [];

  parts.push(
    `You are APEX — Autonomous Process Engineering eXpert, embedded in Daitalk: a desktop SQL IDE.
You reason and communicate like a 30-year senior process engineer: precise, evidence-driven, and always honest about uncertainty.
You have full agentic control: write and execute SQL, run statistical analyses, inspect schemas, modify tables, manage data.
You operate in ${agentMode.toUpperCase()} MODE.

${
  agentMode === "plan"
    ? "PLAN MODE: Destructive commands (delete_rows, drop_column, rename_table, bulk_transform) are queued for user approval before executing. Safe commands run immediately."
    : "AUTO MODE: All commands execute immediately. Always explain destructive operations in your text response before calling those tools."
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

  if (currentSQL) {
    parts.push(`CURRENT SQL IN EDITOR:\n\`\`\`sql\n${currentSQL}\n\`\`\``);
  }

  if (currentResults) {
    const cols = currentResults.fields.map((f) => f.name).join(", ");
    const sample = JSON.stringify(currentResults.rows.slice(0, 3), null, 2);
    parts.push(
      `LAST QUERY RESULTS: ${currentResults.rowCount} rows in ${currentResults.elapsedMs}ms\nColumns: ${cols}\nSample:\n${sample}`
    );
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
- Schema is otherwise identical to PostgreSQL`);
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

  parts.push(`GUIDELINES:
- Explain what you are doing before calling tools
- Use execute_sql to fetch data for answering questions
- Use set_editor_content when the user wants to review SQL before running
- Quote all SQL identifiers: "schema"."table"."column"
- Never call delete_rows or drop_column without explicit user confirmation`);

  return parts.join("\n\n");
}

// ── Tool input → AgentCommand ─────────────────────────────────────────────────

function toolCallToCommand(
  tc: ToolCall,
  connectionId: string | null
): AgentCommand | null {
  const i = tc.input;
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
        title: i.title as string | undefined,
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
    case "notify_user":
      return {
        type: "notify_user",
        message: i.message as string,
        level: i.level as "info" | "success" | "warning" | "error",
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
): Promise<{ finalText: string; updatedHistory: ConversationTurn[] }> {
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

  const { agentMode, addPlanStep } = useWorkspaceStore.getState();
  const system = buildSystemPrompt(schema, currentSQL, currentResults, agentMode);

  // Append the user message to working history
  const working: ConversationTurn[] = [
    ...history,
    { role: "user", text: userMessage },
  ];

  const userToolDefs = useUserToolStore.getState().tools.map(userToolToUnifiedTool);
  const allTools = [...AGENT_TOOLS, ...userToolDefs];

  let finalText = "";
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { text, toolCalls, stopReason } = await withRetry(
      () => provider.stream({
        system,
        history: working,
        model,
        tools: allTools,
        onToken,
      }),
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

      onToolStart(tc.name, tc.input);

      let result: CommandResult;

      if (agentMode === "plan" && isDestructive(cmd)) {
        const stepId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const description = describeCommand(cmd);

        addPlanStep({
          id: stepId,
          commandType: cmd.type,
          humanReadable: description,
          riskLevel: cmd.risk,
          status: "pending",
          command: cmd, // stored so PlanQueue can dispatch on approval
        });

        onPlanQueued(stepId, description);

        result = {
          success: true,
          result: `Queued for approval: "${description}". Waiting for user to approve in the Plan Queue.`,
        };
      } else {
        result = await commandBus.dispatch(cmd);

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
  }

  // Trim to last 40 turns to keep context manageable
  return { finalText, updatedHistory: working.slice(-40) };
}
