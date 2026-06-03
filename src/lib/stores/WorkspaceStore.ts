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
import type { ReviewDossier } from "../review/DataChangeReviewEngine";
import type { Task, TaskCheckpoint } from "../agent/TaskState";
import type { PersistedAiSessionState } from "../ai/AiSessionState";
import type { WorkingMemoryState } from "../memory/WorkingMemory";
import { DEFAULT_WORKING_MEMORY } from "../memory/WorkingMemory";
import type { QueryRuntimeHandle, QuerySessionState } from "../query/runtime";
import type { ImpactMap } from '../agent/harness/ImpactMapEngine';

export type AgentMode = "plan" | "auto";

export interface PITag {
  web_id: string;
  name: string;
  description: string;
  path: string;
  point_type: string;
  engineering_units: string;
}
export type QueryTabType = "sql_editor" | "table_viewer";
export type TabType = QueryTabType | "dashboard" | "artifact_chart" | "artifact_query" | "artifact_report";
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
  review?: ReviewDossier;
  taskId?: string;
  subtaskId?: string;
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

export interface ChartRequest {
  chartType: string;
  xColumn: string;
  yColumn: string;
  title?: string;
}

export interface GraphBuilderRequest {
  requestId: string;
  artifactId?: string | null;
  chartType: string;
  xColumn: string;
  yColumn: string;
  colorColumn?: string | null;
  sizeColumn?: string | null;
  title?: string;
  xLabel?: string;
  yLabel?: string;
}

export interface ArtifactLineage {
  connectionId: string | null;
  sql: string;
  queryId: string | null;
  sourceTables: string[];
  sourceTabId: string | null;
}

export interface ChartArtifactOptions {
  showDataPoints: boolean;
  showTrendLine: boolean;
  logScaleX: boolean;
  logScaleY: boolean;
  xAxisMode: "auto" | "fit" | "zero" | "manual";
  yAxisMode: "auto" | "fit" | "zero" | "manual";
  xAxisMin: string;
  xAxisMax: string;
  yAxisMin: string;
  yAxisMax: string;
  xAxisLabel: string;
  yAxisLabel: string;
  refLineValue: string;
  refLineLabel: string;
  confidenceInterval: "none" | "95" | "99";
}

export interface ChartArtifactAssignments {
  x: string | null;
  y: string | null;
  color: string | null;
  size: string | null;
  facet: string | null;
}

export interface ChartArtifact {
  id: string;
  kind: "chart";
  name: string;
  createdAt: number;
  updatedAt: number;
  lineage: ArtifactLineage;
  snapshot: DashboardDatasourceSnapshot;
  chart: {
    chartType: string;
    assignments: ChartArtifactAssignments;
    options: ChartArtifactOptions;
  };
}

export interface QueryArtifact {
  id: string;
  kind: "query";
  name: string;
  createdAt: number;
  updatedAt: number;
  lineage: ArtifactLineage;
  snapshot: DashboardDatasourceSnapshot;
}

export interface ReportArtifact {
  id: string;
  kind: "report";
  name: string;
  createdAt: number;
  updatedAt: number;
  connectionName: string;
  sourceArtifactIds: string[];
  sourceArtifactRevisionIds: Record<string, string | null>;
  sectionBindings: ReportSectionBinding[];
  spec: import("../reports/ReportBuilder").ReportSpec;
}

export type AnalysisArtifact = ChartArtifact | QueryArtifact | ReportArtifact;

export interface ReportSectionBinding {
  sectionKey: string;
  sectionType: "executive_summary" | "analysis" | "data_table";
  sourceArtifactIds: string[];
  sourceArtifactRevisionIds: Record<string, string | null>;
}

export interface ArtifactRevision {
  id: string;
  artifactId: string;
  recordedAt: number;
  artifact: AnalysisArtifact;
}

export interface ArtifactHeadState {
  headRevisionId: string | null;
  hasUncommittedChanges: boolean;
}

export function getLatestArtifactRevision(
  revisions: ArtifactRevision[] | undefined,
): ArtifactRevision | null {
  if (!revisions || revisions.length === 0) return null;
  return revisions[revisions.length - 1] ?? null;
}

export function getLatestArtifactRevisionId(
  revisions: ArtifactRevision[] | undefined,
): string | null {
  return getLatestArtifactRevision(revisions)?.id ?? null;
}

function areArtifactsEquivalent(left: AnalysisArtifact, right: AnalysisArtifact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  restoredSnapshotAt?: number | null;
  isSheet?: boolean;
}

export interface QueryTabState extends TabStateBase {
  type: QueryTabType;
}

export interface DashboardTabState extends TabStateBase {
  type: "dashboard";
  dashboard: DashboardTabStateData;
}

export interface ArtifactChartTabState extends TabStateBase {
  type: "artifact_chart";
  artifactId: string;
}

export interface ArtifactQueryTabState extends TabStateBase {
  type: "artifact_query";
  artifactId: string;
}

export interface ArtifactReportTabState extends TabStateBase {
  type: "artifact_report";
  artifactId: string;
}

export type TabState =
  | QueryTabState
  | DashboardTabState
  | ArtifactChartTabState
  | ArtifactQueryTabState
  | ArtifactReportTabState;

export type QueryTabInput = Omit<QueryTabState, "queryView"> & {
  queryView?: QueryViewState;
};

export type CreateArtifactChartTabInput = Omit<
  ArtifactChartTabState,
  "type" | "queryView"
> & {
  queryView?: QueryViewState;
};

export type CreateArtifactQueryTabInput = Omit<
  ArtifactQueryTabState,
  "type" | "queryView"
> & {
  queryView?: QueryViewState;
};

export type CreateArtifactReportTabInput = Omit<
  ArtifactReportTabState,
  "type" | "queryView"
> & {
  queryView?: QueryViewState;
};

export type CreateDashboardTabInput = Omit<
  DashboardTabState,
  "type" | "sql" | "queryResults" | "isExecuting" | "queryView" | "dashboard"
> & {
  dashboard?: Partial<DashboardTabStateData>;
  queryView?: QueryViewState;
};

export type AddTabInput =
  | QueryTabInput
  | ({ type: "dashboard" } & CreateDashboardTabInput)
  | ({ type: "artifact_chart" } & CreateArtifactChartTabInput)
  | ({ type: "artifact_query" } & CreateArtifactQueryTabInput)
  | ({ type: "artifact_report" } & CreateArtifactReportTabInput);

export type TabStateUpdate = Partial<
  Pick<
    TabStateBase,
    "title" | "connectionId" | "sql" | "queryResults" | "isExecuting" | "queryView" | "restoredSnapshotAt"
  >
>;

export type DashboardTabUpdate = Partial<Pick<DashboardTabState, "title" | "connectionId">> & {
  dashboard?: Partial<DashboardTabStateData>;
};

export type WorkspacePanel =
  | "history"
  | "agent"
  | "background_agents"
  | "artifacts"
  | "pipelines"
  | "erd"
  | "snippets"
  | "search"
  | "sessions"
  | "overview"
  | "founder"
  | "memory"
  | "harness";

export interface PersistedQueryViewState {
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

export interface PersistedTabStateBase {
  id: string;
  type: TabType;
  title: string;
  connectionId: string | null;
  sql: string;
  queryResults: QueryResults | null;
  queryView: PersistedQueryViewState;
  restoredSnapshotAt?: number | null;
}

export type PersistedTabState =
  | (PersistedTabStateBase & { type: QueryTabType })
  | (PersistedTabStateBase & { type: "dashboard"; dashboard: DashboardTabStateData })
  | (PersistedTabStateBase & { type: "artifact_chart"; artifactId: string })
  | (PersistedTabStateBase & { type: "artifact_query"; artifactId: string })
  | (PersistedTabStateBase & { type: "artifact_report"; artifactId: string });

export interface WorkspaceSessionSnapshot {
  version: 4;
  savedAt: number;
  activeConnectionId: string | null;
  activeTabId: string;
  activePanel: WorkspacePanel;
  graphBuilderRequest: GraphBuilderRequest | null;
  artifacts: Record<string, AnalysisArtifact>;
  artifactRevisions: Record<string, ArtifactRevision[]>;
  artifactHeads: Record<string, ArtifactHeadState>;
  tabs: PersistedTabState[];
  selectedTableNode: { schema: string; table: string } | null;
  aiSession: PersistedAiSessionState | null;
  taskCheckpoint: TaskCheckpoint | null;
}

function createArtifactId(kind: AnalysisArtifact["kind"]) {
  return `artifact-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferReportSectionBindings(artifact: ReportArtifact): ReportSectionBinding[] {
  const bindings: ReportSectionBinding[] = [];
  if (artifact.sourceArtifactIds.length > 0) {
    bindings.push({
      sectionKey: "executive_summary",
      sectionType: "executive_summary",
      sourceArtifactIds: artifact.sourceArtifactIds,
      sourceArtifactRevisionIds: Object.fromEntries(
        artifact.sourceArtifactIds.map((artifactId) => [
          artifactId,
          artifact.sourceArtifactRevisionIds[artifactId] ?? null,
        ]),
      ),
    });
  }

  for (const artifactId of artifact.sourceArtifactIds) {
    const section = artifact.spec.sections.find(
      (candidate) =>
        (candidate.type === "analysis" && candidate.chartId === artifactId) ||
        (candidate.type === "data_table" && candidate.title === artifact.name),
    );
    bindings.push({
      sectionKey: `artifact:${artifactId}`,
      sectionType: section?.type === "analysis" ? "analysis" : "data_table",
      sourceArtifactIds: [artifactId],
      sourceArtifactRevisionIds: {
        [artifactId]: artifact.sourceArtifactRevisionIds[artifactId] ?? null,
      },
    });
  }

  return bindings;
}

function normalizeArtifact(artifact: AnalysisArtifact): AnalysisArtifact {
  if (artifact.kind !== "report") return artifact;
  return {
    ...artifact,
    sectionBindings:
      artifact.sectionBindings && artifact.sectionBindings.length > 0
        ? artifact.sectionBindings
        : inferReportSectionBindings(artifact),
  };
}

function normalizeArtifactRevision(revision: ArtifactRevision): ArtifactRevision {
  return {
    ...revision,
    artifact: normalizeArtifact(revision.artifact),
  };
}

function cloneArtifactForDuplicate(artifact: AnalysisArtifact): AnalysisArtifact {
  const now = Date.now();
  const copyName = artifact.name.endsWith(" Copy") ? artifact.name : `${artifact.name} Copy`;

  if (artifact.kind === "query") {
    return {
      ...artifact,
      id: createArtifactId("query"),
      name: copyName,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (artifact.kind === "chart") {
    return {
      ...artifact,
      id: createArtifactId("chart"),
      name: copyName,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    ...artifact,
    id: createArtifactId("report"),
    name: copyName,
    createdAt: now,
    updatedAt: now,
  };
}

function restoreQueryViewState(input: PersistedQueryViewState): QueryViewState {
  return {
    ...input,
    runtimeHandle: null,
    sessionState: null,
  };
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
  return tab.type === "sql_editor" || tab.type === "table_viewer";
}

export function isArtifactChartTab(tab: TabState): tab is ArtifactChartTabState {
  return tab.type === "artifact_chart";
}

export function isArtifactQueryTab(tab: TabState): tab is ArtifactQueryTabState {
  return tab.type === "artifact_query";
}

export function isArtifactReportTab(tab: TabState): tab is ArtifactReportTabState {
  return tab.type === "artifact_report";
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

  if (tab.type === "artifact_chart") {
    return {
      ...tab,
      queryView:
        tab.queryView ?? createDefaultQueryViewState(tab.sql, tab.connectionId),
    };
  }

  if (tab.type === "artifact_query") {
    return {
      ...tab,
      queryView:
        tab.queryView ?? createDefaultQueryViewState(tab.sql, tab.connectionId),
    };
  }

  if (tab.type === "artifact_report") {
    return {
      ...tab,
      queryView:
        tab.queryView ?? createDefaultQueryViewState(tab.sql, tab.connectionId),
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
  restoredSnapshotAt: null,
};

export interface WorkspaceState {
  agentMode: AgentMode;
  planQueue: PlanStep[];

  undoStack: UndoEntry[];

  activeConnectionId: string | null;
  connections: ConnectionConfig[];
  schemas: Record<string, FullSchema>;
  visibleSchemas: Record<string, string[]>;
  connectionHealth: Record<string, "healthy" | "error" | "checking">;
  connectionColors: Record<string, string>;
  duckdbViews: string[];
  setDuckdbViews: (views: string[]) => void;

  piTags: PITag[];
  setPiTags: (tags: PITag[]) => void;

  focusedNode: string | null;

  chartRequest: ChartRequest | null;
  setChartRequest: (req: WorkspaceState["chartRequest"]) => void;
  graphBuilderRequest: GraphBuilderRequest | null;
  setGraphBuilderRequest: (req: WorkspaceState["graphBuilderRequest"]) => void;

  gogChartRequest: {
    spec: import("../dashboard/GoGSpec").GoGSpec;
    binData: Record<string, unknown>[] | null;
    strategy: "raw" | "binned";
    estimatedRows: number;
  } | null;
  setGogChartRequest: (req: WorkspaceState["gogChartRequest"]) => void;
  artifacts: Record<string, AnalysisArtifact>;
  artifactRevisions: Record<string, ArtifactRevision[]>;
  artifactHeads: Record<string, ArtifactHeadState>;
  updateArtifactDraft: (artifact: AnalysisArtifact) => void;
  commitArtifactRevision: (artifact: AnalysisArtifact) => ArtifactRevision;
  saveCurrentArtifactDraftAsRevision: (artifactId: string) => ArtifactRevision | null;
  discardArtifactDraftChanges: (artifactId: string) => void;
  restoreArtifactRevisionAsDraft: (artifactId: string, revisionId: string) => void;
  duplicateArtifactFromRevision: (artifactId: string, revisionId: string) => AnalysisArtifact | null;
  removeArtifact: (artifactId: string) => void;
  hydrateWorkspaceSession: (snapshot: WorkspaceSessionSnapshot) => void;

  tabs: TabState[];
  activeTabId: string;

  setAgentMode: (mode: AgentMode) => void;
  addPlanStep: (step: PlanStep) => void;
  updatePlanStep: (id: string, updates: Partial<PlanStep>) => void;
  removePlanStep: (id: string) => void;
  clearPlanQueue: () => void;
  setPlanStepStatus: (id: string, status: "approved" | "rejected") => void;

  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | undefined;
  clearUndo: () => void;

  setFocusedNode: (node: string | null) => void;

  setActiveConnection: (id: string | null) => void;
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setSchema: (connectionId: string, schema: FullSchema) => void;
  setVisibleSchemas: (connectionId: string, schemas: string[]) => void;
  setConnectionHealth: (id: string, status: "healthy" | "error" | "checking") => void;
  setConnectionColor: (id: string, color: string) => void;

  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: TabStateUpdate) => void;
  addTab: (tab: AddTabInput) => void;
  closeTab: (tabId: string) => void;
  updateTabQueryView: (updates: Partial<QueryViewState>, tabId?: string) => void;
  resetTabQueryView: (sql: string, connectionId: string | null, tabId?: string) => void;

  createDashboardTab: (tab: CreateDashboardTabInput) => void;
  createArtifactChartTab: (tab: CreateArtifactChartTabInput) => void;
  createArtifactQueryTab: (tab: CreateArtifactQueryTabInput) => void;
  createArtifactReportTab: (tab: CreateArtifactReportTabInput) => void;
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
  updateSheetColumns: (tabId: string, fields: { name: string }[], rows: Record<string, unknown>[]) => void;
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
  aiSession: PersistedAiSessionState | null;
  setAiSession: (session: PersistedAiSessionState | null) => void;
  clearAiSession: () => void;
  taskCheckpoint: TaskCheckpoint | null;
  pendingTaskResume: TaskCheckpoint | null;
  setTaskCheckpoint: (checkpoint: TaskCheckpoint | null) => void;
  abandonTaskCheckpoint: () => void;
  clearTaskCheckpoint: () => void;
  requestPendingTaskResume: (checkpoint: TaskCheckpoint | null) => void;
  clearPendingTaskResume: () => void;

  selectedTableNode: { schema: string; table: string } | null;
  setSelectedTableNode: (node: { schema: string; table: string } | null) => void;

  currentTask: Task | null;
  setCurrentTask: (task: Task | null) => void;

  impactMapResolution: ImpactMap | null;
  setImpactMapResolution: (map: ImpactMap | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer<WorkspaceState>((set, get) => ({
    agentMode: "auto",
    planQueue: [],
    undoStack: [],

    activeConnectionId: null,
    connections: [],
    schemas: {},
    visibleSchemas: {},
    connectionHealth: {},
    connectionColors: {},
    duckdbViews: [],
    piTags: [],

    focusedNode: null,
    chartRequest: null,
    graphBuilderRequest: null,
    gogChartRequest: null,
    artifacts: {},
    artifactRevisions: {},
    artifactHeads: {},

    tabs: [DEFAULT_TAB],
    activeTabId: "tab-1",

    workingMemory: { ...DEFAULT_WORKING_MEMORY, sessionStartTime: Date.now() },

    activeHypotheses: null,
    hypothesisProblemFrame: null,
    activeConfidence: null,
    pendingChatInput: null,
    aiSession: null,
    taskCheckpoint: null,
    pendingTaskResume: null,
    selectedTableNode: null,
    currentTask: null,
    impactMapResolution: null,

    setAgentMode: (mode) =>
      set((state) => {
        state.agentMode = mode;
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

    setPlanStepStatus: (id, status) =>
      set((state) => {
        const step = state.planQueue.find((s) => s.id === id);
        if (step) step.status = status;
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

    setGraphBuilderRequest: (req) =>
      set((state) => {
        state.graphBuilderRequest = req;
      }),

    setGogChartRequest: (req) =>
      set((state) => {
        state.gogChartRequest = req;
      }),

    updateArtifactDraft: (artifact) =>
      set((state) => {
        const normalizedArtifact = normalizeArtifact(artifact);
        const headRevision = getLatestArtifactRevision(state.artifactRevisions[artifact.id]);
        state.artifacts[artifact.id] = normalizedArtifact;
        state.artifactHeads[artifact.id] = {
          headRevisionId: headRevision?.id ?? null,
          hasUncommittedChanges: headRevision
            ? !areArtifactsEquivalent(headRevision.artifact, normalizedArtifact)
            : false,
        };
      }),

    commitArtifactRevision: (artifact) => {
      const normalizedArtifact = normalizeArtifact(artifact);
      const revision: ArtifactRevision = {
        id: `artifact-revision-${artifact.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        artifactId: artifact.id,
        recordedAt: Date.now(),
        artifact: normalizedArtifact,
      };
      set((state) => {
        const existing = state.artifactRevisions[artifact.id] ?? [];
        state.artifactRevisions[artifact.id] = [...existing, revision].slice(-25);
        state.artifacts[artifact.id] = normalizedArtifact;
        state.artifactHeads[artifact.id] = {
          headRevisionId: revision.id,
          hasUncommittedChanges: false,
        };
      });
      return revision;
    },

    saveCurrentArtifactDraftAsRevision: (artifactId) => {
      const artifact = get().artifacts[artifactId];
      if (!artifact) return null;
      return get().commitArtifactRevision({
        ...artifact,
        updatedAt: Date.now(),
      });
    },

    discardArtifactDraftChanges: (artifactId) =>
      set((state) => {
        const headRevision = getLatestArtifactRevision(state.artifactRevisions[artifactId]);
        if (!headRevision) return;
        state.artifacts[artifactId] = headRevision.artifact;
        state.artifactHeads[artifactId] = {
          headRevisionId: headRevision.id,
          hasUncommittedChanges: false,
        };
      }),

    restoreArtifactRevisionAsDraft: (artifactId, revisionId) =>
      set((state) => {
        const revisions = state.artifactRevisions[artifactId] ?? [];
        const targetRevision = revisions.find((revision) => revision.id === revisionId);
        const headRevision = getLatestArtifactRevision(revisions);
        if (!targetRevision) return;

        state.artifacts[artifactId] = {
          ...targetRevision.artifact,
          updatedAt: Date.now(),
        };
        state.artifactHeads[artifactId] = {
          headRevisionId: headRevision?.id ?? null,
          hasUncommittedChanges: headRevision
            ? !areArtifactsEquivalent(headRevision.artifact, targetRevision.artifact)
            : false,
        };
      }),

    duplicateArtifactFromRevision: (artifactId, revisionId) => {
      const sourceRevisions = get().artifactRevisions[artifactId] ?? [];
      const targetRevision = sourceRevisions.find((revision) => revision.id === revisionId);
      if (!targetRevision) return null;

      const duplicatedArtifact = cloneArtifactForDuplicate(targetRevision.artifact);
      const initialRevision: ArtifactRevision = {
        id: `artifact-revision-${duplicatedArtifact.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        artifactId: duplicatedArtifact.id,
        recordedAt: Date.now(),
        artifact: duplicatedArtifact,
      };

      set((state) => {
        state.artifacts[duplicatedArtifact.id] = duplicatedArtifact;
        state.artifactRevisions[duplicatedArtifact.id] = [initialRevision];
        state.artifactHeads[duplicatedArtifact.id] = {
          headRevisionId: initialRevision.id,
          hasUncommittedChanges: false,
        };
      });

      return duplicatedArtifact;
    },

    removeArtifact: (artifactId) =>
      set((state) => {
        delete state.artifacts[artifactId];
        delete state.artifactRevisions[artifactId];
        delete state.artifactHeads[artifactId];
      }),

    hydrateWorkspaceSession: (snapshot) =>
      set((state) => {
        state.activeConnectionId = snapshot.activeConnectionId;
        state.graphBuilderRequest = snapshot.graphBuilderRequest;
        state.artifacts = Object.fromEntries(
          Object.entries(snapshot.artifacts).map(([artifactId, artifact]) => [
            artifactId,
            normalizeArtifact(artifact),
          ]),
        );
        state.artifactRevisions = Object.fromEntries(
          Object.entries(snapshot.artifactRevisions).map(([artifactId, revisions]) => [
            artifactId,
            revisions.map(normalizeArtifactRevision),
          ]),
        );
        state.artifactHeads = snapshot.artifactHeads;
        state.selectedTableNode = snapshot.selectedTableNode;
        state.aiSession = snapshot.aiSession ?? null;
        state.taskCheckpoint = snapshot.taskCheckpoint
          ? {
              ...snapshot.taskCheckpoint,
              lifecycle:
                snapshot.taskCheckpoint.lifecycle === "running"
                  ? "interrupted"
                  : snapshot.taskCheckpoint.lifecycle,
              interruptedAt:
                snapshot.taskCheckpoint.lifecycle === "running"
                  ? snapshot.savedAt
                  : snapshot.taskCheckpoint.interruptedAt,
              updatedAt: snapshot.savedAt,
            }
          : null;
        state.tabs = snapshot.tabs.length > 0
          ? snapshot.tabs.map((tab) => {
              const queryView = restoreQueryViewState(tab.queryView);
              const baseState = {
                ...tab,
                isExecuting: false,
                queryView,
                restoredSnapshotAt:
                  tab.type === "sql_editor" || tab.type === "table_viewer"
                    ? (tab.queryResults ? snapshot.savedAt : null)
                    : (tab.restoredSnapshotAt ?? null),
              };
              return createTabState(baseState as AddTabInput);
            })
          : [DEFAULT_TAB];
        state.activeTabId = state.tabs.some((tab) => tab.id === snapshot.activeTabId)
          ? snapshot.activeTabId
          : state.tabs[0].id;
        state.currentTask = null;
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

    setVisibleSchemas: (connectionId, schemas) =>
      set((state) => {
        state.visibleSchemas[connectionId] = schemas;
        // Marks visible_schemas on the in-memory ConnectionConfig so it flows
        // through to persistConnections() when the caller saves connections.
        const conn = state.connections.find((c) => c.id === connectionId);
        if (conn) conn.visible_schemas = schemas;
      }),

    setDuckdbViews: (views) =>
      set((state) => {
        state.duckdbViews = views;
      }),

    setPiTags: (tags) =>
      set((state) => {
        state.piTags = tags;
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

    createArtifactChartTab: (tab) =>
      set((state) => {
        state.tabs.push(
          createTabState({
            ...tab,
            type: "artifact_chart",
          })
        );
        state.activeTabId = tab.id;
      }),

    createArtifactQueryTab: (tab) =>
      set((state) => {
        state.tabs.push(
          createTabState({
            ...tab,
            type: "artifact_query",
          })
        );
        state.activeTabId = tab.id;
      }),

    createArtifactReportTab: (tab) =>
      set((state) => {
        state.tabs.push(
          createTabState({
            ...tab,
            type: "artifact_report",
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
        if (tab) {
          tab.queryResults = results;
          tab.restoredSnapshotAt = null;
        }
      }),

    updateSheetColumns: (tabId, fields, rows) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab || !tab.queryResults) return;
        tab.queryResults = {
          ...tab.queryResults,
          fields,
          rows,
          rowCount: rows.length,
        };
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

    setAiSession: (session) =>
      set((state) => {
        state.aiSession = session;
      }),

    clearAiSession: () =>
      set((state) => {
        state.aiSession = null;
      }),

    setTaskCheckpoint: (checkpoint) =>
      set((state) => {
        state.taskCheckpoint = checkpoint;
      }),

    abandonTaskCheckpoint: () =>
      set((state) => {
        if (!state.taskCheckpoint) return;
        state.taskCheckpoint = {
          ...state.taskCheckpoint,
          lifecycle: "abandoned",
          interruptedAt: state.taskCheckpoint.interruptedAt ?? Date.now(),
          updatedAt: Date.now(),
          resumeEligible: false,
        };
      }),

    clearTaskCheckpoint: () =>
      set((state) => {
        state.taskCheckpoint = null;
      }),

    requestPendingTaskResume: (checkpoint) =>
      set((state) => {
        state.pendingTaskResume = checkpoint;
      }),

    clearPendingTaskResume: () =>
      set((state) => {
        state.pendingTaskResume = null;
      }),

    setSelectedTableNode: (node) =>
      set((state) => {
        state.selectedTableNode = node;
      }),

    setCurrentTask: (task) =>
      set((state) => {
        state.currentTask = task;
      }),

    setImpactMapResolution: (map) =>
      set((state) => {
        state.impactMapResolution = map as ImpactMap | null;
      }),
  }))
);
