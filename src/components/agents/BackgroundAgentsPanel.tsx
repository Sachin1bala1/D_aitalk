import React, { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock3, FolderOpen, Layers3, Play, RotateCcw, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import {
  createBackgroundAgentEnvironment,
  createBackgroundAgent,
  deleteBackgroundAgentEnvironment,
  deleteBackgroundAgent,
  ensureBackgroundAgentsLoaded,
  getBackgroundAgentEnvironment,
  listBackgroundAgentApprovals,
  listBackgroundAgentEnvironments,
  getBackgroundAgentRuns,
  listBackgroundAgents,
  resolveBackgroundAgentApproval,
  subscribeBackgroundAgents,
  updateBackgroundAgentEnvironment,
  updateBackgroundAgent,
  type BackgroundAgentApprovalItem,
  type BackgroundAgentDefinition,
  type BackgroundAgentEnvironment,
  type BackgroundAgentRun,
} from "../../lib/backgroundAgents/BackgroundAgentStore";
import { queueBackgroundRunTakeover, runBackgroundAnalysisAgent } from "../../lib/backgroundAgents/BackgroundAgentRunner";

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }: { status: BackgroundAgentRun["status"] | null }) {
  const tone =
    status === "success"
      ? "text-emerald-300/80 border-emerald-500/20 bg-emerald-500/5"
      : status === "failed"
        ? "text-red-300/80 border-red-500/20 bg-red-500/5"
        : status === "approval_required"
          ? "text-amber-300/80 border-amber-500/20 bg-amber-500/5"
          : "text-white/35 border-[#2a2a2a] bg-[#111]";

  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${tone}`}>
      {status ?? "idle"}
    </span>
  );
}

interface BackgroundAgentsPanelProps {
  onTakeoverPrompt?: (prompt: string) => void;
}

export function BackgroundAgentsPanel({ onTakeoverPrompt }: BackgroundAgentsPanelProps) {
  const { connections, createArtifactReportTab } = useWorkspaceStore();
  const [agents, setAgents] = useState<BackgroundAgentDefinition[]>([]);
  const [environments, setEnvironments] = useState<BackgroundAgentEnvironment[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [runsByAgent, setRunsByAgent] = useState<Record<string, BackgroundAgentRun[]>>({});
  const [approvals, setApprovals] = useState<BackgroundAgentApprovalItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftConnectionId, setDraftConnectionId] = useState<string>("");
  const [draftEnvironmentId, setDraftEnvironmentId] = useState<string>("");
  const [draftCadenceMinutes, setDraftCadenceMinutes] = useState<string>("60");
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editConnectionId, setEditConnectionId] = useState("");
  const [editEnvironmentId, setEditEnvironmentId] = useState("");
  const [editCadenceMinutes, setEditCadenceMinutes] = useState("");
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [creatingEnvironment, setCreatingEnvironment] = useState(false);
  const [environmentDraftName, setEnvironmentDraftName] = useState("");
  const [environmentDraftDescription, setEnvironmentDraftDescription] = useState("");
  const [environmentDraftConcurrency, setEnvironmentDraftConcurrency] = useState("1");

  useEffect(() => {
    const refresh = async () => {
      await ensureBackgroundAgentsLoaded();
      const nextAgents = listBackgroundAgents();
      const nextEnvironments = listBackgroundAgentEnvironments();
      setAgents(nextAgents);
      setEnvironments(nextEnvironments);
      setRunsByAgent(
        Object.fromEntries(nextAgents.map((agent) => [agent.id, getBackgroundAgentRuns(agent.id)])),
      );
      setApprovals(listBackgroundAgentApprovals());
      setSelectedAgentId((current) => current ?? nextAgents[0]?.id ?? null);
      setDraftConnectionId((current) => current || connections[0]?.id || "");
      setDraftEnvironmentId((current) => current || nextEnvironments[0]?.id || "");
    };

    void refresh();
    return subscribeBackgroundAgents(() => {
      void refresh();
    });
  }, [connections]);

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedRuns = useMemo(
    () => (selectedAgent ? runsByAgent[selectedAgent.id] ?? [] : []),
    [runsByAgent, selectedAgent],
  );
  const selectedApprovals = useMemo(
    () =>
      selectedAgent
        ? approvals.filter((approval) => approval.agentId === selectedAgent.id)
        : [],
    [approvals, selectedAgent],
  );

  useEffect(() => {
    if (!selectedAgent) return;
    setEditName(selectedAgent.name);
    setEditPrompt(selectedAgent.prompt);
    setEditConnectionId(selectedAgent.connectionId);
    setEditEnvironmentId(selectedAgent.environmentId);
    setEditCadenceMinutes(selectedAgent.cadenceMinutes ? String(selectedAgent.cadenceMinutes) : "");
  }, [selectedAgent]);

  const environmentStats = useMemo(
    () =>
      environments.map((environment) => {
        const envAgents = agents.filter((agent) => agent.environmentId === environment.id);
        const envRuns = envAgents.flatMap((agent) => runsByAgent[agent.id] ?? []);
        const queuedCount = envRuns.filter((run) => run.status === "queued").length;
        const activeCount = envRuns.filter((run) => run.status === "running").length;
        return {
          environment,
          agentCount: envAgents.length,
          queuedCount,
          activeCount,
        };
      }),
    [agents, environments, runsByAgent],
  );

  const selectedEnvironment =
    getBackgroundAgentEnvironment(selectedAgent?.environmentId ?? "") ??
    environments[0] ??
    null;

  const handleCreateAgent = async () => {
    if (!draftName.trim() || !draftPrompt.trim() || !draftConnectionId) {
      toast.error("Name, prompt, and connection are required.");
      return;
    }
    const agent = await createBackgroundAgent({
      name: draftName,
      prompt: draftPrompt,
      connectionId: draftConnectionId,
      environmentId: draftEnvironmentId,
      cadenceMinutes: draftCadenceMinutes.trim() ? Number(draftCadenceMinutes) : null,
      isEnabled: true,
    });
    setCreating(false);
    setDraftName("");
    setDraftPrompt("");
    setSelectedAgentId(agent.id);
    toast.success(`Background agent "${agent.name}" created`);
  };

  const handleCreateEnvironment = async () => {
    if (!environmentDraftName.trim()) {
      toast.error("Environment name is required.");
      return;
    }
    const environment = await createBackgroundAgentEnvironment({
      name: environmentDraftName,
      description: environmentDraftDescription,
      connectionIds: [],
      concurrencyLimit: environmentDraftConcurrency.trim() ? Number(environmentDraftConcurrency) : 1,
      isEnabled: true,
    });
    setCreatingEnvironment(false);
    setEnvironmentDraftName("");
    setEnvironmentDraftDescription("");
    setDraftEnvironmentId(environment.id);
    toast.success(`Environment "${environment.name}" created`);
  };

  const handleRunNow = async (agent: BackgroundAgentDefinition) => {
    setRunningAgentId(agent.id);
    try {
      await runBackgroundAnalysisAgent(agent.id);
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleRetryRun = async (agent: BackgroundAgentDefinition, run: BackgroundAgentRun) => {
    setBusyRunId(run.id);
    try {
      await runBackgroundAnalysisAgent(agent.id, {
        trigger: "retry",
        retryOfRunId: run.id,
      });
    } finally {
      setBusyRunId(null);
    }
  };

  const handleTakeoverRun = async (agent: BackgroundAgentDefinition, run: BackgroundAgentRun) => {
    setBusyRunId(run.id);
    try {
      const prompt = await queueBackgroundRunTakeover(agent.id, run.id);
      if (!prompt) {
        toast.error("Unable to build takeover context for this run.");
        return;
      }
      onTakeoverPrompt?.(prompt);
      toast.success(`Investigation for "${agent.name}" moved to AI panel`);
    } finally {
      setBusyRunId(null);
    }
  };

  const handleSaveAgentEdits = async () => {
    if (!selectedAgent) return;
    await updateBackgroundAgent(selectedAgent.id, {
      name: editName.trim(),
      prompt: editPrompt.trim(),
      connectionId: editConnectionId,
      environmentId: editEnvironmentId,
      cadenceMinutes: editCadenceMinutes.trim() ? Number(editCadenceMinutes) : null,
    });
    toast.success(`Saved ${selectedAgent.name}`);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="w-56 shrink-0 border-r border-[#1a1a1a] overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-3 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyan-400/80" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">
              Background
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCreatingEnvironment((value) => !value)}
              className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/55 hover:text-white/80"
            >
              {creatingEnvironment ? "Env Close" : "New Env"}
            </button>
            <button
              onClick={() => setCreating((value) => !value)}
              className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/55 hover:text-white/80"
            >
              {creating ? "Close" : "New"}
            </button>
          </div>
        </div>

        {creatingEnvironment && (
          <div className="border-b border-[#1a1a1a] p-3 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/35">
              <Layers3 className="h-3 w-3" />
              Environment
            </div>
            <input
              value={environmentDraftName}
              onChange={(e) => setEnvironmentDraftName(e.target.value)}
              placeholder="Environment name"
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
            <input
              value={environmentDraftConcurrency}
              onChange={(e) => setEnvironmentDraftConcurrency(e.target.value)}
              placeholder="Concurrency limit"
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
            <textarea
              value={environmentDraftDescription}
              onChange={(e) => setEnvironmentDraftDescription(e.target.value)}
              placeholder="What kind of detached workload belongs here?"
              rows={3}
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none resize-none"
            />
            <button
              onClick={() => void handleCreateEnvironment()}
              className="w-full rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20"
            >
              Save Environment
            </button>
          </div>
        )}

        <div className="border-b border-[#1a1a1a] p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/35">
            <Layers3 className="h-3 w-3" />
            Environments
          </div>
          {environmentStats.map(({ environment, agentCount, queuedCount, activeCount }) => (
            <div key={environment.id} className="rounded border border-[#1f1f1f] bg-black/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium text-white/70">{environment.name}</span>
                <span className="font-mono text-[8px] uppercase tracking-widest text-white/25">
                  {environment.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 font-mono text-[8px] uppercase tracking-widest text-white/25">
                <span>{agentCount} agents</span>
                <span>{activeCount}/{environment.concurrencyLimit} active</span>
                <span>{queuedCount} queued</span>
              </div>
            </div>
          ))}
        </div>

        {creating && (
          <div className="border-b border-[#1a1a1a] p-3 space-y-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Agent name"
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
            <select
              value={draftConnectionId}
              onChange={(e) => setDraftConnectionId(e.target.value)}
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            >
              <option value="">Select connection</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.display_name}
                </option>
              ))}
            </select>
            <select
              value={draftEnvironmentId}
              onChange={(e) => setDraftEnvironmentId(e.target.value)}
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            >
              <option value="">Select environment</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
            <input
              value={draftCadenceMinutes}
              onChange={(e) => setDraftCadenceMinutes(e.target.value)}
              placeholder="Cadence minutes"
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              placeholder="Analyze this connection for drift, anomalies, or trends..."
              rows={6}
              className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none resize-none"
            />
            <button
              onClick={() => void handleCreateAgent()}
              className="w-full rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20"
            >
              Save Agent
            </button>
          </div>
        )}

        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className={`w-full border-b border-[#1a1a1a] px-3 py-3 text-left ${
              selectedAgent?.id === agent.id ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-cyan-400/70 shrink-0" />
              <span className="truncate text-[11px] font-medium text-white/75">{agent.name}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-[9px] font-mono text-white/25">
                {agent.cadenceMinutes ? `Every ${agent.cadenceMinutes}m` : "Manual only"}
              </span>
              <StatusPill status={agent.lastRunStatus} />
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!selectedAgent ? (
          <div className="flex h-full items-center justify-center text-white/15 text-xs">
            No background agents configured
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-400/80" />
                    <h3 className="truncate text-sm font-semibold text-white/80">{selectedAgent.name}</h3>
                    <StatusPill status={selectedAgent.lastRunStatus} />
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-white/35">
                    <div>Connection: {connections.find((connection) => connection.id === selectedAgent.connectionId)?.display_name ?? selectedAgent.connectionId}</div>
                    <div>Environment: {selectedEnvironment?.name ?? selectedAgent.environmentId}</div>
                    <div>Cadence: {selectedAgent.cadenceMinutes ? `${selectedAgent.cadenceMinutes} minutes` : "Manual only"}</div>
                    <div>Last run: {formatTimestamp(selectedAgent.lastRunAt)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void handleRunNow(selectedAgent)}
                    disabled={runningAgentId === selectedAgent.id}
                    className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                  >
                    {runningAgentId === selectedAgent.id ? "Running" : "Run Now"}
                  </button>
                  <button
                    onClick={() =>
                      void updateBackgroundAgent(selectedAgent.id, { isEnabled: !selectedAgent.isEnabled })
                    }
                    className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-white/55 hover:text-white/80"
                  >
                    {selectedAgent.isEnabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => void deleteBackgroundAgent(selectedAgent.id)}
                    className="rounded border border-[#2a2a2a] bg-[#111] p-1.5 text-white/25 hover:text-red-400/80"
                    title="Delete agent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
                />
                <select
                  value={editConnectionId}
                  onChange={(e) => setEditConnectionId(e.target.value)}
                  className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
                >
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.display_name}
                    </option>
                  ))}
                </select>
                <select
                  value={editEnvironmentId}
                  onChange={(e) => setEditEnvironmentId(e.target.value)}
                  className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
                >
                  {environments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name}
                    </option>
                  ))}
                </select>
                <input
                  value={editCadenceMinutes}
                  onChange={(e) => setEditCadenceMinutes(e.target.value)}
                  placeholder="Cadence minutes"
                  className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none"
                />
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={6}
                  className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none resize-none"
                />
                <button
                  onClick={() => void handleSaveAgentEdits()}
                  className="self-start rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-white/55 hover:text-white/80"
                >
                  Save Changes
                </button>
                {selectedEnvironment && selectedEnvironment.id !== "background-env-local-default" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() =>
                        void updateBackgroundAgentEnvironment(selectedEnvironment.id, {
                          connectionIds: Array.from(new Set([...selectedEnvironment.connectionIds, editConnectionId])),
                        })
                      }
                      className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/45 hover:text-white/70"
                    >
                      Add Conn To Env
                    </button>
                    <button
                      onClick={() =>
                        void updateBackgroundAgentEnvironment(selectedEnvironment.id, {
                          isEnabled: !selectedEnvironment.isEnabled,
                        })
                      }
                      className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/45 hover:text-white/70"
                    >
                      {selectedEnvironment.isEnabled ? "Pause Env" : "Enable Env"}
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await deleteBackgroundAgentEnvironment(selectedEnvironment.id);
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to delete environment");
                        }
                      }}
                      className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-red-300/70 hover:bg-red-500/20"
                    >
                      Delete Env
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-4">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                  <Clock3 className="h-3.5 w-3.5" />
                  Recent Runs
                </div>
                <div className="mt-3 space-y-2">
                  {selectedRuns.length === 0 ? (
                    <div className="text-[10px] font-mono text-white/25">No runs recorded yet.</div>
                  ) : (
                    selectedRuns.map((run) => (
                      <div key={run.id} className="rounded border border-[#1f1f1f] bg-black/20 p-3 text-[10px] text-white/45">
                        <div className="flex items-center justify-between gap-2">
                          <StatusPill status={run.status} />
                          <span className="font-mono">{formatTimestamp(run.finishedAt ?? run.startedAt)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-widest text-white/30">
                          <span>{getBackgroundAgentEnvironment(run.environmentId)?.name ?? run.environmentId}</span>
                          <span>{run.trigger}</span>
                          <span>attempt {run.attemptCount}/{run.maxAttempts}</span>
                          {run.retryOfRunId && <span>retry of prior run</span>}
                        </div>
                        <div className="mt-2 font-mono">
                          {run.summary ?? run.error ?? "No summary recorded."}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span>{run.queryArtifactIds.length} query artifacts</span>
                          <span>{run.approvalIds.length} approvals</span>
                          <span>{run.events.length} events</span>
                        </div>
                        {run.events.length > 0 && (
                          <div className="mt-3 rounded border border-[#1f1f1f] bg-[#080808] p-2">
                            <div className="text-[9px] font-mono uppercase tracking-widest text-white/25">
                              Run Evidence
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {run.events.slice(-6).map((event) => (
                                <div key={event.id} className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-mono text-[9px] uppercase tracking-widest text-white/30">
                                      {event.type}
                                    </div>
                                    <div className="truncate text-[10px] text-white/55">{event.message}</div>
                                  </div>
                                  <div className="shrink-0 font-mono text-[9px] text-white/20">
                                    {formatTimestamp(event.at)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {run.reportArtifactId && (
                          <button
                            onClick={() =>
                              createArtifactReportTab({
                                id: `artifact-report-tab-${run.reportArtifactId}-${Date.now()}`,
                                artifactId: run.reportArtifactId!,
                                title: `${selectedAgent.name} report`,
                                connectionId: null,
                                sql: "",
                                queryResults: null,
                                isExecuting: false,
                              })
                            }
                            className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-cyan-300/80 hover:text-cyan-200"
                          >
                            <FolderOpen className="h-3 w-3" />
                            Open report artifact
                          </button>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(run.status === "failed" || run.status === "approval_required") && (
                            <button
                              onClick={() => void handleRetryRun(selectedAgent, run)}
                              disabled={busyRunId === run.id}
                              className="inline-flex items-center gap-1.5 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/55 hover:text-white/80 disabled:opacity-40"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Retry
                            </button>
                          )}
                          {run.status !== "running" && (
                            <button
                              onClick={() => void handleTakeoverRun(selectedAgent, run)}
                              disabled={busyRunId === run.id}
                              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                            >
                              <Sparkles className="h-3 w-3" />
                              Take Over In AI
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-4">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Follow-up Review
                </div>
                <div className="mt-3 space-y-2">
                  {selectedApprovals.length === 0 ? (
                    <div className="text-[10px] font-mono text-white/25">No review items queued.</div>
                  ) : (
                    selectedApprovals.map((approval) => (
                      <div key={approval.id} className="rounded border border-[#1f1f1f] bg-black/20 p-3 text-[10px] text-white/45">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/75">{approval.title}</span>
                          <span className="font-mono uppercase tracking-widest text-amber-300/70">
                            {approval.status}
                          </span>
                        </div>
                        <div className="mt-2">{approval.rationale}</div>
                        {approval.suggestedSql && (
                          <pre className="mt-2 overflow-x-auto rounded border border-[#1f1f1f] bg-[#080808] p-2 font-mono text-[10px] text-white/55">
                            {approval.suggestedSql}
                          </pre>
                        )}
                        {approval.status === "pending" && (
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => void resolveBackgroundAgentApproval(approval.id, "approved")}
                              className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Approve
                            </button>
                            <button
                              onClick={() => void resolveBackgroundAgentApproval(approval.id, "rejected")}
                              className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
