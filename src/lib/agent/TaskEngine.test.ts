import { beforeEach, describe, expect, it, vi } from "vitest";
import { startTaskEngine } from "./TaskEngine";
import type { AIProvider } from "../ai/types";
import { useWorkspaceStore } from "../stores/WorkspaceStore";

describe("TaskEngine approval handling", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      agentMode: "auto",
      planQueue: [],
      currentTask: null,
      taskCheckpoint: null,
      activeConnectionId: "conn-1",
      activeTabId: "tab-1",
    });
  });

  it("pauses the task in awaiting_input when approval is required", async () => {
    const provider: AIProvider = {
      id: "openai",
      name: "Test Provider",
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          text: "I should delete the bad rows.",
          toolCalls: [
            {
              id: "tc-delete",
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
          text: "The delete is queued for approval.",
          toolCalls: [],
          stopReason: "end_turn",
        }),
    };

    const result = await startTaskEngine("Delete bad orders", [], {
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

    const currentTask = useWorkspaceStore.getState().currentTask;
    const checkpoint = useWorkspaceStore.getState().taskCheckpoint;

    expect(result.pendingApprovalSteps).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(1);
    expect(currentTask?.status).toBe("awaiting_input");
    expect(currentTask?.subtasks[0]?.status).toBe("awaiting_approval");
    expect(checkpoint?.task.status).toBe("awaiting_input");
    expect(checkpoint?.task.subtasks[0]?.status).toBe("awaiting_approval");
  });
});
