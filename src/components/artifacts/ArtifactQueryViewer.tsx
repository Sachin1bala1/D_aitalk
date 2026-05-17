import React, { useEffect, useMemo, useState } from "react";
import { Database, FolderOpen, GitBranch, Link2, RotateCcw, Rows3, Save } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore, type ArtifactRevision, type QueryArtifact } from "../../lib/stores/WorkspaceStore";
import { getDownstreamArtifacts } from "../../lib/artifacts/artifactGraph";
import { refreshDownstreamReportDrafts } from "../../lib/artifacts/reportRefresh";
import { evaluateArtifactHealth } from "../../lib/artifacts/dependencyGraph";
import { ArtifactRevisionPanel, formatRevisionTimestamp } from "./ArtifactRevisionPanel";
import { describeArtifactDiff } from "../../lib/artifacts/artifactDiff";
import { ArtifactRevisionDetails } from "./ArtifactRevisionDetails";

export function ArtifactQueryViewer({ artifactId }: { artifactId: string }) {
  const artifact = useWorkspaceStore((state) => state.artifacts[artifactId] as QueryArtifact | undefined);
  const artifacts = useWorkspaceStore((state) => state.artifacts);
  const artifactRevisions = useWorkspaceStore((state) => state.artifactRevisions[artifactId] ?? []);
  const artifactHead = useWorkspaceStore((state) => state.artifactHeads[artifactId] ?? null);
  const createArtifactReportTab = useWorkspaceStore((state) => state.createArtifactReportTab);
  const createArtifactQueryTab = useWorkspaceStore((state) => state.createArtifactQueryTab);
  const updateArtifactDraft = useWorkspaceStore((state) => state.updateArtifactDraft);
  const saveCurrentArtifactDraftAsRevision = useWorkspaceStore((state) => state.saveCurrentArtifactDraftAsRevision);
  const discardArtifactDraftChanges = useWorkspaceStore((state) => state.discardArtifactDraftChanges);
  const restoreArtifactRevisionAsDraft = useWorkspaceStore((state) => state.restoreArtifactRevisionAsDraft);
  const duplicateArtifactFromRevision = useWorkspaceStore((state) => state.duplicateArtifactFromRevision);
  const [selectedRevision, setSelectedRevision] = useState<ArtifactRevision | null>(null);

  useEffect(() => {
    setSelectedRevision(null);
  }, [artifactId]);

  if (!artifact || artifact.kind !== "query") {
    return (
      <div className="flex items-center justify-center h-full text-white/20 text-sm">
        Artifact not found
      </div>
    );
  }

  const downstreamArtifacts = getDownstreamArtifacts(artifact.id, artifacts);
  const downstreamReports = downstreamArtifacts.filter((downstream) => downstream.kind === "report");
  const staleDownstreamReports = downstreamReports.filter((downstream) =>
    evaluateArtifactHealth(downstream, artifacts, useWorkspaceStore.getState().artifactRevisions).staleIds.includes(artifact.id),
  );
  const displayedArtifact = (selectedRevision?.artifact.kind === "query" && selectedRevision.artifact.id === artifact.id
    ? selectedRevision.artifact
    : artifact) as QueryArtifact;
  const compareDetails = useMemo(
    () =>
      selectedRevision?.artifact.kind === "query"
        ? describeArtifactDiff(selectedRevision.artifact, artifact)
        : null,
    [artifact, selectedRevision],
  );

  const handleSaveRevision = () => {
    if (selectedRevision) return;
    saveCurrentArtifactDraftAsRevision(artifact.id);
    toast.success("Query artifact revision saved");
  };

  const handleDiscardDraft = () => {
    if (selectedRevision) return;
    discardArtifactDraftChanges(artifact.id);
    toast.success("Query artifact draft changes discarded");
  };

  const handleRestoreAsDraft = (revision: ArtifactRevision) => {
    restoreArtifactRevisionAsDraft(artifact.id, revision.id);
    setSelectedRevision(null);
    toast.success("Historical revision restored as draft");
  };

  const handleDuplicateRevision = (revision: ArtifactRevision) => {
    const duplicated = duplicateArtifactFromRevision(artifact.id, revision.id);
    if (!duplicated || duplicated.kind !== "query") {
      toast.error("Could not duplicate this revision");
      return;
    }
    createArtifactQueryTab({
      id: `artifact-query-tab-${duplicated.id}-${Date.now()}`,
      artifactId: duplicated.id,
      title: duplicated.name,
      connectionId: duplicated.lineage.connectionId,
      sql: duplicated.lineage.sql,
      queryResults: null,
      isExecuting: false,
    });
    toast.success("Revision duplicated as a new query artifact");
  };

  const openDownstreamReports = () => {
    downstreamReports.forEach((downstream) =>
      createArtifactReportTab({
        id: `artifact-report-tab-${downstream.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        artifactId: downstream.id,
        title: downstream.name,
        connectionId: null,
        sql: "",
        queryResults: null,
        isExecuting: false,
      }),
    );
    toast.success(
      downstreamReports.length === 1 ? "Opened downstream report" : `Opened ${downstreamReports.length} downstream reports`,
    );
  };

  const refreshStaleDownstreamReports = () => {
    const result = refreshDownstreamReportDrafts({
      sourceArtifactId: artifact.id,
      artifacts,
      artifactRevisionsById: useWorkspaceStore.getState().artifactRevisions,
      updateArtifactDraft,
    });
    if (result.refreshed === 0) {
      toast.info("No stale downstream reports needed refresh");
      return;
    }
    toast.success(
      `Refreshed ${result.refreshed} downstream report draft${result.refreshed === 1 ? "" : "s"}`,
      {
        description:
          result.skippedMissing > 0
            ? `${result.skippedMissing} report(s) skipped because linked artifacts are missing.`
            : undefined,
      },
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="border-b border-[#1a1a1a] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Rows3 className="w-4 h-4 text-emerald-400/80" />
          <h2 className="text-sm font-semibold text-white/80">{displayedArtifact.name}</h2>
          <span className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-emerald-300/70">
            query artifact
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[10px] font-mono text-white/30">
          <span>{displayedArtifact.snapshot.rowCount.toLocaleString()} rows</span>
          <span>{displayedArtifact.snapshot.fields.length} columns</span>
          <span>updated {new Date(displayedArtifact.updatedAt).toLocaleString()}</span>
          <span>{artifactRevisions.length} revisions</span>
        </div>
        {selectedRevision && (
          <div className="mt-2 rounded border border-[#00d2ff]/20 bg-[#00d2ff]/5 px-2.5 py-2 text-[10px] font-mono text-[#7fe7ff]">
            Viewing historical revision from {formatRevisionTimestamp(selectedRevision.recordedAt)}
          </div>
        )}
        {!selectedRevision && artifactHead?.hasUncommittedChanges && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleSaveRevision}
              className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-cyan-300/70 hover:text-cyan-200"
            >
              <Save className="w-3 h-3" />
              Save Revision
            </button>
            <button
              onClick={handleDiscardDraft}
              className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80"
            >
              <RotateCcw className="w-3 h-3" />
              Discard Draft
            </button>
          </div>
        )}
        {compareDetails && (
          <ArtifactRevisionDetails
            details={compareDetails}
            previousLabel="Selected Revision"
            currentLabel="Current"
          />
        )}
        <div className="mt-2 grid gap-1 text-[10px] text-white/28">
          <div className="flex items-start gap-1.5">
            <Database className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="font-mono break-all">{displayedArtifact.lineage.sql.trim()}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <Link2 className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="font-mono break-all">
              {displayedArtifact.lineage.sourceTables.join(", ") || "No source tables recorded"}
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-[10px] text-white/35">
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3 h-3 shrink-0" />
            <span className="font-mono uppercase tracking-widest">Used By</span>
          </div>
          {downstreamArtifacts.length === 0 ? (
            <span className="font-mono text-white/20">No downstream artifacts yet</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {downstreamReports.length > 0 && (
                <>
                  <button
                    onClick={openDownstreamReports}
                    className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-cyan-300/70 hover:text-cyan-200"
                  >
                    <FolderOpen className="w-3 h-3" />
                    Open Reports
                  </button>
                  <button
                    onClick={refreshStaleDownstreamReports}
                    disabled={staleDownstreamReports.length === 0}
                    className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Refresh Stale Reports
                  </button>
                </>
              )}
              {downstreamArtifacts.map((downstream) => (
                <button
                  key={downstream.id}
                  onClick={() =>
                    createArtifactReportTab({
                      id: `artifact-report-tab-${downstream.id}-${Date.now()}`,
                      artifactId: downstream.id,
                      title: downstream.name,
                      connectionId: null,
                      sql: "",
                      queryResults: null,
                      isExecuting: false,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80"
                >
                  <FolderOpen className="w-3 h-3" />
                  {downstream.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ArtifactRevisionPanel
          revisions={artifactRevisions}
          selectedRevision={selectedRevision}
          selectedRecordedAt={selectedRevision?.recordedAt ?? null}
          onSelectRevision={setSelectedRevision}
          onClearSelection={() => setSelectedRevision(null)}
          hasUncommittedChanges={artifactHead?.hasUncommittedChanges && !selectedRevision}
          onRestoreAsDraft={handleRestoreAsDraft}
          onDuplicateRevision={handleDuplicateRevision}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="min-w-full text-[11px] font-mono">
          <thead className="sticky top-0 bg-[#0d0d0d] z-10">
            <tr className="border-b border-[#1a1a1a]">
              {displayedArtifact.snapshot.fields.map((field) => (
                <th
                  key={field.name}
                  className="px-3 py-2 text-left text-white/45 font-semibold whitespace-nowrap"
                >
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedArtifact.snapshot.rows.map((row, rowIndex) => (
              <tr key={`artifact-row-${rowIndex}`} className="border-b border-[#121212]">
                {displayedArtifact.snapshot.fields.map((field) => (
                  <td
                    key={`${rowIndex}-${field.name}`}
                    className="px-3 py-2 text-white/70 align-top max-w-[260px] truncate"
                    title={row[field.name] == null ? "" : String(row[field.name])}
                  >
                    {row[field.name] == null ? (
                      <span className="text-white/20">null</span>
                    ) : typeof row[field.name] === "object" ? (
                      JSON.stringify(row[field.name])
                    ) : (
                      String(row[field.name])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
