// src/lib/agent/harness/HarnessLifecycle.ts
import { invoke } from "@tauri-apps/api/core";
import { HarnessObserver } from "./HarnessObserver";
import { useWorkspaceStore } from "../../stores/WorkspaceStore";
import type { PolicyContext } from "./PolicyEngine";

export interface SessionContext {
  sessionId: string;
  connectionId: string | null;
  question: string;
  toolsCalledSoFar: string[];
  errorsSoFar: { tool: string; error: string }[];
  startTime: number;
  iterationCount: number;
  policyContext: PolicyContext;
}

export interface StruggleEvidence {
  type: 'repeated_tool_errors' | 'same_tool_called_3x' | 'no_progress_5_iters';
  details: string;
}

export interface SessionResult {
  success: boolean;
  toolsUsed: string[];
  totalDurationMs: number;
  tokenEstimate: number;
  errorCount: number;
}

export interface HarnessHooks {
  onSessionStart: (ctx: SessionContext) => Promise<void>;
  onBeforeToolCall: (tool: string, input: unknown, ctx: SessionContext) => Promise<void>;
  onAfterToolCall: (tool: string, input: unknown, output: unknown, durationMs: number, ctx: SessionContext) => Promise<void>;
  onToolError: (tool: string, error: Error, ctx: SessionContext) => Promise<{ retry: boolean }>;
  onStruggleDetected: (ctx: SessionContext, evidence: StruggleEvidence) => Promise<string | null>;
  onSessionComplete: (ctx: SessionContext, result: SessionResult) => Promise<void>;
}

export function detectStruggle(ctx: SessionContext): StruggleEvidence | null {
  const toolCounts = new Map<string, number>();
  for (const t of ctx.toolsCalledSoFar) {
    toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
  }
  for (const [tool, count] of toolCounts) {
    if (count >= 3) return { type: 'same_tool_called_3x', details: tool };
  }

  if (ctx.errorsSoFar.length >= 2) {
    return {
      type: 'repeated_tool_errors',
      details: ctx.errorsSoFar.map(e => e.tool).join(', '),
    };
  }

  if (ctx.iterationCount >= 5) {
    return { type: 'no_progress_5_iters', details: `${ctx.iterationCount} iterations` };
  }

  return null;
}

const RETRYABLE_TOOLS = new Set(['db_execute_query', 'db_execute', 'pi_get_history']);

export const DATAIQ_HOOKS: HarnessHooks = {
  async onSessionStart(ctx) {
    useWorkspaceStore.getState().setActiveQuestion(ctx.question);
    HarnessObserver.startSession(ctx.sessionId, ctx.question);
  },

  async onBeforeToolCall(tool, _input, ctx) {
    HarnessObserver.recordToolCallStart(ctx.sessionId, tool);

    // PolicyEngine check — imported lazily to avoid circular dependency
    const { PolicyEngine } = await import('./PolicyEngine');
    const policyResult = PolicyEngine.evaluate(tool, _input, ctx.policyContext);
    if (!policyResult.allowed) {
      HarnessObserver.recordPolicyViolation(ctx.sessionId, policyResult.policyId!, tool);
      throw new Error(`🛡️ Policy [${policyResult.policyName}]: ${policyResult.reason}`);
    }
  },

  async onAfterToolCall(tool, input, _output, durationMs, ctx) {
    HarnessObserver.recordToolCallComplete(ctx.sessionId, tool, durationMs, true);
    useWorkspaceStore.getState().addToolTried(tool);

    const toolInput = input as Record<string, unknown>;
    if (tool === 'execute_sql' && typeof toolInput.sql === 'string') {
      const tableMatch = (toolInput.sql as string).match(/FROM\s+"?(\w+)"?\."?(\w+)"?/i);
      if (tableMatch) {
        const tableName = `${tableMatch[1]}.${tableMatch[2]}`;
        invoke('harness_record_telemetry_edge', {
          fromNode: `dataset:${tableName}`,
          toNode: `analysis:${tool}`,
          edgeType: 'queried',
          sessionId: ctx.sessionId,
        }).catch(console.error);
      }
    }
  },

  async onToolError(tool, error, ctx) {
    HarnessObserver.recordToolError(ctx.sessionId, tool, error.message);
    const isRetryable = RETRYABLE_TOOLS.has(tool) && ctx.errorsSoFar.length < 2;
    return { retry: isRetryable };
  },

  async onStruggleDetected(ctx, evidence) {
    HarnessObserver.recordStruggle(ctx.sessionId, evidence.type, evidence.details);

    if (evidence.type === 'repeated_tool_errors') {
      return `HARNESS NOTICE: The tool '${evidence.details}' has failed multiple times. Try a different approach or ask the user for clarification. Do not retry the same failing tool.`;
    }
    if (evidence.type === 'same_tool_called_3x') {
      return `HARNESS NOTICE: You have called '${evidence.details}' 3 times with similar inputs. The repeated calls suggest this approach is not working. Consider: (1) using a different tool, (2) asking the user, (3) reporting what you found so far.`;
    }
    if (evidence.type === 'no_progress_5_iters') {
      return `HARNESS NOTICE: After ${ctx.iterationCount} iterations, consider summarizing what you have found so far and asking the user if they want to continue or change direction.`;
    }
    return null;
  },

  async onSessionComplete(ctx, result) {
    try {
      await invoke('memory_insert_episode', {
        episode: {
          id: `${ctx.sessionId}-ep`,
          session_id: ctx.sessionId,
          connection_id: ctx.connectionId,
          problem: ctx.question,
          tools_used: JSON.stringify(result.toolsUsed),
          findings: JSON.stringify({ duration: result.totalDurationMs, errors: result.errorCount }),
          outcome: result.success ? 'completed' : 'failed',
          embedding: JSON.stringify([]),
          created_at: Date.now(),
        }
      });
    } catch (e) {
      console.error('[HarnessLifecycle] Failed to store episode:', e);
    }

    await HarnessObserver.finalizeSession(ctx.sessionId, result.success, 'v1.0');
  },
};
