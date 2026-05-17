import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FolderOpen, Play, RefreshCw, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import {
  deletePipelineDefinition,
  ensurePipelinesLoaded,
  getPipelineRuns,
  inspectPipelines,
  runPipelineDefinition,
  subscribePipelines,
  type PipelineDefinition,
  type PipelineRunRecord,
} from "../../lib/pipelines/PipelineStore";

type PipelineWithMeta = PipelineDefinition & {
  runCount: number;
  latestRun: PipelineRunRecord | null;
};

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PipelinePanel() {
  const { connections, createArtifactQueryTab } = useWorkspaceStore();
  const [pipelines, setPipelines] = useState<PipelineWithMeta[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [runningPipelineId, setRunningPipelineId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      await ensurePipelinesLoaded();
      const next = inspectPipelines().pipelines;
      setPipelines(next);
      setSelectedPipelineId((current) => current ?? next[0]?.id ?? null);
    };

    void refresh();
    return subscribePipelines(() => {
      void refresh();
    });
  }, []);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? pipelines[0] ?? null,
    [pipelines, selectedPipelineId],
  );

  const selectedRuns = useMemo(
    () => (selectedPipeline ? getPipelineRuns(selectedPipeline.id) : []),
    [selectedPipeline, pipelines],
  );

  const connectionName = (connectionId: string) =>
    connections.find((connection) => connection.id === connectionId)?.display_name ?? connectionId;

  const openLatestOutput = () => {
    if (!selectedPipeline?.lastRunArtifactId) {
      toast.error("No output artifact available yet");
      return;
    }

    createArtifactQueryTab({
      id: `artifact-query-tab-${selectedPipeline.lastRunArtifactId}-${Date.now()}`,
      artifactId: selectedPipeline.lastRunArtifactId,
      title: `${selectedPipeline.name} output`,
      connectionId: selectedPipeline.sourceConnectionId,
      sql: selectedPipeline.sourceQuery,
      queryResults: null,
      isExecuting: false,
    });
    toast.success("Pipeline output opened");
  };

  const runSelectedPipeline = async () => {
    if (!selectedPipeline) return;
    setRunningPipelineId(selectedPipeline.id);
    try {
      const run = await runPipelineDefinition(selectedPipeline.id);
      toast.success("Pipeline run completed", {
        description: `${run.rowCount ?? 0} row${run.rowCount === 1 ? "" : "s"} written to ${run.targetTable}.`,
      });
    } catch (error: any) {
      toast.error("Pipeline run failed", {
        description: error?.message ?? "Unable to complete pipeline run.",
      });
    } finally {
      setRunningPipelineId(null);
    }
  };

  const deleteSelectedPipeline = async () => {
    if (!selectedPipeline) return;
    await deletePipelineDefinition(selectedPipeline.id);
    toast.success("Pipeline deleted");
  };

  if (pipelines.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/10">
        <Workflow className="h-8 w-8" />
        <p className="text-xs uppercase tracking-widest">No pipelines yet</p>
        <p className="text-[10px] text-white/15 font-mono">
          AI-created pipelines and manual runs will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-44 shrink-0 border-r border-[#1a1a1a] overflow-y-auto">
        {pipelines.map((pipeline) => (
          <button
            key={pipeline.id}
            onClick={() => setSelectedPipelineId(pipeline.id)}
            className={`w-full border-b border-[#1a1a1a] px-3 py-3 text-left transition-colors ${
              selectedPipeline?.id === pipeline.id ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Workflow className="h-3.5 w-3.5 text-cyan-400/70 shrink-0" />
              <span className="truncate text-[11px] font-medium text-white/75">{pipeline.name}</span>
            </div>
            <div className="mt-1 text-[9px] font-mono text-white/25">
              <div className="truncate">{pipeline.targetTable}</div>
              <div className="mt-0.5 uppercase tracking-widest">
                {pipeline.lastRunStatus ?? "idle"} · {pipeline.runCount} run{pipeline.runCount === 1 ? "" : "s"}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selectedPipeline && (
          <>
            <div className="border-b border-[#1a1a1a] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-cyan-400/70 shrink-0" />
                    <h3 className="truncate text-sm font-medium text-white/80">{selectedPipeline.name}</h3>
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-white/30">
                    {connectionName(selectedPipeline.sourceConnectionId)} → {connectionName(selectedPipeline.targetConnectionId)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={runSelectedPipeline}
                    disabled={runningPipelineId === selectedPipeline.id}
                    className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runningPipelineId === selectedPipeline.id ? "Running" : "Run"}
                  </button>
                  <button
                    onClick={openLatestOutput}
                    className="p-1.5 text-white/25 transition-colors hover:text-cyan-300"
                    title="Open latest output artifact"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={deleteSelectedPipeline}
                    className="p-1.5 text-white/20 transition-colors hover:text-red-400/70"
                    title="Delete pipeline"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="space-y-4">
                <section>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-white/20">
                    Source Query
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded border border-[#1f1f1f] bg-black/20 p-3 text-[10px] text-white/55">
                    {selectedPipeline.sourceQuery}
                  </pre>
                </section>

                <section className="grid grid-cols-1 gap-2 text-[10px] text-white/45">
                  <div>
                    <div className="font-mono uppercase tracking-widest text-white/20">Target Table</div>
                    <div className="mt-1 font-mono">{selectedPipeline.targetTable}</div>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-widest text-white/20">Last Run</div>
                    <div className="mt-1 font-mono">
                      {selectedPipeline.lastRunStatus ?? "idle"} · {formatTimestamp(selectedPipeline.lastRunAt)}
                    </div>
                  </div>
                  {selectedPipeline.lastRunError && (
                    <div className="rounded border border-red-500/20 bg-red-500/5 px-2 py-2 text-red-300/80">
                      <div className="flex items-center gap-1.5 font-mono uppercase tracking-widest text-[9px]">
                        <AlertTriangle className="h-3 w-3" />
                        Latest failure
                      </div>
                      <div className="mt-1 font-mono text-[10px] normal-case tracking-normal">
                        {selectedPipeline.lastRunError}
                      </div>
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-white/20" />
                    <div className="text-[9px] font-mono uppercase tracking-widest text-white/20">
                      Recent Runs
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {selectedRuns.length === 0 ? (
                      <div className="rounded border border-[#1f1f1f] bg-black/20 px-3 py-2 text-[10px] font-mono text-white/25">
                        No runs recorded yet.
                      </div>
                    ) : (
                      selectedRuns.map((run) => (
                        <div
                          key={run.id}
                          className="rounded border border-[#1f1f1f] bg-black/20 px-3 py-2 text-[10px] text-white/45"
                        >
                          <div className="flex items-center justify-between gap-3 font-mono">
                            <span className="uppercase tracking-widest">{run.status}</span>
                            <span>{formatTimestamp(run.finishedAt ?? run.startedAt)}</span>
                          </div>
                          <div className="mt-1 font-mono">
                            {run.rowCount ?? 0} row{run.rowCount === 1 ? "" : "s"} → {run.targetTable}
                          </div>
                          {run.error && (
                            <div className="mt-1 font-mono text-red-300/80">{run.error}</div>
                          )}
                          {run.artifactId && (
                            <button
                              onClick={() => {
                                createArtifactQueryTab({
                                  id: `artifact-query-tab-${run.artifactId}-${Date.now()}`,
                                  artifactId: run.artifactId!,
                                  title: `${selectedPipeline.name} output`,
                                  connectionId: selectedPipeline.sourceConnectionId,
                                  sql: selectedPipeline.sourceQuery,
                                  queryResults: null,
                                  isExecuting: false,
                                });
                                toast.success("Pipeline output opened");
                              }}
                              className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-cyan-300/80 transition-colors hover:text-cyan-200"
                            >
                              <Play className="h-3 w-3" />
                              Open output artifact
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
