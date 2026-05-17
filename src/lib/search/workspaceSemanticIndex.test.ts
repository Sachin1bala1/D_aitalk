import { describe, expect, it } from "vitest";
import { buildWorkspaceSearchDocuments, searchWorkspaceDocuments } from "./workspaceSemanticIndex";
import { __resetWorkspaceSearchSnapshotStoreForTests, rebuildWorkspaceSearchSnapshot } from "./WorkspaceSearchSnapshotStore";
import type { FullSchema, QueryHistoryRecord } from "../db/DbClient";
import type { ChartArtifact, ReportArtifact } from "../stores/WorkspaceStore";
import type { PipelineDefinition, PipelineRunRecord } from "../pipelines/PipelineStore";
import type {
  BackgroundAgentApprovalItem,
  BackgroundAgentDefinition,
  BackgroundAgentRun,
} from "../backgroundAgents/BackgroundAgentStore";
import type { Episode } from "../memory/EpisodicMemory";

function createSchema(): FullSchema {
  return {
    connection_id: "conn-1",
    driver: "postgres",
    tables: [
      {
        schema: "public",
        name: "sales_orders",
        row_estimate: 1200,
        size_bytes: 1024,
        object_type: "table",
      },
    ],
    columns: {
      "public.sales_orders": [
        {
          name: "order_total",
          type_name: "numeric",
          display_type: { kind: "float" },
          nullable: false,
          is_primary_key: false,
        },
      ],
    },
    foreign_keys: [],
    indexes: [
      {
        index_name: "idx_sales_orders_created_at",
        table_name: "public.sales_orders",
        columns: ["created_at"],
        is_unique: false,
        is_primary: false,
      },
    ],
    hypertable_tables: [],
    functions: [],
  };
}

function createChartArtifact(): ChartArtifact {
  return {
    id: "artifact-chart-1",
    kind: "chart",
    name: "Sales trend chart",
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 2000,
    lineage: {
      connectionId: "conn-1",
      sql: "select created_at, order_total from public.sales_orders",
      queryId: "q-1",
      sourceTables: ["public.sales_orders"],
      sourceTabId: "tab-1",
    },
    snapshot: {
      id: "snapshot-1",
      name: "Sales trend",
      connectionId: "conn-1",
      sql: "select created_at, order_total from public.sales_orders",
      capturedAt: Date.now() - 4000,
      rowCount: 24,
      elapsedMs: 10,
      queryId: "q-1",
      fields: [{ name: "created_at" }, { name: "order_total" }],
      rows: [],
      sourceTables: ["public.sales_orders"],
    },
    chart: {
      chartType: "line",
      assignments: {
        x: "created_at",
        y: "order_total",
        color: null,
        size: null,
        facet: null,
      },
      options: {
        showDataPoints: true,
        showTrendLine: false,
        logScaleX: false,
        logScaleY: false,
        xAxisMode: "auto",
        yAxisMode: "auto",
        xAxisMin: "",
        xAxisMax: "",
        yAxisMin: "",
        yAxisMax: "",
        xAxisLabel: "created_at",
        yAxisLabel: "order_total",
        refLineValue: "",
        refLineLabel: "",
        confidenceInterval: "none",
      },
    },
  };
}

describe("workspaceSemanticIndex", () => {
  it("builds mixed workspace documents from major entity types", () => {
    const chartArtifact = createChartArtifact();
    const reportArtifact: ReportArtifact = {
      id: "artifact-report-1",
      kind: "report",
      name: "Weekly sales report",
      createdAt: Date.now() - 6000,
      updatedAt: Date.now() - 1000,
      connectionName: "Warehouse",
      sourceArtifactIds: [chartArtifact.id],
      sourceArtifactRevisionIds: { [chartArtifact.id]: "rev-1" },
      sectionBindings: [],
      spec: {
        title: "Weekly sales report",
        author: "Daitalk",
        date: "2026-05-17",
        sections: [{ type: "title_page" }, { type: "executive_summary", bullets: ["Sales increased"] }],
      },
    };

    const pipeline: PipelineDefinition = {
      id: "pipe-1",
      name: "Revenue materialization",
      sourceConnectionId: "conn-1",
      sourceQuery: "select * from public.sales_orders",
      targetConnectionId: "conn-2",
      targetTable: "analytics.revenue_daily",
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 1000,
    };

    const agent: BackgroundAgentDefinition = {
      id: "agent-1",
      name: "Revenue monitor",
      prompt: "Watch for revenue drops and summarize anomalies.",
      connectionId: "conn-1",
      cadenceMinutes: 60,
      isEnabled: true,
      createdAt: Date.now() - 6000,
      updatedAt: Date.now() - 1000,
      lastRunAt: Date.now() - 2000,
      lastRunStatus: "success",
      lastRunArtifactId: chartArtifact.id,
      lastRunSummary: "Detected a weekend dip.",
    };

    const pipelineRun: PipelineRunRecord = {
      id: "pipe-run-1",
      pipelineId: pipeline.id,
      status: "success",
      startedAt: Date.now() - 4000,
      finishedAt: Date.now() - 3500,
      rowCount: 12,
      artifactId: chartArtifact.id,
      targetTable: pipeline.targetTable,
      sourceConnectionId: pipeline.sourceConnectionId,
      targetConnectionId: pipeline.targetConnectionId,
    };

    const agentRun: BackgroundAgentRun = {
      id: "agent-run-1",
      agentId: agent.id,
      status: "success",
      startedAt: Date.now() - 3000,
      finishedAt: Date.now() - 2500,
      summary: "Weekend demand dip only.",
      error: null,
      reportArtifactId: reportArtifact.id,
      queryArtifactIds: [chartArtifact.id],
      approvalIds: ["approval-1"],
    };

    const approval: BackgroundAgentApprovalItem = {
      id: "approval-1",
      agentId: agent.id,
      runId: agentRun.id,
      title: "Review downstream cleanup",
      rationale: "Rows older than threshold may need review.",
      risk: "caution",
      status: "pending",
      createdAt: Date.now() - 2000,
      resolvedAt: null,
      suggestedSql: "delete from analytics.revenue_daily where ...",
    };

    const history: QueryHistoryRecord[] = [
      {
        query_id: "history-1",
        sql: "select * from public.sales_orders where order_total > 1000",
        source_table: "public.sales_orders",
        source_tables: ["public.sales_orders"],
        row_count: 12,
        duration_ms: 40,
        success: true,
        error_message: null,
        executed_at: new Date().toISOString(),
      },
    ];

    const memory: Episode[] = [
      {
        id: "ep-1",
        sessionId: "s-1",
        connectionId: "conn-1",
        problem: "Investigate revenue dip in sales orders",
        toolsUsed: ["execute_sql", "create_chart"],
        findings: { cause: "weekend demand" },
        outcome: "No production issue detected.",
        createdAt: Date.now() - 3000,
      },
    ];

    const docs = buildWorkspaceSearchDocuments({
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        [chartArtifact.id]: chartArtifact,
        [reportArtifact.id]: reportArtifact,
      },
      pipelines: [pipeline],
      pipelineRuns: [pipelineRun],
      backgroundAgents: [agent],
      backgroundAgentRuns: [agentRun],
      backgroundAgentApprovals: [approval],
      queryHistory: history,
      memoryEpisodes: memory,
    });

    expect(docs.some((doc) => doc.kind === "schema_table")).toBe(true);
    expect(docs.some((doc) => doc.kind === "artifact_chart")).toBe(true);
    expect(docs.some((doc) => doc.kind === "artifact_report")).toBe(true);
    expect(docs.some((doc) => doc.kind === "pipeline")).toBe(true);
    expect(docs.some((doc) => doc.kind === "pipeline_run")).toBe(true);
    expect(docs.some((doc) => doc.kind === "background_agent")).toBe(true);
    expect(docs.some((doc) => doc.kind === "background_agent_run")).toBe(true);
    expect(docs.some((doc) => doc.kind === "background_agent_approval")).toBe(true);
    expect(docs.some((doc) => doc.kind === "query_history")).toBe(true);
    expect(docs.some((doc) => doc.kind === "memory_episode")).toBe(true);
  });

  it("returns ranked cross-workspace matches", () => {
    const docs = buildWorkspaceSearchDocuments({
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        "artifact-chart-1": createChartArtifact(),
      },
      pipelines: [],
      pipelineRuns: [],
      backgroundAgents: [],
      backgroundAgentRuns: [],
      backgroundAgentApprovals: [],
      queryHistory: [],
      memoryEpisodes: [],
    });

    const matches = searchWorkspaceDocuments(docs, "sales trend", 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.document.title.toLowerCase()).toContain("sales");
    expect(
      matches.some(
        (match) =>
          match.document.kind === "artifact_chart" || match.document.kind === "schema_table",
      ),
    ).toBe(true);
    expect(matches[0]?.snippet.length).toBeGreaterThan(0);
    expect(matches[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("supports filters and intent-aware boosts", () => {
    const docs = buildWorkspaceSearchDocuments({
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        "artifact-chart-1": createChartArtifact(),
      },
      pipelines: [],
      pipelineRuns: [],
      backgroundAgents: [],
      backgroundAgentRuns: [],
      backgroundAgentApprovals: [],
      queryHistory: [],
      memoryEpisodes: [],
    });

    const chartFirst = searchWorkspaceDocuments(docs, "sales trend chart", {
      limit: 5,
      kinds: ["artifact_chart", "schema_table"],
    });
    expect(chartFirst[0]?.document.kind).toBe("artifact_chart");

    const schemaOnly = searchWorkspaceDocuments(docs, "sales orders table", {
      limit: 5,
      kinds: ["schema_table"],
      connectionId: "conn-1",
      recentDays: 30,
    });
    expect(schemaOnly.every((match) => match.document.kind === "schema_table")).toBe(true);
  });

  it("boosts related evidence across artifacts, runs, and approvals", () => {
    const chartArtifact = createChartArtifact();
    const reportArtifact: ReportArtifact = {
      id: "artifact-report-1",
      kind: "report",
      name: "Weekend dip report",
      createdAt: Date.now() - 6000,
      updatedAt: Date.now() - 1000,
      connectionName: "Warehouse",
      sourceArtifactIds: [chartArtifact.id],
      sourceArtifactRevisionIds: { [chartArtifact.id]: "rev-1" },
      sectionBindings: [],
      spec: {
        title: "Weekend dip report",
        author: "Daitalk",
        date: "2026-05-17",
        sections: [{ type: "title_page" }, { type: "executive_summary", bullets: ["Weekend dip only"] }],
      },
    };
    const pipeline: PipelineDefinition = {
      id: "pipe-1",
      name: "Revenue materialization",
      sourceConnectionId: "conn-1",
      sourceQuery: "select * from public.sales_orders",
      targetConnectionId: "conn-2",
      targetTable: "analytics.revenue_daily",
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 1000,
      lastRunArtifactId: chartArtifact.id,
    };
    const pipelineRun: PipelineRunRecord = {
      id: "pipe-run-1",
      pipelineId: pipeline.id,
      status: "success",
      startedAt: Date.now() - 4000,
      finishedAt: Date.now() - 3500,
      rowCount: 12,
      artifactId: chartArtifact.id,
      targetTable: pipeline.targetTable,
      sourceConnectionId: pipeline.sourceConnectionId,
      targetConnectionId: pipeline.targetConnectionId,
    };
    const agent: BackgroundAgentDefinition = {
      id: "agent-1",
      name: "Revenue monitor",
      prompt: "Watch for revenue drops and summarize anomalies.",
      connectionId: "conn-1",
      cadenceMinutes: 60,
      isEnabled: true,
      createdAt: Date.now() - 6000,
      updatedAt: Date.now() - 1000,
      lastRunAt: Date.now() - 2000,
      lastRunStatus: "success",
      lastRunArtifactId: reportArtifact.id,
      lastRunSummary: "Weekend dip detected.",
    };
    const agentRun: BackgroundAgentRun = {
      id: "agent-run-1",
      agentId: agent.id,
      status: "success",
      startedAt: Date.now() - 3000,
      finishedAt: Date.now() - 2500,
      summary: "Weekend demand dip only.",
      error: null,
      reportArtifactId: reportArtifact.id,
      queryArtifactIds: [chartArtifact.id],
      approvalIds: ["approval-1"],
    };
    const approval: BackgroundAgentApprovalItem = {
      id: "approval-1",
      agentId: agent.id,
      runId: agentRun.id,
      title: "Review downstream cleanup",
      rationale: "Rows older than threshold may need review.",
      risk: "caution",
      status: "pending",
      createdAt: Date.now() - 2000,
      resolvedAt: null,
      suggestedSql: "delete from analytics.revenue_daily where ...",
    };

    const docs = buildWorkspaceSearchDocuments({
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        [chartArtifact.id]: chartArtifact,
        [reportArtifact.id]: reportArtifact,
      },
      pipelines: [pipeline],
      pipelineRuns: [pipelineRun],
      backgroundAgents: [agent],
      backgroundAgentRuns: [agentRun],
      backgroundAgentApprovals: [approval],
      queryHistory: [],
      memoryEpisodes: [],
    });

    const matches = searchWorkspaceDocuments(docs, "weekend dip report", { limit: 10 });
    expect(matches.some((match) => match.document.kind === "artifact_report")).toBe(true);
    expect(matches.some((match) => match.document.kind === "background_agent_run")).toBe(true);
    expect(matches.some((match) => match.document.kind === "background_agent_approval")).toBe(true);
    const approvalMatch = matches.find((match) => match.document.kind === "background_agent_approval");
    expect(approvalMatch?.reasons.some((reason) => reason.includes("related"))).toBe(true);
    expect((approvalMatch?.relatedDocumentIds.length ?? 0) > 0).toBe(true);
  });

  it("links memory episodes to related workspace evidence", () => {
    const chartArtifact = createChartArtifact();
    const docs = buildWorkspaceSearchDocuments({
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        [chartArtifact.id]: chartArtifact,
      },
      pipelines: [],
      pipelineRuns: [],
      backgroundAgents: [],
      backgroundAgentRuns: [],
      backgroundAgentApprovals: [],
      queryHistory: [],
      memoryEpisodes: [
        {
          id: "ep-1",
          sessionId: "s-1",
          connectionId: "conn-1",
          problem: "Investigate sales trend dip in sales orders",
          toolsUsed: ["execute_sql", "create_chart"],
          findings: { note: "sales orders dip investigated" },
          outcome: "trend normalized later",
          createdAt: Date.now() - 1000,
        },
      ],
    });

    const matches = searchWorkspaceDocuments(docs, "investigate sales trend dip", { limit: 10 });
    expect(matches.some((match) => match.document.kind === "memory_episode")).toBe(true);
    expect(matches.some((match) => match.document.kind === "artifact_chart")).toBe(true);
  });

  it("rebuilds only changed index segments for persisted snapshots", async () => {
    __resetWorkspaceSearchSnapshotStoreForTests();
    const baseInput = {
      schemas: { "conn-1": createSchema() },
      connections: [
        {
          id: "conn-1",
          display_name: "Warehouse",
          driver: "postgres",
          connection_string: "postgres://example",
        },
      ],
      artifacts: {
        "artifact-chart-1": createChartArtifact(),
      },
      pipelines: [] as PipelineDefinition[],
      pipelineRuns: [],
      backgroundAgents: [] as BackgroundAgentDefinition[],
      backgroundAgentRuns: [],
      backgroundAgentApprovals: [],
      queryHistory: [] as QueryHistoryRecord[],
      memoryEpisodes: [] as Episode[],
    };

    const first = await rebuildWorkspaceSearchSnapshot(baseInput);
    expect(first.rebuiltSegments.length).toBeGreaterThan(0);

    const second = await rebuildWorkspaceSearchSnapshot(baseInput);
    expect(second.rebuiltSegments).toEqual([]);

    const changedArtifact = {
      ...createChartArtifact(),
      id: "artifact-chart-1",
      name: "Updated sales trend chart",
      updatedAt: Date.now(),
    };
    const third = await rebuildWorkspaceSearchSnapshot({
      ...baseInput,
      artifacts: { "artifact-chart-1": changedArtifact },
    });
    expect(third.rebuiltSegments).toEqual(["artifacts"]);
  });
});
