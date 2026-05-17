import React, { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock3, FolderOpen, Play, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import {
  createBackgroundAgent,
  deleteBackgroundAgent,
  ensureBackgroundAgentsLoaded,
  listBackgroundAgentApprovals,
  getBackgroundAgentRuns,
  listBackgroundAgents,
  resolveBackgroundAgentApproval,
  subscribeBackgroundAgents,
  updateBackgroundAgent,
  type BackgroundAgentApprovalItem,
  type BackgroundAgentDefinition,
  type BackgroundAgentRun,
} from "../../lib/backgroundAgents/BackgroundAgentStore";
import { runBackgroundAnalysisAgent } from "../../lib/backgroundAgents/BackgroundAgentRunner";

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

export function BackgroundAgentsPanel() {
  const { connections, createArtifactReportTab } = useWorkspaceStore();
  const [agents, setAgents] = useState<BackgroundAgentDefinition[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [runsByAgent, setRunsByAgent] = useState<Record<string, BackgroundAgentRun[]>>({});
  const [approvals, setApprovals] = useState<BackgroundAgentApprovalItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftConnectionId, setDraftConnectionId] = useState<string>("");
  const [draftCadenceMinutes, setDraftCadenceMinutes] = useState<string>("60");
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editConnectionId, setEditConnectionId] = useState("");
  const [editCadenceMinutes, setEditCadenceMinutes] = useState("");

  useEffect(() => {
    const refresh = async () => {
      await ensureBackgroundAgentsLoaded();
      const nextAgents = listBackgroundAgents();
      setAgents(nextAgents);
      setRunsByAgent(
        Object.fromEntries(nextAgents.map((agent) => [agent.id, getBackgroundAgentRuns(agent.id)])),
      );
      setApprovals(listBackgroundAgentApprovals());
      setSelectedAgentId((current) => current ?? nextAgents[0]?.id ?? null);
      setDraftConnectionId((current) => current || connections[0]?.id || "");
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
    setEditCadenceMinutes(selectedAgent.cadenceMinutes ? String(selectedAgent.cadenceMinutes) : "");
  }, [selectedAgent]);

  const handleCreateAgent = async () => {
    if (!draftName.trim() || !draftPrompt.trim() || !draftConnectionId) {
      toast.error("Name, prompt, and connection are required.");
      return;
    }
    const agent = await createBackgroundAgent({
      name: draftName,
      prompt: draftPrompt,
      connectionId: draftConnectionId,
      cadenceMinutes: draftCadenceMinutes.trim() ? Number(draftCadenceMinutes) : null,
      isEnabled: true,
    });
    setCreating(false);
    setDraftName("");
    setDraftPrompt("");
    setSelectedAgentId(agent.id);
    toast.success(`Background agent "${agent.name}" created`);
  };

  const handleRunNow = async (agent: BackgroundAgentDefinition) => {
    setRunningAgentId(agent.id);
    try {
      await runBackgroundAnalysisAgent(agent.id);
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleSaveAgentEdits = async () => {
    if (!selectedAgent) return;
    await updateBackgroundAgent(selectedAgent.id, {
      name: editName.trim(),
      prompt: editPrompt.trim(),
      connectionId: editConnectionId,
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
          <button
            onClick={() => setCreating((value) => !value)}
            className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/55 hover:text-white/80"
          >
            {creating ? "Close" : "New"}
          </button>
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
                        <div className="mt-2 font-mono">
                          {run.summary ?? run.error ?? "No summary recorded."}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span>{run.queryArtifactIds.length} query artifacts</span>
                          <span>{run.approvalIds.length} approvals</span>
                        </div>
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
