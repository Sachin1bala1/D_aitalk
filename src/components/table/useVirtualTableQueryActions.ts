import { useCallback } from "react";
import { toast } from "sonner";
import { DbClient, ColumnMeta } from "../../lib/db/DbClient";
import { QueryManager } from "../../lib/table/QueryManager";
import { rowStore } from "../../lib/table/RowStore";

function parseSingleSourceTable(sourceTables: string[]): { schema: string; table: string } | null {
  if (sourceTables.length !== 1) return null;
  const raw = sourceTables[0]?.trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length === 1) {
    return { schema: "public", table: parts[0] };
  }
  const table = parts.pop();
  if (!table) return null;
  return { schema: parts.join("."), table };
}

function sqlLiteral(raw: string, col: ColumnMeta | undefined): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return "NULL";
  if (col?.display_type?.kind === "boolean") {
    return trimmed.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }
  if (col?.display_type?.kind === "integer") {
    const n = parseInt(trimmed, 10);
    if (!isNaN(n)) return String(n);
  }
  if (col?.display_type?.kind === "float") {
    const n = parseFloat(trimmed);
    if (!isNaN(n)) return String(n);
  }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

interface QueryResultsLike {
  queryId: string;
  source_tables: string[];
}

interface EditingCell {
  rowIndex: number;
  colName: string;
  draftValue: string;
}

interface UseVirtualTableQueryActionsParams {
  activeConnectionId: string | null;
  currentQueryResult: QueryResultsLike | null;
  lastTrackedQueryIdRef: React.MutableRefObject<string | null>;
  setSort: (sort: ReturnType<typeof QueryManager.getSort>) => void;
  setFilterText: (value: string) => void;
  filterDebounce: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  isStreaming: boolean;
  setEditingCell: React.Dispatch<React.SetStateAction<EditingCell | null>>;
  editingCell: EditingCell | null;
  rows: Record<string, unknown>[];
}

export function useVirtualTableQueryActions({
  activeConnectionId,
  currentQueryResult,
  lastTrackedQueryIdRef,
  setSort,
  setFilterText,
  filterDebounce,
  isStreaming,
  setEditingCell,
  editingCell,
  rows,
}: UseVirtualTableQueryActionsParams) {
  const handleChartRendered = useCallback(
    async (
      chartType: string,
      columnCount: number,
      selection: { xColumn: string; yColumn: string }
    ) => {
      if (!activeConnectionId || !currentQueryResult) return;
      if (currentQueryResult.queryId === lastTrackedQueryIdRef.current) return;

      const lineageTarget =
        currentQueryResult.source_tables.length <= 1
          ? currentQueryResult.source_tables[0] ?? null
          : currentQueryResult.source_tables.join(",");

      try {
        await DbClient.recordVisualizationViewed({
          query_id: currentQueryResult.queryId,
          chart_type: chartType,
          column_count: columnCount,
          viewed_at: new Date().toISOString(),
        });

        if (lineageTarget) {
          await DbClient.updateParameterAffinity(activeConnectionId, [
            { table_name: lineageTarget, column_name: selection.xColumn },
            { table_name: lineageTarget, column_name: selection.yColumn },
          ]);
        }

        lastTrackedQueryIdRef.current = currentQueryResult.queryId;
      } catch {
        // Ignore tracking failures to preserve current UI behavior.
      }
    },
    [activeConnectionId, currentQueryResult, lastTrackedQueryIdRef]
  );

  const handleSortClick = useCallback(async (colName: string) => {
    await QueryManager.toggleSort(colName);
    setSort(QueryManager.getSort());
  }, [setSort]);

  const handleFilterChange = useCallback((value: string) => {
    setFilterText(value);
    clearTimeout(filterDebounce.current);
    filterDebounce.current = setTimeout(() => {
      QueryManager.setFilter(value);
    }, 400);
  }, [filterDebounce, setFilterText]);

  const handleClearFilter = useCallback(async () => {
    setFilterText("");
    await QueryManager.setFilter("");
  }, [setFilterText]);

  const handleCellDoubleClick = useCallback((rowIndex: number, colName: string, currentValue: unknown) => {
    if (isStreaming) return;
    setEditingCell({
      rowIndex,
      colName,
      draftValue: currentValue === null || currentValue === undefined ? "" : String(currentValue),
    });
  }, [isStreaming, setEditingCell]);

  const handleEditCancel = useCallback(() => setEditingCell(null), [setEditingCell]);

  const handleEditCommit = useCallback(async () => {
    if (!editingCell) return;
    const { rowIndex, colName, draftValue } = editingCell;
    setEditingCell(null);

    const tableInfo = parseSingleSourceTable(currentQueryResult?.source_tables ?? []);
    const connectionId = QueryManager.getConnectionId();

    if (!tableInfo || !connectionId) {
      toast.error("Cannot update: run a simple SELECT from a single table first");
      return;
    }

    const cols = rowStore.columns;
    const pkCol =
      cols.find((c) => c.is_primary_key) ??
      cols.find((c) => c.name.toLowerCase() === "id") ??
      cols[0];

    if (!pkCol) {
      toast.error("Cannot update: no identifiable primary key");
      return;
    }

    const row = rows[rowIndex];
    const pkValue = row[pkCol.name];
    const colMeta = cols.find((c) => c.name === colName);
    const pkMeta = cols.find((c) => c.name === pkCol.name);

    const newValSql = sqlLiteral(draftValue, colMeta);
    const pkValSql = sqlLiteral(pkValue === null ? "" : String(pkValue), pkMeta);

    const sql = `UPDATE "${tableInfo.schema}"."${tableInfo.table}" SET "${colName}" = ${newValSql} WHERE "${pkCol.name}" = ${pkValSql}`;

    try {
      await DbClient.execute(connectionId, sql);
      toast.success("Cell updated");
      await QueryManager.refresh();
    } catch (e: any) {
      toast.error(`Update failed: ${e.message ?? "unknown error"}`);
    }
  }, [currentQueryResult, editingCell, rows, setEditingCell]);

  return {
    handleChartRendered,
    handleSortClick,
    handleFilterChange,
    handleClearFilter,
    handleCellDoubleClick,
    handleEditCancel,
    handleEditCommit,
  };
}
