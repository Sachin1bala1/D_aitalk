import React, { useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, Link2, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { ReportPreview } from "../reports/ReportPreview";
import {
  useWorkspaceStore,
  type ArtifactRevision,
  type ReportArtifact,
} from "../../lib/stores/WorkspaceStore";
import { evaluateArtifactHealth } from "../../lib/artifacts/dependencyGraph";
import {
  buildRefreshedReportArtifact,
  getReportSectionStatuses,
  getStaleReportSectionKeys,
} from "../../lib/artifacts/reportRefresh";
import { getUpstreamArtifacts } from "../../lib/artifacts/artifactGraph";
import { ArtifactRevisionPanel, formatRevisionTimestamp } from "./ArtifactRevisionPanel";
import { describeArtifactDiff } from "../../lib/artifacts/artifactDiff";
import { ArtifactRevisionDetails } from "./ArtifactRevisionDetails";
import { DataChangeReviewDialog } from "../review/DataChangeReviewDialog";
import { buildReportRefreshReview, type ReviewDossier } from "../../lib/review/DataChangeReviewEngine";

export function ArtifactReportViewer({ artifactId }: { artifactId: string }) {
  const artifact = useWorkspaceStore((state) => state.artifacts[artifactId] as ReportArtifact | undefined);
  const artifacts = useWorkspaceStore((state) => state.artifacts);
  const artifactRevisionsById = useWorkspaceStore((state) => state.artifactRevisions);
  const artifactHead = useWorkspaceStore((state) => state.artifactHeads[artifactId] ?? null);
  const createArtifactChartTab = useWorkspaceStore((state) => state.createArtifactChartTab);
  const createArtifactQueryTab = useWorkspaceStore((state) => state.createArtifactQueryTab);
  const createArtifactReportTab = useWorkspaceStore((state) => state.createArtifactReportTab);
  const updateArtifactDraft = useWorkspaceStore((state) => state.updateArtifactDraft);
  const commitArtifactRevision = useWorkspaceStore((state) => state.commitArtifactRevision);
  const discardArtifactDraftChanges = useWorkspaceStore((state) => state.discardArtifactDraftChanges);
  const restoreArtifactRevisionAsDraft = useWorkspaceStore((state) => state.restoreArtifactRevisionAsDraft);
  const duplicateArtifactFromRevision = useWorkspaceStore((state) => state.duplicateArtifactFromRevision);
  const artifactRevisions = useWorkspaceStore((state) => state.artifactRevisions[artifactId] ?? []);
  const [selectedRevision, setSelectedRevision] = useState<ArtifactRevision | null>(null);
  const [pendingRefreshReview, setPendingRefreshReview] = useState<{
    mode: "stale" | "all";
    dossier: ReviewDossier;
  } | null>(null);

  useEffect(() => {
    setSelectedRevision(null);
  }, [artifactId]);

  if (!artifact || artifact.kind !== "report") {
    return (
      <div className="flex items-center justify-center h-full text-white/20 text-sm">
        Artifact not found
      </div>
    );
  }

  const displayedArtifact = (selectedRevision?.artifact.kind === "report" && selectedRevision.artifact.id === artifact.id
    ? selectedRevision.artifact
    : artifact) as ReportArtifact;
  const health = evaluateArtifactHealth(artifact, artifacts, artifactRevisionsById);
  const upstreamArtifacts = getUpstreamArtifacts(artifact, artifacts);
  const compareDetails = useMemo(
    () =>
      selectedRevision?.artifact.kind === "report"
        ? describeArtifactDiff(selectedRevision.artifact, artifact)
        : null,
    [artifact, selectedRevision],
  );
  const sectionStatuses = useMemo(
    () => getReportSectionStatuses(artifact, artifacts, artifactRevisionsById),
    [artifact, artifacts, artifactRevisionsById],
  );
  const staleSections = sectionStatuses.filter((status) => status.stale && !status.missing);
  const missingSections = sectionStatuses.filter((status) => status.missing);
  const healthTone =
    health.status === "fresh"
      ? "text-emerald-300/70 border-emerald-500/20 bg-emerald-500/5"
      : health.status === "stale"
        ? "text-amber-300/70 border-amber-500/20 bg-amber-500/5"
        : "text-red-300/70 border-red-500/20 bg-red-500/5";

  const openSourceArtifact = (sourceArtifactId: string) => {
    const sourceArtifact = artifacts[sourceArtifactId];
    if (!sourceArtifact) return;

    if (sourceArtifact.kind === "chart") {
      createArtifactChartTab({
        id: `artifact-chart-tab-${sourceArtifact.id}-${Date.now()}`,
        artifactId: sourceArtifact.id,
        title: sourceArtifact.name,
        connectionId: sourceArtifact.lineage.connectionId,
        sql: sourceArtifact.lineage.sql,
        queryResults: null,
        isExecuting: false,
      });
      return;
    }

    if (sourceArtifact.kind === "query") {
      createArtifactQueryTab({
        id: `artifact-query-tab-${sourceArtifact.id}-${Date.now()}`,
        artifactId: sourceArtifact.id,
        title: sourceArtifact.name,
        connectionId: sourceArtifact.lineage.connectionId,
        sql: sourceArtifact.lineage.sql,
        queryResults: null,
        isExecuting: false,
      });
      return;
    }

    createArtifactReportTab({
      id: `artifact-report-tab-${sourceArtifact.id}-${Date.now()}`,
      artifactId: sourceArtifact.id,
      title: sourceArtifact.name,
      connectionId: null,
      sql: "",
      queryResults: null,
      isExecuting: false,
    });
  };

  const startRefreshReview = (mode: "stale" | "all") => {
    if (selectedRevision) {
      toast.error("Switch back to the current revision before refreshing this report.");
      return;
    }
    if (artifactHead?.hasUncommittedChanges) {
      toast.error("Save or discard the current report draft before refreshing again.");
      return;
    }
    if (health.missingIds.length > 0) {
      toast.error("Cannot refresh this report while linked artifacts are missing.");
      return;
    }

    const staleSectionKeys =
      mode === "stale" ? getStaleReportSectionKeys(artifact, artifacts, artifactRevisionsById) : [];
    if (mode === "stale" && staleSectionKeys.length === 0) {
      toast.info("No stale report sections need refreshing.");
      return;
    }

    setPendingRefreshReview({
      mode,
      dossier: buildReportRefreshReview(artifact, artifacts, artifactRevisionsById, mode),
    });
  };

  const confirmRefresh = (mode: "stale" | "all") => {
    const staleSectionKeys =
      mode === "stale" ? getStaleReportSectionKeys(artifact, artifacts, artifactRevisionsById) : [];

    const refreshedArtifact = buildRefreshedReportArtifact(
      artifact,
      artifacts,
      artifactRevisionsById,
      mode === "stale" ? { sectionKeys: staleSectionKeys } : undefined,
    );
    updateArtifactDraft(refreshedArtifact);
    setPendingRefreshReview(null);
    toast.success(
      mode === "stale"
        ? `Refreshed ${staleSectionKeys.length} stale report section${staleSectionKeys.length === 1 ? "" : "s"}`
        : "Report draft refreshed from linked artifacts",
    );
  };

  const handleSaveRevision = () => {
    if (selectedRevision) {
      toast.error("Switch back to the current revision before saving this report.");
      return;
    }
    commitArtifactRevision({
      ...artifact,
      updatedAt: Date.now(),
    });
    toast.success("Report revision saved");
  };

  const handleDiscardDraft = () => {
    if (selectedRevision) {
      toast.error("Switch back to the current revision before discarding draft changes.");
      return;
    }
    discardArtifactDraftChanges(artifact.id);
    toast.success("Report draft changes discarded");
  };

  const handleRestoreAsDraft = (revision: ArtifactRevision) => {
    restoreArtifactRevisionAsDraft(artifact.id, revision.id);
    setSelectedRevision(null);
    toast.success("Historical report revision restored as draft");
  };

  const handleDuplicateRevision = (revision: ArtifactRevision) => {
    const duplicated = duplicateArtifactFromRevision(artifact.id, revision.id);
    if (!duplicated || duplicated.kind !== "report") {
      toast.error("Could not duplicate this revision");
      return;
    }
    createArtifactReportTab({
      id: `artifact-report-tab-${duplicated.id}-${Date.now()}`,
      artifactId: duplicated.id,
      title: duplicated.name,
      connectionId: null,
      sql: "",
      queryResults: null,
      isExecuting: false,
    });
    toast.success("Revision duplicated as a new report artifact");
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="border-b border-[#1a1a1a] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-400/80" />
          <h2 className="text-sm font-semibold text-white/80">{displayedArtifact.name}</h2>
          <span className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-amber-300/70">
            report artifact
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[10px] font-mono text-white/30">
          <span>{displayedArtifact.connectionName}</span>
          <span>{displayedArtifact.spec.sections.length} sections</span>
          <span>{artifact.sectionBindings.length} bound refreshable sections</span>
          <span>updated {new Date(displayedArtifact.updatedAt).toLocaleString()}</span>
          <span>{artifactRevisions.length} revisions</span>
          {artifactHead?.hasUncommittedChanges && !selectedRevision && (
            <span className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 uppercase tracking-widest text-amber-300/70">
              draft changes
            </span>
          )}
          <span className={`rounded border px-2 py-0.5 uppercase tracking-widest ${healthTone}`}>
            {health.status}
          </span>
        </div>
        {selectedRevision && (
          <div className="mt-2 rounded border border-[#00d2ff]/20 bg-[#00d2ff]/5 px-2.5 py-2 text-[10px] font-mono text-[#7fe7ff]">
            Viewing historical revision from {formatRevisionTimestamp(selectedRevision.recordedAt)}
          </div>
        )}
        {compareDetails && (
          <ArtifactRevisionDetails
            details={compareDetails}
            previousLabel="Selected Revision"
            currentLabel="Current"
          />
        )}
        <div className="mt-2 flex items-start gap-1.5 text-[10px] text-white/28">
          <Link2 className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="font-mono break-all">
            {displayedArtifact.sourceArtifactIds.length > 0
              ? displayedArtifact.sourceArtifactIds.join(", ")
              : "No source artifacts linked yet"}
          </span>
        </div>
        {!selectedRevision && health.status !== "fresh" && (
          <div className="mt-2 text-[10px] font-mono text-amber-300/70">
            {health.missingIds.length > 0
              ? `${health.missingIds.length} linked artifact(s) are missing.`
              : `${health.staleIds.length} linked artifact(s) changed after this report was saved.`}
          </div>
        )}
        {!selectedRevision && sectionStatuses.length > 0 && (
          <div className="mt-2 text-[10px] font-mono text-white/35">
            <span>{staleSections.length} stale section(s)</span>
            <span className="mx-2 text-white/20">•</span>
            <span>{missingSections.length} missing section binding(s)</span>
          </div>
        )}
        {!selectedRevision && artifact.sourceArtifactIds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => startRefreshReview("stale")}
              disabled={health.missingIds.length > 0 || staleSections.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh Stale Sections
            </button>
            <button
              onClick={() => startRefreshReview("all")}
              disabled={health.missingIds.length > 0}
              className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh All Sections
            </button>
            {artifactHead?.hasUncommittedChanges && (
              <>
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
              </>
            )}
            {artifact.sourceArtifactIds.map((sourceArtifactId) => {
              const sourceArtifact = artifacts[sourceArtifactId];
              return (
                <button
                  key={sourceArtifactId}
                  onClick={() => openSourceArtifact(sourceArtifactId)}
                  disabled={!sourceArtifact}
                  className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55 hover:text-white/80 disabled:opacity-40"
                >
                  <FolderOpen className="w-3 h-3" />
                  {sourceArtifact?.name ?? sourceArtifactId}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-1.5 text-[10px] text-white/35">
          <div className="flex items-center gap-1.5">
            <Link2 className="w-3 h-3 shrink-0" />
            <span className="font-mono uppercase tracking-widest">Upstream</span>
          </div>
          {upstreamArtifacts.length === 0 ? (
            <span className="font-mono text-white/20">No linked upstream artifacts</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {upstreamArtifacts.map((sourceArtifact) => (
                <span
                  key={sourceArtifact.id}
                  className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono text-white/55"
                >
                  <FolderOpen className="w-3 h-3" />
                  {sourceArtifact.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {!selectedRevision && sectionStatuses.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 text-[10px] text-white/35">
            <div className="font-mono uppercase tracking-widest text-white/30">Section Bindings</div>
            <div className="flex flex-col gap-1">
              {sectionStatuses.map((status) => (
                <div
                  key={status.sectionKey}
                  className="rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2 py-1.5 font-mono text-white/45"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{status.sectionKey}</span>
                    <span className="text-white/25">{status.sectionType}</span>
                    {status.missing ? (
                      <span className="text-red-300/70">missing</span>
                    ) : status.stale ? (
                      <span className="text-amber-300/70">stale</span>
                    ) : (
                      <span className="text-emerald-300/70">fresh</span>
                    )}
                  </div>
                  <div className="mt-1 break-all text-white/25">
                    {status.sourceArtifactIds.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
        <DataChangeReviewDialog
          open={!!pendingRefreshReview}
          dossier={pendingRefreshReview?.dossier ?? null}
          title="Report Refresh Review"
          approveLabel="Apply Refresh"
          onApprove={() => pendingRefreshReview && confirmRefresh(pendingRefreshReview.mode)}
          onCancel={() => setPendingRefreshReview(null)}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        <ReportPreview spec={displayedArtifact.spec} />
      </div>
    </div>
  );
}
