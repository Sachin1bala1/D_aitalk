/**
 * ConnectionStore — persists connection configs to:
 *   1. Tauri native file (app local data dir) — primary, survives WebView cache clears
 *   2. localStorage — legacy fallback / migration source
 *
 * Passwords are stored in the OS keychain (Windows Credential Manager /
 * macOS Keychain / libsecret) and stripped from all persisted config objects.
 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { ConnectionConfig } from "./DbClient";
import { DbClient } from "./DbClient";

const LS_KEY = "daitalk_connections_v1";

// ── Keychain helpers ──────────────────────────────────────────────────────────

function credKey(id: string): string {
  return `conn_${id}_password`;
}

async function keychainSave(id: string, password: string): Promise<void> {
  await invoke("save_credential", { key: credKey(id), value: password });
}

async function keychainLoad(id: string): Promise<string | null> {
  try {
    return await invoke<string | null>("get_credential", { key: credKey(id) });
  } catch {
    return null;
  }
}

async function keychainDelete(id: string): Promise<void> {
  try {
    await invoke("delete_credential", { key: credKey(id) });
  } catch {
    // best-effort
  }
}

// ── Password extraction / stripping ─────────────────────────────────────────

/**
 * Extract the password from a connection config (connection_string URL or pi_config).
 * Returns null if no password is found.
 */
function extractPassword(config: ConnectionConfig): string | null {
  // Try pi_config password first
  if (config.pi_config?.password) {
    return config.pi_config.password;
  }
  // Try to parse password from connection_string URL (e.g. postgres://user:pass@host/db)
  if (config.connection_string) {
    try {
      const url = new URL(config.connection_string);
      if (url.password) return decodeURIComponent(url.password);
    } catch {
      // Not a valid URL — ignore
    }
  }
  return null;
}

/**
 * Return a sanitized copy of the config with the password removed from
 * connection_string and pi_config.
 */
function stripPassword(config: ConnectionConfig): ConnectionConfig {
  let sanitized = { ...config };

  // Strip from pi_config
  if (sanitized.pi_config?.password) {
    sanitized = {
      ...sanitized,
      pi_config: { ...sanitized.pi_config, password: "" },
    };
  }

  // Strip from connection_string URL
  if (sanitized.connection_string) {
    try {
      const url = new URL(sanitized.connection_string);
      if (url.password) {
        url.password = "";
        sanitized = { ...sanitized, connection_string: url.toString() };
      }
    } catch {
      // Not a URL — leave as-is
    }
  }

  return sanitized;
}

/**
 * Restore password into a config from a previously extracted value.
 */
function restorePassword(config: ConnectionConfig, password: string): ConnectionConfig {
  let restored = { ...config };

  // Restore into pi_config if that's where it was
  if (restored.pi_config !== undefined) {
    restored = {
      ...restored,
      pi_config: { ...restored.pi_config, password },
    };
    return restored;
  }

  // Restore into connection_string URL
  if (restored.connection_string) {
    try {
      const url = new URL(restored.connection_string);
      url.password = encodeURIComponent(password);
      restored = { ...restored, connection_string: url.toString() };
    } catch {
      // Not a URL — can't restore
    }
  }

  return restored;
}

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

/**
 * Load a single connection config and restore its password from the keychain.
 * Returns null if the connection is not found.
 */
export async function loadConnectionWithPassword(
  id: string
): Promise<ConnectionConfig | null> {
  const all = await loadSavedConnectionsAsync();
  const config = all.find((c) => c.id === id) ?? null;
  if (!config) return null;

  const password = await keychainLoad(id);
  if (password) return restorePassword(config, password);
  return config;
}

/** Persist the full connection list. Strips passwords to keychain before saving. */
export async function persistConnections(configs: ConnectionConfig[]): Promise<void> {
  // Extract and vault passwords, then strip from configs
  const sanitized = await Promise.all(
    configs.map(async (cfg) => {
      const pw = extractPassword(cfg);
      if (pw) {
        try {
          await keychainSave(cfg.id, pw);
        } catch {
          // Keychain unavailable — fall through (password stays in config as fallback)
          return cfg;
        }
        return stripPassword(cfg);
      }
      return cfg;
    })
  );

  lsSave(sanitized);
  try {
    await DbClient.saveConnections(sanitized);
  } catch {
    // Non-fatal: localStorage copy already saved
  }
}

/**
 * Migrate any existing connections that still have passwords in localStorage
 * or the Tauri file into the OS keychain.
 */
export async function migrateCredentials(): Promise<void> {
  try {
    const all = await loadSavedConnectionsAsync();
    let migrated = 0;

    const sanitized = await Promise.all(
      all.map(async (cfg) => {
        const pw = extractPassword(cfg);
        if (pw) {
          try {
            await keychainSave(cfg.id, pw);
            migrated++;
            return stripPassword(cfg);
          } catch {
            return cfg;
          }
        }
        return cfg;
      })
    );

    if (migrated > 0) {
      lsSave(sanitized);
      try {
        await DbClient.saveConnections(sanitized);
      } catch {
        // best-effort
      }
      toast.success("Credentials migrated to secure storage");
    }
  } catch {
    // Non-fatal
  }
}

// ── Synchronous shim (for backward-compat call sites that can't be async) ─────

/** @deprecated Use loadSavedConnectionsAsync() instead */
export function loadSavedConnections(): ConnectionConfig[] {
  return lsLoad();
}

/** @deprecated Use persistConnections() instead */
export function saveConnection(config: ConnectionConfig): void {
  // Strip password synchronously for localStorage; keychain save is fire-and-forget
  const pw = extractPassword(config);
  const toStore = pw ? stripPassword(config) : config;

  const all = lsLoad();
  const idx = all.findIndex((c) => c.id === config.id);
  if (idx !== -1) all[idx] = toStore; else all.push(toStore);
  lsSave(all);

  // Vault password + persist to Tauri file async
  (async () => {
    if (pw) {
      try {
        await keychainSave(config.id, pw);
      } catch {
        // Keychain unavailable
      }
    }
    DbClient.saveConnections(all).catch(() => {});
  })();
}

export function removeConnection(id: string): void {
  const all = lsLoad().filter((c) => c.id !== id);
  lsSave(all);
  keychainDelete(id);
  DbClient.saveConnections(all).catch(() => {});
}

export function clearAllConnections(): void {
  const all = lsLoad();
  all.forEach((c) => keychainDelete(c.id));
  localStorage.removeItem(LS_KEY);
  DbClient.saveConnections([]).catch(() => {});
}
