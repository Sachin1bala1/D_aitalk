/**
 * WorkspaceStore - central Zustand state for the entire app.
 * Replaces the scattered useState() calls in the old App.tsx.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { FullSchema, ConnectionConfig } from "../db/DbClient";
import type {
  AgentCommand,
  Hypothesis,
  ConfidenceDeclaration,
} from "../agent/commands";
import type { WorkingMemoryState } from "../memory/WorkingMemory";
import { DEFAULT_WORKING_MEMORY } from "../memory/WorkingMemory";
import type { QueryRuntimeHandle, QuerySessionState } from "../query/runtime";

export type AgentMode = "plan" | "auto";
export type QueryTabType = "sql_editor" | "table_viewer";
export type TabType = QueryTabType | "dashboard";
export type DashboardWidgetType =
  | "table"
  | "metric"
  | "line_chart"
  | "bar_chart"
  | "scatter_chart"
  | "area_chart"
  | "pie_chart"
  | "text";

export interface PlanStep {
  id: string;
  commandType: string;
  humanReadable: string;
  sqlPreview?: string;
  riskLevel: "safe" | "caution" | "destructive";
  status: "pending" | "approved" | "rejected" | "executing" | "done" | "failed";
  errorMessage?: string;
  command?: AgentCommand;
}

export interface UndoEntry {
  id: string;
  humanReadable: string;
  command: AgentCommand;
  timestamp: number;
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
  runtimeHandle: QueryRuntimeHandle | null;
  sessionState: QuerySessionState | null;
}

export interface DashboardDatasourceSnapshot {
  id: string;
  name: string;
  connectionId: string | null;
  sql: string;
  capturedAt: number;
  rowCount: number;
  elapsedMs: number;
  queryId: string | null;
  fields: QueryResults["fields"];
  rows: QueryResults["rows"];
  sourceTables: string[];
}

export interface DashboardWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string;
  datasourceId: string | null;
  layout: DashboardWidgetLayout;
  config: Record<string, unknown>;
}

export interface DashboardSelectedWidgetState {
  widgetId: string | null;
  mode: "browse" | "edit";
}

export interface DashboardTabStateData {
  datasources: Record<string, DashboardDatasourceSnapshot>;
  widgets: DashboardWidget[];
  selectedWidget: DashboardSelectedWidgetState;
}

export interface TabStateBase {
  id: string;
  type: TabType;
  title: string;
  connectionId: string | null;
  sql: string;
  queryResults: QueryResults | null;
  isExecuting: boolean;
  queryView: QueryViewState;
}

export interface QueryTabState extends TabStateBase {
  type: QueryTabType;
}

export interface DashboardTabState extends TabStateBase {
  type: "dashboard";
  dashboard: DashboardTabStateData;
}

export type TabState = QueryTabState | DashboardTabState;

export type QueryTabInput = Omit<QueryTabState, "queryView"> & {
  queryView?: QueryViewState;
};

export type CreateDashboardTabInput = Omit<
  DashboardTabState,
  "type" | "sql" | "queryResults" | "isExecuting" | "queryView" | "dashboard"
> & {
  dashboard?: Partial<DashboardTabStateData>;
  queryView?: QueryViewState;
};

export type AddTabInput = QueryTabInput | ({ type: "dashboard" } & CreateDashboardTabInput);

export type TabStateUpdate = Partial<
  Pick<
    TabStateBase,
    "title" | "connectionId" | "sql" | "queryResults" | "isExecuting" | "queryView"
  >
>;

export type DashboardTabUpdate = Partial<Pick<DashboardTabState, "title" | "connectionId">> & {
  dashboard?: Partial<DashboardTabStateData>;
};

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
  runtimeHandle: null,
  sessionState: null,
});

export const createDefaultDashboardSelectedWidgetState =
  (): DashboardSelectedWidgetState => ({
    widgetId: null,
    mode: "browse",
  });

export const createDefaultDashboardTabStateData = (
  input?: Partial<DashboardTabStateData>
): DashboardTabStateData => ({
  datasources: input?.datasources ?? {},
  widgets: input?.widgets ?? [],
  selectedWidget:
    input?.selectedWidget ?? createDefaultDashboardSelectedWidgetState(),
});

export function isDashboardTab(tab: TabState): tab is DashboardTabState {
  return tab.type === "dashboard";
}

export function isQueryTab(tab: TabState): tab is QueryTabState {
  return tab.type !== "dashboard";
}

function createTabState(tab: AddTabInput): TabState {
  if (tab.type === "dashboard") {
    return {
      ...tab,
      sql: "",
      queryResults: null,
      isExecuting: false,
      queryView:
        tab.queryView ?? createDefaultQueryViewState("", tab.connectionId),
      dashboard: createDefaultDashboardTabStateData(tab.dashboard),
    };
  }

  return {
    ...tab,
    queryView:
      tab.queryView ?? createDefaultQueryViewState(tab.sql, tab.connectionId),
  };
}

const DEFAULT_TAB: QueryTabState = {
  id: "tab-1",
  type: "sql_editor",
  title: "Query 1",
  sql: "SELECT * FROM users LIMIT 100;",
  connectionId: null,
  queryResults: null,
  isExecuting: false,
  queryView: createDefaultQueryViewState(),
};

export interface WorkspaceState {
  agentMode: AgentMode;
  planQueue: PlanStep[];

  undoStack: UndoEntry[];

  activeConnectionId: string | null;
  connections: ConnectionConfig[];
  schemas: Record<string, FullSchema>;
  connectionHealth: Record<string, "healthy" | "error" | "checking">;
  connectionColors: Record<string, string>;

  focusedNode: string | null;

  chartRequest: { chartType: string; xColumn: string; yColumn: string; title?: string } | null;
  setChartRequest: (req: WorkspaceState["chartRequest"]) => void;

  gogChartRequest: {
    spec: import("../dashboard/GoGSpec").GoGSpec;
    binData: Record<string, unknown>[] | null;
    strategy: "raw" | "binned";
    estimatedRows: number;
  } | null;
  setGogChartRequest: (req: WorkspaceState["gogChartRequest"]) => void;

  tabs: TabState[];
  activeTabId: string;

  setAgentMode: (mode: AgentMode) => void;
  addPlanStep: (step: PlanStep) => void;
  updatePlanStep: (id: string, updates: Partial<PlanStep>) => void;
  removePlanStep: (id: string) => void;
  clearPlanQueue: () => void;

  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | undefined;
  clearUndo: () => void;

  setFocusedNode: (node: string | null) => void;

  setActiveConnection: (id: string | null) => void;
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setSchema: (connectionId: string, schema: FullSchema) => void;
  setConnectionHealth: (id: string, status: "healthy" | "error" | "checking") => void;
  setConnectionColor: (id: string, color: string) => void;

  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: TabStateUpdate) => void;
  addTab: (tab: AddTabInput) => void;
  closeTab: (tabId: string) => void;
  updateTabQueryView: (updates: Partial<QueryViewState>, tabId?: string) => void;
  resetTabQueryView: (sql: string, connectionId: string | null, tabId?: string) => void;

  createDashboardTab: (tab: CreateDashboardTabInput) => void;
  updateDashboardTab: (tabId: string, updates: DashboardTabUpdate) => void;
  upsertDashboardDatasourceSnapshot: (
    tabId: string,
    snapshot: DashboardDatasourceSnapshot
  ) => void;
  removeDashboardDatasourceSnapshot: (tabId: string, datasourceId: string) => void;
  addDashboardWidget: (tabId: string, widget: DashboardWidget) => void;
  updateDashboardWidget: (
    tabId: string,
    widgetId: string,
    updates: Partial<DashboardWidget>
  ) => void;
  removeDashboardWidget: (tabId: string, widgetId: string) => void;
  setDashboardSelectedWidget: (
    tabId: string,
    selectedWidget: DashboardSelectedWidgetState
  ) => void;

  setEditorSql: (sql: string, tabId?: string) => void;
  setQueryResults: (results: QueryResults, tabId?: string) => void;
  setTabExecuting: (executing: boolean, tabId?: string) => void;

  workingMemory: WorkingMemoryState;
  setActiveQuestion: (q: string | null) => void;
  addToolTried: (toolName: string) => void;
  addFinding: (finding: string) => void;
  addPreference: (pref: string) => void;
  resetWorkingMemory: () => void;

  activeHypotheses: Hypothesis[] | null;
  hypothesisProblemFrame: string | null;
  setActiveHypotheses: (h: Hypothesis[], frame: string) => void;
  clearHypotheses: () => void;

  activeConfidence: ConfidenceDeclaration | null;
  setActiveConfidence: (c: ConfidenceDeclaration) => void;
  clearConfidence: () => void;

  pendingChatInput: string | null;
  setPendingChatInput: (text: string) => void;
  clearPendingChatInput: () => void;

  selectedTableNode: { schema: string; table: string } | null;
  setSelectedTableNode: (node: { schema: string; table: string } | null) => void;

  currentTask: { userGoal: string; status: string } | null;
  setCurrentTask: (task: { userGoal: string; status: string } | null) => void;
}

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
    gogChartRequest: null,

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

    setGogChartRequest: (req) =>
      set((state) => {
        state.gogChartRequest = req;
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
          const palette = [
            "#00d2ff",
            "#a78bfa",
            "#34d399",
            "#f59e0b",
            "#f87171",
            "#60a5fa",
            "#fb923c",
            "#e879f9",
          ];
          state.connectionColors[config.id] =
            palette[state.connections.length % palette.length];
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
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) return;
        Object.assign(tab, updates);
      }),

    addTab: (tab) =>
      set((state) => {
        state.tabs.push(createTabState(tab));
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
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (tab) {
          Object.assign(tab.queryView, updates);
        }
      }),

    resetTabQueryView: (sql, connectionId, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (!tab) return;
        tab.queryView = createDefaultQueryViewState(sql, connectionId);
      }),

    createDashboardTab: (tab) =>
      set((state) => {
        state.tabs.push(
          createTabState({
            ...tab,
            type: "dashboard",
          })
        );
        state.activeTabId = tab.id;
      }),

    updateDashboardTab: (tabId, updates) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;

        if (updates.title !== undefined) tab.title = updates.title;
        if (updates.connectionId !== undefined) {
          tab.connectionId = updates.connectionId;
        }
        if (updates.dashboard?.datasources !== undefined) {
          tab.dashboard.datasources = updates.dashboard.datasources;
        }
        if (updates.dashboard?.widgets !== undefined) {
          tab.dashboard.widgets = updates.dashboard.widgets;
        }
        if (updates.dashboard?.selectedWidget !== undefined) {
          tab.dashboard.selectedWidget = updates.dashboard.selectedWidget;
        }
      }),

    upsertDashboardDatasourceSnapshot: (tabId, snapshot) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        tab.dashboard.datasources[snapshot.id] = snapshot;
      }),

    removeDashboardDatasourceSnapshot: (tabId, datasourceId) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        delete tab.dashboard.datasources[datasourceId];
        tab.dashboard.widgets = tab.dashboard.widgets.map((widget) =>
          widget.datasourceId === datasourceId
            ? { ...widget, datasourceId: null }
            : widget
        );
        if (tab.dashboard.selectedWidget.widgetId) {
          const selected = tab.dashboard.widgets.find(
            (widget) => widget.id === tab.dashboard.selectedWidget.widgetId
          );
          if (!selected) {
            tab.dashboard.selectedWidget =
              createDefaultDashboardSelectedWidgetState();
          }
        }
      }),

    addDashboardWidget: (tabId, widget) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        tab.dashboard.widgets.push(widget);
        tab.dashboard.selectedWidget = {
          widgetId: widget.id,
          mode: "edit",
        };
      }),

    updateDashboardWidget: (tabId, widgetId, updates) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        const widget = tab.dashboard.widgets.find(
          (candidate) => candidate.id === widgetId
        );
        if (!widget) return;

        if (updates.layout) {
          widget.layout = {
            ...widget.layout,
            ...updates.layout,
          };
        }
        if (updates.config) {
          widget.config = {
            ...widget.config,
            ...updates.config,
          };
        }

        const { layout, config, ...rest } = updates;
        Object.assign(widget, rest);
      }),

    removeDashboardWidget: (tabId, widgetId) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        tab.dashboard.widgets = tab.dashboard.widgets.filter(
          (widget) => widget.id !== widgetId
        );
        if (tab.dashboard.selectedWidget.widgetId === widgetId) {
          tab.dashboard.selectedWidget =
            createDefaultDashboardSelectedWidgetState();
        }
      }),

    setDashboardSelectedWidget: (tabId, selectedWidget) =>
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab || !isDashboardTab(tab)) return;
        tab.dashboard.selectedWidget = selectedWidget;
      }),

    setEditorSql: (sql, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (tab) tab.sql = sql;
      }),

    setQueryResults: (results, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (tab) tab.queryResults = results;
      }),

    setTabExecuting: (executing, tabId) =>
      set((state) => {
        const id = tabId ?? state.activeTabId;
        const tab = state.tabs.find((candidate) => candidate.id === id);
        if (tab) tab.isExecuting = executing;
      }),

    setActiveQuestion: (q) =>
      set((state) => {
        state.workingMemory.activeQuestion = q;
      }),

    addToolTried: (toolName) =>
      set((state) => {
        state.workingMemory.toolsTriedThisSession.push(toolName);
      }),

    addFinding: (finding) =>
      set((state) => {
        state.workingMemory.findingsSoFar.push(finding);
      }),

    addPreference: (pref) =>
      set((state) => {
        state.workingMemory.userPreferencesStated.push(pref);
      }),

    resetWorkingMemory: () =>
      set((state) => {
        state.workingMemory = {
          ...DEFAULT_WORKING_MEMORY,
          sessionStartTime: Date.now(),
        };
      }),

    setActiveHypotheses: (h, frame) =>
      set((state) => {
        state.activeHypotheses = h;
        state.hypothesisProblemFrame = frame;
      }),

    clearHypotheses: () =>
      set((state) => {
        state.activeHypotheses = null;
        state.hypothesisProblemFrame = null;
      }),

    setActiveConfidence: (c) =>
      set((state) => {
        state.activeConfidence = c;
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
