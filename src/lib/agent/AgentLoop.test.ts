import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReflectionGuidance,
  buildVisualizationClarifier,
  inferNumericColumns,
  isUnderspecifiedVisualizationRequest,
  runAgentLoop,
} from "./AgentLoop";
import { commandBus } from "./CommandBus";
import type { AIProvider } from "../ai/types";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { QueryResults } from "../stores/WorkspaceStore";

const SAMPLE_RESULTS: QueryResults = {
  rows: [
    {
      "Torque [Nm]": 42.8,
      "Tool wear [min]": 0,
      "Air temperature [K]": 298.1,
      Type: "L",
    },
    {
      "Torque [Nm]": 46.3,
      "Tool wear [min]": 3,
      "Air temperature [K]": 298.2,
      Type: "M",
    },
  ],
  fields: [
    { name: "Torque [Nm]" },
    { name: "Tool wear [min]" },
    { name: "Air temperature [K]" },
    { name: "Type" },
  ],
  rowCount: 2,
  elapsedMs: 12,
  queryId: "q1",
  source_tables: ["public.sachin_test_data_table"],
};

describe("visualization clarification heuristics", () => {
  it("flags generic plot requests as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("make plot")).toBe(true);
    expect(isUnderspecifiedVisualizationRequest("plot data")).toBe(true);
  });

  it("does not flag explicit plot relationships as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("plot Torque [Nm] vs Tool wear [min]")).toBe(false);
    expect(isUnderspecifiedVisualizationRequest("make a histogram of Torque [Nm]")).toBe(false);
  });

  it("infers numeric columns from current results", () => {
    expect(inferNumericColumns(SAMPLE_RESULTS)).toEqual([
      "Torque [Nm]",
      "Tool wear [min]",
      "Air temperature [K]",
    ]);
  });

  it("builds a clarifying question with concrete examples when results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", SAMPLE_RESULTS);
    expect(clarifier).toContain("Which relationship do you want plotted?");
    expect(clarifier).toContain("Torque [Nm] vs Tool wear [min]");
  });

  it("asks for columns when no results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", null);
    expect(clarifier).toContain("Which columns or relationship do you want plotted?");
  });
});

describe("destructive command approval enforcement", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      agentMode: "auto",
      planQueue: [],
      currentTask: null,
    });
    vi.restoreAllMocks();
  });

  it("queues destructive commands for approval even in auto mode", async () => {
    const provider: AIProvider = {
      id: "openai",
      name: "Test Provider",
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          text: "I need to remove the bad rows.",
          toolCalls: [
            {
              id: "tc-1",
              name: "delete_rows",
              input: {
                schema: "public",
                table: "orders",
                where: "\"status\" = 'bad'",
              },
            },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          text: "The delete is queued for your approval.",
          toolCalls: [],
          stopReason: "end_turn",
        }),
    };

    const dispatchSpy = vi.spyOn(commandBus, "dispatch");
    const queuedSteps: string[] = [];

    const result = await runAgentLoop("Delete the bad rows", [], {
      provider,
      model: "test-model",
      connectionId: "conn-1",
      schema: null,
      currentSQL: null,
      currentResults: null,
      onToken: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onPlanQueued: (stepId) => {
        queuedSteps.push(stepId);
      },
    });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(queuedSteps).toHaveLength(1);
    expect(result.pendingApprovalSteps).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue[0]?.commandType).toBe("delete_rows");
    expect(useWorkspaceStore.getState().planQueue[0]?.status).toBe("pending");
  });

  it("still dispatches safe commands immediately in auto mode", async () => {
    const provider: AIProvider = {
      id: "openai",
      name: "Test Provider",
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          text: "Opening the table.",
          toolCalls: [
            {
              id: "tc-2",
              name: "open_table",
              input: {
                schema: "public",
                table: "orders",
              },
            },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          text: "The table is open.",
          toolCalls: [],
          stopReason: "end_turn",
        }),
    };

    const dispatchSpy = vi.spyOn(commandBus, "dispatch").mockResolvedValue({
      success: true,
      result: "opened",
    });

    await runAgentLoop("Open orders", [], {
      provider,
      model: "test-model",
      connectionId: "conn-1",
      schema: null,
      currentSQL: null,
      currentResults: null,
      onToken: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onPlanQueued: () => {},
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(0);
  });
});

describe("buildReflectionGuidance", () => {
  it("returns content unchanged for successful non-empty execute_sql", () => {
    const content = JSON.stringify({ rows: [{ a: 1 }], rowCount: 1 });
    expect(buildReflectionGuidance("execute_sql", content, false)).toBe(content);
  });

  it("appends ZERO RESULTS block when execute_sql returns empty rows", () => {
    const content = JSON.stringify({ rows: [], rowCount: 0, fields: [], elapsedMs: 5 });
    const out = buildReflectionGuidance("execute_sql", content, false);
    expect(out).toContain("ZERO RESULTS");
    expect(out).toContain("derived table");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION block on tool error", () => {
    const content = "Error: column not found";
    const out = buildReflectionGuidance("execute_sql", content, true);
    expect(out).toContain("ERROR REFLECTION");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION for non-execute_sql tool errors", () => {
    const content = "Error: connection refused";
    const out = buildReflectionGuidance("analyze_loaded_correlation", content, true);
    expect(out).toContain("ERROR REFLECTION");
  });

  it("returns content unchanged for successful non-execute_sql tool", () => {
    const content = JSON.stringify({ correlations: [{ column: "A", correlation: 0.9 }] });
    expect(buildReflectionGuidance("analyze_loaded_correlation", content, false)).toBe(content);
  });

  it("returns content unchanged for execute_sql with non-JSON content and no error", () => {
    // Tests the catch path for non-JSON content
    expect(buildReflectionGuidance("execute_sql", "plain text result", false)).toBe("plain text result");
  });

  it("appends ERROR REFLECTION for empty-string content on error", () => {
    const out = buildReflectionGuidance("execute_sql", "", true);
    expect(out).toContain("ERROR REFLECTION");
  });

  it("does NOT append ZERO RESULTS when rowCount is null (not zero)", () => {
    // rowCount: null must NOT trigger the zero-rows branch
    const content = JSON.stringify({ rows: [], rowCount: null, fields: [] });
    const out = buildReflectionGuidance("execute_sql", content, false);
    expect(out).toBe(content); // unchanged — null is not 0
  });
});
