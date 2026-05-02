/**
 * registerHandlers — wire every AgentCommand to its implementation.
 *
 * Call once at app startup (App.tsx). After this, `commandBus.dispatch(cmd)`
 * will route to the correct Tauri invoke / WorkspaceStore mutation / UI action.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { commandBus } from "./CommandBus";
import { DbClient } from "../db/DbClient";
import { rowStore } from "../table/RowStore";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { QueryBatch } from "../db/DbClient";
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
  RunStatToolCmd,
  RunUserToolCmd,
  CreateChartCmd,
  CreatePipelineCmd,
  NotifyUserCmd,
  DeclareHypothesesCmd,
  DeclareConfidenceCmd,
  ConfidenceDeclaration,
  PISearchTagsCmd,
  PIGetHistoryCmd,
  PIGetCurrentCmd,
} from "./commands";
import { useUserToolStore } from "../stores/UserToolStore";
import { fillTemplate } from "../tools/user.tools";
import { PyodideRuntime } from "../pyodide/PyodideRuntime";
import { STAT_KERNELS } from "../pyodide/stat_kernels";

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
      const response = await DbClient.executeStreaming(cmd.connectionId, cmd.sql);
      const queryId = response.query_id;
      rowStore.reset(queryId);

      return new Promise((resolve) => {
        const allRows: Record<string, unknown>[] = [];
        let fields: { name: string }[] = [];
        let unlistenFn: (() => void) | null = null;

        listen<QueryBatch>("query_batch", (event) => {
          const batch = event.payload;
          if (batch.query_id !== queryId) return;

          rowStore.appendBatch(batch);

          if (batch.columns && fields.length === 0) {
            fields = batch.columns.map((c) => ({ name: c.name }));
          }
          allRows.push(...batch.rows);

          if (batch.error) {
            unlistenFn?.();
            rowStore.finalize();
            setTabExecuting(false);
            resolve({ success: false, error: batch.error });
          } else if (batch.is_final) {
            unlistenFn?.();
            setTabExecuting(false);
            // Update WorkspaceStore for AIPanel context
            setQueryResults({
              rows: allRows,
              fields,
              rowCount: allRows.length,
              elapsedMs: batch.total_elapsed_ms,
              queryId,
              source_tables: response.source_tables,
            });
            resolve({
              success: true,
              result: {
                rowCount: allRows.length,
                elapsedMs: batch.total_elapsed_ms,
                preview: allRows.slice(0, 5), // first 5 rows for AI context
              },
            });
          }
        }).then((fn) => {
          unlistenFn = fn;
        });
      });
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
    const { activeConnectionId, pushUndo } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    try {
      const affected = await DbClient.execute(
        activeConnectionId,
        `DELETE FROM "${cmd.schema}"."${cmd.table}" WHERE ${cmd.where};`,
      );
      pushUndo({
        id: `undo-${Date.now()}`,
        humanReadable: `Deleted rows from ${cmd.schema}.${cmd.table} WHERE ${cmd.where}`,
        command: cmd,
        timestamp: Date.now(),
      });
      return { success: true, result: `Deleted ${affected} rows` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<BulkTransformCmd>("bulk_transform", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const affected = await DbClient.execute(connectionId, cmd.sql);
      return { success: true, result: `${affected} rows affected` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
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

  // ── Statistical Analysis (Pyodide) ───────────────────────────────────────

  commandBus.register<RunStatToolCmd>("run_stat_tool", async (cmd) => {
    const kernelCode = STAT_KERNELS[cmd.method];
    if (!kernelCode) {
      return { success: false, error: `Unknown stat method: ${cmd.method}` };
    }
    try {
      const result = await PyodideRuntime.getInstance().run(kernelCode, cmd.params);
      return { success: true, result };
    } catch (e: any) {
      return { success: false, error: e.message ?? "Stat kernel failed" };
    }
  });

  // ── User-Defined Tools ────────────────────────────────────────────────────

  commandBus.register<RunUserToolCmd>("run_user_tool", async (cmd) => {
    const tool = useUserToolStore.getState().tools.find((t) => t.id === cmd.toolId);
    if (!tool) {
      return { success: false, error: `User tool not found: ${cmd.toolId}` };
    }

    const { body } = tool;

    if (body.type === "notify") {
      return commandBus.dispatch({
        type: "notify_user",
        message: fillTemplate(body.message, cmd.params),
        level: body.level,
        risk: "safe",
      });
    }

    if (body.type === "sql_template") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      return commandBus.dispatch({
        type: "execute_sql",
        sql: fillTemplate(body.sql, cmd.params),
        connectionId: cmd.connectionId,
        risk: "safe",
      });
    }

    if (body.type === "chart") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      const queryResult = await commandBus.dispatch({
        type: "execute_sql",
        sql: fillTemplate(body.sql, cmd.params),
        connectionId: cmd.connectionId,
        risk: "safe",
      });
      if (!queryResult.success) return queryResult;
      return commandBus.dispatch({
        type: "create_chart",
        chartType: body.chartType,
        xColumn: body.xColumn,
        yColumn: body.yColumn,
        title: body.title ?? tool.displayName,
        risk: "safe",
      });
    }

    if (body.type === "report") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      const results: Array<{ label: string; data: unknown }> = [];
      for (const step of body.steps) {
        const r = await commandBus.dispatch({
          type: "execute_sql",
          sql: fillTemplate(step.sql, cmd.params),
          connectionId: cmd.connectionId,
          risk: "safe",
        });
        if (!r.success) return r;
        results.push({ label: step.label, data: r.result });
      }
      return { success: true, result: results };
    }

    return { success: false, error: "Unknown user tool body type" };
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  commandBus.register<RunDuckDbAnalysisCmd>("run_duckdb_analysis", async (cmd) => {
    try {
      const queryId = await DbClient.duckdbQuery(cmd.sql);
      rowStore.reset(queryId);

      return new Promise((resolve) => {
        let unlistenFn: (() => void) | null = null;

        listen<QueryBatch>("query_batch", (event) => {
          const batch = event.payload;
          if (batch.query_id !== queryId) return;

          rowStore.appendBatch(batch);

          if (batch.error) {
            unlistenFn?.();
            rowStore.finalize();
            resolve({ success: false, error: batch.error });
          } else if (batch.is_final) {
            unlistenFn?.();
            resolve({ success: true, result: `DuckDB analysis complete: ${batch.rows_so_far} rows` });
          }
        }).then((fn) => {
          unlistenFn = fn;
        });
      });
    } catch (e: any) {
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

  // ── Hypothesis Engine ─────────────────────────────────────────────────────

  commandBus.register<DeclareHypothesesCmd>("declare_hypotheses", async (cmd) => {
    useWorkspaceStore.getState().setActiveHypotheses(cmd.hypotheses, cmd.problemFrame);
    return { success: true, result: "Hypotheses declared" };
  });

  // ── Confidence Scoring ────────────────────────────────────────────────────

  commandBus.register<DeclareConfidenceCmd>("declare_confidence", async (cmd) => {
    const { type, risk, ...declaration } = cmd;
    useWorkspaceStore.getState().setActiveConfidence(declaration as ConfidenceDeclaration);
    return { success: true, result: "Confidence declared" };
  });

  // ── OSIsoft PI Historian ──────────────────────────────────────────────────

  commandBus.register<PISearchTagsCmd>("pi_search_tags", async (cmd) => {
    try {
      const tags = await invoke("pi_search_tags", {
        connectionId: cmd.connectionId,
        query: cmd.query,
        maxCount: cmd.maxCount,
      });
      return { success: true, result: tags };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  commandBus.register<PIGetHistoryCmd>("pi_get_history", async (cmd) => {
    try {
      const data = await invoke("pi_get_history", {
        connectionId: cmd.connectionId,
        webIds: cmd.webIds,
        start: cmd.start,
        end: cmd.end,
        interval: cmd.interval,
      });
      return { success: true, result: data };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  commandBus.register<PIGetCurrentCmd>("pi_get_current", async (cmd) => {
    try {
      const values = await invoke("pi_get_current", {
        connectionId: cmd.connectionId,
        webIds: cmd.webIds,
      });
      return { success: true, result: values };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
