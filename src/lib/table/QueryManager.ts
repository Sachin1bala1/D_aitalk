/**
 * QueryManager — tab-scoped server-side sort and filter orchestration.
 *
 * Query transform state lives in WorkspaceStore per tab. This module stays as
 * a thin facade so existing UI callers can keep using the same API.
 */
import { listen } from "@tauri-apps/api/event";
import { DbClient, QueryBatch } from "../db/DbClient";
import { useWorkspaceStore, type QueryViewState, type SortState } from "../stores/WorkspaceStore";
import { buildEffectiveSqlForQueryView } from "../query/QueryTransformClient";
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

  getNullFilter(): string | null {
    return currentQueryView()?.nullFilter ?? null;
  },

  getBaseQuery(): string {
    return currentQueryView()?.baseSql ?? "";
  },

  inferTableName(): string {
    const baseSql = currentQueryView()?.baseSql ?? "";
    const match = baseSql.match(/\bFROM\s+["'`]?(\w+)["'`]?/i);
    return match?.[1] ?? "table_name";
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

  getBaseTable(): { schema: string; table: string } | null {
    const baseSql = currentQueryView()?.baseSql ?? "";
    if (!baseSql) return null;
    const qualified = baseSql.match(/\bFROM\s+"?(\w+)"?\."?(\w+)"?/i);
    if (qualified) return { schema: qualified[1], table: qualified[2] };
    const bare = baseSql.match(/\bFROM\s+"?(\w+)"?/i);
    if (bare) return { schema: "public", table: bare[1] };
    return null;
  },
};

async function reexecute() {
  const tab = activeTab();
  const view = tab?.queryView;
  if (!tab || !view?.connectionId || !view.baseSql) return;

  const effectiveSql = await buildEffectiveSqlForQueryView(view);
  updateQueryView({ effectiveSql }, tab.id);

  try {
    const response = await DbClient.executeStreaming(view.connectionId, effectiveSql);
    const queryId = response.query_id;
    updateQueryView({ currentQueryId: queryId }, tab.id);
    rowStore.reset(queryId);

    const unlisten = await listen<QueryBatch>("query_batch", (event) => {
      const batch = event.payload;
      if (batch.query_id !== queryId) return;

      rowStore.appendBatch(batch);

      if (batch.columns && (view.columns.length === 0 || currentQueryView()?.columns.length === 0)) {
        updateQueryView({ columns: batch.columns.map((column) => column.name) }, tab.id);
      }

      if (batch.is_final || batch.error) {
        rowStore.finalize();
        unlisten();
      }
    });
  } catch (error) {
    console.error("QueryManager re-execute failed:", error);
    rowStore.finalize();
  }
}
