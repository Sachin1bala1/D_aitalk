/**
 * registerHandlers — wire every AgentCommand to its implementation.
 *
 * Call once at app startup (App.tsx). After this, `commandBus.dispatch(cmd)`
 * will route to the correct Tauri invoke / WorkspaceStore mutation / UI action.
 */
import { toast } from "sonner";

import { commandBus } from "./CommandBus";
import { DbClient } from "../db/DbClient";
import { rowStore } from "../table/RowStore";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { collectStreamingQuery, runDuckDbQuery } from "../query/runtime";
import type {
  SetEditorContentCmd,
  ExecuteSqlCmd,
  CancelQueryCmd,
  OpenTableCmd,
  OpenNewTabCmd,
  CloseTabCmd,
  AddColumnCmd,
  DropColumnCmd,
  RenameTableCmd,
  DeleteRowsCmd,
  BulkTransformCmd,
  CreateIndexCmd,
  FocusSchemaNodeCmd,
  InsertRowCmd,
  UpdateCellCmd,
  RunDuckDbAnalysisCmd,
  CreateChartCmd,
  CreatePipelineCmd,
  NotifyUserCmd,
} from "./commands";

export function registerHandlers() {
  // ── SQL ───────────────────────────────────────────────────────────────────

  commandBus.register<SetEditorContentCmd>("set_editor_content", async (cmd) => {
    useWorkspaceStore.getState().setEditorSql(cmd.sql);
    return { success: true, result: "SQL written to editor" };
  });

  commandBus.register<ExecuteSqlCmd>("execute_sql", async (cmd) => {
    const { setEditorSql, setTabExecuting, setQueryResults, activeTabId } =
      useWorkspaceStore.getState();

    setEditorSql(cmd.sql);
    setTabExecuting(true);

    try {
      const result = await collectStreamingQuery(cmd.connectionId, cmd.sql);
      rowStore.finalize();
      setTabExecuting(false);
      setQueryResults({
        rows: result.rows,
        fields: result.fields,
        rowCount: result.rows.length,
        elapsedMs: result.elapsedMs,
        queryId: result.queryId,
        source_tables: result.source_tables,
      });
      return {
        success: true,
        result: {
          rowCount: result.rows.length,
          elapsedMs: result.elapsedMs,
          preview: result.rows.slice(0, 5),
        },
      };
    } catch (e: any) {
      setTabExecuting(false);
      rowStore.finalize();
      return { success: false, error: e.message ?? "Query failed" };
    }
  });

  commandBus.register<CancelQueryCmd>("cancel_query", async () => {
    useWorkspaceStore.getState().setTabExecuting(false);
    rowStore.finalize();
    return { success: true, result: "Query cancelled" };
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  commandBus.register<OpenTableCmd>("open_table", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    const conn = connections.find((c) => c.id === (activeConnectionId ?? ""));
    const driver = conn?.driver ?? "postgres";

    let sql: string;
    if (driver === "mongodb") {
      // MongoDB streaming uses collection name as the "SQL" parameter
      sql = cmd.table;
    } else if (driver === "redis") {
      // Redis streaming uses prefix (part before first ':')
      sql = cmd.table;
    } else {
      sql = `SELECT * FROM "${cmd.schema}"."${cmd.table}" LIMIT 500;`;
    }

    useWorkspaceStore.getState().setEditorSql(sql);
    return { success: true, result: `Opened ${cmd.schema}.${cmd.table}` };
  });

  commandBus.register<OpenNewTabCmd>("open_new_tab", async (cmd) => {
    const { addTab } = useWorkspaceStore.getState();
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      type: "sql_editor",
      title: cmd.title ?? "New Query",
      sql: "",
      connectionId: useWorkspaceStore.getState().activeConnectionId,
      queryResults: null,
      isExecuting: false,
    });
    return { success: true, result: `Opened new tab: ${cmd.title ?? "New Query"}` };
  });

  // ── Schema mutation ───────────────────────────────────────────────────────

  commandBus.register<AddColumnCmd>("add_column", async (cmd) => {
    const { activeConnectionId, pushUndo, setSchema } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    try {
      await DbClient.addColumn(
        activeConnectionId,
        cmd.schema,
        cmd.table,
        cmd.columnName,
        cmd.dataType,
        cmd.nullable,
        cmd.defaultValue,
      );
      pushUndo({
        id: `undo-${Date.now()}`,
        humanReadable: `Added column ${cmd.columnName} to ${cmd.schema}.${cmd.table}`,
        command: cmd,
        timestamp: Date.now(),
      });
      const schema = await DbClient.getSchema(activeConnectionId);
      setSchema(activeConnectionId, schema);
      return { success: true, result: `Added column ${cmd.columnName} to ${cmd.schema}.${cmd.table}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<DropColumnCmd>("drop_column", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === activeConnectionId)?.driver;
    const noSqlDrivers = ["mongodb", "redis", "clickhouse"];
    if (driver && noSqlDrivers.includes(driver)) {
      return { success: false, error: `DROP COLUMN is not supported for ${driver}. Use the native shell or driver tools.` };
    }
    try {
      await DbClient.execute(
        activeConnectionId,
        `ALTER TABLE "${cmd.schema}"."${cmd.table}" DROP COLUMN "${cmd.columnName}";`,
      );
      const schema = await DbClient.getSchema(activeConnectionId);
      useWorkspaceStore.getState().setSchema(activeConnectionId, schema);
      return { success: true, result: `Dropped column ${cmd.columnName}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<RenameTableCmd>("rename_table", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === connectionId)?.driver;
    const noSqlDrivers = ["mongodb", "redis", "clickhouse"];
    if (driver && noSqlDrivers.includes(driver)) {
      return { success: false, error: `RENAME TABLE is not supported for ${driver}. Use the native shell or driver tools.` };
    }
    try {
      await DbClient.execute(
        connectionId,
        `ALTER TABLE "${cmd.schema}"."${cmd.oldName}" RENAME TO "${cmd.newName}";`,
      );
      const schema = await DbClient.getSchema(connectionId);
      useWorkspaceStore.getState().setSchema(connectionId, schema);
      return { success: true, result: `Renamed ${cmd.oldName} to ${cmd.newName}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Data mutation ─────────────────────────────────────────────────────────

  commandBus.register<DeleteRowsCmd>("delete_rows", async (cmd) => {
    const { activeConnectionId, setEditorSql } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    const reviewSql = `DELETE FROM "${cmd.schema}"."${cmd.table}" WHERE ${cmd.where};`;
    setEditorSql(reviewSql);
    DbClient.recordSecurityAudit({
      event_type: "destructive_action_execution",
      outcome: "manual_review_required",
      details_json: {
        command_type: cmd.type,
        schema: cmd.schema,
        table: cmd.table,
      },
    }).catch(() => {});
    toast.warning("Destructive SQL was loaded into the editor for manual review.");
    return {
      success: true,
      result: "Delete statement loaded into the editor. Review and run it manually if you approve.",
    };
  });

  commandBus.register<BulkTransformCmd>("bulk_transform", async (cmd) => {
    const { activeConnectionId, setEditorSql } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    setEditorSql(cmd.sql);
    DbClient.recordSecurityAudit({
      event_type: "destructive_action_execution",
      outcome: "manual_review_required",
      details_json: {
        command_type: cmd.type,
      },
    }).catch(() => {});
    toast.warning("Bulk transform SQL was loaded into the editor for manual review.");
    return {
      success: true,
      result: "Bulk transform SQL loaded into the editor. Review and run it manually if you approve.",
    };
  });

  // ── Schema helpers ────────────────────────────────────────────────────────

  commandBus.register<CreateIndexCmd>("create_index", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === connectionId)?.driver;
    if (driver === "mongodb") return { success: false, error: "Use MongoDB's createIndex() via the shell for index management." };
    if (driver === "redis") return { success: false, error: "Redis does not support SQL indexes." };
    if (driver === "clickhouse") return { success: false, error: "ClickHouse does not support CREATE INDEX — use ORDER BY / MergeTree settings instead." };
    try {
      const uniqueStr = cmd.unique ? "UNIQUE " : "";
      const namePart = cmd.indexName ? `"${cmd.indexName}"` : "";
      const colsPart = cmd.columns.map((c) => `"${c}"`).join(", ");
      const sql = `CREATE ${uniqueStr}INDEX ${namePart} ON "${cmd.schema}"."${cmd.table}" (${colsPart});`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Created index on ${cmd.schema}.${cmd.table}(${cmd.columns.join(", ")})` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<FocusSchemaNodeCmd>("focus_schema_node", async (cmd) => {
    useWorkspaceStore.getState().setFocusedNode(`${cmd.schema}.${cmd.table}`);
    toast.info(`Focusing ${cmd.schema}.${cmd.table} in schema tree`);
    return { success: true, result: `Focused ${cmd.schema}.${cmd.table}` };
  });

  // ── Single-row mutations ──────────────────────────────────────────────────

  commandBus.register<InsertRowCmd>("insert_row", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const cols = Object.keys(cmd.values).map((c) => `"${c}"`).join(", ");
      const vals = Object.values(cmd.values)
        .map((v) => (v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v)))
        .join(", ");
      const sql = `INSERT INTO "${cmd.schema}"."${cmd.table}" (${cols}) VALUES (${vals});`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Inserted 1 row into ${cmd.schema}.${cmd.table}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<UpdateCellCmd>("update_cell", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const newVal = cmd.newValue === null ? "NULL" : typeof cmd.newValue === "string"
        ? `'${String(cmd.newValue).replace(/'/g, "''")}'`
        : String(cmd.newValue);
      const pkVal = typeof cmd.pkValue === "string"
        ? `'${String(cmd.pkValue).replace(/'/g, "''")}'`
        : String(cmd.pkValue);
      const sql = `UPDATE "${cmd.schema}"."${cmd.table}" SET "${cmd.column}" = ${newVal} WHERE "${cmd.pkColumn}" = ${pkVal};`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Updated ${cmd.schema}.${cmd.table}.${cmd.column}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  commandBus.register<RunDuckDbAnalysisCmd>("run_duckdb_analysis", async (cmd) => {
    try {
      return await new Promise((resolve) => {
        runDuckDbQuery(cmd.sql, {
          onSuccess(results) {
            resolve({
              success: true,
              result: `DuckDB analysis complete: ${results.rows.length} rows`,
            });
          },
          onError(message) {
            resolve({ success: false, error: message });
          },
          onSettled() {
            rowStore.finalize();
          },
        }).catch((error: any) => {
          rowStore.finalize();
          resolve({ success: false, error: error?.message ?? "DuckDB query failed" });
        });
      });
    } catch (e: any) {
      rowStore.finalize();
      return { success: false, error: e.message ?? "DuckDB query failed" };
    }
  });

  // ── Tab management ────────────────────────────────────────────────────────

  commandBus.register<CloseTabCmd>("close_tab", async (cmd) => {
    const { activeTabId, closeTab } = useWorkspaceStore.getState();
    const targetId = cmd.tabId ?? activeTabId;
    if (!targetId) return { success: false, error: "No tab to close" };
    closeTab(targetId);
    return { success: true, result: `Closed tab ${targetId}` };
  });

  // ── Charts (stub — renders in future ChartPanel) ──────────────────────────

  commandBus.register<CreateChartCmd>("create_chart", async (cmd) => {
    useWorkspaceStore.getState().setChartRequest({
      chartType: cmd.chartType,
      xColumn: cmd.xColumn,
      yColumn: cmd.yColumn,
      title: cmd.title,
    });
    toast.success(`Chart: ${cmd.chartType} — ${cmd.xColumn} vs ${cmd.yColumn}`);
    return { success: true, result: `Chart opened: ${cmd.chartType}` };
  });

  // ── Pipeline (stub — wires to future PipelinePanel) ──────────────────────

  commandBus.register<CreatePipelineCmd>("create_pipeline", async (cmd) => {
    // TODO: wire to PipelinePanel when implemented
    toast.info(`Pipeline "${cmd.name}": ${cmd.sourceQuery} → ${cmd.targetTable}`);
    return { success: true, result: `Pipeline "${cmd.name}" registered` };
  });

  // ── UI ────────────────────────────────────────────────────────────────────

  commandBus.register<NotifyUserCmd>("notify_user", async (cmd) => {
    const fn = {
      info: toast.info,
      success: toast.success,
      warning: toast.warning,
      error: toast.error,
    }[cmd.level];
    fn(cmd.message);
    return { success: true };
  });
}
