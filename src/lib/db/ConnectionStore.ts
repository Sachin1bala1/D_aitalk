/**
 * ConnectionStore — persists connection configs to:
 *   1. Tauri native file (app local data dir) — primary, survives WebView cache clears
 *   2. localStorage — legacy fallback / migration source
 *
 * Connection strings may contain passwords. This data lives only on the
 * local machine in the app data directory. Never transmitted externally.
 */
import type { ConnectionConfig } from "./DbClient";
import { DbClient } from "./DbClient";

const LS_KEY = "daitalk_connections_v1";

// ── localStorage helpers (legacy / fallback) ──────────────────────────────────

function lsLoad(): ConnectionConfig[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ConnectionConfig[]) : [];
  } catch {
    return [];
  }
}

function lsSave(configs: ConnectionConfig[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(configs));
}

// ── Public async API ──────────────────────────────────────────────────────────

/** Load all saved connections. Prefers Tauri file; falls back to localStorage. */
export async function loadSavedConnectionsAsync(): Promise<ConnectionConfig[]> {
  try {
    const tauriResult = await DbClient.loadConnections();
    if (tauriResult.length > 0) return tauriResult;
    // Migration: if Tauri file is empty but localStorage has data, migrate it
    const ls = lsLoad();
    if (ls.length > 0) {
      await DbClient.saveConnections(ls);
      return ls;
    }
    return [];
  } catch {
    // Tauri not available (browser dev mode) — fall back to localStorage
    return lsLoad();
  }
}

/** Persist the full connection list. Writes to both Tauri file and localStorage. */
export async function persistConnections(configs: ConnectionConfig[]): Promise<void> {
  lsSave(configs);
  try {
    await DbClient.saveConnections(configs);
  } catch {
    // Non-fatal: localStorage copy already saved
  }
}

// ── Synchronous shim (for backward-compat call sites that can't be async) ─────

/** @deprecated Use loadSavedConnectionsAsync() instead */
export function loadSavedConnections(): ConnectionConfig[] {
  return lsLoad();
}

/** @deprecated Use persistConnections() instead */
export function saveConnection(config: ConnectionConfig): void {
  const all = lsLoad();
  const idx = all.findIndex((c) => c.id === config.id);
  if (idx !== -1) all[idx] = config; else all.push(config);
  lsSave(all);
  // Fire-and-forget Tauri save
  DbClient.saveConnections(all).catch(() => {});
}

export function removeConnection(id: string): void {
  const all = lsLoad().filter((c) => c.id !== id);
  lsSave(all);
  DbClient.saveConnections(all).catch(() => {});
}

export function clearAllConnections(): void {
  localStorage.removeItem(LS_KEY);
  DbClient.saveConnections([]).catch(() => {});
}
