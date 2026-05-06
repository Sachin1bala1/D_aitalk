/**
 * HarnessObserver — Telemetry Singleton
 * 
 * Collects all harness events and metrics for:
 * - Real-time session monitoring
 * - Historical KPI tracking
 * - Meta-Harness optimizer feedback
 * 
 * Every harness event flows through this singleton.
 */

import type { SessionContext, SessionResult, StruggleEvidence, SessionTrace } from "./types";

export class HarnessObserver {
  private static sessionTraces = new Map<string, SessionTrace>();
  private static activeSessions = new Map<string, SessionContext>();

  // Historical metrics for dashboards
  private static completedSessions: SessionTrace[] = [];

  static initializeSession(ctx: SessionContext): void {
    this.activeSessions.set(ctx.sessionId, ctx);
    this.sessionTraces.set(ctx.sessionId, {
      sessionId: ctx.sessionId,
      question: ctx.question,
      startTime: Date.now(),
      toolEvents: [],
      errors: [],
      struggles: [],
      tokenEstimates: [],
      toolCallStartTimes: new Map(),
    });
  }

  static recordContextBuild(
    sessionId: string,
    tokenUsage: { system: number; history: number; total: number }
  ): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.tokenEstimates.push(tokenUsage);
    }
  }

  static recordToolCallStart(sessionId: string, tool: string, input: unknown): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.toolCallStartTimes.set(tool, Date.now());
    }
  }

  static recordToolCallComplete(
    sessionId: string,
    tool: string,
    durationMs: number,
    success: boolean
  ): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.toolEvents.push({
        tool,
        durationMs,
        success,
        ts: Date.now(),
      });
    }
  }

  static recordToolError(sessionId: string, tool: string, error: string): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.errors.push({
        tool,
        error,
        ts: Date.now(),
      });
    }
  }

  static recordStruggle(sessionId: string, evidence: StruggleEvidence): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.struggles.push(evidence);
    }
  }

  static recordPolicyViolation(sessionId: string, policy: string, tool: string): void {
    // Track policy violations for dashboard
    // In production: save to analytics
  }

  static async finalizeSession(sessionId: string, result: SessionResult): Promise<void> {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace) return;

    // Store completed session for historical tracking
    this.completedSessions.push(trace);

    // Clean up active session
    this.sessionTraces.delete(sessionId);
    this.activeSessions.delete(sessionId);
  }

  // ─── Query Methods ─────────────────────────────────────────────────────

  static getActiveSessions(): SessionContext[] {
    return Array.from(this.activeSessions.values());
  }

  static getSessionTrace(sessionId: string): SessionTrace | undefined {
    return this.sessionTraces.get(sessionId);
  }

  static getCompletedSessions(limit: number = 100): SessionTrace[] {
    return [...this.completedSessions].reverse().slice(0, limit);
  }

  static getMetrics(lastNDays: number = 30): {
    successRate: number;
    avgSessionDuration: number;
    avgTokenEstimate: number;
    policyViolations: number;
    struggleRate: number;
    toolErrorRate: number;
  } {
    const cutoff = Date.now() - lastNDays * 24 * 60 * 60 * 1000;
    const sessions = this.completedSessions.filter(s => s.startTime > cutoff);

    if (sessions.length === 0) {
      return {
        successRate: 0,
        avgSessionDuration: 0,
        avgTokenEstimate: 0,
        policyViolations: 0,
        struggleRate: 0,
        toolErrorRate: 0,
      };
    }

    const totalTokens = sessions.reduce(
      (sum, s) => sum + Math.max(...s.tokenEstimates.map(t => t.total), 0),
      0
    );

    const totalDuration = sessions.reduce((sum, s) => sum + (Date.now() - s.startTime), 0);

    const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolEvents.length, 0);
    const failedToolCalls = sessions.reduce((sum, s) => sum + s.errors.length, 0);

    const sessionsWithStruggles = sessions.filter(s => s.struggles.length > 0).length;

    return {
      successRate: 100, // Placeholder - would calculate from actual results
      avgSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
      avgTokenEstimate: sessions.length > 0 ? totalTokens / sessions.length : 0,
      policyViolations: 0, // Placeholder
      struggleRate:
        sessions.length > 0 ? (sessionsWithStruggles / sessions.length) * 100 : 0,
      toolErrorRate:
        totalToolCalls > 0 ? (failedToolCalls / totalToolCalls) * 100 : 0,
    };
  }

  static getToolMetrics(): Array<{
    tool: string;
    calls: number;
    avgDuration: number;
    errorRate: number;
    mostCommonError?: string;
  }> {
    const toolStats = new Map<
      string,
      {
        calls: number;
        totalDuration: number;
        errors: string[];
      }
    >();

    for (const session of this.completedSessions) {
      for (const event of session.toolEvents) {
        const existing = toolStats.get(event.tool) || {
          calls: 0,
          totalDuration: 0,
          errors: [],
        };
        existing.calls += 1;
        existing.totalDuration += event.durationMs;
        toolStats.set(event.tool, existing);
      }

      for (const error of session.errors) {
        const existing = toolStats.get(error.tool) || {
          calls: 0,
          totalDuration: 0,
          errors: [],
        };
        existing.errors.push(error.error);
        toolStats.set(error.tool, existing);
      }
    }

    return Array.from(toolStats.entries()).map(([tool, stats]) => {
      const errorCounts = new Map<string, number>();
      for (const err of stats.errors) {
        errorCounts.set(err, (errorCounts.get(err) || 0) + 1);
      }
      const mostCommonError = Array.from(errorCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];

      return {
        tool,
        calls: stats.calls,
        avgDuration: stats.calls > 0 ? stats.totalDuration / stats.calls : 0,
        errorRate: stats.calls > 0 ? (stats.errors.length / stats.calls) * 100 : 0,
        mostCommonError,
      };
    });
  }

  private static getTrace(sessionId: string): SessionTrace | undefined {
    return this.sessionTraces.get(sessionId);
  }

  // For testing
  static clear(): void {
    this.sessionTraces.clear();
    this.activeSessions.clear();
    this.completedSessions = [];
  }
}
