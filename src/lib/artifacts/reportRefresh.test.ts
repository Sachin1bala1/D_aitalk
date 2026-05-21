import { describe, expect, it } from "vitest";
import type {
  ArtifactRevision,
  ChartArtifact,
  QueryArtifact,
  ReportArtifact,
} from "../stores/WorkspaceStore";
import {
  buildRefreshedReportArtifact,
  getReportSectionStatuses,
  getStaleReportSectionKeys,
} from "./reportRefresh";

function createQueryArtifact(id: string, revisionSuffix: string, rowCount = 10): QueryArtifact {
  return {
    id,
    kind: "query",
    name: `Query ${id}`,
    createdAt: 1,
    updatedAt: 100,
    lineage: {
      connectionId: "conn-1",
      connectionName: "Local",
      sql: "select * from public.orders",
      queryId: `query-${revisionSuffix}`,
      sourceTables: ["public.orders"],
    },
    snapshot: {
      rows: [{ id: 1, status: "ok" }],
      fields: [{ name: "id" }, { name: "status" }],
      rowCount,
      queryId: `query-${revisionSuffix}`,
      source_tables: ["public.orders"],
      elapsedMs: 5,
    },
  };
}

function createChartArtifact(id: string, revisionSuffix: string): ChartArtifact {
  return {
    id,
    kind: "chart",
    name: `Chart ${id}`,
    createdAt: 1,
    updatedAt: 100,
    lineage: {
      connectionId: "conn-1",
      connectionName: "Local",
      sql: "select * from public.orders",
      queryId: `query-${revisionSuffix}`,
      sourceTables: ["public.orders"],
    },
    snapshot: {
      rows: [{ id: 1, status: "ok" }],
      fields: [{ name: "id" }, { name: "status" }],
      rowCount: 10,
      queryId: `query-${revisionSuffix}`,
      source_tables: ["public.orders"],
      elapsedMs: 5,
    },
    spec: {
      chartType: "bar",
      title: "Orders",
      assignments: { x: "status", y: "id", series: null },
      options: { stacked: false, showLegend: true, showGrid: true },
    },
  };
}

function createRevisions(artifact: QueryArtifact | ChartArtifact, revisionId: string): ArtifactRevision[] {
  return [
    {
      id: revisionId,
      artifactId: artifact.id,
      recordedAt: 1,
      artifact,
    },
  ];
}

describe("reportRefresh", () => {
  it("reports stale section bindings for only the changed upstream artifact", () => {
    const query = createQueryArtifact("artifact-query-1", "a");
    const chart = createChartArtifact("artifact-chart-1", "a");
    const report: ReportArtifact = {
      id: "artifact-report-1",
      kind: "report",
      name: "Report",
      createdAt: 1,
      updatedAt: 1,
      connectionName: "Local",
      sourceArtifactIds: [query.id, chart.id],
      sourceArtifactRevisionIds: {
        [query.id]: "query-rev-1",
        [chart.id]: "chart-rev-1",
      },
      sectionBindings: [
        {
          sectionKey: "executive_summary",
          sectionType: "executive_summary",
          sourceArtifactIds: [query.id, chart.id],
          sourceArtifactRevisionIds: {
            [query.id]: "query-rev-1",
            [chart.id]: "chart-rev-1",
          },
        },
        {
          sectionKey: `artifact:${query.id}`,
          sectionType: "data_table",
          sourceArtifactIds: [query.id],
          sourceArtifactRevisionIds: { [query.id]: "query-rev-1" },
        },
        {
          sectionKey: `artifact:${chart.id}`,
          sectionType: "analysis",
          sourceArtifactIds: [chart.id],
          sourceArtifactRevisionIds: { [chart.id]: "chart-rev-1" },
        },
      ],
      spec: {
        title: "Report",
        author: "User",
        date: "5/17/2026",
        connectionName: "Local",
        sections: [
          { type: "title_page" },
          { type: "executive_summary", bullets: ["Old"] },
          { type: "data_table", title: "Query artifact-query-1", columns: ["id"], rows: [[1]] },
          { type: "analysis", title: "Chart artifact-chart-1", chartDataUrl: "", chartId: chart.id, findings: "Old", confidence: 0.5, tools_used: ["artifact_chart"] },
          { type: "recommendations", items: [{ priority: "medium", action: "Keep watching" }] },
        ],
      },
    };
    const nextQuery = createQueryArtifact("artifact-query-1", "b", 42);
    const artifacts = {
      [nextQuery.id]: nextQuery,
      [chart.id]: chart,
      [report.id]: report,
    };
    const revisions = {
      [nextQuery.id]: createRevisions(nextQuery, "query-rev-2"),
      [chart.id]: createRevisions(chart, "chart-rev-1"),
    };

    const statuses = getReportSectionStatuses(report, artifacts, revisions);
    const staleKeys = getStaleReportSectionKeys(report, artifacts, revisions);

    expect(statuses.filter((status) => status.stale).map((status) => status.sectionKey)).toEqual([
      "executive_summary",
      `artifact:${nextQuery.id}`,
    ]);
    expect(staleKeys).toEqual(["executive_summary", `artifact:${nextQuery.id}`]);
  });

  it("refreshes only stale report sections and preserves untouched sections", () => {
    const query = createQueryArtifact("artifact-query-1", "a");
    const chart = createChartArtifact("artifact-chart-1", "a");
    const report: ReportArtifact = {
      id: "artifact-report-1",
      kind: "report",
      name: "Report",
      createdAt: 1,
      updatedAt: 1,
      connectionName: "Local",
      sourceArtifactIds: [query.id, chart.id],
      sourceArtifactRevisionIds: {
        [query.id]: "query-rev-1",
        [chart.id]: "chart-rev-1",
      },
      sectionBindings: [
        {
          sectionKey: "executive_summary",
          sectionType: "executive_summary",
          sourceArtifactIds: [query.id, chart.id],
          sourceArtifactRevisionIds: {
            [query.id]: "query-rev-1",
            [chart.id]: "chart-rev-1",
          },
        },
        {
          sectionKey: `artifact:${query.id}`,
          sectionType: "data_table",
          sourceArtifactIds: [query.id],
          sourceArtifactRevisionIds: { [query.id]: "query-rev-1" },
        },
        {
          sectionKey: `artifact:${chart.id}`,
          sectionType: "analysis",
          sourceArtifactIds: [chart.id],
          sourceArtifactRevisionIds: { [chart.id]: "chart-rev-1" },
        },
      ],
      spec: {
        title: "Report",
        author: "User",
        date: "5/17/2026",
        connectionName: "Local",
        sections: [
          { type: "title_page" },
          { type: "executive_summary", bullets: ["Old summary"] },
          { type: "data_table", title: "Old query section", columns: ["id"], rows: [[1]] },
          { type: "analysis", title: "Stable chart section", chartDataUrl: "", chartId: chart.id, findings: "Stable findings", confidence: 0.5, tools_used: ["artifact_chart"] },
          { type: "recommendations", items: [{ priority: "medium", action: "Keep watching" }] },
        ],
      },
    };
    const nextQuery = createQueryArtifact("artifact-query-1", "b", 42);
    const artifacts = {
      [nextQuery.id]: nextQuery,
      [chart.id]: chart,
      [report.id]: report,
    };
    const revisions = {
      [nextQuery.id]: createRevisions(nextQuery, "query-rev-2"),
      [chart.id]: createRevisions(chart, "chart-rev-1"),
    };

    const refreshed = buildRefreshedReportArtifact(report, artifacts, revisions, {
      sectionKeys: ["executive_summary", `artifact:${nextQuery.id}`],
    });

    expect(refreshed.spec.sections[1]).toMatchObject({ type: "executive_summary" });
    expect(refreshed.spec.sections[2]).toMatchObject({
      type: "data_table",
      title: nextQuery.name,
    });
    expect(refreshed.spec.sections[3]).toMatchObject({
      type: "analysis",
      title: "Stable chart section",
      findings: "Stable findings",
    });
    expect(refreshed.sectionBindings.find((binding) => binding.sectionKey === `artifact:${nextQuery.id}`)?.sourceArtifactRevisionIds[nextQuery.id]).toBe("query-rev-2");
    expect(refreshed.sectionBindings.find((binding) => binding.sectionKey === `artifact:${chart.id}`)?.sourceArtifactRevisionIds[chart.id]).toBe("chart-rev-1");
  });
});
