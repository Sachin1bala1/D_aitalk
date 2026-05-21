import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Database, FolderOpen, GitBranch, Link2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { GraphBuilder } from "../charts/GraphBuilder";
import { useWorkspaceStore, type ArtifactRevision, type ChartArtifact } from "../../lib/stores/WorkspaceStore";
import { getDownstreamArtifacts } from "../../lib/artifacts/artifactGraph";
import { refreshDownstreamReportDrafts } from "../../lib/artifacts/reportRefresh";
import { evaluateArtifactHealth } from "../../lib/artifacts/dependencyGraph";
import { ArtifactRevisionPanel, formatRevisionTimestamp } from "./ArtifactRevisionPanel";
import { describeArtifactDiff } from "../../lib/artifacts/artifactDiff";
import { ArtifactRevisionDetails } from "./ArtifactRevisionDetails";

const SUPPORTED_CHART_TYPES = new Set([
  "scatter",
  "line",
  "bar",
  "histogram",
  "box",
  "heatmap",
  "control_chart",
  "pareto",
  "area",
  "bubble",
]);

export function ArtifactChartViewer({ artifactId }: { artifactId: string }) {
  const artifact = useWorkspaceStore((state) => state.artifacts[artifactId] as ChartArtifact | undefined);
  const artifacts = useWorkspaceStore((state) => state.artifacts);
  const artifactRevisions = useWorkspaceStore((state) => state.artifactRevisions[artifactId] ?? []);
  const artifactHead = useWorkspaceStore((state) => state.artifactHeads[artifactId] ?? null);
  const createArtifactReportTab = useWorkspaceStore((state) => state.createArtifactReportTab);
  const createArtifactChartTab = useWorkspaceStore((state) => state.createArtifactChartTab);
  const updateArtifactDraft = useWorkspaceStore((state) => state.updateArtifactDraft);
  const saveCurrentArtifactDraftAsRevision = useWorkspaceStore((state) => state.saveCurrentArtifactDraftAsRevision);
  const discardArtifactDraftChanges = useWorkspaceStore((state) => state.discardArtifactDraftChanges);
  const restoreArtifactRevisionAsDraft = useWorkspaceStore((state) => state.restoreArtifactRevisionAsDraft);
  const duplicateArtifactFromRevision = useWorkspaceStore((state) => state.duplicateArtifactFromRevision);
  const [selectedRevision, setSelectedRevision] = useState<ArtifactRevision | null>(null);

  useEffect(() => {
    setSelectedRevision(null);
  }, [artifactId]);

  if (!artifact || artifact.kind !== "chart") {
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
  const displayedArtifact = (selectedRevision?.artifact.kind === "chart" && selectedRevision.artifact.id === artifact.id
    ? selectedRevision.artifact
    : artifact) as ChartArtifact;
  const compareDetails = useMemo(
    () =>
      selectedRevision?.artifact.kind === "chart"
        ? describeArtifactDiff(selectedRevision.artifact, artifact)
        : null,
    [artifact, selectedRevision],
  );

  const chartType = SUPPORTED_CHART_TYPES.has(displayedArtifact.chart.chartType)
    ? displayedArtifact.chart.chartType
    : "bar";

  const referenceLineY = displayedArtifact.chart.options.refLineValue
    ? {
        value: Number(displayedArtifact.chart.options.refLineValue),
        label: displayedArtifact.chart.options.refLineLabel || displayedArtifact.chart.options.refLineValue,
      }
    : null;

  const xAxisMin = displayedArtifact.chart.options.xAxisMin ? Number(displayedArtifact.chart.options.xAxisMin) : null;
  const xAxisMax = displayedArtifact.chart.options.xAxisMax ? Number(displayedArtifact.chart.options.xAxisMax) : null;
  const yAxisMin = displayedArtifact.chart.options.yAxisMin ? Number(displayedArtifact.chart.options.yAxisMin) : null;
  const yAxisMax = displayedArtifact.chart.options.yAxisMax ? Number(displayedArtifact.chart.options.yAxisMax) : null;

  const handleSaveRevision = () => {
    if (selectedRevision) return;
    saveCurrentArtifactDraftAsRevision(artifact.id);
    toast.success("Chart artifact revision saved");
  };

  const handleDiscardDraft = () => {
    if (selectedRevision) return;
    discardArtifactDraftChanges(artifact.id);
    toast.success("Chart artifact draft changes discarded");
  };

  const handleRestoreAsDraft = (revision: ArtifactRevision) => {
    restoreArtifactRevisionAsDraft(artifact.id, revision.id);
    setSelectedRevision(null);
    toast.success("Historical revision restored as chart draft");
  };

  const handleDuplicateRevision = (revision: ArtifactRevision) => {
    const duplicated = duplicateArtifactFromRevision(artifact.id, revision.id);
    if (!duplicated || duplicated.kind !== "chart") {
      toast.error("Could not duplicate this revision");
      return;
    }
    createArtifactChartTab({
      id: `artifact-chart-tab-${duplicated.id}-${Date.now()}`,
      artifactId: duplicated.id,
      title: duplicated.name,
      connectionId: duplicated.lineage.connectionId,
      sql: duplicated.lineage.sql,
      queryResults: null,
      isExecuting: false,
    });
    toast.success("Revision duplicated as a new chart artifact");
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
          <BarChart3 className="w-4 h-4 text-cyan-400/80" />
          <h2 className="text-sm font-semibold text-white/80">{displayedArtifact.name}</h2>
          <span className="rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-cyan-300/70">
            artifact
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[10px] font-mono text-white/30">
          <span>{displayedArtifact.snapshot.rowCount.toLocaleString()} rows</span>
          <span>{displayedArtifact.chart.chartType}</span>
          <span>updated {new Date(displayedArtifact.updatedAt).toLocaleString()}</span>
          <span>{artifactRevisions.length} revisions</span>
          {artifactHead?.hasUncommittedChanges && !selectedRevision && (
            <span className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 uppercase tracking-widest text-amber-300/70">
              draft changes
            </span>
          )}
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

      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <div className="h-full rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] overflow-hidden">
          <GraphBuilder
            data={displayedArtifact.snapshot.rows}
            xCol={displayedArtifact.chart.assignments.x}
            yCol={displayedArtifact.chart.assignments.y}
            colorCol={displayedArtifact.chart.assignments.color}
            sizeCol={displayedArtifact.chart.assignments.size}
            chartType={chartType as any}
            showDataPoints={displayedArtifact.chart.options.showDataPoints}
            showTrendLine={displayedArtifact.chart.options.showTrendLine}
            logScaleX={displayedArtifact.chart.options.logScaleX}
            logScaleY={displayedArtifact.chart.options.logScaleY}
            referenceLineY={referenceLineY}
            confidenceInterval={displayedArtifact.chart.options.confidenceInterval}
            xAxisMode={displayedArtifact.chart.options.xAxisMode}
            yAxisMode={displayedArtifact.chart.options.yAxisMode}
            xAxisMin={Number.isFinite(xAxisMin) ? xAxisMin : null}
            xAxisMax={Number.isFinite(xAxisMax) ? xAxisMax : null}
            yAxisMin={Number.isFinite(yAxisMin) ? yAxisMin : null}
            yAxisMax={Number.isFinite(yAxisMax) ? yAxisMax : null}
            xAxisLabel={displayedArtifact.chart.options.xAxisLabel || displayedArtifact.chart.assignments.x}
            yAxisLabel={displayedArtifact.chart.options.yAxisLabel || displayedArtifact.chart.assignments.y}
          />
        </div>
      </div>
    </div>
  );
}
