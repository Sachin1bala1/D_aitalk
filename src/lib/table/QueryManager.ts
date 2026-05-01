/**
 * QueryManager — tab-scoped server-side sort and filter orchestration.
 *
 * Query view state lives in WorkspaceStore per tab. This module is now a
 * thin façade so existing callers can keep using the same API without relying
 * on module-global mutable query state.
 */
import { DbClient } from "../db/DbClient";
import {
  cancelStreamingQuery,
  runStreamingQuery,
  type QueryRuntimeHandle,
  type QuerySessionState,
} from "../query/runtime";
import { useWorkspaceStore, type QueryViewState, type SortState } from "../stores/WorkspaceStore";
import { rowStore } from "./RowStore";

function activeTab() {
  const state = useWorkspaceStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

function currentQueryView(): QueryViewState | null {
  return activeTab()?.queryView ?? null;
}

function updateQueryView(updates: Partial<QueryViewState>, tabId?: string) {
  useWorkspaceStore.getState().updateTabQueryView(updates, tabId);
}

function buildRunningSession(queryId: string): QuerySessionState {
  return {
    status: "running",
    queryId,
    elapsedMs: 0,
    rowsSoFar: 0,
  };
}

export const QueryManager = {
  setBaseQuery(sql: string, connectionId: string) {
    useWorkspaceStore.getState().resetTabQueryView(sql, connectionId);
  },

  setColumns(cols: string[]) {
    updateQueryView({ columns: cols });
  },

  getSort(): SortState | null {
    return currentQueryView()?.sort ?? null;
  },

  getFilter(): string {
    return currentQueryView()?.globalFilter ?? "";
  },

  getColumnFilters(): Record<string, string> {
    return { ...(currentQueryView()?.columnFilters ?? {}) };
  },

  getBaseQuery(): string {
    return currentQueryView()?.baseSql ?? "";
  },

  async toggleSort(column: string) {
    const view = currentQueryView();
    if (!view) return;

    const sort =
      view.sort?.column === column
        ? view.sort.direction === "asc"
          ? { column, direction: "desc" as const }
          : null
        : { column, direction: "asc" as const };

    updateQueryView({ sort });
    await reexecute();
  },

  async setFilter(value: string) {
    updateQueryView({
      globalFilter: value,
      columnFilters: {},
      nullFilter: null,
    });
    await reexecute();
  },

  async setColumnFilter(column: string, value: string) {
    const view = currentQueryView();
    if (!view) return;
    const columnFilters = { ...view.columnFilters };
    if (value.trim() === "") {
      delete columnFilters[column];
    } else {
      columnFilters[column] = value;
    }

    updateQueryView({
      globalFilter: "",
      nullFilter: null,
      columnFilters,
    });
    await reexecute();
  },

  async clearColumnFilters() {
    updateQueryView({ columnFilters: {} });
    await reexecute();
  },

  async clearAll() {
    updateQueryView({
      sort: null,
      globalFilter: "",
      nullFilter: null,
      columnFilters: {},
    });
    await reexecute();
  },

  async setNullFilter(column: string) {
    updateQueryView({
      nullFilter: column,
      globalFilter: "",
      columnFilters: {},
    });
    await reexecute();
  },

  async clearNullFilter() {
    updateQueryView({ nullFilter: null });
    await reexecute();
  },

  async refresh() {
    await reexecute();
  },

  getConnectionId(): string | null {
    return currentQueryView()?.connectionId ?? null;
  },
};

async function reexecute() {
  const tab = activeTab();
  const view = tab?.queryView;
  if (!tab || !view?.connectionId || !view.baseSql) return;

  const effectiveSql = await DbClient.buildEffectiveSql({
    base_sql: view.baseSql,
    sort: view.sort,
    global_filter: view.globalFilter,
    null_filter: view.nullFilter,
    column_filters: view.columnFilters,
    columns: view.columns,
  });

  updateQueryView({ effectiveSql }, tab.id);

  try {
    await cancelStreamingQuery(view.runtimeHandle);

    const runtimeHandle: QueryRuntimeHandle = await runStreamingQuery(
      view.connectionId,
      effectiveSql,
      {
        onColumns(fields) {
          const current = useWorkspaceStore
            .getState()
            .tabs.find((candidate) => candidate.id === tab.id)?.queryView;
          if ((current?.columns.length ?? 0) === 0) {
            updateQueryView(
              { columns: fields.map((column) => column.name) },
              tab.id
            );
          }
        },
        onSuccess(results) {
          updateQueryView(
            {
              currentQueryId: results.queryId,
              sessionState: {
                status: "completed",
                queryId: results.queryId,
                elapsedMs: results.elapsedMs,
                rowsSoFar: results.rows.length,
              },
            },
            tab.id
          );
        },
        onStateChange(state) {
          updateQueryView({ sessionState: state }, tab.id);
        },
        onSettled() {
          rowStore.finalize();
        },
      }
    );

    updateQueryView(
      {
        runtimeHandle,
        currentQueryId: runtimeHandle.queryId,
        sessionState: buildRunningSession(runtimeHandle.queryId),
      },
      tab.id
    );
  } catch (error) {
    console.error("QueryManager re-execute failed:", error);
    rowStore.finalize();
    updateQueryView(
      {
        runtimeHandle: null,
        sessionState: {
          status: "failed",
          queryId: view.currentQueryId ?? "unknown",
          elapsedMs: 0,
          rowsSoFar: 0,
          errorMessage:
            error instanceof Error ? error.message : "Query re-execute failed",
        },
      },
      tab.id
    );
  }
}
