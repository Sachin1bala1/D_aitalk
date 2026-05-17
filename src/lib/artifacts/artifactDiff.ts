import type {
  AnalysisArtifact,
  ArtifactRevision,
  ChartArtifact,
  QueryArtifact,
  ReportArtifact,
} from "../stores/WorkspaceStore";
import type { ReportSection } from "../reports/ReportBuilder";

export interface ArtifactDiffSection {
  title: string;
  items: string[];
}

export interface ArtifactDiffDetails {
  summary: string[];
  sections: ArtifactDiffSection[];
}

function pushSection(sections: ArtifactDiffSection[], title: string, items: string[]) {
  if (items.length === 0) return;
  sections.push({ title, items });
}

function diffQueryLike(
  prev: QueryArtifact | ChartArtifact,
  next: QueryArtifact | ChartArtifact,
): ArtifactDiffDetails {
  const summary: string[] = [];
  const sections: ArtifactDiffSection[] = [];
  const overview: string[] = [];
  const rowDelta = next.snapshot.rowCount - prev.snapshot.rowCount;
  if (rowDelta !== 0) {
    const direction = rowDelta > 0 ? "increased" : "decreased";
    summary.push(`row count ${direction} by ${Math.abs(rowDelta).toLocaleString()}`);
    overview.push(
      `Rows ${direction} from ${prev.snapshot.rowCount.toLocaleString()} to ${next.snapshot.rowCount.toLocaleString()}`,
    );
  }

  const prevColumns = new Set(prev.snapshot.fields.map((field) => field.name));
  const nextColumns = new Set(next.snapshot.fields.map((field) => field.name));
  const addedColumns = [...nextColumns].filter((column) => !prevColumns.has(column));
  const removedColumns = [...prevColumns].filter((column) => !nextColumns.has(column));
  const columnChanges: string[] = [];
  if (addedColumns.length > 0) {
    summary.push(`columns added: ${addedColumns.join(", ")}`);
    columnChanges.push(`Added columns: ${addedColumns.join(", ")}`);
  }
  if (removedColumns.length > 0) {
    summary.push(`columns removed: ${removedColumns.join(", ")}`);
    columnChanges.push(`Removed columns: ${removedColumns.join(", ")}`);
  }

  const previousQueryId = prev.lineage.queryId ?? "none";
  const nextQueryId = next.lineage.queryId ?? "none";
  if (previousQueryId !== nextQueryId) {
    overview.push(`Query snapshot changed from ${previousQueryId} to ${nextQueryId}`);
  }

  pushSection(sections, "Overview", overview);
  pushSection(sections, "Columns", columnChanges);
  return { summary, sections };
}

function diffChart(prev: ChartArtifact, next: ChartArtifact): ArtifactDiffDetails {
  const base = diffQueryLike(prev, next);
  const chartConfigChanges: string[] = [];
  if (prev.chart.chartType !== next.chart.chartType) {
    base.summary.push(`chart type changed from ${prev.chart.chartType} to ${next.chart.chartType}`);
    chartConfigChanges.push(`Chart type changed from ${prev.chart.chartType} to ${next.chart.chartType}`);
  }

  const assignmentKeys: Array<keyof ChartArtifact["chart"]["assignments"]> = ["x", "y", "color", "size", "facet"];
  for (const key of assignmentKeys) {
    if (prev.chart.assignments[key] !== next.chart.assignments[key]) {
      base.summary.push(`${key} assignment changed`);
      chartConfigChanges.push(
        `${key.toUpperCase()} assignment changed from ${prev.chart.assignments[key] ?? "none"} to ${
          next.chart.assignments[key] ?? "none"
        }`,
      );
    }
  }

  const optionChanges: string[] = [];
  if (prev.chart.options.showTrendLine !== next.chart.options.showTrendLine) {
    optionChanges.push(`Trend line ${next.chart.options.showTrendLine ? "enabled" : "disabled"}`);
  }
  if (prev.chart.options.showDataPoints !== next.chart.options.showDataPoints) {
    optionChanges.push(`Data points ${next.chart.options.showDataPoints ? "shown" : "hidden"}`);
  }
  if (prev.chart.options.xAxisLabel !== next.chart.options.xAxisLabel) {
    optionChanges.push(`X axis label changed to ${next.chart.options.xAxisLabel || next.chart.assignments.x || "default"}`);
  }
  if (prev.chart.options.yAxisLabel !== next.chart.options.yAxisLabel) {
    optionChanges.push(`Y axis label changed to ${next.chart.options.yAxisLabel || next.chart.assignments.y || "default"}`);
  }

  pushSection(base.sections, "Chart Config", chartConfigChanges);
  pushSection(base.sections, "Display Options", optionChanges);
  return base;
}

function diffReport(prev: ReportArtifact, next: ReportArtifact): ArtifactDiffDetails {
  const summary: string[] = [];
  const sections: ArtifactDiffSection[] = [];
  const structureChanges: string[] = [];
  if (prev.spec.sections.length !== next.spec.sections.length) {
    summary.push(`section count changed from ${prev.spec.sections.length} to ${next.spec.sections.length}`);
    structureChanges.push(`Sections changed from ${prev.spec.sections.length} to ${next.spec.sections.length}`);
  }
  if (prev.sourceArtifactIds.join("|") !== next.sourceArtifactIds.join("|")) {
    summary.push("linked source artifacts changed");
    structureChanges.push("Linked source artifacts were updated");
  }
  if (prev.spec.date !== next.spec.date) {
    summary.push(`report date updated to ${next.spec.date}`);
    structureChanges.push(`Report date updated to ${next.spec.date}`);
  }
  if (prev.name !== next.name) {
    summary.push(`report name changed from ${prev.name} to ${next.name}`);
    structureChanges.push(`Report title changed from ${prev.name} to ${next.name}`);
  }

  const previousHeadings = prev.spec.sections.map(describeReportSection);
  const nextHeadings = next.spec.sections.map(describeReportSection);
  const addedSections = nextHeadings.filter((heading) => !previousHeadings.includes(heading));
  const removedSections = previousHeadings.filter((heading) => !nextHeadings.includes(heading));
  const sectionHeadingChanges: string[] = [];
  if (addedSections.length > 0) {
    sectionHeadingChanges.push(`Added sections: ${addedSections.join(", ")}`);
  }
  if (removedSections.length > 0) {
    sectionHeadingChanges.push(`Removed sections: ${removedSections.join(", ")}`);
  }

  pushSection(sections, "Structure", structureChanges);
  pushSection(sections, "Section Headings", sectionHeadingChanges);
  return { summary, sections };
}

export function summarizeArtifactDiff(previous: AnalysisArtifact, current: AnalysisArtifact): string[] {
  if (previous.kind !== current.kind) {
    return [`artifact kind changed from ${previous.kind} to ${current.kind}`];
  }

  if (current.kind === "query" && previous.kind === "query") {
    return diffQueryLike(previous, current).summary;
  }
  if (current.kind === "chart" && previous.kind === "chart") {
    return diffChart(previous, current).summary;
  }
  if (current.kind === "report" && previous.kind === "report") {
    return diffReport(previous, current).summary;
  }
  return [];
}

export function describeArtifactDiff(previous: AnalysisArtifact, current: AnalysisArtifact): ArtifactDiffDetails {
  if (previous.kind !== current.kind) {
    return {
      summary: [`artifact kind changed from ${previous.kind} to ${current.kind}`],
      sections: [
        {
          title: "Artifact Kind",
          items: [`Artifact kind changed from ${previous.kind} to ${current.kind}`],
        },
      ],
    };
  }

  if (current.kind === "query" && previous.kind === "query") {
    return diffQueryLike(previous, current);
  }
  if (current.kind === "chart" && previous.kind === "chart") {
    return diffChart(previous, current);
  }
  if (current.kind === "report" && previous.kind === "report") {
    return diffReport(previous, current);
  }
  return { summary: [], sections: [] };
}

export function summarizeLatestArtifactRevisionDiff(revisions: ArtifactRevision[]): string[] {
  if (revisions.length < 2) return [];
  const previous = revisions[revisions.length - 2]?.artifact;
  const current = revisions[revisions.length - 1]?.artifact;
  if (!previous || !current) return [];
  return summarizeArtifactDiff(previous, current);
}

function describeReportSection(section: ReportSection): string {
  switch (section.type) {
    case "title_page":
      return "Title Page";
    case "executive_summary":
      return "Executive Summary";
    case "analysis":
      return section.title;
    case "data_table":
      return section.title || "Data Table";
    case "recommendations":
      return "Recommendations";
    default:
      return "Unknown Section";
  }
}
