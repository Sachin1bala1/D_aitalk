import { useCallback, useRef } from "react";
import { DbClient } from "../db/DbClient";
import { QueryManager } from "../table/QueryManager";
import { useWorkspaceStore, type QueryViewState } from "../stores/WorkspaceStore";
import {
  cancelStreamingQuery,
  runExplainQuery,
  runStreamingQuery,
  splitSqlStatements,
  type QueryRuntimeHandle,
  type QueryRuntimeResults,
} from "./runtime";

type QueryKind = "run" | "explain";

interface ActiveTabLike {
  sql?: string;
  isExecuting?: boolean;
}

interface AppQueryControllerOptions {
  activeConnectionId: string | null;
  activeTab?: ActiveTabLike;
  hasBindParams: (sql: string) => boolean;
  onRequireBindParams: (sql: string) => void;
  onColumns: (columns: string[]) => void;
  onStatementsExecuted?: (count: number) => void;
  onSuccess: (kind: QueryKind, results: QueryRuntimeResults, sql: string) => void;
  onError: (kind: QueryKind, message: string, sql: string) => void;
  setExecuting: (executing: boolean) => void;
}

export function useAppQueryController({
  activeConnectionId,
  activeTab,
  hasBindParams,
  onRequireBindParams,
  onColumns,
  onStatementsExecuted,
  onSuccess,
  onError,
  setExecuting,
}: AppQueryControllerOptions) {
  const currentQueryHandleRef = useRef<QueryRuntimeHandle | null>(null);

  const syncActiveTabQueryView = useCallback(
    (updates: Partial<QueryViewState>) => {
      const state = useWorkspaceStore.getState();
      state.updateTabQueryView(updates);
    },
    []
  );

  const finalizeHandle = useCallback(() => {
    currentQueryHandleRef.current = null;
    syncActiveTabQueryView({ runtimeHandle: null });
    setExecuting(false);
  }, [setExecuting, syncActiveTabQueryView]);

  const executeStreaming = useCallback(async (sql: string, kind: QueryKind) => {
    if (!activeConnectionId) {
      onError(kind, "No active database connection", sql);
      return;
    }

    setExecuting(true);
    QueryManager.setBaseQuery(sql, activeConnectionId);
    syncActiveTabQueryView({
      effectiveSql: sql,
      sessionState: null,
      runtimeHandle: null,
      currentQueryId: null,
    });

    try {
      const runner = kind === "explain" ? runExplainQuery : runStreamingQuery;
      currentQueryHandleRef.current = await runner(activeConnectionId, sql, {
        onColumns: (fields) => onColumns(fields.map((field) => field.name)),
        onSuccess: (results) => onSuccess(kind, results, sql),
        onError: (message) => onError(kind, message, sql),
        onStateChange: (state) => {
          syncActiveTabQueryView({ sessionState: state });
        },
        onSettled: () => finalizeHandle(),
      });
      syncActiveTabQueryView({
        runtimeHandle: currentQueryHandleRef.current,
        currentQueryId: currentQueryHandleRef.current.queryId,
      });
    } catch (error: any) {
      finalizeHandle();
      onError(kind, error?.message ?? "Query failed", sql);
    }
  }, [activeConnectionId, finalizeHandle, onColumns, onError, onSuccess, setExecuting, syncActiveTabQueryView]);

  const handleExecute = useCallback(async (sqlOverride?: string) => {
    if (activeTab?.isExecuting) return;
    if (!activeConnectionId) {
      onError("run", "No active database connection", sqlOverride ?? activeTab?.sql ?? "");
      return;
    }

    const sql = sqlOverride ?? activeTab?.sql;
    if (!sql) return;

    if (!sqlOverride && hasBindParams(sql)) {
      onRequireBindParams(sql);
      return;
    }

    const statements = splitSqlStatements(sql);
    if (statements.length > 1) {
      setExecuting(true);
      let successCount = 0;

      for (let i = 0; i < statements.length - 1; i++) {
        const stmt = statements[i];
        try {
          await DbClient.execute(activeConnectionId, stmt);
          successCount++;
        } catch (e: any) {
          setExecuting(false);
          onError("run", `Statement ${i + 1}: ${e?.message ?? String(e)}`, sql);
          return;
        }
      }

      setExecuting(false);
      if (successCount > 0) {
        onStatementsExecuted?.(successCount);
      }

      await executeStreaming(statements[statements.length - 1], "run");
      return;
    }

    await executeStreaming(sql, "run");
  }, [activeConnectionId, activeTab, executeStreaming, hasBindParams, onError, onRequireBindParams, onStatementsExecuted, setExecuting]);

  const handleExplain = useCallback(async () => {
    const sql = activeTab?.sql;
    if (!sql || !activeConnectionId) {
      onError("explain", "No SQL or connection active", sql ?? "");
      return;
    }
    await executeStreaming(sql, "explain");
  }, [activeConnectionId, activeTab?.sql, executeStreaming, onError]);

  const handleStop = useCallback(async () => {
    await cancelStreamingQuery(currentQueryHandleRef.current);
    currentQueryHandleRef.current = null;
    syncActiveTabQueryView({
      runtimeHandle: null,
      sessionState: null,
    });
    setExecuting(false);
  }, [setExecuting, syncActiveTabQueryView]);

  return {
    handleExecute,
    handleExplain,
    handleStop,
  };
}
