import { beforeEach, describe, expect, it, vi } from "vitest";

describe("PipelineStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates and lists persisted pipelines", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const pipelineStore = await import("./PipelineStore");

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Daily sales sync",
      sourceConnectionId: "conn-src",
      sourceQuery: "select * from sales",
      targetConnectionId: "conn-dst",
      targetTable: "public.sales_snapshot",
    });

    expect(pipelineStore.listPipelines()).toHaveLength(1);
    expect(pipelineStore.inspectPipelines().pipelines[0]?.id).toBe(pipeline.id);
    expect(saveSpy).toHaveBeenCalled();
  });

  it("runs a pipeline, writes target rows, and records an output artifact", async () => {
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
      sourceConnectionId: "conn-src",
      sourceQuery: "select id, region, total from revenue",
      targetConnectionId: "conn-dst",
      targetTable: "public.revenue_snapshot",
    });

    const run = await pipelineStore.runPipelineDefinition(pipeline.id);

    expect(querySpy).toHaveBeenCalledWith("conn-src", "select id, region, total from revenue");
    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(run.status).toBe("success");
    expect(run.rowCount).toBe(2);
    expect(run.artifactId).toBeTruthy();
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "query",
      lineage: {
        connectionId: "conn-src",
        sql: "select id, region, total from revenue",
        queryId: run.id,
      },
    });

    const inspected = pipelineStore.inspectPipelines().pipelines[0];
    expect(inspected?.lastRunStatus).toBe("success");
    expect(inspected?.lastRunArtifactId).toBe(run.artifactId);
    expect(pipelineStore.getPipelineRuns(pipeline.id)[0]?.id).toBe(run.id);
  });

  it("records failed pipeline runs without claiming success", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();
    vi.spyOn(DbClient, "query").mockRejectedValue(new Error("source query failed"));

    const pipelineStore = await import("./PipelineStore");

    await pipelineStore.ensurePipelinesLoaded();
    const pipeline = await pipelineStore.createPipelineDefinition({
      name: "Broken sync",
      sourceConnectionId: "conn-src",
      sourceQuery: "select * from missing_table",
      targetConnectionId: "conn-dst",
      targetTable: "public.broken_snapshot",
    });

    await expect(pipelineStore.runPipelineDefinition(pipeline.id)).rejects.toThrow(
      "source query failed",
    );

    const inspected = pipelineStore.inspectPipelines().pipelines[0];
    expect(inspected?.lastRunStatus).toBe("failed");
    expect(inspected?.lastRunError).toBe("source query failed");
    expect(pipelineStore.getPipelineRuns(pipeline.id)[0]?.status).toBe("failed");
  });
});
