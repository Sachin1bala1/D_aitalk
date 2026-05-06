/**
 * WorkspaceStore — central Zustand state for the entire app.
 * Replaces the scattered useState() calls in the old App.tsx.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { FullSchema, ConnectionConfig } from "../db/DbClient";
import type { AgentCommand, Hypothesis, ConfidenceDeclaration } from "../agent/commands";
import type { WorkingMemoryState } from "../memory/WorkingMemory";
import { DEFAULT_WORKING_MEMORY } from "../memory/WorkingMemory";

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
  queryView: QueryViewState;
}

export interface QueryResults {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  rowCount: number;
  elapsedMs: number;
  queryId: string;
  source_tables: string[];
}

export interface SortState {
  column: string;
  direction: "asc" | "desc";
}

export interface QueryViewState {
  baseSql: string;
  connectionId: string | null;
  effectiveSql: string;
  sort: SortState | null;
  globalFilter: string;
  nullFilter: string | null;
  columnFilters: Record<string, string>;
  columns: string[];
  currentQueryId: string | null;
}

export const createDefaultQueryViewState = (
  sql = "",
  connectionId: string | null = null
): QueryViewState => ({
  baseSql: sql,
  connectionId,
  effectiveSql: sql,
  sort: null,
  globalFilter: "",
  nullFilter: null,
  columnFilters: {},
  columns: [],
  currentQueryId: null,
});

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
  addTab: (tab: Omit<TabState, "queryView"> & { queryView?: QueryViewState }) => void;
  closeTab: (tabId: string) => void;
  updateTabQueryView: (updates: Partial<QueryViewState>, tabId?: string) => void;
  resetTabQueryView: (sql: string, connectionId: string | null, tabId?: string) => void;

  // Convenience: active tab helpers
  setEditorSql: (sql: string, tabId?: string) => void;
  setQueryResults: (results: QueryResults, tabId?: string) => void;
  setTabExecuting: (executing: boolean, tabId?: string) => void;

  // Memory
  workingMemory: WorkingMemoryState;
  setActiveQuestion: (q: string | null) => void;
  addToolTried: (toolName: string) => void;
  addFinding: (finding: string) => void;
  addPreference: (pref: string) => void;
  resetWorkingMemory: () => void;

  // Hypothesis Engine
  activeHypotheses: Hypothesis[] | null;
  hypothesisProblemFrame: string | null;
  setActiveHypotheses: (h: Hypothesis[], frame: string) => void;
  clearHypotheses: () => void;

  // Confidence Scoring
  activeConfidence: ConfidenceDeclaration | null;
  setActiveConfidence: (c: ConfidenceDeclaration) => void;
  clearConfidence: () => void;

  // Pending chat input (set by StatResultView "Ask APEX" button)
  pendingChatInput: string | null;
  setPendingChatInput: (text: string) => void;
  clearPendingChatInput: () => void;

  // Object Properties Panel — selected table node
  selectedTableNode: { schema: string; table: string } | null;
  setSelectedTableNode: (node: { schema: string; table: string } | null) => void;

  // Task progress (set by TaskEngine while agent runs a multi-step task)
  currentTask: { userGoal: string; status: string } | null;
  setCurrentTask: (task: { userGoal: string; status: string } | null) => void;
}

const DEFAULT_TAB: TabState = {
  id: "tab-1",
  type: "sql_editor",
  title: "Query 1",
  sql: "SELECT * FROM users LIMIT 100;",
  connectionId: null,
  queryResults: null,
  isExecuting: false,
  queryView: createDefaultQueryViewState(),
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

    workingMemory: { ...DEFAULT_WORKING_MEMORY, sessionStartTime: Date.now() },

    activeHypotheses: null,
    hypothesisProblemFrame: null,

    activeConfidence: null,
    pendingChatInput: null,

    selectedTableNode: null,
    currentTask: null,

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
        state.tabs.push({
          ...tab,
          queryView: tab.queryView ?? createDefaultQueryViewState(tab.sql, tab.connectionId),
        });
        state.activeTabId = tab.id;
      }),

    closeTab: (tabId) =>
      set((state) => {
        state.tabs = state.tabs.filter((t) => t.id !== tabId);
        if (state.activeTabId === tabId && state.tabs.length > 0) {
          state.activeTabId = state.tabs[state.tabs.length - 1].id;
        }
      }),

    updateTabQueryView: (updates, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) Object.assign(tab.queryView, updates);
      }),

    resetTabQueryView: (sql, connectionId, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) return;
        tab.queryView = createDefaultQueryViewState(sql, connectionId);
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

    setActiveQuestion: (q) =>
      set((state) => { state.workingMemory.activeQuestion = q; }),
    addToolTried: (toolName) =>
      set((state) => { state.workingMemory.toolsTriedThisSession.push(toolName); }),
    addFinding: (finding) =>
      set((state) => { state.workingMemory.findingsSoFar.push(finding); }),
    addPreference: (pref) =>
      set((state) => { state.workingMemory.userPreferencesStated.push(pref); }),
    resetWorkingMemory: () =>
      set((state) => {
        state.workingMemory = { ...DEFAULT_WORKING_MEMORY, sessionStartTime: Date.now() };
      }),

    setActiveHypotheses: (h, frame) =>
      set((state) => {
        state.activeHypotheses = h as Hypothesis[];
        state.hypothesisProblemFrame = frame;
      }),

    clearHypotheses: () =>
      set((state) => {
        state.activeHypotheses = null;
        state.hypothesisProblemFrame = null;
      }),

    setActiveConfidence: (c) =>
      set((state) => {
        state.activeConfidence = c as ConfidenceDeclaration;
      }),

    clearConfidence: () =>
      set((state) => {
        state.activeConfidence = null;
      }),

    setPendingChatInput: (text) =>
      set((state) => {
        state.pendingChatInput = text;
      }),

    clearPendingChatInput: () =>
      set((state) => {
        state.pendingChatInput = null;
      }),

    setSelectedTableNode: (node) =>
      set((state) => {
        state.selectedTableNode = node;
      }),

    setCurrentTask: (task) =>
      set((state) => {
        state.currentTask = task;
      }),
  }))
);
