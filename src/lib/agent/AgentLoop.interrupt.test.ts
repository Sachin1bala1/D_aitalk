/**
 * AgentLoop interrupt tests — exercises the exact race condition the user reported:
 *   "sends message A → message A hangs/retries → sends message B →
 *    old message A should stop, not continue executing tools"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./CommandBus", () => ({
  commandBus: { dispatch: vi.fn().mockResolvedValue({ success: true, result: "ok" }) },
}));
vi.mock("./toolDefinitions", () => ({ AGENT_TOOLS: [] }));
vi.mock("./commands", () => ({ isDestructive: () => false, describeCommand: () => "cmd" }));
vi.mock("../stores/UserToolStore", () => ({
  useUserToolStore: { getState: () => ({ tools: [] }) },
}));
vi.mock("../tools/user.tools", () => ({ userToolToUnifiedTool: (t: unknown) => t }));
vi.mock("../tools/stat.tools", () => ({ statToolToKernelKey: (n: string) => n }));
vi.mock("../stores/WorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      agentMode: "auto",
      addPlanStep: vi.fn(),
      currentTask: null,
      connections: [],
      tabs: [],
      activeTabId: null,
    }),
  },
}));
vi.mock("../memory/WorkspaceRuleStore", () => ({
  useWorkspaceRuleStore: { getState: () => ({ getApprovedRules: () => [] }) },
}));
vi.mock("./harness/ContextEngine", () => ({
  ContextEngine: {
    trackContextBuild: vi.fn(),
    compactHistory: (h: unknown[]) => h,
    estimateTokenUsage: () => ({ total: 0 }),
  },
}));
vi.mock("./harness/HarnessLifecycle", () => ({
  DATAIQ_HOOKS: {},
  detectStruggle: () => null,
}));
vi.mock("./harness/FailureTraceStore", () => ({
  FailureTraceStore: { getActiveVersion: () => Promise.resolve(null) },
}));
vi.mock("./harness/ImpactMapEngine", () => ({
  ImpactMapEngine: { fromCommands: () => ({}) },
}));

import { runAgentLoop } from "./AgentLoop";
import type { AgentLoopOptions } from "./AgentLoop";
import type { StreamResult } from "../ai/types";

function makeOpts(overrides: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
  return {
    provider: {
      id: "claude" as const,
      name: "Claude",
      stream: vi.fn().mockResolvedValue({
        text: "done",
        toolCalls: [],
        stopReason: "end_turn",
      } satisfies StreamResult),
    },
    model: "claude-opus-4-6",
    connectionId: null,
    schema: null,
    currentSQL: null,
    currentResults: null,
    onToken: vi.fn(),
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onPlanQueued: vi.fn(),
    ...overrides,
  };
}

// ── Scenario 1: Pre-aborted signal — never enters round loop ─────────────────
describe("runAgentLoop — pre-aborted signal", () => {
  it("throws AbortError without calling provider.stream", async () => {
    const controller = new AbortController();
    controller.abort();

    const opts = makeOpts({ signal: controller.signal });
    await expect(runAgentLoop("hello", [], opts)).rejects.toThrow("Aborted");
    expect(opts.provider.stream).not.toHaveBeenCalled();
  });
});

// ── Scenario 2: Abort fires between rounds ───────────────────────────────────
describe("runAgentLoop — abort fires between rounds", () => {
  it("stops after the first round when signal is aborted before round 2", async () => {
    const controller = new AbortController();
    let streamCallCount = 0;

    // Round 1: returns a tool_use to trigger round 2
    // Round 2: should never be reached — signal aborted after round 1 completes
    const slowProvider = {
      id: "claude" as const,
      name: "Claude",
      stream: vi.fn().mockImplementation(async (): Promise<StreamResult> => {
        streamCallCount++;
        if (streamCallCount === 1) {
          // After round 1 resolves, abort immediately before round 2 check
          // Use setImmediate-equivalent to let the loop reach the abort check
          return Promise.resolve({
            text: "calling a tool",
            toolCalls: [{ id: "tc1", name: "set_editor_content", input: { sql: "SELECT 1" } }],
            stopReason: "tool_use" as const,
          });
        }
        return Promise.resolve({ text: "round 2", toolCalls: [], stopReason: "end_turn" as const });
      }),
    };

    // Abort the controller right as round 1 resolves
    // We simulate this by aborting synchronously before runAgentLoop finishes round 1
    const originalStream = slowProvider.stream;
    slowProvider.stream = vi.fn().mockImplementation(async (...args) => {
      const result = await originalStream(...args);
      if (streamCallCount === 1) {
        // Abort happens during tool execution phase (between round 1 and round 2)
        controller.abort();
      }
      return result;
    });

    const opts = makeOpts({ provider: slowProvider, signal: controller.signal });

    await expect(runAgentLoop("hello", [], opts)).rejects.toThrow("Aborted");
    // Round 2's stream should never be called — abort fires between rounds
    expect(streamCallCount).toBe(1);
  });
});

// ── Scenario 3: withRetry abort — stale retry sleeping in backoff ─────────────
describe("withRetry abort — stale retry scenario", () => {
  it("aborts during retry delay, provider is not retried", async () => {
    const { withRetry } = await import("../ai/resilience");
    const controller = new AbortController();
    let callCount = 0;

    const fn = vi.fn(async () => {
      callCount++;
      throw new Error("503 server error"); // always fail to trigger retry
    });

    // Abort 10ms after first failure starts the 2s delay
    setTimeout(() => controller.abort(), 10);

    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 2_000, // 2 second delay — abort fires during this sleep
        signal: controller.signal,
      })
    ).rejects.toThrow("Aborted");

    // Only 1 call — the 2s backoff was cut short by abort
    expect(callCount).toBe(1);
  });
});

// ── Scenario 4: Abort signal passed to provider.stream ───────────────────────
describe("runAgentLoop — signal forwarded to provider.stream", () => {
  it("passes the AbortSignal to provider.stream so mid-stream abort is possible", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const opts = makeOpts({
      signal: controller.signal,
      provider: {
        id: "claude" as const,
        name: "Claude",
        stream: vi.fn().mockImplementation(async (params: { signal?: AbortSignal }) => {
          receivedSignal = params.signal;
          return { text: "done", toolCalls: [], stopReason: "end_turn" as const };
        }),
      },
    });

    await runAgentLoop("hello", [], opts);

    // The provider must receive the AbortSignal so it can abort mid-stream
    expect(receivedSignal).toBe(controller.signal);
  });
});

// ── Scenario 5: Normal completion unaffected by a live (unaborted) signal ────
describe("runAgentLoop — normal completion with signal present but not aborted", () => {
  it("completes normally when signal is never aborted", async () => {
    const controller = new AbortController(); // never aborted
    const opts = makeOpts({ signal: controller.signal });

    const result = await runAgentLoop("hello", [], opts);

    expect(result.finalText).toBe("done");
    expect(opts.provider.stream).toHaveBeenCalledOnce();
  });
});
