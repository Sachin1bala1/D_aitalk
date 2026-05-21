import type { AnalysisArtifact } from "../stores/WorkspaceStore";

export function getUpstreamArtifacts(
  artifact: AnalysisArtifact,
  allArtifacts: Record<string, AnalysisArtifact>,
): AnalysisArtifact[] {
  if (artifact.kind === "report") {
    return artifact.sourceArtifactIds
      .map((artifactId) => allArtifacts[artifactId])
      .filter((candidate): candidate is AnalysisArtifact => !!candidate);
  }

  return [];
}

export function getDownstreamArtifacts(
  artifactId: string,
  allArtifacts: Record<string, AnalysisArtifact>,
): AnalysisArtifact[] {
  return Object.values(allArtifacts).filter((artifact) => {
    if (artifact.kind !== "report") return false;
    return artifact.sourceArtifactIds.includes(artifactId);
  });
}
