import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./WorkspaceStore";

describe("WorkspaceStore agent mode behavior", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      agentMode: "plan",
      planQueue: [],
    });
  });

  it("preserves pending approvals when switching to auto mode", () => {
    useWorkspaceStore.getState().addPlanStep({
      id: "plan-1",
      commandType: "delete_rows",
      humanReadable: "DELETE rows from public.orders WHERE status = 'bad'",
      riskLevel: "destructive",
      status: "pending",
    });

    useWorkspaceStore.getState().setAgentMode("auto");

    expect(useWorkspaceStore.getState().agentMode).toBe("auto");
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue[0]?.id).toBe("plan-1");
  });
});
