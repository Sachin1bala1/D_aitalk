/**
 * FailureTraceStore — typed Tauri client for harness DB
 *
 * Thin client layer over the Tauri `harness_*` commands defined in the Rust
 * backend. Caches the active harness version and exposes typed queries.
 *
 * No React, no Zustand — pure TypeScript module.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types (match Rust structs exactly)
// ---------------------------------------------------------------------------

export interface HarnessFailureTrace {
  id: number;
  session_id: string;
  question: string;
  tools_used: string;       // JSON string of string[]
  errors: string;           // JSON string of {tool, error}[]
  struggle_events: string;  // JSON string
  final_success: boolean;
  token_estimate: number | null;
  duration_ms: number | null;
  harness_version: string | null;
  created_at: number;
}

export interface HarnessVersion {
  id: number;
  version_tag: string;
  system_prompt_additions: string;
  success_rate: number | null;
  avg_token_estimate: number | null;
  failure_count: number | null;
  is_active: boolean;
  created_at: number;
}

export interface TelemetryEdge {
  id: number;
  from_node: string;
  to_node: string;
  edge_type: string;
  session_id: string;
  weight: number | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// FailureTraceStore
// ---------------------------------------------------------------------------

export class FailureTraceStore {
  private static _activeVersion: HarnessVersion | null = null;

  /**
   * Fetches the most recent N failure traces from Rust SQLite.
   */
  static async getFailures(limit = 50): Promise<HarnessFailureTrace[]> {
    try {
      return await invoke<HarnessFailureTrace[]>("harness_get_failures", { limit });
    } catch (err) {
      throw new Error(`FailureTraceStore.getFailures failed: ${err}`);
    }
  }

  /**
   * Fetches all harness versions from the Rust backend.
   */
  static async getVersions(): Promise<HarnessVersion[]> {
    try {
      return await invoke<HarnessVersion[]>("harness_get_versions", {});
    } catch (err) {
      throw new Error(`FailureTraceStore.getVersions failed: ${err}`);
    }
  }

  /**
   * Returns the currently active harness version (cached).
   * Checks the in-memory cache first. If not cached, fetches all versions
   * and finds the one with `is_active === true`. Returns null if none found.
   */
  static async getActiveVersion(): Promise<HarnessVersion | null> {
    if (FailureTraceStore._activeVersion !== null) {
      return FailureTraceStore._activeVersion;
    }

    try {
      const versions = await invoke<HarnessVersion[]>("harness_get_versions", {});
      const active = versions.find((v) => v.is_active === true) ?? null;
      FailureTraceStore._activeVersion = active;
      return active;
    } catch (err) {
      throw new Error(`FailureTraceStore.getActiveVersion failed: ${err}`);
    }
  }

  /**
   * Inserts a new harness version. Does NOT activate it.
   */
  static async insertVersion(
    versionTag: string,
    systemPromptAdditions: string
  ): Promise<void> {
    try {
      await invoke<void>("harness_insert_version", {
        versionTag,
        systemPromptAdditions,
      });
    } catch (err) {
      throw new Error(`FailureTraceStore.insertVersion failed: ${err}`);
    }
  }

  /**
   * Activates a version by id.
   * Clears the cached active version so the next call to getActiveVersion re-fetches.
   */
  static async activateVersion(id: number): Promise<void> {
    try {
      await invoke<void>("harness_activate_version", { id });
      // Invalidate cache so next getActiveVersion call re-fetches from Rust
      FailureTraceStore._activeVersion = null;
    } catch (err) {
      throw new Error(`FailureTraceStore.activateVersion(${id}) failed: ${err}`);
    }
  }

  /**
   * Fetches recent telemetry edges from the Rust backend.
   */
  static async getTelemetryGraph(limit = 200): Promise<TelemetryEdge[]> {
    try {
      return await invoke<TelemetryEdge[]>("harness_get_telemetry_graph", { limit });
    } catch (err) {
      throw new Error(`FailureTraceStore.getTelemetryGraph failed: ${err}`);
    }
  }
}
