import { listen } from "@tauri-apps/api/event";
import type { ExecuteStreamingResponse, QueryBatch } from "../db/DbClient";
import { DbClient } from "../db/DbClient";
import { rowStore } from "../table/RowStore";

export type QuerySessionStatus = "running" | "completed" | "failed" | "cancelled";

export interface QueryRuntimeResults {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  elapsedMs: number;
  queryId: string;
  source_tables: string[];
}

export interface QuerySessionState {
  status: QuerySessionStatus;
  queryId: string;
  elapsedMs: number;
  rowsSoFar: number;
  errorMessage?: string;
}

export interface QueryRuntimeCallbacks {
  onColumns?: (fields: { name: string }[]) => void;
  onSuccess?: (results: QueryRuntimeResults) => void;
  onError?: (message: string) => void;
  onSettled?: (state: QuerySessionState) => void;
  onStateChange?: (state: QuerySessionState) => void;
}

export interface QueryRuntimeHandle {
  queryId: string;
  stopListening: () => void;
}

export interface CollectedStreamingQuery {
  rows: Record<string, unknown>[];
  fields: { name: string }[];
  elapsedMs: number;
  queryId: string;
  source_tables: string[];
}

interface StreamStartResponse {
  query_id: string;
  source_tables: string[];
}

function buildSessionState(
  queryId: string,
  status: QuerySessionStatus,
  elapsedMs = 0,
  rowsSoFar = 0,
  errorMessage?: string,
): QuerySessionState {
  return { status, queryId, elapsedMs, rowsSoFar, errorMessage };
}

function isCancellationMessage(message: string): boolean {
  return message.toLowerCase().includes("cancel");
}

function notifyStateChange(
  callbacks: QueryRuntimeCallbacks,
  state: QuerySessionState,
): QuerySessionState {
  callbacks.onStateChange?.(state);
  if (state.status !== "running") {
    callbacks.onSettled?.(state);
  }
  return state;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      current += ch;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        current += "*/";
        i++;
      } else {
        current += ch;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      inLineComment = true;
      current += "--";
      i++;
      continue;
    }
    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      inBlockComment = true;
      current += "/*";
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

export async function runStreamingQuery(
  connectionId: string,
  sql: string,
  callbacks: QueryRuntimeCallbacks = {},
): Promise<QueryRuntimeHandle> {
  const response = await DbClient.executeStreaming(connectionId, sql);
  return subscribeToStreamingQuery(response, callbacks);
}

export async function runExplainQuery(
  connectionId: string,
  sql: string,
  callbacks: QueryRuntimeCallbacks = {},
): Promise<QueryRuntimeHandle> {
  const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql.replace(/;\s*$/, "")}`;
  const response = await DbClient.executeStreaming(connectionId, explainSql);
  return subscribeToStreamingQuery(response, callbacks);
}

export async function runDuckDbQuery(
  sql: string,
  callbacks: QueryRuntimeCallbacks = {},
): Promise<QueryRuntimeHandle> {
  const queryId = await DbClient.duckdbQuery(sql);
  return subscribeToStreamingQuery(
    { query_id: queryId, source_tables: [] },
    callbacks,
  );
}

export async function cancelStreamingQuery(handle: QueryRuntimeHandle | null): Promise<void> {
  if (!handle) return;
  handle.stopListening();
  rowStore.finalize();
  await DbClient.cancelQuery(handle.queryId).catch(() => {});
}

export async function collectStreamingQuery(
  connectionId: string,
  sql: string,
): Promise<CollectedStreamingQuery> {
  const response = await DbClient.executeStreaming(connectionId, sql);
  return collectFromResponse(response);
}

export async function collectDuckDbQuery(sql: string): Promise<CollectedStreamingQuery> {
  const queryId = await DbClient.duckdbQuery(sql);
  return collectFromResponse({ query_id: queryId, source_tables: [] });
}

export async function queryRows(
  connectionId: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await collectStreamingQuery(connectionId, sql);
  return result.rows;
}

async function collectFromResponse(
  response: StreamStartResponse,
): Promise<CollectedStreamingQuery> {
  const { query_id: queryId, source_tables } = response;

  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    let fields: { name: string }[] = [];
    let unlisten: (() => void) | null = null;

    listen<QueryBatch>("query_batch", (event) => {
      const batch = event.payload;
      if (batch.query_id !== queryId) return;

      if (batch.error) {
        unlisten?.();
        reject(new Error(batch.error));
        return;
      }

      if (batch.columns && fields.length === 0) {
        fields = batch.columns.map((column) => ({ name: column.name }));
      }

      rows.push(...batch.rows);

      if (batch.is_final) {
        unlisten?.();
        resolve({
          rows,
          fields,
          elapsedMs: batch.total_elapsed_ms,
          queryId,
          source_tables,
        });
      }
    }).then((stop) => {
      unlisten = stop;
    }).catch(reject);
  });
}

async function subscribeToStreamingQuery(
  response: ExecuteStreamingResponse,
  callbacks: QueryRuntimeCallbacks,
): Promise<QueryRuntimeHandle>;
async function subscribeToStreamingQuery(
  response: StreamStartResponse,
  callbacks: QueryRuntimeCallbacks,
): Promise<QueryRuntimeHandle>;
async function subscribeToStreamingQuery(
  response: StreamStartResponse,
  callbacks: QueryRuntimeCallbacks,
): Promise<QueryRuntimeHandle> {
  const { query_id: queryId, source_tables } = response;
  rowStore.reset(queryId);

  const allRows: Record<string, unknown>[] = [];
  let fields: { name: string }[] = [];
  let activeUnlisten: (() => void) | null = null;
  notifyStateChange(callbacks, buildSessionState(queryId, "running"));

  const unlisten = await listen<QueryBatch>("query_batch", (event) => {
    const batch = event.payload;
    if (batch.query_id !== queryId) return;

    if (batch.error) {
      const state = notifyStateChange(
        callbacks,
        buildSessionState(
          queryId,
          isCancellationMessage(batch.error) ? "cancelled" : "failed",
          batch.total_elapsed_ms,
          batch.rows_so_far,
          batch.error,
        ),
      );
      rowStore.finalize();
      callbacks.onError?.(state.errorMessage ?? batch.error);
      activeUnlisten?.();
      return;
    }

    rowStore.appendBatch(batch);
    if (batch.columns && fields.length === 0) {
      fields = batch.columns.map((column) => ({ name: column.name }));
      callbacks.onColumns?.(fields);
    }

    allRows.push(...batch.rows);
    callbacks.onStateChange?.(
      buildSessionState(queryId, "running", batch.total_elapsed_ms, batch.rows_so_far),
    );

    if (batch.is_final) {
      const completedState = notifyStateChange(
        callbacks,
        buildSessionState(queryId, "completed", batch.total_elapsed_ms, batch.rows_so_far),
      );
      callbacks.onSuccess?.({
        rows: allRows,
        fields,
        elapsedMs: completedState.elapsedMs,
        queryId,
        source_tables,
      });
      activeUnlisten?.();
    }
  });

  activeUnlisten = unlisten;

  return {
    queryId,
    stopListening: () => {
      activeUnlisten?.();
      activeUnlisten = null;
    },
  };
}
