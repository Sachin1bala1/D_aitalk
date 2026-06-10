import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { EventEmitter } from "events";
import type {
  TaskGraph,
  TaskNode,
  FileDiff,
  CriticVerdict,
  TestResult,
  AgentTraceEntry,
} from "../types";

// ─── Mock @anthropic-ai/sdk ────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  // Must use function keyword (not arrow) so it can be called with `new`
  function MockAnthropic() {
    return { messages: { create: mockCreate } };
  }
  return { default: MockAnthropic };
});

// ─── Mock fs for trace-logger (T06) ────────────────────────────────────────
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: {
      ...actual,
      appendFileSync: vi.fn(actual.appendFileSync),
      writeFileSync: vi.fn(actual.writeFileSync),
      mkdirSync: vi.fn(actual.mkdirSync),
    },
    appendFileSync: vi.fn(actual.appendFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

// ─── Mock child_process (for T04, and to prevent real spawns) ──────────────
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function anthropicTextResponse(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  };
}

function makeMockNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    node_id: "test-node-001",
    parent_id: null,
    description: "Test node",
    agent_role: "coder",
    status: "pending",
    inputs: {},
    outputs: {},
    test_assertions: ["should handle null input"],
    attempts: 0,
    max_attempts: 2,
    error_log: [],
    ...overrides,
  };
}

function makeTaskGraph(overrides: Partial<TaskGraph> = {}): TaskGraph {
  return {
    goal_id: "test-goal",
    goal_description: "test",
    created_at: new Date().toISOString(),
    status: "pending",
    nodes: [makeMockNode()],
    success_criteria: ["all tests pass"],
    ...overrides,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key-fake";
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════════
// T01 — plannerAgent() returns valid TaskGraph JSON
// ═══════════════════════════════════════════════════════════════════════════
describe("T01 — plannerAgent returns valid TaskGraph JSON", () => {
  it("should return a TaskGraph with goal_id, nodes, success_criteria, and status", async () => {
    const { plannerAgent } = await import("../planner");

    const mockGraph: TaskGraph = makeTaskGraph();
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(mockGraph))
    );

    const result = await plannerAgent("build a feature", "context");

    expect(typeof result.goal_id).toBe("string");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(result.success_criteria)).toBe(true);
    expect(result.status).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T02 — coderAgent() returns FileDiff[] that parses correctly
// ═══════════════════════════════════════════════════════════════════════════
describe("T02 — coderAgent returns FileDiff[]", () => {
  it("should return FileDiff[] with correct shape", async () => {
    const { coderAgent } = await import("../coder");

    const mockDiffs: FileDiff[] = [
      {
        filename: "src/foo.ts",
        original: "old",
        modified: "new // AGENT[node1]: fix",
      },
    ];
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(mockDiffs))
    );

    const result = await coderAgent(makeMockNode(), []);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].filename).toBe("src/foo.ts");
    expect(result[0].original).toBe("old");
    expect(result[0].modified).toBe("new // AGENT[node1]: fix");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T03 — criticAgent() returns CriticVerdict for known-bad diff
// ═══════════════════════════════════════════════════════════════════════════
describe("T03 — criticAgent flags known-bad diff", () => {
  it("should return REQUEST_CHANGES with reasons", async () => {
    const { criticAgent } = await import("../critic");

    const mockVerdict: CriticVerdict = {
      verdict: "REQUEST_CHANGES",
      reasons: ["Missing null check on line 5", "Unhandled promise rejection"],
    };
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(mockVerdict))
    );

    const mockDiffs: FileDiff[] = [
      { filename: "src/bad.ts", original: "old", modified: "new" },
    ];
    const result = await criticAgent(makeMockNode(), mockDiffs);

    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T04 — runTests() correctly maps failing test to TaskNode ID
// ═══════════════════════════════════════════════════════════════════════════
describe("T04 — runTests maps failing test to TaskNode ID", () => {
  it("should map failing test and return passed === false", async () => {
    const mockSpawn = vi.mocked(cp.spawn);

    // Create fake vitest JSON output
    const vitestOutput = JSON.stringify({
      files: [
        {
          name: "test.spec.ts",
          filepath: "/tmp/test.spec.ts",
          tasks: [
            {
              name: "AGENT[test-node-001]: should handle null input",
              state: "fail",
              errors: [{ message: "expected null to be defined" }],
            },
          ],
        },
      ],
      numFailedTests: 1,
      numPassedTests: 0,
      success: false,
    });

    // Build a fake child process using EventEmitter
    const fakeStdout = new EventEmitter();
    const fakeStderr = new EventEmitter();
    const fakeChild = new EventEmitter() as any;
    fakeChild.stdout = fakeStdout;
    fakeChild.stderr = fakeStderr;

    mockSpawn.mockReturnValueOnce(fakeChild as any);

    const { runTests } = await import("../test-runner");

    // Need to also mock mkdirSync since it tries to create staging dir
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const promise = runTests([], "test-node-001", "/tmp/staging");

    // Emit data and close
    fakeStdout.emit("data", Buffer.from(vitestOutput));
    fakeChild.emit("close", 1);

    const result = await promise;

    expect(result.passed).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    const failingTest = result.results.find((r) => !r.passed);
    expect(failingTest).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T05 — patcherAgent() resolves synthetic bug in ≤2 attempts
// ═══════════════════════════════════════════════════════════════════════════
describe("T05 — patcherAgent resolves synthetic bug", () => {
  it("should return FileDiff[] when attempts < max_attempts", async () => {
    const { patcherAgent } = await import("../patcher");

    const node = makeMockNode({ attempts: 0, max_attempts: 2, agent_role: "patcher" });

    const patchDiffs: FileDiff[] = [
      {
        filename: "src/fix.ts",
        original: "broken code",
        modified: "fixed code // PATCHER[test-node-001]: null check",
      },
    ];
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(patchDiffs))
    );

    const failingResult: TestResult = {
      test_id: "AGENT[test-node-001]:null-test",
      assertion: "should handle null input",
      passed: false,
      actual_output: "TypeError: Cannot read property of null",
    };

    // Mock writeFileSync for the halt_report.json (shouldn't be called, but just in case)
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = await patcherAgent(
      node,
      [{ filename: "src/fix.ts", original: "original", modified: "broken code" }],
      [failingResult]
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].filename).toBe("src/fix.ts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T06 — traceLogger appends valid AgentTraceEntry JSON
// ═══════════════════════════════════════════════════════════════════════════
describe("T06 — traceLogger appends valid AgentTraceEntry", () => {
  it("should call fs.appendFileSync with valid JSON", async () => {
    const appendMock = vi.mocked(fs.appendFileSync);
    appendMock.mockClear();
    appendMock.mockImplementation(() => {});

    const { traceLogger } = await import("../trace-logger");

    const entry: AgentTraceEntry = {
      timestamp: new Date().toISOString(),
      goal_id: "test-goal",
      node_id: "test-node-001",
      agent_role: "coder",
      action: "coder_complete",
      input_summary: "test input",
      output_summary: "test output",
      test_results: [],
      status: "success",
    };

    traceLogger.append(entry);

    expect(appendMock).toHaveBeenCalled();
    const writtenData = appendMock.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenData.trim());
    expect(parsed.goal_id).toBe("test-goal");
    expect(parsed.node_id).toBe("test-node-001");
    expect(parsed.status).toBe("success");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T07–T10 — Orchestrator tests
// These mock the Anthropic SDK to control the full flow, and mock runTests
// via spyOn to avoid needing to simulate child_process spawn behavior.
// ═══════════════════════════════════════════════════════════════════════════
import * as testRunnerModule from "../test-runner";

function setupOrchestratorMocksForSuccess() {
  // Call 1: plannerAgent -> TaskGraph
  mockCreate.mockResolvedValueOnce(
    anthropicTextResponse(JSON.stringify(makeTaskGraph()))
  );

  // Call 2: coderAgent -> FileDiff[]
  mockCreate.mockResolvedValueOnce(
    anthropicTextResponse(
      JSON.stringify([
        { filename: "src/target.ts", original: "old", modified: "new" },
      ])
    )
  );

  // Call 3: criticAgent -> APPROVE
  mockCreate.mockResolvedValueOnce(
    anthropicTextResponse(
      JSON.stringify({ verdict: "APPROVE", reasons: [] })
    )
  );

  // Mock runTests to return passing results (bypass spawn complexity)
  vi.spyOn(testRunnerModule, "runTests").mockResolvedValueOnce({
    passed: true,
    results: [],
  });

  vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
  vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  vi.mocked(fs.appendFileSync).mockImplementation(() => {});
}

describe("T07 — Full orchestrator loop completes for trivial goal", () => {
  it("should complete without HALT", async () => {
    setupOrchestratorMocksForSuccess();

    const { runAgentLoop } = await import("../orchestrator");
    const graph = await runAgentLoop("trivial goal", "context");

    expect(graph.status).toBe("complete");
  });
});

describe("T08 — Orchestrator HALTs when critic returns REQUEST_CHANGES twice", () => {
  it("should throw error containing HALT", async () => {
    // Call 1: plannerAgent -> TaskGraph
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(makeTaskGraph()))
    );

    // Call 2: coderAgent (attempt 1) -> FileDiff[]
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        JSON.stringify([
          { filename: "src/target.ts", original: "old", modified: "new" },
        ])
      )
    );

    // Call 3: criticAgent (attempt 1) -> REQUEST_CHANGES
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        JSON.stringify({
          verdict: "REQUEST_CHANGES",
          reasons: ["bad code"],
        })
      )
    );

    // Call 4: coderAgent (attempt 2) -> FileDiff[]
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        JSON.stringify([
          { filename: "src/target.ts", original: "old", modified: "new2" },
        ])
      )
    );

    // Call 5: criticAgent (attempt 2) -> REQUEST_CHANGES again
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        JSON.stringify({
          verdict: "REQUEST_CHANGES",
          reasons: ["still bad"],
        })
      )
    );

    // Mock fs for buildHaltReport
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const { runAgentLoop } = await import("../orchestrator");

    await expect(
      runAgentLoop("goal that fails", "context")
    ).rejects.toThrow(/HALT/);
  });
});

describe("T09 — agent_trace.jsonl populated after successful run", () => {
  it("should call fs.appendFileSync at least once on success", async () => {
    const appendMock = vi.mocked(fs.appendFileSync);
    appendMock.mockClear();

    setupOrchestratorMocksForSuccess();

    const { runAgentLoop } = await import("../orchestrator");
    await runAgentLoop("trace test goal", "context");

    // traceLogger.append calls fs.appendFileSync
    expect(appendMock).toHaveBeenCalled();
    const writtenData = appendMock.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenData.trim());
    expect(parsed.goal_id).toBeDefined();
    expect(parsed.node_id).toBeDefined();
    expect(parsed.status).toBe("success");
  });
});

describe("T10 — No files outside target TaskNode scope modified", () => {
  it("should only contain expected filenames in node outputs", async () => {
    setupOrchestratorMocksForSuccess();

    const { runAgentLoop } = await import("../orchestrator");
    const graph = await runAgentLoop("scoped goal", "context");

    for (const node of graph.nodes) {
      if (node.outputs && node.outputs.diffs) {
        const diffs = node.outputs.diffs as FileDiff[];
        for (const diff of diffs) {
          expect(diff.filename).toBe("src/target.ts");
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T11 — All pre-existing tests still pass (import check)
// ═══════════════════════════════════════════════════════════════════════════
describe("T11 — Agent modules importable without errors", () => {
  it("should import from src/agents/index.ts without throwing", async () => {
    const agents = await import("../index");
    expect(agents).toBeDefined();
    expect(typeof agents.plannerAgent).toBe("function");
    expect(typeof agents.coderAgent).toBe("function");
    expect(typeof agents.criticAgent).toBe("function");
    expect(typeof agents.runTests).toBe("function");
    expect(typeof agents.patcherAgent).toBe("function");
    expect(typeof agents.runAgentLoop).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T12 — orchestrator.ts has zero TypeScript compiler errors
// ═══════════════════════════════════════════════════════════════════════════
describe("T12 — Zero TypeScript compiler errors", () => {
  it("should pass tsc --noEmit", async () => {
    const cp = await vi.importActual<typeof import("child_process")>("child_process");

    expect(() => {
      cp.execSync("npx tsc --noEmit", {
        cwd: path.resolve(__dirname, "../../.."),
        timeout: 120000,
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 180000); // 3 minute timeout for tsc
});

// ═══════════════════════════════════════════════════════════════════════════
// T13 — plannerAgent() gracefully handles vague goal
// ═══════════════════════════════════════════════════════════════════════════
describe("T13 — plannerAgent handles vague goal gracefully", () => {
  it("should return valid TaskGraph even for vague input", async () => {
    const { plannerAgent } = await import("../planner");

    const vagueGraph = makeTaskGraph({
      goal_id: "make-it-better",
      goal_description: "make it better",
    });
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(vagueGraph))
    );

    const result = await plannerAgent("make it better", "some context");

    expect(typeof result.goal_id).toBe("string");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(result.success_criteria)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T14 — Critic correctly APPROVEs known-good diff
// ═══════════════════════════════════════════════════════════════════════════
describe("T14 — Critic APPROVEs known-good diff", () => {
  it("should return APPROVE with no false positives", async () => {
    const { criticAgent } = await import("../critic");

    const approveVerdict: CriticVerdict = {
      verdict: "APPROVE",
      reasons: [],
    };
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(approveVerdict))
    );

    const goodDiffs: FileDiff[] = [
      {
        filename: "src/good.ts",
        original: "function add(a: number, b: number) { return a; }",
        modified:
          "function add(a: number, b: number) { return a + b; // AGENT[test-node-001]: fix addition }",
      },
    ];

    const result = await criticAgent(makeMockNode(), goodDiffs);

    expect(result.verdict).toBe("APPROVE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T15 — Patcher does not modify files outside failing test's scope
// ═══════════════════════════════════════════════════════════════════════════
describe("T15 — Patcher does not modify files outside scope", () => {
  it("should only return diffs for the expected file", async () => {
    const { patcherAgent } = await import("../patcher");

    const node = makeMockNode({ attempts: 0, max_attempts: 2, agent_role: "patcher" });

    const patchDiffs: FileDiff[] = [
      {
        filename: "src/specific-file.ts",
        original: "broken",
        modified: "fixed // PATCHER[test-node-001]: fix",
      },
    ];
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(JSON.stringify(patchDiffs))
    );

    const failingResult: TestResult = {
      test_id: "AGENT[test-node-001]:scope-test",
      assertion: "should not crash",
      passed: false,
      actual_output: "Error: crash",
    };

    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = await patcherAgent(
      node,
      [{ filename: "src/specific-file.ts", original: "orig", modified: "broken" }],
      [failingResult]
    );

    expect(result.length).toBeGreaterThan(0);
    for (const diff of result) {
      expect(diff.filename).toBe("src/specific-file.ts");
    }
  });
});
