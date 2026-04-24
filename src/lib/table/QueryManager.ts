/**
 * QueryManager — server-side sort and filter for VirtualTable.
 *
 * Keeps the "base" SQL (what the user wrote) separate from the
 * "effective" SQL (base + ORDER BY + WHERE wrap). When sort or filter
 * changes it rebuilds the effective SQL and re-executes via DbClient,
 * streaming results into RowStore exactly like a normal query.
 *
 * All state lives here (module-level singleton) so VirtualTable can
 * call setSort/setFilter without prop-drilling.
 */
import { listen } from "@tauri-apps/api/event";
import { DbClient, QueryBatch } from "../db/DbClient";
import { rowStore } from "./RowStore";

export interface SortState {
  column: string;
  direction: "asc" | "desc";
}

// ── Module state ──────────────────────────────────────────────────────────────

let _baseSql = "";
let _connectionId: string | null = null;
let _sort: SortState | null = null;
let _globalFilter = "";
let _nullFilter: string | null = null; // column name to filter IS NULL
let _columnFilters: Record<string, string> = {}; // per-column ILIKE filters
let _columns: string[] = []; // populated after first query for filter wrapping

/** External listener for when effective SQL changes (so App can show it). */
let _onSqlChange: ((sql: string) => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export const QueryManager = {
  /** Call after the user manually runs a query so we track the base SQL. */
  setBaseQuery(sql: string, connectionId: string) {
    _baseSql = sql;
    _connectionId = connectionId;
    _sort = null;
    _globalFilter = "";
    _nullFilter = null;
    _columnFilters = {};
    _columns = [];
  },

  /** Called by RowStore after first batch to populate column names. */
  setColumns(cols: string[]) {
    _columns = cols;
  },

  setOnSqlChange(fn: (sql: string) => void) {
    _onSqlChange = fn;
  },

  getSort(): SortState | null {
    return _sort;
  },

  getFilter(): string {
    return _globalFilter;
  },

  getColumnFilters(): Record<string, string> {
    return { ..._columnFilters };
  },

  getBaseQuery(): string {
    return _baseSql;
  },

  /** Best-effort: extract the first table name from the base SQL. */
  inferTableName(): string {
    const m = _baseSql.match(/\bFROM\s+["'`]?(\w+)["'`]?/i);
    return m?.[1] ?? "table_name";
  },

  /** Toggle sort: first click = ASC, second = DESC, third = clear. */
  async toggleSort(column: string) {
    if (_sort?.column === column) {
      if (_sort.direction === "asc") {
        _sort = { column, direction: "desc" };
      } else {
        _sort = null;
      }
    } else {
      _sort = { column, direction: "asc" };
    }
    await _reexecute();
  },

  async setFilter(value: string) {
    _globalFilter = value;
    _columnFilters = {}; // global filter clears per-column filters
    await _reexecute();
  },

  /** Set a per-column filter value. Empty string clears that column's filter. */
  async setColumnFilter(column: string, value: string) {
    _globalFilter = ""; // per-column filters clear global filter
    if (value.trim() === "") {
      delete _columnFilters[column];
    } else {
      _columnFilters[column] = value;
    }
    await _reexecute();
  },

  /** Clear all per-column filters. */
  async clearColumnFilters() {
    _columnFilters = {};
    await _reexecute();
  },

  async clearAll() {
    _sort = null;
    _globalFilter = "";
    _nullFilter = null;
    _columnFilters = {};
    await _reexecute();
  },

  /** Filter to show only rows where a specific column IS NULL. */
  async setNullFilter(column: string) {
    _nullFilter = column;
    _globalFilter = "";
    _columnFilters = {};
    await _reexecute();
  },

  /** Clear NULL filter. */
  async clearNullFilter() {
    _nullFilter = null;
    await _reexecute();
  },

  /** Re-run the current effective SQL (call after an inline cell edit). */
  async refresh() {
    await _reexecute();
  },

  /** Return the connection ID for the current base query. */
  getConnectionId(): string | null {
    return _connectionId;
  },

  /**
   * Parse the base SQL to extract a single source table.
   * Works for simple `SELECT ... FROM "schema"."table"` patterns.
   * Returns null if the SQL is complex (joins, subqueries, etc.).
   */
  getBaseTable(): { schema: string; table: string } | null {
    if (!_baseSql) return null;
    // schema.table — quoted or unquoted
    const m2 = _baseSql.match(/\bFROM\s+"?(\w+)"?\."?(\w+)"?/i);
    if (m2) return { schema: m2[1], table: m2[2] };
    // bare table name only
    const m1 = _baseSql.match(/\bFROM\s+"?(\w+)"?/i);
    if (m1) return { schema: "public", table: m1[1] };
    return null;
  },
};

// ── SQL builder ───────────────────────────────────────────────────────────────

function buildEffectiveSql(): string {
  if (!_baseSql) return "";

  const hasSort = _sort !== null;
  const hasGlobal = _globalFilter.trim().length > 0 && _columns.length > 0;
  const hasNullFilter = _nullFilter !== null;
  const colFilterEntries = Object.entries(_columnFilters).filter(([, v]) => v.trim() !== "");
  const hasColFilters = colFilterEntries.length > 0;

  if (!hasSort && !hasGlobal && !hasNullFilter && !hasColFilters) return _baseSql;

  // Wrap base SQL in a subquery
  let sql = `SELECT * FROM (\n  ${_baseSql.replace(/;?\s*$/, "")}\n) AS _daitalk_q`;

  // Build WHERE clause
  const conditions: string[] = [];
  if (hasNullFilter) {
    conditions.push(`"${_nullFilter}" IS NULL`);
  } else if (hasGlobal) {
    const globalConds = _columns
      .map((c) => `CAST("${c}" AS TEXT) ILIKE '%${_globalFilter.replace(/'/g, "''")}%'`)
      .join("\n  OR ");
    conditions.push(`(${globalConds})`);
  } else if (hasColFilters) {
    for (const [col, val] of colFilterEntries) {
      const escaped = val.replace(/'/g, "''");
      // Support operators: >, <, >=, <=, !=, = at start of value
      if (/^(>=|<=|!=|>|<|=)/.test(val.trim())) {
        const op = val.trim().match(/^(>=|<=|!=|>|<|=)/)![1];
        const operand = val.trim().slice(op.length).trim();
        conditions.push(`"${col}" ${op} '${operand.replace(/'/g, "''")}'`);
      } else {
        conditions.push(`CAST("${col}" AS TEXT) ILIKE '%${escaped}%'`);
      }
    }
  }

  if (conditions.length > 0) {
    sql += `\nWHERE ${conditions.join("\n  AND ")}`;
  }

  if (hasSort && _sort) {
    sql += `\nORDER BY "${_sort.column}" ${_sort.direction.toUpperCase()}`;
  }

  return sql;
}

// ── Re-execute ────────────────────────────────────────────────────────────────

let _currentQueryId: string | null = null;

async function _reexecute() {
  if (!_connectionId || !_baseSql) return;

  const effectiveSql = buildEffectiveSql();
  _onSqlChange?.(effectiveSql);

  try {
    const queryId = await DbClient.executeStreaming(_connectionId, effectiveSql);
    _currentQueryId = queryId;
    rowStore.reset(queryId);

    const unlisten = await listen<QueryBatch>("query_batch", (event) => {
      const batch = event.payload;
      if (batch.query_id !== queryId) return;

      rowStore.appendBatch(batch);

      // Populate column names for filter building
      if (batch.columns && _columns.length === 0) {
        _columns = batch.columns.map((c) => c.name);
      }

      if (batch.is_final || batch.error) {
        rowStore.finalize();
        unlisten();
      }
    });
  } catch (e) {
    console.error("QueryManager re-execute failed:", e);
    rowStore.finalize();
  }
}
