/**
 * HarnessLifecycle — Structured Entry/Exit Points for Agent Interactions
 *
 * Hooks called at:
 * - onSessionStart: when user initiates a new analysis
 * - onBeforeToolCall: before ANY tool execution (security gate + policy check)
 * - onAfterToolCall: after tool completes (record metrics + telemetry edge)
 * - onToolError: on tool failure (retry logic)
 * - onStruggleDetected: when agent repeats attempts or has high error rate
 * - onSessionComplete: at end of analysis (store episode, record outcome)
 */

import { invoke } from "@tauri-apps/api/core";
import type { SessionContext, StruggleEvidence, SessionResult } from "./types";
import { UsageAnalytics } from "../../analytics/UsageAnalytics";
import { EpisodicMemory } from "../../memory/EpisodicMemory";
import { FailureTraceStore } from "./FailureTraceStore";
import { HarnessObserver } from "./HarnessObserver";
import { useWorkspaceStore } from "../../stores/WorkspaceStore";

export type { SessionContext, StruggleEvidence, SessionResult };

export interface HarnessHooks {
  onSessionStart?: (ctx: SessionContext) => Promise<void>;
  onBeforeToolCall?: (
    tool: string,
    input: unknown,
    ctx: SessionContext
  ) => Promise<unknown | void>;
  onAfterToolCall?: (
    tool: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    ctx: SessionContext
  ) => Promise<void>;
  onToolError?: (
    tool: string,
    input: unknown,
    error: Error,
    ctx: SessionContext
  ) => Promise<{ retry: boolean; modifiedInput?: unknown }>;
  onStruggleDetected?: (
    ctx: SessionContext,
    evidence: StruggleEvidence
  ) => Promise<string | void>;
  onSessionComplete?: (
    ctx: SessionContext,
    result: SessionResult
  ) => Promise<void>;
}

export const DATAIQ_HOOKS: HarnessHooks = {
  onSessionStart: async (ctx: SessionContext) => {
    // Update WorkspaceStore for UI (local requirement)
    try {
      useWorkspaceStore.getState().setActiveQuestion(ctx.question);
    } catch { /* non-critical outside React */ }

    // (WorkingMemory is a Zustand state shape, not a class — use store directly)

    UsageAnalytics.track({
      event_type: "apex_session_start",
      feature: "apex_chat",
      metadata: JSON.stringify({
        sessionId: ctx.sessionId,
        question: ctx.question.slice(0, 100),
      }),
    });

    HarnessObserver.initializeSession(ctx);
  },

  onBeforeToolCall: async (tool: string, input: unknown, ctx: SessionContext) => {
    HarnessObserver.recordToolCallStart(ctx.sessionId, tool, input);

    // PolicyEngine check — lazy import to avoid circular dependency
    if (ctx.policyContext) {
      const { PolicyEngine } = await import("./PolicyEngine");
      const policyResult = PolicyEngine.evaluate(tool, input, ctx.policyContext);
      if (!policyResult.allowed) {
        HarnessObserver.recordPolicyViolation(ctx.sessionId, policyResult.policyId!, tool);
        throw new Error(`🛡️ Policy [${policyResult.policyName}]: ${policyResult.reason}`);
      }
    }

    // Block destructive tools on read-only connections
    const DESTRUCTIVE = ["delete_rows", "execute_sql_write", "drop_table", "bulk_transform"];
    if (DESTRUCTIVE.includes(tool) && ctx.policyContext?.isReadOnly) {
      throw new Error(
        `Tool '${tool}' blocked: connection is read-only. Cannot execute destructive operations.`
      );
    }
  },

  onAfterToolCall: async (
    tool: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    ctx: SessionContext
  ) => {
    HarnessObserver.recordToolCallComplete(ctx.sessionId, tool, durationMs, !!output);
    useWorkspaceStore.getState().addToolTried(tool);

    UsageAnalytics.track({
      event_type: "analysis_run",
      feature: "analysis",
      duration_ms: durationMs,
      success: true,
      metadata: JSON.stringify({ tool }),
    });

    // Record telemetry edge to Rust (local requirement)
    const toolInput = input as Record<string, unknown>;
    if (tool === "execute_sql" && typeof toolInput?.sql === "string") {
      const tableMatch = (toolInput.sql as string).match(/FROM\s+"?(\w+)"?\."?(\w+)"?/i);
      if (tableMatch) {
        invoke("harness_record_telemetry_edge", {
          fromNode: `dataset:${tableMatch[1]}.${tableMatch[2]}`,
          toNode: `analysis:${tool}`,
          edgeType: "queried",
          sessionId: ctx.sessionId,
        }).catch(() => { /* non-critical */ });
      }
    }
  },

  onToolError: async (
    tool: string,
    input: unknown,
    error: Error,
    ctx: SessionContext
  ) => {
    HarnessObserver.recordToolError(ctx.sessionId, tool, error.message);

    const RETRYABLE = ["db_execute_query", "pi_get_history", "analyze_run"];
    const TRANSIENT_ERRORS = ["timeout", "network", "ECONNREFUSED", "429"];
    const isTransient = TRANSIENT_ERRORS.some(k =>
      error.message.toLowerCase().includes(k)
    );

    if (RETRYABLE.includes(tool) && isTransient && ctx.errorsSoFar.length < 2) {
      return { retry: true };
    }
    return { retry: false };
  },

  onStruggleDetected: async (
    ctx: SessionContext,
    evidence: StruggleEvidence
  ): Promise<string | void> => {
    HarnessObserver.recordStruggle(ctx.sessionId, evidence);

    if (evidence.type === "repeated_tool_errors") {
      return (
        `🛡️ HARNESS NOTICE: The tool '${evidence.details}' has failed multiple times. ` +
        `Try a different approach or ask the user for clarification. ` +
        `Do NOT retry the same failing tool more than twice.`
      );
    }
    if (evidence.type === "same_tool_called_3x") {
      return (
        `🛡️ HARNESS NOTICE: You have called the same tool 3 times with similar inputs. ` +
        `Consider: (1) using a different tool, (2) asking the user for more details, ` +
        `(3) reporting what you found so far.`
      );
    }
    if (evidence.type === "no_progress_5_iters") {
      return (
        `🛡️ HARNESS NOTICE: This analysis has run for 5 iterations without progress. ` +
        `Consider whether the user's question needs clarification or if a different approach is needed.`
      );
    }
    return undefined;
  },

  onSessionComplete: async (
    ctx: SessionContext,
    result: SessionResult
  ) => {
    // Persist episode via EpisodicMemory (TypeScript layer)
    await EpisodicMemory.store({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId ?? undefined,  // null → undefined for Episode type
      problem: ctx.question,
      toolsUsed: result.toolsUsed,
      findings: {
        duration: result.totalDurationMs,
        errors: result.errorCount,
        success: result.success,
        confidence: result.finalConfidence,
      },
    });

    // Also persist via Tauri SQLite (Rust layer — authoritative storage)
    invoke("memory_insert_episode", {
      episode: {
        id: `${ctx.sessionId}-ep`,
        session_id: ctx.sessionId,
        connection_id: ctx.connectionId,
        problem: ctx.question,
        tools_used: JSON.stringify(result.toolsUsed),
        findings: JSON.stringify({
          duration: result.totalDurationMs,
          errors: result.errorCount,
        }),
        outcome: result.success ? "completed" : "failed",
        embedding: JSON.stringify([]),
        created_at: Date.now(),
      },
    }).catch(e => console.error("[HarnessLifecycle] Failed to store episode:", e));

    UsageAnalytics.track({
      event_type: "apex_session_complete",
      feature: "apex_chat",
      duration_ms: result.totalDurationMs,
      success: result.success,
      metadata: JSON.stringify({
        sessionId: ctx.sessionId,
        errorCount: result.errorCount,
        toolsUsed: result.toolsUsed.length,
      }),
    });

    if (!result.success || result.errorCount > 0) {
      await FailureTraceStore.record({
        sessionId: ctx.sessionId,
        question: ctx.question,
        toolsUsed: result.toolsUsed,
        errors: ctx.errorsSoFar,
        finalSuccess: result.success,
        tokenEstimate: result.tokenEstimate,
        durationMs: result.totalDurationMs,
      });
    }

    await HarnessObserver.finalizeSession(ctx.sessionId, result);
  },
};

/**
 * Struggle detection — identifies patterns indicating the agent is stuck.
 * Called by AgentLoop after each iteration.
 */
export function detectStruggle(ctx: SessionContext): StruggleEvidence | null {
  const toolCounts = new Map<string, number>();
  ctx.toolsCalledSoFar.forEach(t => {
    toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  });
  for (const [tool, count] of toolCounts.entries()) {
    if (count >= 3) return { type: "same_tool_called_3x", details: tool };
  }
  if (ctx.errorsSoFar.length >= 2) {
    return {
      type: "repeated_tool_errors",
      details: ctx.errorsSoFar.map(e => e.tool).join(", "),
    };
  }
  if (ctx.iterationCount >= 5) {
    return { type: "no_progress_5_iters", details: `${ctx.iterationCount} iterations` };
  }
  return null;
}

/**
 * Register an additional hook handler at runtime.
 * Useful for test overrides or plugin extensions.
 */
export function registerHook(hookName: keyof HarnessHooks, handler: any): void {
  const original = DATAIQ_HOOKS[hookName] as
    | ((...args: any[]) => Promise<unknown>)
    | undefined;
  (DATAIQ_HOOKS as any)[hookName] = async (...args: any[]) => {
    if (original) await original(...args);
    return handler(...args);
  };
}
