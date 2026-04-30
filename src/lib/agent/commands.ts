/**
 * AgentCommand — the full typed union of every action the AI agent can take.
 *
 * These are not function calls — they are data. The CommandBus routes them
 * to the correct handler (Tauri invoke, WorkspaceStore mutation, or UI action).
 *
 * Risk levels (used by Plan Mode UI):
 *   safe        — read-only or reversible writes
 *   caution     — DDL that changes schema but is undoable
 *   destructive — data loss possible; always requires approval in Plan Mode
 */

export type RiskLevel = "safe" | "caution" | "destructive";

// ── SQL / Query ───────────────────────────────────────────────────────────────

export interface SetEditorContentCmd {
  type: "set_editor_content";
  sql: string;
  risk: "safe";
}

export interface ExecuteSqlCmd {
  type: "execute_sql";
  sql: string;
  connectionId: string;
  risk: "safe";
}

export interface CancelQueryCmd {
  type: "cancel_query";
  risk: "safe";
}

// ── Navigation ────────────────────────────────────────────────────────────────

export interface OpenTableCmd {
  type: "open_table";
  schema: string;
  table: string;
  risk: "safe";
}

export interface OpenNewTabCmd {
  type: "open_new_tab";
  title?: string;
  risk: "safe";
}

// ── Schema mutation ───────────────────────────────────────────────────────────

export interface AddColumnCmd {
  type: "add_column";
  schema: string;
  table: string;
  columnName: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  risk: "caution";
}

export interface DropColumnCmd {
  type: "drop_column";
  schema: string;
  table: string;
  columnName: string;
  risk: "destructive";
}

export interface RenameTableCmd {
  type: "rename_table";
  schema: string;
  oldName: string;
  newName: string;
  risk: "destructive";
}

// ── Data mutation ─────────────────────────────────────────────────────────────

export interface DeleteRowsCmd {
  type: "delete_rows";
  schema: string;
  table: string;
  where: string; // raw SQL WHERE clause — agent must be explicit
  estimatedCount?: number;
  risk: "destructive";
}

export interface BulkTransformCmd {
  type: "bulk_transform";
  sql: string; // full UPDATE/INSERT/MERGE SQL
  risk: "destructive";
}

// ── Schema helpers ────────────────────────────────────────────────────────────

export interface CreateIndexCmd {
  type: "create_index";
  schema: string;
  table: string;
  columns: string[];
  unique: boolean;
  indexName?: string;
  risk: "caution";
}

export interface FocusSchemaNodeCmd {
  type: "focus_schema_node";
  schema: string;
  table: string;
  risk: "safe";
}

// ── Single-row mutations ──────────────────────────────────────────────────────

export interface InsertRowCmd {
  type: "insert_row";
  schema: string;
  table: string;
  values: Record<string, unknown>;
  risk: "caution";
}

export interface UpdateCellCmd {
  type: "update_cell";
  schema: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  column: string;
  newValue: unknown;
  risk: "caution";
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface RunDuckDbAnalysisCmd {
  type: "run_duckdb_analysis";
  sql: string;
  risk: "safe";
}

// ── UI ────────────────────────────────────────────────────────────────────────

export interface NotifyUserCmd {
  type: "notify_user";
  message: string;
  level: "info" | "success" | "warning" | "error";
  risk: "safe";
}

export interface CloseTabCmd {
  type: "close_tab";
  tabId?: string; // omit to close active tab
  risk: "safe";
}

// ── Statistical Analysis (Pyodide) ────────────────────────────────────────────

export interface RunStatToolCmd {
  type: "run_stat_tool";
  /** Matches a key in STAT_KERNELS: describe | spc_xbar_r | capability | western_electric | regression | fft | anomaly_zscore */
  method: string;
  params: Record<string, unknown>;
  risk: "safe";
}

// ── User-Defined Tools ────────────────────────────────────────────────────────

export interface RunUserToolCmd {
  type: "run_user_tool";
  /** Matches UserTool.id — used to look up the tool from UserToolStore */
  toolId: string;
  params: Record<string, unknown>;
  connectionId: string | null;
  risk: "safe" | "caution";
}

// ── Analytics (advanced) ──────────────────────────────────────────────────────

export interface CreateChartCmd {
  type: "create_chart";
  chartType: "bar" | "line" | "scatter" | "pie" | "area";
  xColumn: string;
  yColumn: string;
  title?: string;
  risk: "safe";
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface CreatePipelineCmd {
  type: "create_pipeline";
  name: string;
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
  risk: "caution";
}

// ── Hypothesis Engine ─────────────────────────────────────────────────────────

export interface Hypothesis {
  statement: string;
  probability: number;
  evidence_for?: string;
  evidence_against?: string;
  discriminating_test?: string;
}

export interface DeclareHypothesesCmd {
  type: "declare_hypotheses";
  hypotheses: Hypothesis[];
  problemFrame: string;
  risk: "safe";
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type AgentCommand =
  | SetEditorContentCmd
  | ExecuteSqlCmd
  | CancelQueryCmd
  | OpenTableCmd
  | OpenNewTabCmd
  | CloseTabCmd
  | AddColumnCmd
  | DropColumnCmd
  | RenameTableCmd
  | DeleteRowsCmd
  | BulkTransformCmd
  | CreateIndexCmd
  | FocusSchemaNodeCmd
  | InsertRowCmd
  | UpdateCellCmd
  | RunDuckDbAnalysisCmd
  | RunStatToolCmd
  | RunUserToolCmd
  | CreateChartCmd
  | CreatePipelineCmd
  | NotifyUserCmd
  | DeclareHypothesesCmd;

export type CommandType = AgentCommand["type"];

/** Commands that always require user approval, even in Auto Mode. */
export const DESTRUCTIVE_COMMANDS = new Set<CommandType>([
  "drop_column",
  "rename_table",
  "delete_rows",
  "bulk_transform",
]);

export function isDestructive(cmd: AgentCommand): boolean {
  return DESTRUCTIVE_COMMANDS.has(cmd.type);
}

/** Human-readable summary of a command for Plan Mode display. */
export function describeCommand(cmd: AgentCommand): string {
  switch (cmd.type) {
    case "set_editor_content": return `Write SQL to editor`;
    case "execute_sql": return `Execute SQL query`;
    case "cancel_query": return `Cancel running query`;
    case "open_table": return `Open table: ${cmd.schema}.${cmd.table}`;
    case "open_new_tab": return `Open new tab${cmd.title ? `: ${cmd.title}` : ""}`;
    case "add_column": return `Add column "${cmd.columnName}" (${cmd.dataType}) to ${cmd.schema}.${cmd.table}`;
    case "drop_column": return `DROP column "${cmd.columnName}" from ${cmd.schema}.${cmd.table}`;
    case "rename_table": return `Rename ${cmd.schema}.${cmd.oldName} → ${cmd.newName}`;
    case "delete_rows": return `DELETE rows from ${cmd.schema}.${cmd.table} WHERE ${cmd.where}`;
    case "bulk_transform": return `Bulk SQL: ${cmd.sql.slice(0, 60)}…`;
    case "create_index": return `CREATE ${cmd.unique ? "UNIQUE " : ""}INDEX on ${cmd.schema}.${cmd.table}(${cmd.columns.join(", ")})`;
    case "focus_schema_node": return `Focus ${cmd.schema}.${cmd.table} in sidebar`;
    case "insert_row": return `INSERT INTO ${cmd.schema}.${cmd.table}`;
    case "update_cell": return `UPDATE ${cmd.schema}.${cmd.table} SET ${cmd.column} WHERE ${cmd.pkColumn}=${cmd.pkValue}`;
    case "run_stat_tool": return `Stat analysis: ${cmd.method}`;
    case "run_user_tool": return `User tool: ${cmd.toolId}`;
    case "run_duckdb_analysis": return `DuckDB: ${cmd.sql.slice(0, 60)}…`;
    case "create_chart": return `Create ${cmd.chartType} chart: ${cmd.xColumn} vs ${cmd.yColumn}`;
    case "create_pipeline": return `Create pipeline "${cmd.name}" → ${cmd.targetTable}`;
    case "close_tab": return cmd.tabId ? `Close tab ${cmd.tabId}` : `Close active tab`;
    case "notify_user": return `Notify: ${cmd.message}`;
    case "declare_hypotheses": return `Declare ${cmd.hypotheses.length} hypothesis${cmd.hypotheses.length !== 1 ? "es" : ""}: ${cmd.problemFrame.slice(0, 60)}`;
  }
}
