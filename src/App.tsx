import React, { Suspense, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  AlignLeft,
  Database,
  FolderOpen,
  GitCommitVertical,
  Keyboard,
  LayoutDashboard,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Square,
  Upload,
  Zap,
} from "lucide-react";

import { DashboardWorkspace } from "./components/dashboard/DashboardWorkspace";
import { AgentModeToggle } from "./components/ai/AgentModeToggle";
import { BindParamsDialog, detectParams } from "./components/dialogs/BindParamsDialog";
import { ConnectionDialog } from "./components/dialogs/ConnectionDialog";
import { FileImportDialog } from "./components/dialogs/FileImportDialog";
import { KeyboardShortcutsDialog } from "./components/dialogs/KeyboardShortcutsDialog";
import { QuickOpenDialog } from "./components/dialogs/QuickOpenDialog";
import { SafetyDataDialog } from "./components/dialogs/SafetyDataDialog";
import { SQLEditor } from "./components/editor/SQLEditor";
import { TabBar } from "./components/editor/TabBar";
import { SchemaSearch } from "./components/schema/SchemaSearch";
import { Sidebar } from "./components/schema/Sidebar";
import { VirtualTable } from "./components/table/VirtualTable";
import { registerHandlers } from "./lib/agent/registerHandlers";
import { useAppKeyboardShortcuts } from "./lib/app/useAppKeyboardShortcuts";
import { useAppQueryFeedback } from "./lib/app/useAppQueryFeedback";
import { useAppShellUi } from "./lib/app/useAppShellUi";
import { buildDashboardSnapshot, buildInitialDashboardWidget } from "./lib/dashboard/dashboardState";
import { useWorkspaceStore, isDashboardTab, type QueryResults } from "./lib/stores/WorkspaceStore";
import { QueryManager } from "./lib/table/QueryManager";
import { useAppQueryController } from "./lib/query/useAppQueryController";
import { useWorkspaceConnectionActions } from "./lib/workspace/useWorkspaceConnectionActions";
import { useWorkspaceConnectionRuntime } from "./lib/workspace/useWorkspaceConnectionRuntime";
import { useWorkspaceEditorActions } from "./lib/workspace/useWorkspaceEditorActions";
import { useWorkspaceTransactionActions } from "./lib/workspace/useWorkspaceTransactionActions";

const AIPanel = React.lazy(() =>
  import("./components/ai/AIPanel").then((module) => ({ default: module.AIPanel })),
);
const DDLModal = React.lazy(() =>
  import("./components/dialogs/DDLModal").then((module) => ({ default: module.DDLModal })),
);
const SnippetsPanel = React.lazy(() =>
  import("./components/editor/SnippetsPanel").then((module) => ({ default: module.SnippetsPanel })),
);
const DatabaseOverview = React.lazy(() =>
  import("./components/panels/DatabaseOverview").then((module) => ({ default: module.DatabaseOverview })),
);
const SessionMonitor = React.lazy(() =>
  import("./components/panels/SessionMonitor").then((module) => ({ default: module.SessionMonitor })),
);
const ERDiagram = React.lazy(() =>
  import("./components/schema/ERDiagram").then((module) => ({ default: module.ERDiagram })),
);

function PanelFallback({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs font-mono text-white/30">
      {label}
    </div>
  );
}

export default function App() {
  const [safetyDataOpen, setSafetyDataOpen] = useState(false);
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
    createDashboardTab,
    upsertDashboardDatasourceSnapshot,
    addDashboardWidget,
    updateDashboardWidget,
    removeDashboardWidget,
    setDashboardSelectedWidget,
  } = useWorkspaceStore();

  useEffect(() => {
    registerHandlers();
  }, []);

  useWorkspaceConnectionRuntime({
    connections,
    schemas,
    activeTabId,
    addConnection,
    setSchema,
    setConnectionHealth,
    setActiveConnection,
    updateTab,
  });

  const {
    isConnecting,
    setIsConnecting,
    activePanel,
    setActivePanel,
    inTransaction,
    setInTransaction,
    autoCommit,
    toggleAutoCommit,
    shortcutsOpen,
    setShortcutsOpen,
    fileImportOpen,
    setFileImportOpen,
    ddlModal,
    setDdlModal,
    editorPct,
    setEditorPct,
    splitDragging,
    splitContainerRef,
    bindParams,
    setBindParams,
    quickOpenOpen,
    setQuickOpenOpen,
    handleInsertTemplate,
    handleCountRows,
    handleDropTable: shellHandleDropTable,
  } = useAppShellUi({
    onStop: async () => {},
    setEditorSql,
  });

  const { refreshSchema, handleConnect, handleDisconnect } = useWorkspaceConnectionActions({
    activeTabId,
    connections,
    addConnection,
    removeConnection,
    setSchema,
    setActiveConnection,
    updateTab,
    onConnected: () => setIsConnecting(false),
  });

  const { handleBegin, handleCommit, handleRollback } = useWorkspaceTransactionActions({
    activeConnectionId,
    setInTransaction,
  });

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeDashboardTab = activeTab && isDashboardTab(activeTab) ? activeTab : null;
  const activeQueryTab = activeTab && !isDashboardTab(activeTab) ? activeTab : null;
  const activeSchema = activeConnectionId ? schemas[activeConnectionId] : null;
  const activeDashboardSnapshot = activeDashboardTab
    ? Object.values(activeDashboardTab.dashboard.datasources).sort(
        (left, right) => right.capturedAt - left.capturedAt,
      )[0] ?? null
    : null;
  const aiPanelCurrentSQL = activeQueryTab?.sql ?? activeDashboardSnapshot?.sql ?? null;
  const aiPanelCurrentResults: QueryResults | null = activeQueryTab?.queryResults
    ?? (activeDashboardSnapshot
      ? {
          rows: activeDashboardSnapshot.rows,
          fields: activeDashboardSnapshot.fields,
          rowCount: activeDashboardSnapshot.rowCount,
          elapsedMs: activeDashboardSnapshot.elapsedMs,
          queryId: activeDashboardSnapshot.queryId ?? `dashboard-${activeDashboardTab?.id ?? "snapshot"}`,
          source_tables: activeDashboardSnapshot.sourceTables,
        }
      : null);

  const { handleFormatSql, handleSaveSql, handleOpenFile } = useWorkspaceEditorActions({
    activeConnectionId,
    activeTab: activeQueryTab ?? undefined,
    connections,
    setEditorSql,
  });

  const { handleQuerySuccess, handleQueryError } = useAppQueryFeedback({
    setQueryResults,
  });

  const { handleExecute, handleExplain, handleStop } = useAppQueryController({
    activeConnectionId,
    activeTab: activeQueryTab ?? undefined,
    hasBindParams: (sql) => detectParams(sql).length > 0,
    onRequireBindParams: (sql) => setBindParams({ open: true, sql }),
    onColumns: (columns) => QueryManager.setColumns(columns),
    onStatementsExecuted: (count) => {
      toast.success(`${count} statement${count > 1 ? "s" : ""} executed`);
    },
    onSuccess: handleQuerySuccess,
    onError: handleQueryError,
    setExecuting: setTabExecuting,
  });

  useAppKeyboardShortcuts({
    handleSaveSql,
    handleOpenFile,
    handleFormatSql,
    handleExplain,
    setActivePanel,
    setShortcutsOpen,
    setQuickOpenOpen,
  });

  const handleStopWithToast = async () => {
    await handleStop();
    toast.info("Query cancelled");
  };

  const handleCreateDashboard = () => {
    const dashboardTabId = `dashboard-${Date.now()}`;
    const sourceTab = activeQueryTab;
    const sourceResults = sourceTab?.queryResults ?? null;
    const sourceConnectionId = sourceTab?.connectionId ?? activeConnectionId;

    createDashboardTab({
      id: dashboardTabId,
      title: sourceTab?.title
        ? `${sourceTab.title} Dashboard`
        : `Dashboard ${tabs.filter((tab) => isDashboardTab(tab)).length + 1}`,
      connectionId: sourceConnectionId,
    });

    if (!sourceTab || !sourceResults) {
      toast.success("Blank dashboard created");
      return;
    }

    const snapshot = buildDashboardSnapshot(sourceResults, sourceTab.sql, sourceConnectionId);
    const initialWidget = buildInitialDashboardWidget(snapshot);
    upsertDashboardDatasourceSnapshot(dashboardTabId, snapshot);
    addDashboardWidget(dashboardTabId, {
      id: `dashboard-widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...initialWidget,
    });
    toast.success(`Dashboard created from ${sourceTab.title}`);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0a0a] text-white">
      <Toaster position="bottom-right" theme="dark" />

      <div className="flex w-64 shrink-0 flex-col border-r border-[#262626] bg-[#0d0d0d]">
        <div className="flex h-12 items-center justify-between border-b border-[#262626] px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-[#00d2ff]">
              <Database className="h-3.5 w-3.5 text-black" />
            </div>
            <span className="text-sm font-bold tracking-tight">DAITALK</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFileImportOpen(true)}
              className="rounded p-1 transition-colors hover:bg-white/10"
              title="Import CSV / Parquet into DuckDB"
            >
              <Upload className="h-3.5 w-3.5 text-amber-400/50" />
            </button>
            <button
              onClick={() => setIsConnecting(true)}
              className="rounded p-1 transition-colors hover:bg-white/10"
              title="New connection"
            >
              <Plus className="h-4 w-4 text-white/50" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeSchema ? (
            <Sidebar
              schema={Object.fromEntries(
                activeSchema.tables.map((table) => [
                  table.name,
                  (activeSchema.columns[`${table.schema}.${table.name}`] ?? []).map((column) => ({
                    name: column.name,
                    type: column.type_name,
                  })),
                ]),
              )}
              fullSchema={activeSchema}
              onViewDdl={(schema, table) => setDdlModal({ schema, table })}
              onViewFunctionDdl={(fnSchema, fnName) =>
                setDdlModal({
                  schema: fnSchema,
                  table: fnName,
                  title: "Function / Procedure DDL",
                  subtitle: `${fnSchema}.${fnName}`,
                  customQuery: `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${fnSchema}' AND p.proname = '${fnName}' LIMIT 1`,
                })
              }
              onTableClick={(table) => setEditorSql(`SELECT * FROM "${table}" LIMIT 100;`)}
              focusedNode={focusedNode}
              schemaName={activeSchema.tables[0]?.schema ?? "public"}
              onSelectAll={(table) => setEditorSql(`SELECT * FROM "${table}" LIMIT 100;`)}
              onInsertTemplate={handleInsertTemplate}
              onExplain={handleExplain}
              onCountRows={handleCountRows}
              onRefreshSchema={() => refreshSchema(activeConnectionId!)}
              onDropTable={shellHandleDropTable}
              connections={connections}
              activeConnectionId={activeConnectionId}
              connectionHealth={connectionHealth}
              onSwitchConnection={(id) => {
                setActiveConnection(id);
                updateTab(activeTabId, { connectionId: id });
              }}
              onDisconnect={handleDisconnect}
              driver={connections.find((connection) => connection.id === activeConnectionId)?.driver}
              onRunTableSql={(sql, description) => {
                setEditorSql(sql);
                toast.info(`Running: ${description}`);
                setTimeout(() => handleExecute(), 50);
              }}
            />
          ) : (
            <div className="mt-8 p-4 text-center text-xs text-white/30">
              No connection active.
              <br />
              <button
                onClick={() => setIsConnecting(true)}
                className="mt-1 text-[#00d2ff] hover:underline"
              >
                Connect a database
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={splitContainerRef}
        className="flex min-w-0 flex-1 flex-col"
        onMouseMove={(event) => {
          if (!splitDragging.current || !splitContainerRef.current) return;
          const rect = splitContainerRef.current.getBoundingClientRect();
          const pct = ((event.clientY - rect.top) / rect.height) * 100;
          setEditorPct(Math.min(85, Math.max(15, pct)));
        }}
        onMouseUp={() => {
          splitDragging.current = false;
        }}
        onMouseLeave={() => {
          splitDragging.current = false;
        }}
      >
        <div className="flex h-12 items-center justify-between border-b border-[#262626] bg-[#0d0d0d] px-4">
          <div className="flex items-center gap-2">
            {activeDashboardTab ? (
              <button
                onClick={handleCreateDashboard}
                className="flex items-center gap-1.5 rounded border border-[#00d2ff]/25 bg-[#00d2ff]/8 px-3 py-1.5 text-xs font-bold text-[#7ae7ff] transition-colors hover:bg-[#00d2ff]/15"
                title="Create another dashboard tab"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                New Dashboard
              </button>
            ) : (
              <>
                {activeQueryTab?.isExecuting ? (
                  <button
                    onClick={handleStopWithToast}
                    className="flex items-center gap-1.5 rounded bg-red-500/80 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-500 animate-pulse"
                    title="Stop query (cancel)"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => handleExecute()}
                    disabled={!activeConnectionId}
                    className="flex items-center gap-1.5 rounded bg-[#00d2ff] px-3 py-1.5 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Run
                  </button>
                )}
                <button
                  onClick={handleExplain}
                  disabled={activeQueryTab?.isExecuting || !activeConnectionId || !activeQueryTab?.sql}
                  className="flex items-center gap-1.5 rounded border border-[#262626] px-2.5 py-1.5 text-xs text-white/40 transition-colors hover:border-amber-500/30 hover:text-amber-400 disabled:opacity-20"
                  title="EXPLAIN ANALYZE current query (Shift+F5)"
                >
                  <Zap className="h-3 w-3" />
                  Explain
                </button>
                <div className="h-4 w-px bg-[#262626]" />
                <button
                  onClick={handleOpenFile}
                  className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-white"
                  title="Open .sql file"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleSaveSql}
                  disabled={!activeQueryTab?.sql}
                  className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-white disabled:opacity-20"
                  title="Save SQL"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleFormatSql}
                  disabled={!activeQueryTab?.sql}
                  className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-purple-400 disabled:opacity-20"
                  title="Format SQL (Ctrl+Shift+F)"
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCreateDashboard}
                  disabled={!activeQueryTab?.queryResults}
                  className="flex items-center gap-1.5 rounded border border-[#1f3f47] px-2.5 py-1.5 text-xs text-[#7ae7ff] transition-colors hover:border-[#00d2ff]/40 disabled:opacity-30"
                  title="Create a dashboard from the current query results"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </button>
                <div className="h-4 w-px bg-[#262626]" />
                {!inTransaction ? (
                  <button
                    onClick={handleBegin}
                    disabled={!activeConnectionId || autoCommit}
                    className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-emerald-400 disabled:opacity-20"
                    title="BEGIN transaction"
                  >
                    <GitCommitVertical className="h-3.5 w-3.5" />
                    BEGIN
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCommit}
                      className="flex items-center gap-1 text-xs font-bold text-emerald-400 transition-colors hover:text-emerald-300"
                      title="COMMIT"
                    >
                      <GitCommitVertical className="h-3.5 w-3.5" />
                      COMMIT
                    </button>
                    <button
                      onClick={handleRollback}
                      className="flex items-center gap-1 text-xs text-red-400 transition-colors hover:text-red-300"
                      title="ROLLBACK"
                    >
                      <RotateCcw className="h-3 w-3" />
                      ROLLBACK
                    </button>
                  </>
                )}
                <button
                  onClick={toggleAutoCommit}
                  className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                    autoCommit
                      ? "border-[#00d2ff]/30 bg-[#00d2ff]/5 text-[#00d2ff]/60"
                      : "border-amber-500/30 bg-amber-500/5 text-amber-400/60"
                  }`}
                  title="Toggle auto-commit"
                >
                  {autoCommit ? "AUTO" : "MANUAL"}
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {activeConnectionId &&
              (() => {
                const connection = connections.find((candidate) => candidate.id === activeConnectionId);
                const health = connectionHealth[activeConnectionId];
                const color =
                  useWorkspaceStore.getState().connectionColors[activeConnectionId] ?? "#00d2ff";
                if (!connection) return null;
                return (
                  <div
                    className="flex max-w-[200px] items-center gap-1.5 rounded border px-2 py-1"
                    style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        health === "healthy"
                          ? "bg-emerald-400"
                          : health === "error"
                            ? "bg-red-400 animate-pulse"
                            : "bg-amber-400/60 animate-pulse"
                      }`}
                      title={
                        health === "healthy"
                          ? "Connected"
                          : health === "error"
                            ? "Lost"
                            : "Checking"
                      }
                    />
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate text-[10px] font-medium text-white/70">
                      {connection.display_name}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-white/25">
                      {connection.driver}
                    </span>
                  </div>
                );
              })()}
            <AgentModeToggle />
            <button
              onClick={() => setSafetyDataOpen(true)}
              className="rounded p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              title="Safety, privacy, and local data"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShortcutsOpen(true)}
              className="rounded p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              title="Keyboard shortcuts (Ctrl+/)"
            >
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
        </div>

        <TabBar />

        {activeDashboardTab ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <DashboardWorkspace
              tab={activeDashboardTab}
              onAddWidget={(widget) =>
                addDashboardWidget(activeDashboardTab.id, {
                  id: `dashboard-widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  ...widget,
                })
              }
              onUpdateWidget={(widgetId, updates) =>
                updateDashboardWidget(activeDashboardTab.id, widgetId, updates)
              }
              onRemoveWidget={(widgetId) =>
                removeDashboardWidget(activeDashboardTab.id, widgetId)
              }
              onSelectWidget={(widgetId, mode = "browse") =>
                setDashboardSelectedWidget(activeDashboardTab.id, { widgetId, mode })
              }
            />
          </div>
        ) : (
          <>
            <div style={{ height: `${editorPct}%` }} className="shrink-0 border-b border-[#262626]">
              <SQLEditor
                value={activeQueryTab?.sql ?? ""}
                onChange={(sql) => setEditorSql(sql)}
                onExecute={handleExecute}
                onExecuteSelected={(sql) => handleExecute(sql)}
                schema={activeSchema}
                resultColumns={activeQueryTab?.queryResults?.fields?.map((field) => field.name)}
              />
            </div>

            <div
              className="h-1.5 shrink-0 cursor-row-resize bg-[#1a1a1a] transition-colors hover:bg-[#00d2ff]/30"
              onMouseDown={(event) => {
                event.preventDefault();
                splitDragging.current = true;
              }}
              onDoubleClick={() => setEditorPct(45)}
              title="Drag to resize · Double-click to reset"
            />

            <div className="flex-1 min-h-0 overflow-hidden">
              <VirtualTable />
            </div>
          </>
        )}
      </div>

      <div className="flex w-96 shrink-0 flex-col border-l border-[#262626] bg-[#0d0d0d]">
        <div className="flex h-12 items-center gap-4 border-b border-[#262626] px-4">
          {(["agent", "history", "snippets", "erd", "search", "sessions", "overview"] as const).map((panel) => (
            <button
              key={panel}
              onClick={() => setActivePanel(panel)}
              className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                activePanel === panel ? "text-[#00d2ff]" : "text-white/30 hover:text-white/50"
              }`}
            >
              {panel === "erd"
                ? "ERD"
                : panel === "agent"
                  ? "AI"
                  : panel === "snippets"
                    ? "Snippets"
                    : panel === "search"
                      ? "Search"
                      : panel === "sessions"
                        ? "Sessions"
                        : panel === "overview"
                          ? "DB"
                          : "History"}
            </button>
          ))}
          {planQueue.length > 0 && (
            <span className="ml-auto rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
              {planQueue.length} pending
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {activePanel === "erd" ? (
            <Suspense fallback={<PanelFallback label="Loading ERD..." />}>
              <ERDiagram schema={activeSchema} />
            </Suspense>
          ) : activePanel === "snippets" ? (
            <Suspense fallback={<PanelFallback label="Loading snippets..." />}>
              <SnippetsPanel
                currentSQL={aiPanelCurrentSQL}
                onInsert={(sql) => setEditorSql(sql)}
              />
            </Suspense>
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
            <Suspense fallback={<PanelFallback label="Loading sessions..." />}>
              <SessionMonitor />
            </Suspense>
          ) : activePanel === "overview" ? (
            <Suspense fallback={<PanelFallback label="Loading database overview..." />}>
              <DatabaseOverview />
            </Suspense>
          ) : (
            <Suspense fallback={<PanelFallback label="Loading AI panel..." />}>
              <AIPanel
                activePanel={activePanel}
                currentSQL={aiPanelCurrentSQL}
                currentResults={aiPanelCurrentResults}
                currentSchema={activeSchema}
                connectionId={activeConnectionId}
                onApplySQL={(sql) => setEditorSql(sql)}
                onQuerySuccess={(results, sql) => {
                  setEditorSql(sql);
                  setQueryResults(results);
                }}
              />
            </Suspense>
          )}
        </div>
      </div>

      <ConnectionDialog
        open={isConnecting}
        onOpenChange={setIsConnecting}
        onConnect={handleConnect}
      />
      <SafetyDataDialog open={safetyDataOpen} onClose={() => setSafetyDataOpen(false)} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FileImportDialog
        open={fileImportOpen}
        onOpenChange={setFileImportOpen}
        onImported={(sql) => {
          setEditorSql(sql);
          toast.info("File imported into DuckDB — running preview query");
        }}
      />
      <Suspense fallback={null}>
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
      </Suspense>
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
    </div>
  );
}
