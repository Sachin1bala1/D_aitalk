/**
 * RowStore — singleton store for streaming query results.
 *
 * Design:
 * - Rows live in a flat mutable array for O(1) index access.
 * - A monotonic version counter is the "snapshot" for useSyncExternalStore.
 *   When the version changes, React re-renders subscribed components.
 * - Ring buffer: once rows exceed MAX_ROWS, oldest rows are dropped.
 *
 * Usage:
 *   rowStore.reset(queryId)          // call before starting a new query
 *   rowStore.appendBatch(batch)      // call from query_batch event listener
 *   const store = useRowStore()      // in components — auto-updates on new batches
 */
import { useSyncExternalStore } from "react";
import type { ColumnMeta, QueryBatch } from "../db/DbClient";

const MAX_ROWS = 2_000_000;

class RowStore {
  rows: Record<string, unknown>[] = [];
  columns: ColumnMeta[] = [];
  queryId: string | null = null;
  isStreaming = false;
  elapsedMs = 0;

  private _version = 0;
  private _listeners = new Set<() => void>();

  /** Start a new query — clears previous results immediately. */
  reset(queryId: string) {
    this.rows = [];
    this.columns = [];
    this.queryId = queryId;
    this.isStreaming = true;
    this.elapsedMs = 0;
    this._notify();
  }

  /** Append a streamed batch. Columns are captured from the first batch. */
  appendBatch(batch: QueryBatch) {
    if (batch.columns && this.columns.length === 0) {
      this.columns = batch.columns;
    }
    for (const row of batch.rows) {
      this.rows.push(row);
    }
    // Ring buffer — drop oldest rows when over limit
    if (this.rows.length > MAX_ROWS) {
      this.rows.splice(0, this.rows.length - MAX_ROWS);
    }
    if (batch.is_final) {
      this.isStreaming = false;
      this.elapsedMs = batch.total_elapsed_ms;
    }
    this._notify();
  }

  /** Mark streaming as done (e.g. on error). */
  finalize() {
    this.isStreaming = false;
    this._notify();
  }

  subscribe(listener: () => void) {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /** Version number is the snapshot — changes trigger useSyncExternalStore re-renders. */
  getSnapshot() {
    return this._version;
  }

  private _notify() {
    this._version++;
    this._listeners.forEach((fn) => fn());
  }
}

/** Singleton — shared across the app. */
export const rowStore = new RowStore();

/**
 * Hook: subscribe to rowStore updates.
 * Returns the store object directly — read rows/columns/etc from it.
 * Re-renders whenever appendBatch() or reset() is called.
 */
export function useRowStore() {
  // The version number drives re-renders; actual data is read from the mutable store.
  useSyncExternalStore(
    (l) => rowStore.subscribe(l),
    () => rowStore.getSnapshot(),
    () => rowStore.getSnapshot(),
  );
  return rowStore;
}
