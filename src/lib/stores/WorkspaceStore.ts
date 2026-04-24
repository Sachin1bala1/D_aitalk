/**
 * WorkspaceStore — central Zustand state for the entire app.
 * Replaces the scattered useState() calls in the old App.tsx.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { FullSchema, ConnectionConfig } from "../db/DbClient";
import type { AgentCommand } from "../agent/commands";

export type AgentMode = "plan" | "auto";

export interface PlanStep {
  id: string;
  commandType: string;
  humanReadable: string;
  sqlPreview?: string;
  riskLevel: "safe" | "caution" | "destructive";
  status: "pending" | "approved" | "rejected" | "executing" | "done" | "failed";
  errorMessage?: string;
  /** Stored so PlanQueue can dispatch the command when the user approves */
  command?: AgentCommand;
}

export interface UndoEntry {
  id: string;
  humanReadable: string;
  command: AgentCommand;
  timestamp: number;
}

export interface TabState {
  id: string;
  type: "sql_editor" | "table_viewer";
  title: string;
  sql: string;
  connectionId: string | null;
  queryResults: QueryResults | null;
  isExecuting: boolean;
}

export interface QueryResults {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  rowCount: number;
  elapsedMs: number;
  queryId: string;
}

export interface WorkspaceState {
  // Agent mode
  agentMode: AgentMode;
  planQueue: PlanStep[];

  // Undo stack (max 50 entries)
  undoStack: UndoEntry[];

  // Connections
  activeConnectionId: string | null;
  connections: ConnectionConfig[];                           // all open connections
  schemas: Record<string, FullSchema>;                       // keyed by connectionId
  connectionHealth: Record<string, "healthy" | "error" | "checking">;
  connectionColors: Record<string, string>; // connectionId → tailwind color class

  // Sidebar focus (set by focus_schema_node command)
  focusedNode: string | null; // "schema.table"

  // Chart request (set by create_chart command → consumed by VirtualTable)
  chartRequest: { chartType: string; xColumn: string; yColumn: string; title?: string } | null;
  setChartRequest: (req: WorkspaceState["chartRequest"]) => void;

  // Editor tabs
  tabs: TabState[];
  activeTabId: string;

  // Actions — Agent Mode
  setAgentMode: (mode: AgentMode) => void;
  addPlanStep: (step: PlanStep) => void;
  updatePlanStep: (id: string, updates: Partial<PlanStep>) => void;
  removePlanStep: (id: string) => void;
  clearPlanQueue: () => void;

  // Actions — Undo
  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | undefined;
  clearUndo: () => void;

  // Actions — Focus
  setFocusedNode: (node: string | null) => void;

  // Actions — Connections
  setActiveConnection: (id: string | null) => void;
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setSchema: (connectionId: string, schema: FullSchema) => void;
  setConnectionHealth: (id: string, status: "healthy" | "error" | "checking") => void;
  setConnectionColor: (id: string, color: string) => void;

  // Actions — Tabs
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<TabState>) => void;
  addTab: (tab: TabState) => void;
  closeTab: (tabId: string) => void;

  // Convenience: active tab helpers
  setEditorSql: (sql: string, tabId?: string) => void;
  setQueryResults: (results: QueryResults, tabId?: string) => void;
  setTabExecuting: (executing: boolean, tabId?: string) => void;
}

const DEFAULT_TAB: TabState = {
  id: "tab-1",
  type: "sql_editor",
  title: "Query 1",
  sql: "SELECT * FROM users LIMIT 100;",
  connectionId: null,
  queryResults: null,
  isExecuting: false,
};

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    agentMode: "auto",
    planQueue: [],
    undoStack: [],

    activeConnectionId: null,
    connections: [],
    schemas: {},
    connectionHealth: {},
    connectionColors: {},

    focusedNode: null,
    chartRequest: null,

    tabs: [DEFAULT_TAB],
    activeTabId: "tab-1",

    setAgentMode: (mode) =>
      set((state) => {
        state.agentMode = mode;
        if (mode === "auto") state.planQueue = [];
      }),

    addPlanStep: (step) =>
      set((state) => {
        state.planQueue.push(step);
      }),

    updatePlanStep: (id, updates) =>
      set((state) => {
        const idx = state.planQueue.findIndex((s) => s.id === id);
        if (idx !== -1) Object.assign(state.planQueue[idx], updates);
      }),

    removePlanStep: (id) =>
      set((state) => {
        state.planQueue = state.planQueue.filter((s) => s.id !== id);
      }),

    clearPlanQueue: () =>
      set((state) => {
        state.planQueue = [];
      }),

    pushUndo: (entry) =>
      set((state) => {
        state.undoStack.push(entry);
        if (state.undoStack.length > 50) state.undoStack.shift();
      }),

    popUndo: () => {
      let entry: UndoEntry | undefined;
      set((state) => {
        entry = state.undoStack[state.undoStack.length - 1];
        state.undoStack = state.undoStack.slice(0, -1);
      });
      return entry;
    },

    clearUndo: () =>
      set((state) => {
        state.undoStack = [];
      }),

    setFocusedNode: (node) =>
      set((state) => {
        state.focusedNode = node;
      }),

    setChartRequest: (req) =>
      set((state) => {
        state.chartRequest = req;
      }),

    setActiveConnection: (id) =>
      set((state) => {
        state.activeConnectionId = id;
      }),

    addConnection: (config) =>
      set((state) => {
        const exists = state.connections.findIndex((c) => c.id === config.id);
        if (exists === -1) {
          state.connections.push(config);
          // Auto-assign a color based on index
          const palette = ["#00d2ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb923c", "#e879f9"];
          state.connectionColors[config.id] = palette[state.connections.length % palette.length];
        } else {
          state.connections[exists] = config;
        }
      }),

    removeConnection: (id) =>
      set((state) => {
        state.connections = state.connections.filter((c) => c.id !== id);
        delete state.schemas[id];
        delete state.connectionHealth[id];
        delete state.connectionColors[id];
        if (state.activeConnectionId === id) {
          state.activeConnectionId = state.connections[0]?.id ?? null;
        }
      }),

    setConnectionHealth: (id, status) =>
      set((state) => {
        state.connectionHealth[id] = status;
      }),

    setConnectionColor: (id, color) =>
      set((state) => {
        state.connectionColors[id] = color;
      }),

    setSchema: (connectionId, schema) =>
      set((state) => {
        state.schemas[connectionId] = schema;
      }),

    setActiveTab: (tabId) =>
      set((state) => {
        state.activeTabId = tabId;
      }),

    updateTab: (tabId, updates) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (tab) Object.assign(tab, updates);
      }),

    addTab: (tab) =>
      set((state) => {
        state.tabs.push(tab);
        state.activeTabId = tab.id;
      }),

    closeTab: (tabId) =>
      set((state) => {
        state.tabs = state.tabs.filter((t) => t.id !== tabId);
        if (state.activeTabId === tabId && state.tabs.length > 0) {
          state.activeTabId = state.tabs[state.tabs.length - 1].id;
        }
      }),

    setEditorSql: (sql, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) tab.sql = sql;
      }),

    setQueryResults: (results, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) tab.queryResults = results;
      }),

    setTabExecuting: (executing, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) tab.isExecuting = executing;
      }),
  }))
);
