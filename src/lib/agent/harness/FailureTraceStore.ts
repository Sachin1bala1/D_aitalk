/**
 * FailureTraceStore — Persistent storage of failure traces for Meta-Harness optimization
 * 
 * Stores complete session traces including errors, struggles, and outcomes.
 * Used by HarnessOptimizer to analyze patterns and propose system prompt improvements.
 */

import type { HarnessFailureTrace } from "./types";

export class FailureTraceStore {
  private static traces: HarnessFailureTrace[] = [];

  static async record(trace: HarnessFailureTrace): Promise<void> {
    this.traces.push(trace);
    // In production: persist to harness_failure_traces table via Tauri command
    // await invoke('harness_record_failure', trace);
  }

  static async getRecentFailures(limit: number = 20): Promise<HarnessFailureTrace[]> {
    return [...this.traces].reverse().slice(0, limit);
  }

  static async getBySessionId(sessionId: string): Promise<HarnessFailureTrace | undefined> {
    return this.traces.find(t => t.sessionId === sessionId);
  }

  static async getFailureStats(): Promise<{
    totalFailures: number;
    lastFailure?: HarnessFailureTrace;
    avgDuration: number;
  }> {
    const failures = this.traces.filter(t => !t.finalSuccess);
    return {
      totalFailures: failures.length,
      lastFailure: failures[failures.length - 1],
      avgDuration: failures.length > 0
        ? failures.reduce((sum, t) => sum + t.durationMs, 0) / failures.length
        : 0,
    };
  }

  static async clear(): Promise<void> {
    this.traces = [];
  }
}
