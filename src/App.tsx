import React, { Suspense, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { Database, Play, Save, FolderOpen, Plus, Settings, Keyboard, GitCommitVertical, RotateCcw, Square, Zap, Upload, AlignLeft } from "lucide-react";

import { useWorkspaceStore } from "./lib/stores/WorkspaceStore";
import { QueryManager } from "./lib/table/QueryManager";
import { useAppQueryController } from "./lib/query/useAppQueryController";

import { SQLEditor } from "./components/editor/SQLEditor";
import { TabBar } from "./components/editor/TabBar";
import { VirtualTable } from "./components/table/VirtualTable";
import { Sidebar } from "./components/schema/Sidebar";
import { ConnectionDialog } from "./components/dialogs/ConnectionDialog";
import { AgentModeToggle } from "./components/ai/AgentModeToggle";
import { registerHandlers } from "./lib/agent/registerHandlers";
import { KeyboardShortcutsDialog } from "./components/dialogs/KeyboardShortcutsDialog";
import { FileImportDialog } from "./components/dialogs/FileImportDialog";
import { SafetyDataDialog } from "./components/dialogs/SafetyDataDialog";
import { SchemaSearch } from "./components/schema/SchemaSearch";
import { BindParamsDialog, detectParams } from "./components/dialogs/BindParamsDialog";
import { QuickOpenDialog } from "./components/dialogs/QuickOpenDialog";
import { useWorkspaceConnectionRuntime } from "./lib/workspace/useWorkspaceConnectionRuntime";
import { useWorkspaceConnectionActions } from "./lib/workspace/useWorkspaceConnectionActions";
import { useWorkspaceTransactionActions } from "./lib/workspace/useWorkspaceTransactionActions";
import { useWorkspaceEditorActions } from "./lib/workspace/useWorkspaceEditorActions";
import { useAppShellUi } from "./lib/app/useAppShellUi";
import { useAppKeyboardShortcuts } from "./lib/app/useAppKeyboardShortcuts";
import { useAppQueryFeedback } from "./lib/app/useAppQueryFeedback";

const AIPanel = React.lazy(() =>
  import("./components/ai/AIPanel").then((module) => ({ default: module.AIPanel }))
);
const ERDiagram = React.lazy(() =>
  import("./components/schema/ERDiagram").then((module) => ({ default: module.ERDiagram }))
);
const DDLModal = React.lazy(() =>
  import("./components/dialogs/DDLModal").then((module) => ({ default: module.DDLModal }))
);
const SnippetsPanel = React.lazy(() =>
  import("./components/editor/SnippetsPanel").then((module) => ({ default: module.SnippetsPanel }))
);
const SessionMonitor = React.lazy(() =>
  import("./components/panels/SessionMonitor").then((module) => ({ default: module.SessionMonitor }))
);
const DatabaseOverview = React.lazy(() =>
  import("./components/panels/DatabaseOverview").then((module) => ({ default: module.DatabaseOverview }))
);

function PanelFallback({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs font-mono text-white/30">
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
  } = useWorkspaceStore();

  // Register CommandBus handlers once on mount
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

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeSchema = activeConnectionId ? schemas[activeConnectionId] : null;

  const { handleFormatSql, handleSaveSql, handleOpenFile } = useWorkspaceEditorActions({
    activeConnectionId,
    activeTab,
    connections,
    setEditorSql,
  });

  const { handleQuerySuccess, handleQueryError } = useAppQueryFeedback({
    setQueryResults,
  });

  const { handleExecute, handleExplain, handleStop } = useAppQueryController({
    activeConnectionId,
    activeTab,
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

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-white overflow-hidden">
      <Toaster position="bottom-right" theme="dark" />

      {/* Left: Schema sidebar */}
      <div className="w-64 border-r border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0">
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
              onDropTable={shellHandleDropTable}
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
                onClick={handleStopWithToast}
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
              onClick={toggleAutoCommit}
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
            <AgentModeToggle />
            <button
              onClick={() => setSafetyDataOpen(true)}
              className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
              title="Safety, privacy, and local data"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShortcutsOpen(true)}
              className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
              title="Keyboard shortcuts (Ctrl+/)"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab strip */}
        <TabBar />

        {/* SQL Editor — resizable top pane */}
        <div style={{ height: `${editorPct}%` }} className="border-b border-[#262626] shrink-0">
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
        <div className="flex-1 overflow-hidden min-h-0">
          <VirtualTable />
        </div>
      </div>

      {/* Right: AI Panel */}
      <div className="w-96 border-l border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0">
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
            <Suspense fallback={<PanelFallback label="Loading ERD..." />}>
              <ERDiagram schema={activeSchema} />
            </Suspense>
          ) : activePanel === "snippets" ? (
            <Suspense fallback={<PanelFallback label="Loading snippets..." />}>
              <SnippetsPanel
                currentSQL={activeTab?.sql ?? null}
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
