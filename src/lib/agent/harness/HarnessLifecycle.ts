/**
 * HarnessLifecycle — Structured Entry/Exit Points for Agent Interactions
 * 
 * Based on Stanford Meta-Harness (arxiv 2603.05344):
 * "Lifecycle hooks enable systematic injection of harness-level behaviors
 * without modifying core agent logic. Cross-cutting concerns execute at
 * defined entry and exit points in the conversation lifecycle."
 * 
 * Hooks called at:
 * - onSessionStart: when user initiates a new analysis
 * - onBeforeToolCall: before ANY tool execution (can block or modify input)
 * - onAfterToolCall: after tool completes (record metrics)
 * - onToolError: on tool failure (retry logic, error recovery)
 * - onStruggleDetected: when agent repeats attempts or has high error rate
 * - onSessionComplete: at end of analysis (store episode, record outcome)
 */

import type { SessionContext, StruggleEvidence, SessionResult } from "./types";
import { WorkingMemory } from "../memory/WorkingMemory";
import { UsageAnalytics } from "../analytics/UsageAnalytics";
import { EpisodicMemory } from "../memory/EpisodicMemory";
import { FailureTraceStore } from "./FailureTraceStore";
import { HarnessObserver } from "./HarnessObserver";

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

/**
 * Standard DataIQ hooks — the default harness behavior
 * Manages security, analytics, memory, and failure tracking
 */
export const DATAIQ_HOOKS: HarnessHooks = {
  /**
   * Initialize session context: set up working memory, tracking
   */
  onSessionStart: async (ctx: SessionContext) => {
    // Load memory context into WorkingMemory for this session
    await WorkingMemory.setActiveQuestion(ctx.sessionId, ctx.question);

    // Track session start in usage analytics
    UsageAnalytics.track({
      event_type: "apex_session_start",
      feature: "apex_chat",
      metadata: JSON.stringify({
        sessionId: ctx.sessionId,
        question: ctx.question.slice(0, 100),
      }),
    });

    // Initialize telemetry observation
    HarnessObserver.initializeSession(ctx);
  },

  /**
   * Security gate before any tool execution
   * Blocks destructive operations on read-only connections
   * Enforces data governance policies
   */
  onBeforeToolCall: async (tool: string, input: unknown, ctx: SessionContext) => {
    // Security: block destructive tools if connection is read-only
    const DESTRUCTIVE = ["delete_rows", "execute_sql_write", "drop_table", "bulk_transform"];
    if (DESTRUCTIVE.includes(tool)) {
      // Check connection config - in real implementation would fetch from ConnectionRegistry
      const isReadOnly = (input as any)?.connectionId?.includes?.("readonly");
      if (isReadOnly) {
        throw new Error(
          `Tool '${tool}' blocked: connection is read-only. Cannot execute destructive operations.`
        );
      }
    }

    // Log tool call start for telemetry
    HarnessObserver.recordToolCallStart(ctx.sessionId, tool, input);
  },

  /**
   * Record successful tool execution metrics
   */
  onAfterToolCall: async (
    tool: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    ctx: SessionContext
  ) => {
    // Record to telemetry
    HarnessObserver.recordToolCallComplete(ctx.sessionId, tool, durationMs, !!output);

    // Add to WorkingMemory's tools tried list
    WorkingMemory.recordToolUsed(ctx.sessionId, tool);

    // Track in UsageAnalytics
    UsageAnalytics.track({
      event_type: "analysis_run",
      feature: "analysis",
      duration_ms: durationMs,
      success: true,
      metadata: JSON.stringify({ tool }),
    });
  },

  /**
   * Handle tool errors with retry logic
   * Transient errors (network, timeout) retry once
   * Persistent errors fail immediately
   */
  onToolError: async (
    tool: string,
    input: unknown,
    error: Error,
    ctx: SessionContext
  ) => {
    // Record error in telemetry
    HarnessObserver.recordToolError(ctx.sessionId, tool, error.message);

    // Retry once for transient errors (network, timeout, throttling)
    const RETRYABLE = ["db_execute_query", "pi_get_history", "analyze_run"];
    const TRANSIENT_ERRORS = ["timeout", "network", "ECONNREFUSED", "429"];

    const isTransient = TRANSIENT_ERRORS.some(keyword =>
      error.message.toLowerCase().includes(keyword)
    );

    if (RETRYABLE.includes(tool) && isTransient && ctx.errorsSoFar.length < 2) {
      return { retry: true };
    }

    return { retry: false };
  },

  /**
   * Inject contextual guidance when agent is struggling
   * Detects patterns: repeated errors, looping, no progress
   */
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
        `The repeated calls suggest the approach is not working. ` +
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

  /**
   * Finalize session: store episode, record metrics, trigger optimizations
   */
  onSessionComplete: async (
    ctx: SessionContext,
    result: SessionResult
  ) => {
    // Store episode in episodic memory for learning
    await EpisodicMemory.store({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId,
      problem: ctx.question,
      toolsUsed: result.toolsUsed,
      findings: {
        duration: result.totalDurationMs,
        errors: result.errorCount,
        success: result.success,
        confidence: result.finalConfidence,
      },
    });

    // Track completion analytics
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

    // Update failure trace store (used by Meta-Harness optimizer)
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

    // Finalize telemetry observation
    await HarnessObserver.finalizeSession(ctx.sessionId, result);
  },
};

/**
 * Struggle detection engine
 * Identifies patterns indicating the agent is stuck or looping
 */
export function detectStruggle(ctx: SessionContext): StruggleEvidence | null {
  // Pattern 1: same tool called 3+ times
  const toolCounts = new Map<string, number>();
  ctx.toolsCalledSoFar.forEach(t => {
    toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  });

  for (const [tool, count] of toolCounts.entries()) {
    if (count >= 3) {
      return {
        type: "same_tool_called_3x",
        details: tool,
      };
    }
  }

  // Pattern 2: multiple tool errors
  if (ctx.errorsSoFar.length >= 2) {
    const toolsWithErrors = ctx.errorsSoFar.map(e => e.tool).join(", ");
    return {
      type: "repeated_tool_errors",
      details: toolsWithErrors,
    };
  }

  // Pattern 3: 5+ iterations with no hypothesis update (high iteration count)
  if (ctx.iterationCount >= 5) {
    return {
      type: "no_progress_5_iters",
      details: `${ctx.iterationCount} iterations`,
    };
  }

  // No struggle detected
  return null;
}

/**
 * Register a hook handler
 * Useful for adding custom behavior to the harness at runtime
 */
export function registerHook(
  hookName: keyof HarnessHooks,
  handler: any
): void {
  const original = DATAIQ_HOOKS[hookName];
  DATAIQ_HOOKS[hookName] = async (...args: any[]) => {
    if (original) {
      await original(...args);
    }
    return handler(...args);
  };
}
