import { describe, it, expect, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./CommandBus", () => ({ commandBus: { dispatch: vi.fn().mockResolvedValue({ success: true, result: "ok" }) } }));
vi.mock("./toolDefinitions", () => ({ AGENT_TOOLS: [] }));
vi.mock("./commands", () => ({ isDestructive: () => false, describeCommand: () => "cmd" }));
vi.mock("../stores/UserToolStore", () => ({ useUserToolStore: { getState: () => ({ tools: [] }) } }));
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
vi.mock("../memory/WorkspaceRuleStore", () => ({ useWorkspaceRuleStore: { getState: () => ({ getApprovedRules: () => [] }) } }));
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

describe("runAgentLoop abort", () => {
  it("throws AbortError immediately when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-abort before calling runAgentLoop

    const mockProvider = {
      id: "claude" as const,
      name: "Claude",
      stream: vi.fn().mockResolvedValue({ text: "hello", toolCalls: [], stopReason: "end_turn" }),
    };

    const opts: AgentLoopOptions = {
      provider: mockProvider,
      model: "claude-opus-4-6",
      connectionId: null,
      schema: null,
      currentSQL: null,
      currentResults: null,
      onToken: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onPlanQueued: vi.fn(),
      signal: controller.signal,
    };

    await expect(
      runAgentLoop("hello", [], opts)
    ).rejects.toThrow("Aborted");

    // Stream should never be called — abort fires before round 1 starts
    expect(mockProvider.stream).not.toHaveBeenCalled();
  });
});
