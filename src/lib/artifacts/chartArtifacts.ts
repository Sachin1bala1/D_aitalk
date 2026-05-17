import { buildDashboardSnapshot } from "../dashboard/dashboardState";
import type {
  AnalysisArtifact,
  ArtifactLineage,
  ChartArtifactAssignments,
  ChartArtifactOptions,
  QueryResults,
} from "../stores/WorkspaceStore";

export function createDefaultChartArtifactOptions(args: {
  xLabel: string;
  yLabel: string;
}): ChartArtifactOptions {
  return {
    showDataPoints: true,
    showTrendLine: false,
    logScaleX: false,
    logScaleY: false,
    xAxisMode: "fit",
    yAxisMode: "fit",
    xAxisMin: "",
    xAxisMax: "",
    yAxisMin: "",
    yAxisMax: "",
    xAxisLabel: args.xLabel,
    yAxisLabel: args.yLabel,
    refLineValue: "",
    refLineLabel: "",
    confidenceInterval: "none",
  };
}

export function createChartArtifact(args: {
  name: string;
  chartType: string;
  assignments: ChartArtifactAssignments;
  options: ChartArtifactOptions;
  results: QueryResults;
  sql: string;
  connectionId: string | null;
  sourceTabId: string | null;
}): AnalysisArtifact {
  const now = Date.now();
  const artifactId = `artifact-chart-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const lineage: ArtifactLineage = {
    connectionId: args.connectionId,
    sql: args.sql,
    queryId: args.results.queryId,
    sourceTables: args.results.source_tables,
    sourceTabId: args.sourceTabId,
  };

  return {
    id: artifactId,
    kind: "chart",
    name: args.name,
    createdAt: now,
    updatedAt: now,
    lineage,
    snapshot: buildDashboardSnapshot(args.results, args.sql, args.connectionId, args.name),
    chart: {
      chartType: args.chartType,
      assignments: args.assignments,
      options: args.options,
    },
  };
}
