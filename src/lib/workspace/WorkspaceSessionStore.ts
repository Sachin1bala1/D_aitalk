import { DbClient } from "../db/DbClient";
import {
  type PersistedTabState,
  type QueryViewState,
  type TabState,
  type WorkspacePanel,
  type WorkspaceSessionSnapshot,
  type WorkspaceState,
} from "../stores/WorkspaceStore";

function serializeQueryView(queryView: QueryViewState) {
  return {
    baseSql: queryView.baseSql,
    connectionId: queryView.connectionId,
    effectiveSql: queryView.effectiveSql,
    sort: queryView.sort,
    globalFilter: queryView.globalFilter,
    nullFilter: queryView.nullFilter,
    columnFilters: queryView.columnFilters,
    columns: queryView.columns,
    currentQueryId: queryView.currentQueryId,
  };
}

function serializeTab(tab: TabState): PersistedTabState {
  const base = {
    id: tab.id,
    type: tab.type,
    title: tab.title,
    connectionId: tab.connectionId,
    sql: tab.sql,
    queryResults: tab.queryResults,
    queryView: serializeQueryView(tab.queryView),
  };

  if (tab.type === "dashboard") {
    return {
      ...base,
      type: "dashboard",
      dashboard: tab.dashboard,
    };
  }

  if (tab.type === "artifact_chart") {
    return {
      ...base,
      type: "artifact_chart",
      artifactId: tab.artifactId,
    };
  }

  if (tab.type === "artifact_query") {
    return {
      ...base,
      type: "artifact_query",
      artifactId: tab.artifactId,
    };
  }

  if (tab.type === "artifact_report") {
    return {
      ...base,
      type: "artifact_report",
      artifactId: tab.artifactId,
    };
  }

  return {
    ...base,
    type: tab.type,
  };
}

export function buildWorkspaceSessionSnapshot(args: {
  workspace: WorkspaceState;
  activePanel: WorkspacePanel;
}): WorkspaceSessionSnapshot {
  return {
    version: 4,
    savedAt: Date.now(),
    activeConnectionId: args.workspace.activeConnectionId,
    activeTabId: args.workspace.activeTabId,
    activePanel: args.activePanel,
    graphBuilderRequest: args.workspace.graphBuilderRequest,
    artifacts: args.workspace.artifacts,
    artifactRevisions: args.workspace.artifactRevisions,
    artifactHeads: args.workspace.artifactHeads,
    tabs: args.workspace.tabs.map(serializeTab),
    selectedTableNode: args.workspace.selectedTableNode,
    aiSession: args.workspace.aiSession,
    taskCheckpoint: args.workspace.taskCheckpoint,
  };
}

export async function persistWorkspaceSession(snapshot: WorkspaceSessionSnapshot): Promise<void> {
  await DbClient.saveWorkspaceSession(JSON.stringify(snapshot));
}

export async function loadWorkspaceSession(): Promise<WorkspaceSessionSnapshot | null> {
  const raw = await DbClient.loadWorkspaceSession();
  if (!raw) return null;

  type LegacyWorkspaceSessionV1 = Omit<
    WorkspaceSessionSnapshot,
    "version" | "aiSession" | "taskCheckpoint"
  > & { version: 1 };
  type LegacyWorkspaceSessionV2 = Omit<
    WorkspaceSessionSnapshot,
    "version" | "taskCheckpoint"
  > & { version: 2 };
  type LegacyWorkspaceSessionV3 = Omit<WorkspaceSessionSnapshot, "version"> & { version: 3 };
  type AnyWorkspaceSession =
    | WorkspaceSessionSnapshot
    | LegacyWorkspaceSessionV1
    | LegacyWorkspaceSessionV2
    | LegacyWorkspaceSessionV3;

  const parsed = JSON.parse(raw) as AnyWorkspaceSession;
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4) {
    return null;
  }

  return {
    ...parsed,
    version: 4,
    aiSession: parsed.version === 1 ? null : parsed.aiSession,
    taskCheckpoint:
      parsed.version === 1 || parsed.version === 2 ? null : parsed.taskCheckpoint,
  };
}

export async function clearWorkspaceSession(): Promise<void> {
  await DbClient.clearWorkspaceSession();
}
