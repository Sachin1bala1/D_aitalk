import { buildDashboardSnapshot } from "../dashboard/dashboardState";
import type { AnalysisArtifact, ArtifactLineage, QueryResults } from "../stores/WorkspaceStore";

export function createQueryArtifact(args: {
  name: string;
  results: QueryResults;
  sql: string;
  connectionId: string | null;
  sourceTabId: string | null;
}): AnalysisArtifact {
  const now = Date.now();
  const artifactId = `artifact-query-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const lineage: ArtifactLineage = {
    connectionId: args.connectionId,
    sql: args.sql,
    queryId: args.results.queryId,
    sourceTables: args.results.source_tables,
    sourceTabId: args.sourceTabId,
  };

  return {
    id: artifactId,
    kind: "query",
    name: args.name,
    createdAt: now,
    updatedAt: now,
    lineage,
    snapshot: buildDashboardSnapshot(args.results, args.sql, args.connectionId, args.name),
  };
}
