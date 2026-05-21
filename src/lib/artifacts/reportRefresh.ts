import type {
  AnalysisArtifact,
  ArtifactRevision,
  ChartArtifact,
  QueryArtifact,
  ReportArtifact,
  ReportSectionBinding,
} from "../stores/WorkspaceStore";
import { getLatestArtifactRevisionId } from "../stores/WorkspaceStore";
import type { ReportSection, ReportSpec } from "../reports/ReportBuilder";
import { evaluateArtifactHealth } from "./dependencyGraph";

export interface ReportSectionRefreshStatus {
  sectionKey: string;
  sectionType: ReportSectionBinding["sectionType"];
  stale: boolean;
  missing: boolean;
  sourceArtifactIds: string[];
}

function buildExecutiveSummarySection(sourceArtifacts: SourceArtifact[]): ReportSection {
  const queryCount = sourceArtifacts.filter((artifact) => artifact.kind === "query").length;
  const chartCount = sourceArtifacts.filter((artifact) => artifact.kind === "chart").length;
  const totalRows = sourceArtifacts.reduce((sum, artifact) => sum + artifact.snapshot.rowCount, 0);

  const bullets = [
    `Refreshed from ${sourceArtifacts.length} linked artifact${sourceArtifacts.length === 1 ? "" : "s"}.`,
    `Sources include ${queryCount} query snapshot${queryCount === 1 ? "" : "s"} and ${chartCount} chart artifact${chartCount === 1 ? "" : "s"}.`,
    `Current linked snapshots cover ${totalRows.toLocaleString()} total rows.`,
  ];

  return { type: "executive_summary", bullets };
}

function buildChartAnalysisSection(artifact: ChartArtifact): ReportSection {
  const sourceTables = artifact.lineage.sourceTables.join(", ") || "unknown sources";
  return {
    type: "analysis",
    title: artifact.name,
    chartDataUrl: "",
    chartId: artifact.id,
    findings: `Chart artifact refreshed from ${sourceTables} using ${artifact.snapshot.rowCount.toLocaleString()} rows.`,
    confidence: 0.9,
    tools_used: ["artifact_chart"],
  };
}

function buildQueryTableSection(artifact: QueryArtifact): ReportSection {
  const columns = artifact.snapshot.fields.map((field) => field.name);
  const rows = artifact.snapshot.rows.slice(0, 25).map((row) =>
    columns.map((column) => row[column] ?? null),
  );

  return {
    type: "data_table",
    title: artifact.name,
    columns,
    rows,
  };
}

type SourceArtifact = ChartArtifact | QueryArtifact;

function getSourceArtifacts(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
): SourceArtifact[] {
  return artifact.sourceArtifactIds
    .map((id) => allArtifacts[id])
    .filter(
      (candidate): candidate is SourceArtifact =>
        !!candidate && (candidate.kind === "chart" || candidate.kind === "query"),
    );
}

function getSectionKeyForSourceArtifact(sourceArtifactId: string): string {
  return `artifact:${sourceArtifactId}`;
}

function buildSectionBindings(
  sourceArtifacts: SourceArtifact[],
  artifactRevisionsById: Record<string, ArtifactRevision[]>,
): ReportSectionBinding[] {
  const bindings: ReportSectionBinding[] = [];

  if (sourceArtifacts.length > 0) {
    bindings.push({
      sectionKey: "executive_summary",
      sectionType: "executive_summary",
      sourceArtifactIds: sourceArtifacts.map((artifact) => artifact.id),
      sourceArtifactRevisionIds: Object.fromEntries(
        sourceArtifacts.map((artifact) => [
          artifact.id,
          getLatestArtifactRevisionId(artifactRevisionsById[artifact.id]),
        ]),
      ),
    });
  }

  for (const sourceArtifact of sourceArtifacts) {
    bindings.push({
      sectionKey: getSectionKeyForSourceArtifact(sourceArtifact.id),
      sectionType: sourceArtifact.kind === "chart" ? "analysis" : "data_table",
      sourceArtifactIds: [sourceArtifact.id],
      sourceArtifactRevisionIds: {
        [sourceArtifact.id]: getLatestArtifactRevisionId(artifactRevisionsById[sourceArtifact.id]),
      },
    });
  }

  return bindings;
}

function findSectionIndexByKey(
  report: ReportArtifact,
  sectionKey: string,
): number {
  if (sectionKey === "executive_summary") {
    return report.spec.sections.findIndex((section) => section.type === "executive_summary");
  }

  if (sectionKey.startsWith("artifact:")) {
    const artifactId = sectionKey.slice("artifact:".length);
    const bindingIndex = report.sourceArtifactIds.indexOf(artifactId);
    if (bindingIndex >= 0) {
      return 2 + bindingIndex;
    }
  }

  return -1;
}

function buildSectionForBinding(
  binding: ReportSectionBinding,
  sourceArtifactsById: Record<string, SourceArtifact>,
): ReportSection | null {
  if (binding.sectionKey === "executive_summary") {
    const artifacts = binding.sourceArtifactIds
      .map((artifactId) => sourceArtifactsById[artifactId])
      .filter(Boolean);
    return buildExecutiveSummarySection(artifacts);
  }

  const sourceArtifactId = binding.sourceArtifactIds[0];
  const sourceArtifact = sourceArtifactId ? sourceArtifactsById[sourceArtifactId] : null;
  if (!sourceArtifact) return null;

  if (sourceArtifact.kind === "chart") {
    return buildChartAnalysisSection(sourceArtifact);
  }

  return buildQueryTableSection(sourceArtifact);
}

export function getReportSectionStatuses(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
  allArtifactRevisions: Record<string, ArtifactRevision[]>,
): ReportSectionRefreshStatus[] {
  return artifact.sectionBindings.map((binding) => {
    const missingIds = binding.sourceArtifactIds.filter((artifactId) => !allArtifacts[artifactId]);
    const staleIds = binding.sourceArtifactIds.filter((artifactId) => {
      const baselineRevisionId = binding.sourceArtifactRevisionIds[artifactId] ?? null;
      const currentRevisionId = getLatestArtifactRevisionId(allArtifactRevisions[artifactId]);
      return !!baselineRevisionId && !!currentRevisionId && baselineRevisionId !== currentRevisionId;
    });

    return {
      sectionKey: binding.sectionKey,
      sectionType: binding.sectionType,
      stale: staleIds.length > 0,
      missing: missingIds.length > 0,
      sourceArtifactIds: binding.sourceArtifactIds,
    };
  });
}

function rebuildReportSections(args: {
  artifact: ReportArtifact;
  allArtifacts: Record<string, AnalysisArtifact>;
  artifactRevisionsById: Record<string, ArtifactRevision[]>;
  sectionKeys?: string[];
}): {
  spec: ReportSpec;
  sourceArtifacts: Array<{ id: string; updatedAt: number }>;
  sectionBindings: ReportSectionBinding[];
} {
  const sourceArtifacts = getSourceArtifacts(args.artifact, args.allArtifacts);
  const sourceArtifactsById = Object.fromEntries(
    sourceArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const nextSectionBindings = buildSectionBindings(sourceArtifacts, args.artifactRevisionsById);
  const refreshAll = !args.sectionKeys || args.sectionKeys.length === 0;
  const sectionKeysToRefresh = new Set(args.sectionKeys ?? []);
  const nextSections = [...args.artifact.spec.sections];

  if (!args.artifact.sectionBindings.length || refreshAll) {
    const recommendations = args.artifact.spec.sections.filter(
      (section): section is Extract<ReportSection, { type: "recommendations" }> =>
        section.type === "recommendations",
    );
    const rebuiltSections: ReportSection[] = [
      { type: "title_page" },
      buildExecutiveSummarySection(sourceArtifacts),
      ...sourceArtifacts.map((sourceArtifact) =>
        sourceArtifact.kind === "chart"
          ? buildChartAnalysisSection(sourceArtifact)
          : buildQueryTableSection(sourceArtifact),
      ),
      ...recommendations,
    ];

    return {
      spec: {
        ...args.artifact.spec,
        date: new Date().toLocaleDateString(),
        sections: rebuiltSections,
      },
      sourceArtifacts: sourceArtifacts.map((sourceArtifact) => ({
        id: sourceArtifact.id,
        updatedAt: sourceArtifact.updatedAt,
      })),
      sectionBindings: nextSectionBindings,
    };
  }

  for (const binding of nextSectionBindings) {
    if (!sectionKeysToRefresh.has(binding.sectionKey)) continue;
    const sectionIndex = findSectionIndexByKey(args.artifact, binding.sectionKey);
    const rebuiltSection = buildSectionForBinding(binding, sourceArtifactsById);
    if (sectionIndex < 0 || !rebuiltSection) continue;
    nextSections[sectionIndex] = rebuiltSection;
  }

  return {
    spec: {
      ...args.artifact.spec,
      date: new Date().toLocaleDateString(),
      sections: nextSections,
    },
    sourceArtifacts: sourceArtifacts.map((sourceArtifact) => ({
      id: sourceArtifact.id,
      updatedAt: sourceArtifact.updatedAt,
    })),
    sectionBindings: nextSectionBindings.map((binding) =>
      sectionKeysToRefresh.has(binding.sectionKey)
        ? binding
        : args.artifact.sectionBindings.find((candidate) => candidate.sectionKey === binding.sectionKey) ?? binding,
    ),
  };
}

export function rebuildReportSpecFromArtifacts(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
): {
  spec: ReportSpec;
  sourceArtifacts: Array<{ id: string; updatedAt: number }>;
} {
  const sourceArtifacts = getSourceArtifacts(artifact, allArtifacts);
  const recommendations = artifact.spec.sections.filter(
    (section): section is Extract<ReportSection, { type: "recommendations" }> =>
      section.type === "recommendations",
  );
  const nextSections: ReportSection[] = [
    { type: "title_page" },
    buildExecutiveSummarySection(sourceArtifacts),
    ...sourceArtifacts.map((sourceArtifact) =>
      sourceArtifact.kind === "chart"
        ? buildChartAnalysisSection(sourceArtifact)
        : buildQueryTableSection(sourceArtifact),
    ),
    ...recommendations,
  ];

  return {
    spec: {
      ...artifact.spec,
      date: new Date().toLocaleDateString(),
      sections: nextSections,
    },
    sourceArtifacts: sourceArtifacts.map((sourceArtifact) => ({
      id: sourceArtifact.id,
      updatedAt: sourceArtifact.updatedAt,
    })),
  };
}

export function buildRefreshedReportArtifact(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
  artifactRevisionsById: Record<string, ArtifactRevision[]>,
  options?: { sectionKeys?: string[] },
): ReportArtifact {
  const rebuilt = rebuildReportSections({
    artifact,
    allArtifacts,
    artifactRevisionsById,
    sectionKeys: options?.sectionKeys,
  });

  return {
    ...artifact,
    updatedAt: Date.now(),
    sourceArtifactIds: rebuilt.sourceArtifacts.map((sourceArtifact) => sourceArtifact.id),
    sourceArtifactRevisionIds: Object.fromEntries(
      rebuilt.sourceArtifacts.map((sourceArtifact) => [
        sourceArtifact.id,
        getLatestArtifactRevisionId(artifactRevisionsById[sourceArtifact.id]),
      ]),
    ),
    sectionBindings: rebuilt.sectionBindings,
    spec: rebuilt.spec,
  };
}

export function getStaleReportSectionKeys(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
  artifactRevisionsById: Record<string, ArtifactRevision[]>,
): string[] {
  return getReportSectionStatuses(artifact, allArtifacts, artifactRevisionsById)
    .filter((status) => status.stale && !status.missing)
    .map((status) => status.sectionKey);
}

export function refreshDownstreamReportDrafts(args: {
  sourceArtifactId: string;
  artifacts: Record<string, AnalysisArtifact>;
  artifactRevisionsById: Record<string, ArtifactRevision[]>;
  updateArtifactDraft: (artifact: AnalysisArtifact) => void;
}): { refreshed: number; skippedMissing: number; skippedClean: number } {
  let refreshed = 0;
  let skippedMissing = 0;
  let skippedClean = 0;

  for (const artifact of Object.values(args.artifacts)) {
    if (artifact.kind !== "report" || !artifact.sourceArtifactIds.includes(args.sourceArtifactId)) {
      continue;
    }

    const health = evaluateArtifactHealth(artifact, args.artifacts, args.artifactRevisionsById);
    if (health.missingIds.length > 0) {
      skippedMissing += 1;
      continue;
    }

    const staleSectionKeys = getStaleReportSectionKeys(
      artifact,
      args.artifacts,
      args.artifactRevisionsById,
    );
    if (staleSectionKeys.length === 0) {
      skippedClean += 1;
      continue;
    }

    args.updateArtifactDraft(
      buildRefreshedReportArtifact(artifact, args.artifacts, args.artifactRevisionsById, {
        sectionKeys: staleSectionKeys,
      }),
    );
    refreshed += 1;
  }

  return { refreshed, skippedMissing, skippedClean };
}
