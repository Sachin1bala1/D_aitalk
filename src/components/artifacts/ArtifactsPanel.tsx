import React, { useMemo } from "react";
import { BarChart3, Clock3, FolderOpen, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { evaluateArtifactHealth } from "../../lib/artifacts/dependencyGraph";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ArtifactsPanel() {
  const {
    artifacts,
    artifactRevisions,
    artifactHeads,
    createArtifactChartTab,
    createArtifactQueryTab,
    createArtifactReportTab,
    removeArtifact,
  } = useWorkspaceStore();

  const orderedArtifacts = useMemo(
    () => Object.values(artifacts).sort((a, b) => b.updatedAt - a.updatedAt),
    [artifacts],
  );

  const badgeClass = (status: "fresh" | "stale" | "missing") =>
    status === "fresh"
      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300/70"
      : status === "stale"
        ? "border-amber-500/20 bg-amber-500/5 text-amber-300/70"
        : "border-red-500/20 bg-red-500/5 text-red-300/70";

  if (orderedArtifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/10 gap-2">
        <BarChart3 className="w-8 h-8" />
        <p className="text-xs uppercase tracking-widest">No artifacts yet</p>
        <p className="text-[10px] text-white/15 font-mono">
          AI-created charts will appear here with saved lineage.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-white/20">
          {orderedArtifacts.length} saved artifact{orderedArtifacts.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#1a1a1a]">
        {orderedArtifacts.map((artifact) => {
          const health = evaluateArtifactHealth(artifact, artifacts, artifactRevisions);
          const openArtifact = () => {
            if (artifact.kind === "chart") {
              createArtifactChartTab({
                id: `artifact-chart-tab-${artifact.id}-${Date.now()}`,
                artifactId: artifact.id,
                title: artifact.name,
                connectionId: artifact.lineage.connectionId,
                sql: artifact.lineage.sql,
                queryResults: null,
                isExecuting: false,
              });
              toast.success("Chart artifact opened in a tab");
              return;
            }

            if (artifact.kind === "query") {
              createArtifactQueryTab({
                id: `artifact-query-tab-${artifact.id}-${Date.now()}`,
                artifactId: artifact.id,
                title: artifact.name,
                connectionId: artifact.lineage.connectionId,
                sql: artifact.lineage.sql,
                queryResults: null,
                isExecuting: false,
              });
              toast.success("Query artifact opened in a tab");
              return;
            }

            createArtifactReportTab({
              id: `artifact-report-tab-${artifact.id}-${Date.now()}`,
              artifactId: artifact.id,
              title: artifact.name,
              connectionId: null,
              sql: "",
              queryResults: null,
              isExecuting: false,
            });
            toast.success("Report artifact opened in a tab");
          };

          return (
            <div key={artifact.id} className="px-3 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5 text-cyan-400/70 shrink-0" />
                    <span className="text-[11px] font-medium text-white/75 truncate">
                      {artifact.name}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[9px] font-mono text-white/25">
                    <span className="uppercase tracking-widest">{artifact.kind}</span>
                    <span className={`rounded border px-1.5 py-0.5 uppercase tracking-widest ${badgeClass(health.status)}`}>
                      {health.status}
                    </span>
                    {artifactHeads[artifact.id]?.hasUncommittedChanges && (
                      <span className="rounded border border-amber-500/20 bg-amber-500/5 px-1.5 py-0.5 uppercase tracking-widest text-amber-300/70">
                        draft
                      </span>
                    )}
                    <span>
                      {artifact.kind === "chart"
                        ? artifact.chart.chartType
                        : artifact.kind === "query"
                          ? "snapshot"
                          : "report"}
                    </span>
                    <span>
                      {artifact.kind === "report"
                        ? `${artifact.spec.sections.length} sections`
                        : `${artifact.snapshot.rowCount.toLocaleString()} rows`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={openArtifact}
                    className="p-1.5 text-white/25 hover:text-cyan-300 transition-colors"
                    title="Open artifact"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      removeArtifact(artifact.id);
                      toast.success("Artifact removed");
                    }}
                    className="p-1.5 text-white/20 hover:text-red-400/70 transition-colors"
                    title="Remove artifact"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-white/35">
                <div className="flex items-center gap-1.5">
                  <Clock3 className="w-3 h-3 shrink-0" />
                  <span className="font-mono">Updated {formatTimestamp(artifact.updatedAt)}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Link2 className="w-3 h-3 shrink-0 mt-0.5" />
                  <span className="font-mono break-all">
                    {artifact.kind === "report"
                      ? artifact.sourceArtifactIds.join(", ") || "No source artifacts linked yet"
                      : artifact.lineage.sourceTables.join(", ") || "No source tables recorded"}
                  </span>
                </div>
                <div className="text-[9px] font-mono text-white/20 line-clamp-2">
                  {artifact.kind === "report"
                    ? artifact.spec.title
                    : artifact.lineage.sql.trim()}
                </div>
                {artifact.kind === "report" && (health.staleIds.length > 0 || health.missingIds.length > 0) && (
                  <div className="text-[9px] font-mono text-amber-300/70">
                    {health.missingIds.length > 0
                      ? `${health.missingIds.length} linked artifact(s) missing`
                      : `${health.staleIds.length} linked artifact(s) updated since this report was saved`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
