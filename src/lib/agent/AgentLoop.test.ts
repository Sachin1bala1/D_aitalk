import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
