import { describe, expect, it } from "vitest";
import type { ChartArtifact, ReportArtifact } from "../stores/WorkspaceStore";
import type { PipelineDefinition, PipelineRunRecord } from "../pipelines/PipelineStore";
import { buildCommandReview, buildPipelineRunReview, buildReportRefreshReview } from "./DataChangeReviewEngine";

function createChartArtifact(): ChartArtifact {
  return {
    id: "artifact-chart-1",
    kind: "chart",
    name: "Sales trend chart",
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 1000,
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
      capturedAt: Date.now() - 3000,
      rowCount: 24,
      elapsedMs: 10,
      queryId: "q-1",
      fields: [{ name: "created_at" }, { name: "order_total" }],
      rows: [],
      sourceTables: ["public.sales_orders"],
    },
    chart: {
      chartType: "line",
      assignments: { x: "created_at", y: "order_total", color: null, size: null, facet: null },
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

describe("DataChangeReviewEngine", () => {
  it("flags broad destructive delete risk", () => {
    const review = buildCommandReview(
      {
        type: "delete_rows",
        schema: "public",
        table: "sales_orders",
        where: "1 = 1",
        estimatedCount: 2500,
        risk: "destructive",
      },
      {
        artifacts: { "artifact-chart-1": createChartArtifact() },
        connections: [],
        schemas: {},
      },
      { pipelines: [], backgroundAgents: [] },
    );

    expect(review).not.toBeNull();
    expect(review?.findings.some((finding) => finding.severity === "critical")).toBe(true);
    expect(review?.findings.some((finding) => finding.title.includes("Broad delete predicate"))).toBe(true);
  });

  it("describes pipeline overwrite risk", () => {
    const pipeline: PipelineDefinition = {
      id: "pipe-1",
      name: "Revenue materialization",
      sourceConnectionId: "conn-1",
      sourceQuery: "select * from public.sales_orders",
      targetConnectionId: "conn-2",
      targetTable: "analytics.revenue_daily",
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 1000,
      lastRunArtifactId: "artifact-chart-1",
    };
    const latestRun: PipelineRunRecord = {
      id: "run-1",
      pipelineId: "pipe-1",
      status: "success",
      startedAt: Date.now() - 4000,
      finishedAt: Date.now() - 3500,
      rowCount: 600,
      artifactId: "artifact-chart-1",
      targetTable: "analytics.revenue_daily",
      sourceConnectionId: "conn-1",
      targetConnectionId: "conn-2",
    };

    const review = buildPipelineRunReview(pipeline, latestRun, {
      "artifact-chart-1": createChartArtifact(),
    });

    expect(review.findings.some((finding) => finding.title.includes("Materialization overwrite"))).toBe(true);
    expect(review.sqlPreview).toContain("select * from public.sales_orders");
  });

  it("summarizes report refresh impact", () => {
    const chartArtifact = createChartArtifact();
    const report: ReportArtifact = {
      id: "artifact-report-1",
      kind: "report",
      name: "Weekly sales report",
      createdAt: Date.now() - 6000,
      updatedAt: Date.now() - 5000,
      connectionName: "Warehouse",
      sourceArtifactIds: [chartArtifact.id],
      sourceArtifactRevisionIds: { [chartArtifact.id]: "rev-old" },
      sectionBindings: [
        {
          sectionKey: "executive_summary",
          sectionType: "executive_summary",
          sourceArtifactIds: [chartArtifact.id],
          sourceArtifactRevisionIds: { [chartArtifact.id]: "rev-old" },
        },
      ],
      spec: {
        title: "Weekly sales report",
        author: "Daitalk",
        date: "2026-05-17",
        sections: [{ type: "title_page" }, { type: "executive_summary", bullets: ["Sales increased"] }],
      },
    };

    const review = buildReportRefreshReview(
      report,
      { [chartArtifact.id]: chartArtifact },
      {
        [chartArtifact.id]: [
          {
            id: "rev-new",
            artifactId: chartArtifact.id,
            recordedAt: Date.now(),
            artifact: { ...chartArtifact, updatedAt: Date.now() },
          },
        ],
      },
      "stale",
    );

    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.findings.some((finding) => finding.category === "lineage")).toBe(true);
  });
});
