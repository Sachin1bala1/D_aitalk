import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toaster, toast } from "sonner";
import { Database, Play, Save, FolderOpen, Plus, Settings, GitCommitVertical, RotateCcw, Square, Zap, Upload, AlignLeft } from "lucide-react";

import { format as formatSql } from "sql-formatter";
import { useWorkspaceStore } from "./lib/stores/WorkspaceStore";
import { DbClient, QueryBatch } from "./lib/db/DbClient";
import { rowStore } from "./lib/table/RowStore";
import { QueryManager } from "./lib/table/QueryManager";
import { pushHistory } from "./components/history/QueryHistory";

import { SQLEditor } from "./components/editor/SQLEditor";
import { TabBar } from "./components/editor/TabBar";
import { VirtualTable } from "./components/table/VirtualTable";
import { Sidebar } from "./components/schema/Sidebar";
import { ConnectionDialog } from "./components/dialogs/ConnectionDialog";
import { AIPanel } from "./components/ai/AIPanel";
import { AgentModeToggle } from "./components/ai/AgentModeToggle";
import { registerHandlers } from "./lib/agent/registerHandlers";
import { loadSavedConnectionsAsync, saveConnection, removeConnection as removePersistedConnection } from "./lib/db/ConnectionStore";
import { ERDiagram } from "./components/schema/ERDiagram";
import { KeyboardShortcutsDialog } from "./components/dialogs/KeyboardShortcutsDialog";
import { FileImportDialog } from "./components/dialogs/FileImportDialog";
import { DDLModal } from "./components/dialogs/DDLModal";
import { SnippetsPanel } from "./components/editor/SnippetsPanel";
import { SchemaSearch } from "./components/schema/SchemaSearch";
import { BindParamsDialog, detectParams } from "./components/dialogs/BindParamsDialog";
import { SessionMonitor } from "./components/panels/SessionMonitor";
import { DatabaseOverview } from "./components/panels/DatabaseOverview";
import { QuickOpenDialog } from "./components/dialogs/QuickOpenDialog";
import { WelcomeScreen } from "./components/onboarding/WelcomeScreen";
import { OnboardingTour } from "./components/onboarding/OnboardingTour";

export default function App() {
  const {
    activeConnectionId,
    connections,
    schemas,
    tabs,
    activeTabId,
    planQueue,
    focusedNode,
    setSchema,
    setActiveConnection,
    addConnection,
    removeConnection,
    setConnectionHealth,
    connectionHealth,
    setEditorSql,
    setQueryResults,
    setTabExecuting,
    updateTab,
    popUndo,
    undoStack,
  } = useWorkspaceStore();

  const [isConnecting, setIsConnecting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem("daitalk_onboarding_dismissed"));
  const [showTour, setShowTour] = useState(false);
  const [activePanel, setActivePanel] = useState<"history" | "agent" | "erd" | "snippets" | "search" | "sessions" | "overview">("agent");
  const [inTransaction, setInTransaction] = useState(false);
  const [autoCommit, setAutoCommit] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fileImportOpen, setFileImportOpen] = useState(false);
  const [ddlModal, setDdlModal] = useState<{ schema: string; table: string; customQuery?: string; title?: string; subtitle?: string } | null>(null);
  const [editorPct, setEditorPct] = useState(45);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [bindParams, setBindParams] = useState<{ open: boolean; sql: string } | null>(null);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);

  // Cancel query refs — survive re-renders without state
  const currentQueryIdRef = useRef<string | null>(null);
  const currentUnlistenRef = useRef<(() => void) | null>(null);

  // Register CommandBus handlers once on mount + restore saved connections
  useEffect(() => {
    registerHandlers();
    restoreSavedConnections();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s" && !e.shiftKey) { e.preventDefault(); handleSaveSql(); }
      if (ctrl && e.key === "o") { e.preventDefault(); handleOpenFile(); }
      if (ctrl && e.key === "/") { e.preventDefault(); setShortcutsOpen(true); }
      if (ctrl && e.shiftKey && e.key === "F") { e.preventDefault(); handleFormatSql(); }
      if (ctrl && e.key === "t") { e.preventDefault(); /* new tab handled in TabBar */ }
      if (e.key === "F5" && e.shiftKey) { e.preventDefault(); handleExplain(); }
      // Ctrl+K — focus AI chat input
      if (ctrl && e.key === "k") {
        e.preventDefault();
        setActivePanel("agent");
        setTimeout(() => {
          (document.querySelector("[data-ai-input]") as HTMLTextAreaElement | null)?.focus();
        }, 60);
      }
      // Ctrl+Shift+S — open schema search panel
      if (ctrl && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setActivePanel("search");
      }
      // Ctrl+P — quick open table picker
      if (ctrl && e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        setQuickOpenOpen(true);
      }
      // Ctrl+Z — undo last agent mutation
      if (ctrl && e.key === "z" && !e.shiftKey) {
        const entry = useWorkspaceStore.getState().popUndo();
        if (entry) {
          toast.info(`Undo: ${entry.humanReadable}`);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Schema auto-refresh: compare table fingerprint every 60s, notify if changed
  const schemaFingerprintRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (connections.length === 0) return;
    const fingerprint = (s: typeof schemas[string] | undefined) =>
      s ? s.tables.map((t: { schema: string; name: string }) => `${t.schema}.${t.name}`).sort().join("|") : "";

    const check = async () => {
      for (const conn of connections) {
        try {
          const fresh = await DbClient.getSchema(conn.id);
          const prev = schemaFingerprintRef.current[conn.id];
          const next = fingerprint(fresh);
          if (prev !== undefined && prev !== next) {
            setSchema(conn.id, fresh);
            toast.info(`Schema changed on ${conn.display_name} — refreshed`, {
              description: "Another session may have run DDL. Schema sidebar updated.",
              duration: 6000,
            });
          }
          schemaFingerprintRef.current[conn.id] = next;
        } catch {
          // network error — ignore silently, health ping handles this
        }
      }
    };
    // Set initial fingerprints without toast
    for (const conn of connections) {
      const s = schemas[conn.id];
      if (s) schemaFingerprintRef.current[conn.id] = s.tables.map((t) => `${t.schema}.${t.name}`).sort().join("|");
    }
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [connections.map((c) => c.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connection health ping — every 30 seconds
  useEffect(() => {
    if (connections.length === 0) return;
    const ping = async () => {
      for (const conn of connections) {
        setConnectionHealth(conn.id, "checking");
        try {
          await DbClient.ping(conn.id);
          setConnectionHealth(conn.id, "healthy");
        } catch {
          setConnectionHealth(conn.id, "error");
        }
      }
    };
    ping(); // immediate first check
    const id = setInterval(ping, 30_000);
    return () => clearInterval(id);
  }, [connections.map((c) => c.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const restoreSavedConnections = async () => {
    const saved = await loadSavedConnectionsAsync();
    if (saved.length === 0) return;

    let firstRestoredId: string | null = null;

    // Try to reconnect all saved connections in parallel
    await Promise.allSettled(
      saved.map(async (config) => {
        try {
          await DbClient.connect(config);
          addConnection(config);
          const schema = await DbClient.getSchema(config.id);
          setSchema(config.id, schema);
          setConnectionHealth(config.id, "healthy");
          if (!firstRestoredId) firstRestoredId = config.id;
        } catch {
          // Individual failure is non-fatal — user can reconnect manually
        }
      })
    );

    if (firstRestoredId) {
      setActiveConnection(firstRestoredId);
      updateTab(activeTabId, { connectionId: firstRestoredId });
      toast.success(
        saved.length === 1
          ? `Reconnected to ${saved[0].display_name}`
          : `Restored ${saved.length} connection(s)`
      );
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeSchema = activeConnectionId ? schemas[activeConnectionId] : null;

  // ── Execute query ─────────────────────────────────────────────────────────

  /** Split SQL on statement boundaries, ignoring semicolons inside strings/comments. */
  function splitStatements(sql: string): string[] {
    const stmts: string[] = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      const next = sql[i + 1];

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        current += ch;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; current += "*/"; i++; } else current += ch;
        continue;
      }
      if (!inSingle && !inDouble && ch === "-" && next === "-") { inLineComment = true; current += "--"; i++; continue; }
      if (!inSingle && !inDouble && ch === "/" && next === "*") { inBlockComment = true; current += "/*"; i++; continue; }
      if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }

      if (ch === ";" && !inSingle && !inDouble) {
        const trimmed = current.trim();
        if (trimmed) stmts.push(trimmed);
        current = "";
      } else {
        current += ch;
      }
    }
    const last = current.trim();
    if (last) stmts.push(last);
    return stmts;
  }

  const handleExecute = async (sqlOverride?: string) => {
    if (activeTab?.isExecuting) return;
    if (!activeConnectionId) {
      toast.error("No active database connection");
      return;
    }
    const sql = sqlOverride ?? activeTab?.sql;
    if (!sql) return;

    // Intercept if SQL has bind parameters and no override (override = already substituted)
    if (!sqlOverride && detectParams(sql).length > 0) {
      setBindParams({ open: true, sql });
      return;
    }

    // Multi-statement: if more than one statement, run them sequentially
    // (DDL/DML statements first, last SELECT drives VirtualTable)
    const statements = splitStatements(sql);
    if (statements.length > 1) {
      setTabExecuting(true);
      let successCount = 0;
      let errorMsg: string | null = null;
      for (let i = 0; i < statements.length - 1; i++) {
        const stmt = statements[i];
        try {
          await DbClient.execute(activeConnectionId, stmt);
          successCount++;
        } catch (e: any) {
          errorMsg = `Statement ${i + 1}: ${e?.message ?? String(e)}`;
          break;
        }
      }
      setTabExecuting(false);
      if (errorMsg) {
        toast.error(errorMsg);
        return;
      }
      if (successCount > 0) toast.success(`${successCount} statement${successCount > 1 ? "s" : ""} executed`);
      // Run the last statement normally (may be SELECT)
      await handleExecute(statements[statements.length - 1]);
      return;
    }

    setTabExecuting(true);

    // Tell QueryManager the new base SQL so sort/filter knows what to wrap
    QueryManager.setBaseQuery(sql, activeConnectionId);

    try {
      const response = await DbClient.executeStreaming(activeConnectionId, sql);
      const queryId = response.query_id;
      rowStore.reset(queryId);

      const allRows: Record<string, unknown>[] = [];
      let fields: { name: string }[] = [];
      let finalElapsed = 0;

      const unlisten = await listen<QueryBatch>("query_batch", (event) => {
        const batch = event.payload;
        if (batch.query_id !== queryId) return;

        if (batch.error) {
          toast.error(batch.error);
          rowStore.finalize();
          setTabExecuting(false);
          currentQueryIdRef.current = null;
          currentUnlistenRef.current = null;
          pushHistory({ sql, rowCount: 0, elapsedMs: 0, timestamp: Date.now(), error: batch.error });
          unlisten();
          return;
        }

        rowStore.appendBatch(batch);

        if (batch.columns && fields.length === 0) {
          fields = batch.columns.map((c) => ({ name: c.name }));
          QueryManager.setColumns(fields.map((f) => f.name));
        }
        allRows.push(...batch.rows);
        finalElapsed = batch.total_elapsed_ms;

        if (batch.is_final) {
          unlisten();
          setTabExecuting(false);
          currentQueryIdRef.current = null;
          currentUnlistenRef.current = null;

          toast.success(
            allRows.length === 0
              ? "Query executed — no rows returned"
              : `${allRows.length.toLocaleString()} rows in ${finalElapsed}ms`
          );

          setQueryResults({
            rows: allRows,
            fields,
            rowCount: allRows.length,
            elapsedMs: finalElapsed,
            queryId,
            source_tables: response.source_tables,
          });

          pushHistory({ sql, rowCount: allRows.length, elapsedMs: finalElapsed, timestamp: Date.now() });
        }
      });

      // Store refs so Stop button can cancel
      currentQueryIdRef.current = queryId;
      currentUnlistenRef.current = unlisten;
    } catch (error: any) {
      toast.error(error.message ?? "Query failed");
      rowStore.finalize();
      setTabExecuting(false);
      pushHistory({ sql, rowCount: 0, elapsedMs: 0, timestamp: Date.now(), error: error.message });
    }
  };

  // ── Stop (cancel) query ───────────────────────────────────────────────────

  const handleStop = async () => {
    // Stop listening for new batches immediately
    currentUnlistenRef.current?.();
    currentUnlistenRef.current = null;
    rowStore.finalize();
    setTabExecuting(false);

    // Tell the Rust streaming loop to exit at next batch boundary
    if (currentQueryIdRef.current) {
      DbClient.cancelQuery(currentQueryIdRef.current).catch(() => {});
      currentQueryIdRef.current = null;
    }

    toast.info("Query cancelled");
  };

  // ── Format SQL ────────────────────────────────────────────────────────────

  const handleFormatSql = () => {
    const sql = activeTab?.sql;
    if (!sql) return;
    const driver = connections.find((c) => c.id === activeConnectionId)?.driver ?? "postgresql";
    const dialect = driver === "mysql" || driver === "mariadb" ? "mysql"
      : driver === "mssql" ? "tsql"
      : driver === "sqlite" ? "sqlite"
      : driver === "clickhouse" ? "spark" // closest to ClickHouse
      : "postgresql";
    try {
      const formatted = formatSql(sql, { language: dialect, tabWidth: 4, keywordCase: "upper" });
      setEditorSql(formatted);
      toast.success("SQL formatted");
    } catch {
      toast.error("Could not format SQL");
    }
  };

  // ── Save SQL ──────────────────────────────────────────────────────────────

  const handleSaveSql = () => {
    if (!activeTab?.sql) return;
    const blob = new Blob([activeTab.sql], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab.title.replace(/\s+/g, "_")}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("SQL file saved");
  };

  // ── Connection ────────────────────────────────────────────────────────────

  const refreshSchema = async (connectionId: string) => {
    try {
      const schema = await DbClient.getSchema(connectionId);
      setSchema(connectionId, schema);
    } catch (error: any) {
      // Still set an empty schema so the sidebar renders (connection is active, schema just unavailable)
      setSchema(connectionId, { tables: [], columns: {}, functions: [], foreign_keys: [], indexes: [], hypertable_tables: [], driver: "postgres", connection_id: connectionId });
      toast.error(`Schema load failed: ${error.message ?? "unknown error"} — click Refresh in sidebar to retry`);
    }
  };

  const handleConnect = async (connectionId: string, config?: import("./lib/db/DbClient").ConnectionConfig) => {
    setActiveConnection(connectionId);
    await refreshSchema(connectionId);
    updateTab(activeTabId, { connectionId });
    setIsConnecting(false);
    if (config) {
      addConnection(config);
      saveConnection(config);
    }
    toast.success("Connected");
    // First-run onboarding: dismiss welcome screen and launch tour if not yet completed
    setShowWelcome(false);
    if (!localStorage.getItem("daitalk_tour_completed")) {
      setShowTour(true);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      await DbClient.disconnect(connectionId);
    } catch { /* ignore */ }
    removeConnection(connectionId);           // Zustand store
    removePersistedConnection(connectionId);  // disk + localStorage
    toast.info("Disconnected");
  };

  // ── File open ─────────────────────────────────────────────────────────────

  const handleOpenFile = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".sql,.txt";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          if (text) {
            setEditorSql(text);
            toast.success(`Opened ${file.name}`);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    } catch (e: any) {
      toast.error("File open failed");
    }
  };

  // ── Transaction control ───────────────────────────────────────────────────

  const handleBegin = async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "BEGIN");
      setInTransaction(true);
      toast.info("Transaction started");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCommit = async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "COMMIT");
      setInTransaction(false);
      toast.success("Transaction committed");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRollback = async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "ROLLBACK");
      setInTransaction(false);
      toast.info("Transaction rolled back");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── EXPLAIN plan ──────────────────────────────────────────────────────────

  const handleExplain = async () => {
    if (!activeTab?.sql || !activeConnectionId) {
      toast.error("No SQL or connection active");
      return;
    }
    const baseSql = activeTab.sql.replace(/;\s*$/, "");
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${baseSql}`;
    setTabExecuting(true);

    try {
      const response = await DbClient.executeStreaming(activeConnectionId, explainSql);
      const queryId = response.query_id;
      rowStore.reset(queryId);
      QueryManager.setBaseQuery(explainSql, activeConnectionId);

      const allRows: Record<string, unknown>[] = [];
      let fields: { name: string }[] = [];

      const unlisten = await listen<QueryBatch>("query_batch", (event) => {
        const batch = event.payload;
        if (batch.query_id !== queryId) return;

        if (batch.error) {
          toast.error(`EXPLAIN failed: ${batch.error}`);
          rowStore.finalize();
          setTabExecuting(false);
          unlisten();
          return;
        }

        rowStore.appendBatch(batch);
        if (batch.columns && fields.length === 0) {
          fields = batch.columns.map((c) => ({ name: c.name }));
          QueryManager.setColumns(fields.map((f) => f.name));
        }
        allRows.push(...batch.rows);

        if (batch.is_final) {
          unlisten();
          setTabExecuting(false);
          toast.success(`EXPLAIN plan ready — ${allRows.length} plan lines`);
          setQueryResults({
            rows: allRows,
            fields,
            rowCount: allRows.length,
            elapsedMs: batch.total_elapsed_ms,
            queryId,
            source_tables: response.source_tables,
          });
        }
      });
    } catch (e: any) {
      toast.error(e.message ?? "EXPLAIN failed");
      rowStore.finalize();
      setTabExecuting(false);
    }
  };

  // ── Context menu handlers ─────────────────────────────────────────────────

  const handleInsertTemplate = (tableName: string, columns: { name: string; type: string }[]) => {
    const cols = columns.map((c) => `"${c.name}"`).join(", ");
    const vals = columns.map(() => "NULL").join(", ");
    const sql = `INSERT INTO "${tableName}" (${cols})\nVALUES (${vals});`;
    setEditorSql(sql);
    toast.success("INSERT template loaded into editor");
  };

  const handleCountRows = (tableName: string) => {
    setEditorSql(`SELECT COUNT(*) AS row_count FROM "${tableName}";`);
  };

  const handleDropTable = (schema: string, tableName: string) => {
    const sql = `DROP TABLE "${schema}"."${tableName}";`;
    setEditorSql(sql);
    toast.warning(`DROP TABLE loaded — review and Run to execute`);
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-white overflow-hidden">
      <Toaster position="bottom-right" theme="dark" />

      {/* Left: Schema sidebar */}
      <div data-tour="schema-sidebar" className="w-64 border-r border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0">
        <div className="h-12 flex items-center justify-between px-4 border-b border-[#262626]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#00d2ff] rounded flex items-center justify-center">
              <Database className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-sm">DAITALK</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFileImportOpen(true)}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Import CSV / Parquet into DuckDB"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400/50" />
            </button>
            <button
              onClick={() => setIsConnecting(true)}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="New connection"
            >
              <Plus className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeSchema ? (
            <Sidebar
              schema={Object.fromEntries(
                activeSchema.tables.map((t) => [
                  t.name,
                  (activeSchema.columns[`${t.schema}.${t.name}`] ?? []).map((c) => ({
                    name: c.name,
                    type: c.type_name,
                  })),
                ])
              )}
              fullSchema={activeSchema}
              onViewDdl={(schema, table) => setDdlModal({ schema, table })}
              onViewFunctionDdl={(fnSchema, fnName) => setDdlModal({
                schema: fnSchema,
                table: fnName,
                title: "Function / Procedure DDL",
                subtitle: `${fnSchema}.${fnName}`,
                customQuery: `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${fnSchema}' AND p.proname = '${fnName}' LIMIT 1`,
              })}
              onTableClick={(table) => setEditorSql(`SELECT * FROM "${table}" LIMIT 100;`)}
              focusedNode={focusedNode}
              schemaName={activeSchema.tables[0]?.schema ?? "public"}
              onSelectAll={(table) => setEditorSql(`SELECT * FROM "${table}" LIMIT 100;`)}
              onInsertTemplate={handleInsertTemplate}
              onExplain={handleExplain}
              onCountRows={handleCountRows}
              onRefreshSchema={() => refreshSchema(activeConnectionId!)}
              onDropTable={handleDropTable}
              connections={connections}
              activeConnectionId={activeConnectionId}
              connectionHealth={connectionHealth}
              onSwitchConnection={(id) => {
                setActiveConnection(id);
                updateTab(activeTabId, { connectionId: id });
              }}
              onDisconnect={handleDisconnect}
              driver={connections.find((c) => c.id === activeConnectionId)?.driver}
              onRunTableSql={(sql, description) => {
                setEditorSql(sql);
                toast.info(`Running: ${description}`);
                setTimeout(() => handleExecute(), 50);
              }}
            />
          ) : (
            <div className="p-4 text-xs text-white/30 text-center mt-8">
              No connection active.
              <br />
              <button
                onClick={() => setIsConnecting(true)}
                className="text-[#00d2ff] hover:underline mt-1"
              >
                Connect a database
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Editor + Results */}
      <div
        ref={splitContainerRef}
        className="flex-1 flex flex-col min-w-0"
        onMouseMove={(e) => {
          if (!splitDragging.current || !splitContainerRef.current) return;
          const rect = splitContainerRef.current.getBoundingClientRect();
          const pct = ((e.clientY - rect.top) / rect.height) * 100;
          setEditorPct(Math.min(85, Math.max(15, pct)));
        }}
        onMouseUp={() => { splitDragging.current = false; }}
        onMouseLeave={() => { splitDragging.current = false; }}
      >
        {/* Toolbar */}
        <div className="h-12 border-b border-[#262626] flex items-center px-4 justify-between bg-[#0d0d0d] shrink-0">
          <div className="flex items-center gap-2">
            {activeTab?.isExecuting ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500/80 text-white text-xs font-bold hover:bg-red-500 transition-colors animate-pulse"
                title="Stop query (cancel)"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                onClick={() => handleExecute()}
                disabled={!activeConnectionId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00d2ff] text-black text-xs font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <Play className="w-3 h-3 fill-current" />
                Run
              </button>
            )}
            <button
              onClick={handleExplain}
              disabled={activeTab?.isExecuting || !activeConnectionId || !activeTab?.sql}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#262626] text-white/40 text-xs hover:text-amber-400 hover:border-amber-500/30 disabled:opacity-20 transition-colors"
              title="EXPLAIN ANALYZE current query (Shift+F5)"
            >
              <Zap className="w-3 h-3" />
              Explain
            </button>
            <div className="h-4 w-px bg-[#262626]" />
            {/* File open/save */}
            <button onClick={handleOpenFile} className="flex items-center gap-1 text-white/40 hover:text-white text-xs transition-colors" title="Open .sql file">
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleSaveSql} disabled={!activeTab?.sql} className="flex items-center gap-1 text-white/40 hover:text-white text-xs transition-colors disabled:opacity-20" title="Save SQL">
              <Save className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleFormatSql} disabled={!activeTab?.sql} className="flex items-center gap-1 text-white/40 hover:text-purple-400 text-xs transition-colors disabled:opacity-20" title="Format SQL (Ctrl+Shift+F)">
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-px bg-[#262626]" />
            {/* Transaction control */}
            {!inTransaction ? (
              <button
                onClick={handleBegin}
                disabled={!activeConnectionId || autoCommit}
                className="flex items-center gap-1 text-white/40 hover:text-emerald-400 text-xs transition-colors disabled:opacity-20"
                title="BEGIN transaction"
              >
                <GitCommitVertical className="w-3.5 h-3.5" /> BEGIN
              </button>
            ) : (
              <>
                <button onClick={handleCommit} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs font-bold transition-colors" title="COMMIT">
                  <GitCommitVertical className="w-3.5 h-3.5" /> COMMIT
                </button>
                <button onClick={handleRollback} className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs transition-colors" title="ROLLBACK">
                  <RotateCcw className="w-3 h-3" /> ROLLBACK
                </button>
              </>
            )}
            <button
              onClick={() => { setAutoCommit((v) => !v); if (!autoCommit) setInTransaction(false); }}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${autoCommit ? "border-[#00d2ff]/30 text-[#00d2ff]/60 bg-[#00d2ff]/5" : "border-amber-500/30 text-amber-400/60 bg-amber-500/5"}`}
              title="Toggle auto-commit"
            >
              {autoCommit ? "AUTO" : "MANUAL"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Active connection badge */}
            {activeConnectionId && (() => {
              const conn = connections.find((c) => c.id === activeConnectionId);
              const health = connectionHealth[activeConnectionId];
              const color = useWorkspaceStore.getState().connectionColors[activeConnectionId] ?? "#00d2ff";
              if (!conn) return null;
              return (
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded border max-w-[200px]"
                  style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      health === "healthy" ? "bg-emerald-400" :
                      health === "error" ? "bg-red-400 animate-pulse" :
                      "bg-amber-400/60 animate-pulse"
                    }`}
                    title={health === "healthy" ? "Connected" : health === "error" ? "Lost" : "Checking"}
                  />
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-white/70 truncate font-medium">{conn.display_name}</span>
                  <span className="text-[9px] text-white/25 font-mono shrink-0">{conn.driver}</span>
                </div>
              );
            })()}
            <div data-tour="plan-mode"><AgentModeToggle /></div>
            <button
              onClick={() => setShortcutsOpen(true)}
              className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
              title="Keyboard shortcuts (Ctrl+/)"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab strip */}
        <TabBar />

        {/* SQL Editor — resizable top pane */}
        <div data-tour="sql-editor" style={{ height: `${editorPct}%` }} className="border-b border-[#262626] shrink-0">
          <SQLEditor
            value={activeTab?.sql ?? ""}
            onChange={(sql) => setEditorSql(sql)}
            onExecute={handleExecute}
            onExecuteSelected={(sql) => handleExecute(sql)}
            schema={activeSchema}
            resultColumns={activeTab?.queryResults?.fields?.map((f) => f.name)}
          />
        </div>

        {/* Drag handle */}
        <div
          className="h-1.5 bg-[#1a1a1a] hover:bg-[#00d2ff]/30 cursor-row-resize shrink-0 transition-colors"
          onMouseDown={(e) => { e.preventDefault(); splitDragging.current = true; }}
          onDoubleClick={() => setEditorPct(45)}
          title="Drag to resize · Double-click to reset"
        />

        {/* Results — remaining space */}
        <div data-tour="graph-builder" className="flex-1 overflow-hidden min-h-0">
          <VirtualTable />
        </div>
      </div>

      {/* Right: AI Panel */}
      <div data-tour="ai-panel" className="w-96 border-l border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0">
        <div className="h-12 border-b border-[#262626] flex items-center px-4 gap-4 shrink-0">
          {(["agent", "history", "snippets", "erd", "search", "sessions", "overview"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                activePanel === p ? "text-[#00d2ff]" : "text-white/30 hover:text-white/50"
              }`}
            >
              {p === "erd" ? "ERD" : p === "agent" ? "AI" : p === "snippets" ? "Snippets" : p === "search" ? "Search" : p === "sessions" ? "Sessions" : p === "overview" ? "DB" : "History"}
            </button>
          ))}
          {planQueue.length > 0 && (
            <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5 font-bold">
              {planQueue.length} pending
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {activePanel === "erd" ? (
            <ERDiagram schema={activeSchema} />
          ) : activePanel === "snippets" ? (
            <SnippetsPanel
              currentSQL={activeTab?.sql ?? null}
              onInsert={(sql) => setEditorSql(sql)}
              driver={activeSchema?.driver}
            />
          ) : activePanel === "search" ? (
            <SchemaSearch
              schemas={schemas}
              connections={connections}
              onNavigate={(connId, sql) => {
                setActiveConnection(connId);
                updateTab(activeTabId, { connectionId: connId });
                setEditorSql(sql);
                setActivePanel("agent");
              }}
            />
          ) : activePanel === "sessions" ? (
            <SessionMonitor />
          ) : activePanel === "overview" ? (
            <DatabaseOverview />
          ) : (
            <AIPanel
              activePanel={activePanel}
              currentSQL={activeTab?.sql ?? null}
              currentResults={activeTab?.queryResults ?? null}
              currentSchema={activeSchema}
              connectionId={activeConnectionId}
              onApplySQL={(sql) => setEditorSql(sql)}
              onQuerySuccess={(results, sql) => {
                setEditorSql(sql);
                setQueryResults(results);
              }}
            />
          )}
        </div>
      </div>

      <ConnectionDialog
        open={isConnecting}
        onOpenChange={setIsConnecting}
        onConnect={handleConnect}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FileImportDialog
        open={fileImportOpen}
        onOpenChange={setFileImportOpen}
        onImported={(sql) => {
          setEditorSql(sql);
          toast.info("File imported into DuckDB — running preview query");
        }}
      />
      <DDLModal
        open={ddlModal !== null}
        onClose={() => setDdlModal(null)}
        connectionId={activeConnectionId}
        schema={ddlModal?.schema ?? "public"}
        table={ddlModal?.table ?? ""}
        customQuery={ddlModal?.customQuery}
        title={ddlModal?.title}
        subtitle={ddlModal?.subtitle}
        onSendToEditor={(sql) => setEditorSql(sql)}
      />
      <BindParamsDialog
        open={bindParams?.open ?? false}
        sql={bindParams?.sql ?? ""}
        onConfirm={(substituted) => {
          setBindParams(null);
          handleExecute(substituted);
        }}
        onCancel={() => setBindParams(null)}
      />
      <QuickOpenDialog
        open={quickOpenOpen}
        schemas={schemas}
        connections={connections}
        onClose={() => setQuickOpenOpen(false)}
        onSelect={(connId, sql) => {
          setActiveConnection(connId);
          updateTab(activeTabId, { connectionId: connId });
          setEditorSql(sql);
          handleExecute(sql);
        }}
      />

      {showWelcome && (
        <WelcomeScreen
          onConnect={(driver) => {
            setShowWelcome(false);
            setIsConnecting(true);
            // driver hint stored so ConnectionDialog can pre-select it if desired
            void driver;
          }}
          onOpenFile={() => {
            setShowWelcome(false);
            handleOpenFile();
          }}
          onDismiss={() => setShowWelcome(false)}
        />
      )}

      {showTour && <OnboardingTour onComplete={() => setShowTour(false)} />}
    </div>
  );
}
