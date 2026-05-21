import type { AnalysisArtifact, ReportSectionBinding } from "../stores/WorkspaceStore";
import type { ReportSpec } from "../reports/ReportBuilder";

function buildInitialReportSectionBindings(args: {
  spec: ReportSpec;
  sourceArtifacts: Array<{ id: string; revisionId: string | null }>;
}): ReportSectionBinding[] {
  const bindings: ReportSectionBinding[] = [];
  const artifactBindings = args.sourceArtifacts;

  if (artifactBindings.length > 0) {
    bindings.push({
      sectionKey: "executive_summary",
      sectionType: "executive_summary",
      sourceArtifactIds: artifactBindings.map((artifact) => artifact.id),
      sourceArtifactRevisionIds: Object.fromEntries(
        artifactBindings.map((artifact) => [artifact.id, artifact.revisionId]),
      ),
    });
  }

  let sourceIndex = 0;
  for (const section of args.spec.sections) {
    if (section.type !== "analysis" && section.type !== "data_table") continue;
    const sourceArtifact = artifactBindings[sourceIndex];
    sourceIndex += 1;
    if (!sourceArtifact) continue;

    bindings.push({
      sectionKey: `artifact:${sourceArtifact.id}`,
      sectionType: section.type,
      sourceArtifactIds: [sourceArtifact.id],
      sourceArtifactRevisionIds: {
        [sourceArtifact.id]: sourceArtifact.revisionId,
      },
    });
  }

  return bindings;
}

export function createReportArtifact(args: {
  name: string;
  connectionName: string;
  spec: ReportSpec;
  sourceArtifacts?: Array<{ id: string; revisionId: string | null }>;
}): AnalysisArtifact {
  const now = Date.now();
  const sourceArtifacts = args.sourceArtifacts ?? [];
  return {
    id: `artifact-report-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "report",
    name: args.name,
    createdAt: now,
    updatedAt: now,
    connectionName: args.connectionName,
    sourceArtifactIds: sourceArtifacts.map((artifact) => artifact.id),
    sourceArtifactRevisionIds: Object.fromEntries(
      sourceArtifacts.map((artifact) => [artifact.id, artifact.revisionId]),
    ),
    sectionBindings: buildInitialReportSectionBindings({
      spec: args.spec,
      sourceArtifacts,
    }),
    spec: args.spec,
  };
}
