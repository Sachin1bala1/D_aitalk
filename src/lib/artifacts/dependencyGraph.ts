import {
  getLatestArtifactRevisionId,
  type AnalysisArtifact,
  type ArtifactRevision,
  type ReportArtifact,
} from "../stores/WorkspaceStore";

export type ArtifactHealthStatus = "fresh" | "stale" | "missing";

export interface ArtifactHealth {
  status: ArtifactHealthStatus;
  staleIds: string[];
  missingIds: string[];
}

export function evaluateArtifactHealth(
  artifact: AnalysisArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
  allArtifactRevisions: Record<string, ArtifactRevision[]> = {},
): ArtifactHealth {
  if (artifact.kind !== "report") {
    return { status: "fresh", staleIds: [], missingIds: [] };
  }

  return evaluateReportHealth(artifact, allArtifacts, allArtifactRevisions);
}

function evaluateReportHealth(
  artifact: ReportArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
  allArtifactRevisions: Record<string, ArtifactRevision[]>,
): ArtifactHealth {
  const staleIds: string[] = [];
  const missingIds: string[] = [];

  for (const artifactId of artifact.sourceArtifactIds) {
    const current = allArtifacts[artifactId];
    const baselineRevisionId = artifact.sourceArtifactRevisionIds[artifactId];

    if (!current) {
      missingIds.push(artifactId);
      continue;
    }

    const currentRevisionId = getLatestArtifactRevisionId(allArtifactRevisions[artifactId]);
    if (baselineRevisionId && currentRevisionId && currentRevisionId !== baselineRevisionId) {
      staleIds.push(artifactId);
    }
  }

  if (missingIds.length > 0) {
    return { status: "missing", staleIds, missingIds };
  }

  if (staleIds.length > 0) {
    return { status: "stale", staleIds, missingIds };
  }

  return { status: "fresh", staleIds, missingIds };
}
