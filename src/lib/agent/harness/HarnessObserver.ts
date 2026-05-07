// src/lib/agent/harness/HarnessObserver.ts
// Singleton that collects every harness event in a session.
// Written to by ContextEngine, HarnessLifecycle, PolicyEngine.
// Flushed to Rust at onSessionComplete.
import { invoke } from "@tauri-apps/api/core";

export interface TokenUsage {
  system: number;   // estimated tokens in system prompt
  history: number;  // estimated tokens in conversation history
  total: number;
}

export interface ToolEvent {
  tool: string;
  durationMs: number;
  success: boolean;
  ts: number;
}

export interface ToolError {
  tool: string;
  error: string;
  ts: number;
}

export interface StruggleRecord {
  type: string;
  details: string;
  ts: number;
}

interface SessionTrace {
  question: string;
  startTime: number;
  toolEvents: ToolEvent[];
  errors: ToolError[];
  struggles: StruggleRecord[];
  tokenEstimates: TokenUsage[];
  toolCallStartTimes: Map<string, number>;
}

export class HarnessObserver {
  private static sessionTraces = new Map<string, SessionTrace>();

  static startSession(sessionId: string, question: string): void {
    this.sessionTraces.set(sessionId, {
      question,
      startTime: Date.now(),
      toolEvents: [],
      errors: [],
      struggles: [],
      tokenEstimates: [],
      toolCallStartTimes: new Map(),
    });
  }

  static recordContextBuild(sessionId: string, usage: TokenUsage): void {
    this.getTrace(sessionId).tokenEstimates.push(usage);
  }

  static recordToolCallStart(sessionId: string, tool: string): void {
    this.getTrace(sessionId).toolCallStartTimes.set(tool + '_' + Date.now(), Date.now());
  }

  static recordToolCallComplete(
    sessionId: string,
    tool: string,
    durationMs: number,
    success: boolean
  ): void {
    this.getTrace(sessionId).toolEvents.push({ tool, durationMs, success, ts: Date.now() });
  }

  static recordToolError(sessionId: string, tool: string, error: string): void {
    this.getTrace(sessionId).errors.push({ tool, error, ts: Date.now() });
  }

  static recordStruggle(sessionId: string, type: string, details: string): void {
    this.getTrace(sessionId).struggles.push({ type, details, ts: Date.now() });
  }

  static recordPolicyViolation(sessionId: string, policyId: string, tool: string): void {
    invoke('memory_track_usage_event', {
      event: {
        event_type: 'policy_violation',
        feature: 'harness',
        connection_id: null,
        driver: null,
        metadata_json: { policy: policyId, tool },
        created_at: null,
      }
    }).catch(console.error);
  }

  static getLatestTokenEstimate(sessionId: string): TokenUsage | null {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace || trace.tokenEstimates.length === 0) return null;
    return trace.tokenEstimates[trace.tokenEstimates.length - 1];
  }

  static async finalizeSession(
    sessionId: string,
    success: boolean,
    harnessVersion: string
  ): Promise<void> {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace) return;

    const maxToken = trace.tokenEstimates.length > 0
      ? Math.max(...trace.tokenEstimates.map(t => t.total))
      : null;

    const durationMs = Date.now() - trace.startTime;
    const errorCount = trace.errors.length;

    if (!success || errorCount > 0) {
      try {
        await invoke('harness_record_failure', {
          sessionId,
          question: trace.question,
          toolsUsed: JSON.stringify(trace.toolEvents.map(e => e.tool)),
          errors: JSON.stringify(trace.errors.map(e => ({ tool: e.tool, error: e.error }))),
          struggleEvents: JSON.stringify(trace.struggles),
          finalSuccess: success,
          tokenEstimate: maxToken,
          durationMs,
          harnessVersion,
        });
      } catch (e) {
        console.error('[HarnessObserver] Failed to persist session trace:', e);
      }
    }

    for (const ev of trace.toolEvents) {
      try {
        await invoke('harness_record_telemetry_edge', {
          fromNode: `analysis:${ev.tool}`,
          toNode: success ? 'outcome:success' : 'outcome:failure',
          edgeType: 'produced',
          sessionId,
        });
      } catch { /* non-critical */ }
    }

    this.sessionTraces.delete(sessionId);
  }

  private static getTrace(sessionId: string): SessionTrace {
    if (!this.sessionTraces.has(sessionId)) {
      this.sessionTraces.set(sessionId, {
        question: '',
        startTime: Date.now(),
        toolEvents: [],
        errors: [],
        struggles: [],
        tokenEstimates: [],
        toolCallStartTimes: new Map(),
      });
    }
    return this.sessionTraces.get(sessionId)!;
  }
}
