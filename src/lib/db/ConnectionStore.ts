/**
 * ConnectionStore persists connection configs only through the Tauri native layer.
 *
 * High-security mode: do not mirror connection strings into browser storage.
 * The Rust layer stores sanitized metadata on disk and secrets in the OS keychain.
 */
import type { ConnectionConfig } from "./DbClient";
import { DbClient } from "./DbClient";

/** Load all saved connections from the native store. */
export async function loadSavedConnectionsAsync(): Promise<ConnectionConfig[]> {
  try {
    return await DbClient.loadConnections();
  } catch {
    return [];
  }
}

/** Persist the full connection list through the native store. */
export async function persistConnections(configs: ConnectionConfig[]): Promise<void> {
  await DbClient.saveConnections(configs);
}

/** @deprecated Saved connections are loaded asynchronously from the native store. */
export function loadSavedConnections(): ConnectionConfig[] {
  return [];
}

/** @deprecated Use persistConnections() instead. */
export function saveConnection(config: ConnectionConfig): void {
  DbClient.loadConnections()
    .then((all) => {
      const next = [...all.filter((c) => c.id !== config.id), config];
      return DbClient.saveConnections(next);
    })
    .catch(() => {});
}

export function removeConnection(id: string): void {
  DbClient.loadConnections()
    .then((all) => DbClient.saveConnections(all.filter((c) => c.id !== id)))
    .catch(() => {});
}

export function clearAllConnections(): void {
  DbClient.saveConnections([]).catch(() => {});
}
