import { beforeEach, describe, expect, it, vi } from "vitest";

describe("PipelineStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates and lists persisted pipelines with normalized workflow steps", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const pipelineStore = await import("./PipelineStore");

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Daily sales sync",
      description: "Refresh the sales snapshot every morning",
      sourceConnectionId: "conn-src",
      sourceQuery: "select * from sales",
      targetConnectionId: "conn-dst",
      targetTable: "public.sales_snapshot",
      cadenceMinutes: 60,
      isEnabled: true,
    });

    expect(pipelineStore.listPipelines()).toHaveLength(1);
    expect(pipeline.description).toBe("Refresh the sales snapshot every morning");
    expect(pipeline.cadenceMinutes).toBe(60);
    expect(pipeline.isEnabled).toBe(true);
    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[0]).toMatchObject({
      type: "query",
      connectionId: "conn-src",
      sql: "select * from sales",
    });
    expect(pipeline.steps[1]).toMatchObject({
      type: "materialize",
      targetConnectionId: "conn-dst",
      targetTable: "public.sales_snapshot",
    });
    expect(pipelineStore.inspectPipelines().pipelines[0]?.id).toBe(pipeline.id);
    expect(saveSpy).toHaveBeenCalled();
  });

  it("runs a multi-step pipeline, writes target rows, and records step evidence", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();
    const querySpy = vi
      .spyOn(DbClient, "query")
      .mockResolvedValue([
        { id: 1, region: "north", total: 10 },
        { id: 2, region: "south", total: 12 },
      ]);
    const executeSpy = vi.spyOn(DbClient, "execute").mockResolvedValue(0);

    const pipelineStore = await import("./PipelineStore");
    const { useWorkspaceStore } = await import("../stores/WorkspaceStore");
    const commitSpy = vi.fn();
    useWorkspaceStore.setState({ commitArtifactRevision: commitSpy } as any);

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Revenue snapshot",
      description: "Query, validate, and materialize revenue rows",
      sourceConnectionId: "conn-src",
      sourceQuery: "select id, region, total from revenue",
      targetConnectionId: "conn-dst",
      targetTable: "public.revenue_snapshot",
      steps: [
        {
          id: "step-query",
          type: "query",
          name: "Fetch revenue rows",
          connectionId: "conn-src",
          sql: "select id, region, total from revenue",
        },
        {
          id: "step-assert",
          type: "assert_row_count",
          name: "Ensure data exists",
          sourceStepId: "step-query",
          minRows: 1,
          failOnEmpty: true,
        },
        {
          id: "step-materialize",
          type: "materialize",
          name: "Write snapshot",
          sourceStepId: "step-query",
          targetConnectionId: "conn-dst",
          targetTable: "public.revenue_snapshot",
          writeMode: "replace",
        },
      ],
    });

    const run = await pipelineStore.runPipelineDefinition(pipeline.id);

    expect(querySpy).toHaveBeenCalledWith("conn-src", "select id, region, total from revenue");
    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(run.status).toBe("success");
    expect(run.trigger).toBe("manual");
    expect(run.rowCount).toBe(2);
    expect(run.artifactId).toBeTruthy();
    expect(run.stepRuns).toHaveLength(3);
    expect(run.stepRuns.map((stepRun) => stepRun.status)).toEqual([
      "success",
      "success",
      "success",
    ]);
    expect(run.stepRuns[0]).toMatchObject({
      stepId: "step-query",
      stepType: "query",
      rowCount: 2,
    });
    expect(run.stepRuns[1]).toMatchObject({
      stepId: "step-assert",
      stepType: "assert_row_count",
      rowCount: 2,
    });
    expect(run.stepRuns[2]).toMatchObject({
      stepId: "step-materialize",
      stepType: "materialize",
      rowCount: 2,
      artifactId: run.artifactId,
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "query",
      lineage: {
        connectionId: "conn-src",
        sql: "select id, region, total from revenue",
      },
    });

    const inspected = pipelineStore.inspectPipelines().pipelines[0];
    expect(inspected?.lastRunStatus).toBe("success");
    expect(inspected?.lastRunArtifactId).toBe(run.artifactId);
    expect(pipelineStore.getPipelineRuns(pipeline.id)[0]?.id).toBe(run.id);
  });

  it("fails row-count assertions before writes and records step failure", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();
    vi.spyOn(DbClient, "query").mockResolvedValue([]);
    const executeSpy = vi.spyOn(DbClient, "execute").mockResolvedValue(0);

    const pipelineStore = await import("./PipelineStore");

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Guarded sync",
      sourceConnectionId: "conn-src",
      sourceQuery: "select * from empty_source",
      targetConnectionId: "conn-dst",
      targetTable: "public.guarded_snapshot",
      steps: [
        {
          id: "step-query",
          type: "query",
          name: "Fetch source rows",
          connectionId: "conn-src",
          sql: "select * from empty_source",
        },
        {
          id: "step-assert",
          type: "assert_row_count",
          name: "Require non-empty dataset",
          sourceStepId: "step-query",
          failOnEmpty: true,
        },
        {
          id: "step-materialize",
          type: "materialize",
          name: "Write target rows",
          sourceStepId: "step-query",
          targetConnectionId: "conn-dst",
          targetTable: "public.guarded_snapshot",
          writeMode: "replace",
        },
      ],
    });

    await expect(pipelineStore.runPipelineDefinition(pipeline.id)).rejects.toThrow(
      "Assertion failed: query returned no rows.",
    );

    expect(executeSpy).not.toHaveBeenCalled();
    const latestRun = pipelineStore.getPipelineRuns(pipeline.id)[0];
    expect(latestRun?.status).toBe("failed");
    expect(latestRun?.stepRuns).toHaveLength(2);
    expect(latestRun?.stepRuns[0]).toMatchObject({
      stepId: "step-query",
      status: "success",
      rowCount: 0,
    });
    expect(latestRun?.stepRuns[1]).toMatchObject({
      stepId: "step-assert",
      status: "failed",
      error: "Assertion failed: query returned no rows.",
    });
    expect(pipelineStore.inspectPipelines().pipelines[0]?.lastRunStatus).toBe("failed");
  });

  it("runs due scheduled pipelines with a scheduled trigger", async () => {
    const { DbClient } = await import("../db/DbClient");
    let persistedDocument: unknown = null;
    vi.spyOn(DbClient, "loadAppDocument").mockImplementation(async () => persistedDocument as any);
    vi.spyOn(DbClient, "saveAppDocument").mockImplementation(async (_key, value) => {
      persistedDocument = value;
    });
    vi.spyOn(DbClient, "query").mockResolvedValue([{ id: 1 }]);
    vi.spyOn(DbClient, "execute").mockResolvedValue(0);

    const pipelineStore = await import("./PipelineStore");
    const { useWorkspaceStore } = await import("../stores/WorkspaceStore");
    useWorkspaceStore.setState({ commitArtifactRevision: vi.fn() } as any);

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Scheduled revenue snapshot",
      sourceConnectionId: "conn-src",
      sourceQuery: "select id from revenue",
      targetConnectionId: "conn-dst",
      targetTable: "public.revenue_snapshot",
      cadenceMinutes: 5,
      isEnabled: true,
    });

    await pipelineStore.runDuePipelineDefinitions(Date.now());

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = pipelineStore.getPipelineRuns(pipeline.id)[0];
      if (candidate && candidate.status === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const run = pipelineStore.getPipelineRuns(pipeline.id)[0];
    expect(run).toBeTruthy();
    expect(run?.trigger).toBe("scheduled");
    expect(run?.status).toBe("success");
  });
});
