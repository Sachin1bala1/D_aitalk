import { useCallback } from "react";
import { toast } from "sonner";

import { pushHistory } from "../../components/history/QueryHistory";
import type { QueryRuntimeResults } from "../query/runtime";

type QueryKind = "run" | "explain";

interface UseAppQueryFeedbackOptions {
  setQueryResults: (results: {
    rows: Record<string, unknown>[];
    fields: { name: string }[];
    rowCount: number;
    elapsedMs: number;
    queryId: string;
    source_tables: string[];
  }) => void;
}

export function useAppQueryFeedback({ setQueryResults }: UseAppQueryFeedbackOptions) {
  const applyQueryResults = useCallback(
    (results: QueryRuntimeResults, sql: string) => {
      toast.success(
        results.rows.length === 0
          ? "Query executed — no rows returned"
          : `${results.rows.length.toLocaleString()} rows in ${results.elapsedMs}ms`
      );

      setQueryResults({
        rows: results.rows,
        fields: results.fields,
        rowCount: results.rows.length,
        elapsedMs: results.elapsedMs,
        queryId: results.queryId,
        source_tables: results.source_tables,
      });
      pushHistory({
        sql,
        rowCount: results.rows.length,
        elapsedMs: results.elapsedMs,
        timestamp: Date.now(),
      });
    },
    [setQueryResults]
  );

  const handleQuerySuccess = useCallback(
    (kind: QueryKind, results: QueryRuntimeResults, sql: string) => {
      if (kind === "run") {
        applyQueryResults(results, sql);
        return;
      }

      toast.success(`EXPLAIN plan ready — ${results.rows.length} plan lines`);
      setQueryResults({
        rows: results.rows,
        fields: results.fields,
        rowCount: results.rows.length,
        elapsedMs: results.elapsedMs,
        queryId: results.queryId,
        source_tables: results.source_tables,
      });
    },
    [applyQueryResults, setQueryResults]
  );

  const handleQueryError = useCallback((kind: QueryKind, message: string, sql: string) => {
    if (kind === "run") {
      toast.error(message);
      pushHistory({ sql, rowCount: 0, elapsedMs: 0, timestamp: Date.now(), error: message });
      return;
    }

    toast.error(`EXPLAIN failed: ${message}`);
  }, []);

  return {
    handleQuerySuccess,
    handleQueryError,
  };
}
