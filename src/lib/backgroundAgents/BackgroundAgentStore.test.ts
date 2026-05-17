import { afterEach, describe, expect, it } from "vitest";
import {
  __resetBackgroundAgentStoreForTests,
  addBackgroundAgentApprovalItems,
  appendBackgroundAgentRunEvent,
  createBackgroundAgent,
  getBackgroundAgent,
  getBackgroundAgentRuns,
  markBackgroundAgentRunRunning,
  recordBackgroundAgentRunStart,
  requestBackgroundAgentRunTakeover,
  resolveBackgroundAgentApproval,
  shouldRunBackgroundAgentNow,
  finishBackgroundAgentRun,
  listBackgroundAgentApprovals,
} from "./BackgroundAgentStore";

describe("BackgroundAgentStore", () => {
  afterEach(() => {
    __resetBackgroundAgentStoreForTests();
  });

  it("marks enabled agents due when cadence has elapsed", () => {
    expect(
      shouldRunBackgroundAgentNow(
        {
          id: "agent-1",
          name: "Watch orders",
          prompt: "analyze",
          connectionId: "conn-1",
          cadenceMinutes: 30,
          isEnabled: true,
          createdAt: 1,
          updatedAt: 1,
          lastRunAt: 0,
          lastRunStatus: null,
          lastRunArtifactId: null,
          lastRunSummary: null,
        },
        31 * 60_000,
      ),
    ).toBe(true);
  });

  it("persists runs and approval lifecycle for background agents", async () => {
    const agent = await createBackgroundAgent({
      name: "Monitor drift",
      prompt: "Check anomalies",
      connectionId: "conn-1",
      cadenceMinutes: 60,
      isEnabled: true,
    });

    const run = await recordBackgroundAgentRunStart(agent.id, {
      trigger: "scheduled",
      maxAttempts: 2,
    });
    await markBackgroundAgentRunRunning({
      agentId: agent.id,
      runId: run.id,
      attemptCount: 1,
    });
    await appendBackgroundAgentRunEvent({
      agentId: agent.id,
      runId: run.id,
      type: "sql_executed",
      message: "Executed drift check query",
      metadata: { rowCount: 12 },
    });
    const approvals = await addBackgroundAgentApprovalItems([
      {
        agentId: agent.id,
        runId: run.id,
        title: "Review cleanup query",
        rationale: "An outlier cleanup was recommended.",
        risk: "caution",
        suggestedSql: "DELETE FROM public.orders WHERE id = 1;",
      },
    ]);

    await finishBackgroundAgentRun({
      runId: run.id,
      agentId: agent.id,
      status: "approval_required",
      summary: "Drift detected",
      approvalIds: approvals.map((approval) => approval.id),
      queryArtifactIds: ["artifact-query-1"],
      reportArtifactId: "artifact-report-1",
    });
    await requestBackgroundAgentRunTakeover({
      agentId: agent.id,
      runId: run.id,
      prompt: "Resume this detached investigation in AI chat.",
    });
    await resolveBackgroundAgentApproval(approvals[0].id, "approved");

    const savedAgent = getBackgroundAgent(agent.id);
    const savedRuns = getBackgroundAgentRuns(agent.id);
    const savedApproval = listBackgroundAgentApprovals(agent.id)[0];

    expect(savedAgent?.lastRunStatus).toBe("approval_required");
    expect(savedAgent?.lastRunArtifactId).toBe("artifact-report-1");
    expect(savedRuns[0]?.trigger).toBe("scheduled");
    expect(savedRuns[0]?.attemptCount).toBe(1);
    expect(savedRuns[0]?.approvalIds).toEqual([approvals[0].id]);
    expect(savedRuns[0]?.queryArtifactIds).toEqual(["artifact-query-1"]);
    expect(savedRuns[0]?.events.some((event) => event.type === "sql_executed")).toBe(true);
    expect(savedRuns[0]?.takeoverPrompt).toContain("detached investigation");
    expect(savedApproval?.status).toBe("approved");
  });
});
