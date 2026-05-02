import { DbClient } from "../db/DbClient";
import type { QueryViewState } from "../stores/WorkspaceStore";

export async function buildEffectiveSqlForQueryView(
  queryView: Pick<
    QueryViewState,
    "baseSql" | "sort" | "globalFilter" | "nullFilter" | "columnFilters" | "columns"
  >
): Promise<string> {
  return DbClient.buildEffectiveSql({
    base_sql: queryView.baseSql,
    sort: queryView.sort,
    global_filter: queryView.globalFilter,
    null_filter: queryView.nullFilter,
    column_filters: queryView.columnFilters,
    columns: queryView.columns,
  });
}
