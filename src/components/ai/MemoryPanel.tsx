import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Brain, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { BusinessClient, type OutcomeRecord } from "../../lib/business/BusinessClient";
import { EpisodicMemory, type Episode } from "../../lib/memory/EpisodicMemory";
import {
  useWorkspaceRuleStore,
  type WorkspaceRule,
  type WorkspaceRuleKind,
  type WorkspaceRuleScope,
} from "../../lib/memory/WorkspaceRuleStore";
import { UserCalibrationProfile, type ExpertiseLevel } from "../../lib/memory/UserCalibrationProfile";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

function relativeTime(tsMs: number): string {
  const diffMs = Date.now() - tsMs;
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-[#262626]">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full bg-[#1a1a1a] px-3 py-2 text-xs font-semibold uppercase tracking-widest text-white/60 transition-colors hover:text-white/90"
      >
        <div className="flex items-center justify-between">
          <span>{title}</span>
          {open ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
        </div>
      </button>
      {open && <div className="bg-[#0d0d0d] px-3 py-2">{children}</div>}
    </div>
  );
}

function RuleMeta({ rule }: { rule: WorkspaceRule }) {
  return (
    <p className="mt-1 font-mono text-[10px] text-white/25">
      {rule.kind} · {rule.scope === "connection" ? (rule.connectionId ?? "connection") : "workspace"} · {rule.source}
    </p>
  );
}

export function MemoryPanel() {
  const activeConnectionId = useWorkspaceStore((state) => state.activeConnectionId);
  const {
    rules,
    ensureLoaded: ensureRulesLoaded,
    createRule,
    approveRule,
    rejectRule,
    deleteRule,
  } = useWorkspaceRuleStore();

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [priorityParams, setPriorityParams] = useState<string[]>([]);
  const [expertiseLevel, setExpertiseLevel] = useState<ExpertiseLevel>("operator");
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [expertiseError, setExpertiseError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleInstruction, setRuleInstruction] = useState("");
  const [ruleKind, setRuleKind] = useState<WorkspaceRuleKind>("analysis");
  const [ruleScope, setRuleScope] = useState<WorkspaceRuleScope>("workspace");
  const [rulesError, setRulesError] = useState<string | null>(null);

  const loadEpisodes = useCallback(async () => {
    setEpisodesLoading(true);
    setEpisodesError(null);
    try {
      setEpisodes(await EpisodicMemory.getRecent(10));
    } catch (error: unknown) {
      setEpisodesError((error as Error)?.message ?? String(error));
    } finally {
      setEpisodesLoading(false);
    }
  }, []);

  const loadOutcomes = useCallback(async () => {
    setOutcomesError(null);
    try {
      setOutcomes(await BusinessClient.getPendingOutcomes(12));
    } catch (error: unknown) {
      setOutcomesError((error as Error)?.message ?? String(error));
    }
  }, []);

  const loadCalibration = useCallback(async () => {
    setCalibrationError(null);
    try {
      const [params, profile] = await Promise.all([
        UserCalibrationProfile.getPriorityParameters(),
        UserCalibrationProfile.getProfile(),
      ]);
      setPriorityParams(params);
      setExpertiseLevel(profile.expertiseLevel);
    } catch (error: unknown) {
      setCalibrationError((error as Error)?.message ?? String(error));
    }
  }, []);

  useEffect(() => {
    void ensureRulesLoaded();
    void loadEpisodes();
    void loadCalibration();
    void loadOutcomes();
  }, [ensureRulesLoaded, loadCalibration, loadEpisodes, loadOutcomes]);

  const handleExpertiseChange = async (level: ExpertiseLevel) => {
    const previous = expertiseLevel;
    setExpertiseLevel(level);
    setExpertiseError(null);
    try {
      await UserCalibrationProfile.updateExpertise(level);
    } catch (error: unknown) {
      setExpertiseLevel(previous);
      setExpertiseError((error as Error)?.message ?? String(error));
    }
  };

  const handleClearMemory = async () => {
    setClearError(null);
    try {
      await invoke("memory_clear_episodes");
      setConfirmingClear(false);
      await loadEpisodes();
    } catch (error: unknown) {
      setClearError((error as Error)?.message ?? String(error));
    }
  };

  const handleOutcomeStatus = async (outcome: OutcomeRecord, status: OutcomeRecord["status"]) => {
    try {
      await BusinessClient.upsertOutcome({
        ...outcome,
        status,
        resolved_at: status === "resolved" ? Date.now() : outcome.resolved_at ?? null,
        updated_at: Date.now(),
      });
      await loadOutcomes();
      await loadCalibration();
    } catch (error: unknown) {
      setOutcomesError((error as Error)?.message ?? String(error));
    }
  };

  const visibleRules = rules.filter((rule) => rule.scope === "workspace" || rule.connectionId === activeConnectionId);
  const suggestedRules = visibleRules.filter((rule) => rule.status === "suggested");
  const approvedRules = visibleRules.filter((rule) => rule.status === "approved");

  const handleCreateRule = () => {
    if (!ruleTitle.trim() || !ruleInstruction.trim()) {
      setRulesError("Title and instruction are required.");
      return;
    }
    setRulesError(null);
    createRule({
      title: ruleTitle,
      instruction: ruleInstruction,
      kind: ruleKind,
      scope: ruleScope,
      connectionId: ruleScope === "connection" ? activeConnectionId ?? null : null,
      source: "user",
      status: "approved",
      evidence: [],
    });
    setRuleTitle("");
    setRuleInstruction("");
    setRuleKind("analysis");
    setRuleScope("workspace");
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#0d0d0d] p-3">
      <div className="flex items-center gap-2 border-b border-[#262626] pb-1">
        <Brain className="h-4 w-4 text-[#00d2ff]" />
        <span className="text-xs font-bold uppercase tracking-widest text-white/70">APEX Memory</span>
      </div>

      <Section title="Past Analyses" defaultOpen>
        {episodesLoading ? (
          <p className="py-1 text-xs text-white/30">Loading...</p>
        ) : episodesError ? (
          <p className="py-1 text-xs text-red-400/80">{episodesError}</p>
        ) : episodes.length === 0 ? (
          <p className="py-1 text-xs text-white/30">No past analyses yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {episodes.map((episode) => (
              <li key={episode.id} className="flex items-start gap-2 text-xs">
                <span className="w-12 shrink-0 text-right font-mono text-white/25">{relativeTime(episode.createdAt)}</span>
                <span className="leading-snug text-white/60">{truncate(episode.problem, 60)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pending Outcomes" defaultOpen>
        {outcomesError ? (
          <p className="py-1 text-xs text-red-400/80">{outcomesError}</p>
        ) : outcomes.length === 0 ? (
          <p className="py-1 text-xs text-white/30">No open learning loops.</p>
        ) : (
          <div className="space-y-2">
            {outcomes.map((outcome) => (
              <div key={outcome.id} className="rounded-lg border border-[#262626] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs leading-snug text-white/70">{truncate(outcome.title, 72)}</p>
                    <p className="mt-1 font-mono text-[10px] text-white/25">
                      {outcome.due_at ? `due ${relativeTime(outcome.due_at)}` : "no due date"} · {outcome.status}
                    </p>
                  </div>
                  <select
                    value={outcome.status}
                    onChange={(event) => handleOutcomeStatus(outcome, event.target.value as OutcomeRecord["status"])}
                    className="rounded border border-[#262626] bg-[#1a1a1a] px-1.5 py-1 text-[10px] text-white/70"
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Workspace Rules" defaultOpen>
        <div className="space-y-2">
          <input
            value={ruleTitle}
            onChange={(event) => setRuleTitle(event.target.value)}
            placeholder="Rule title"
            className="w-full rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1 text-xs text-white/80"
          />
          <textarea
            value={ruleInstruction}
            onChange={(event) => setRuleInstruction(event.target.value)}
            placeholder="Instruction the AI should follow in future sessions"
            rows={3}
            className="w-full resize-none rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1 text-xs text-white/80"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={ruleKind}
              onChange={(event) => setRuleKind(event.target.value as WorkspaceRuleKind)}
              className="rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1 text-[10px] text-white/70"
            >
              <option value="analysis">Analysis</option>
              <option value="sql">SQL</option>
              <option value="safety">Safety</option>
              <option value="reporting">Reporting</option>
            </select>
            <select
              value={ruleScope}
              onChange={(event) => setRuleScope(event.target.value as WorkspaceRuleScope)}
              className="rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1 text-[10px] text-white/70"
            >
              <option value="workspace">Workspace</option>
              <option value="connection">This connection</option>
            </select>
          </div>
          <button
            onClick={handleCreateRule}
            className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold text-cyan-300/80 hover:bg-cyan-500/15"
          >
            Save approved rule
          </button>
          {rulesError && <p className="text-xs text-red-400/80">{rulesError}</p>}
        </div>
      </Section>

      <Section title="Suggested Rules" defaultOpen>
        {suggestedRules.length === 0 ? (
          <p className="py-1 text-xs text-white/30">No pending rule suggestions.</p>
        ) : (
          <div className="space-y-2">
            {suggestedRules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-[#262626] p-2">
                <p className="text-xs text-white/75">{rule.title}</p>
                <RuleMeta rule={rule} />
                <p className="mt-1 text-[11px] leading-snug text-white/55">{rule.instruction}</p>
                {rule.rationale && <p className="mt-1 text-[10px] text-amber-300/55">{rule.rationale}</p>}
                {rule.evidence.length > 0 && (
                  <p className="mt-1 text-[10px] text-white/30">{rule.evidence.slice(0, 2).join(" · ")}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => approveRule(rule.id)}
                    className="flex-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300/80"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectRule(rule.id)}
                    className="flex-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300/80"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Approved Rules" defaultOpen>
        {approvedRules.length === 0 ? (
          <p className="py-1 text-xs text-white/30">No approved workspace rules yet.</p>
        ) : (
          <div className="space-y-2">
            {approvedRules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-[#262626] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-white/75">{rule.title}</p>
                    <RuleMeta rule={rule} />
                    <p className="mt-1 text-[11px] leading-snug text-white/55">{rule.instruction}</p>
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="rounded border border-[#262626] px-2 py-1 text-[10px] text-white/40 hover:text-red-300/80"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {calibrationError && <p className="px-1 text-xs text-red-400/80">{calibrationError}</p>}

      <Section title="Priority Parameters" defaultOpen>
        <p className="text-xs leading-snug text-white/55">
          {priorityParams.length === 0 ? <span className="text-white/30">None yet</span> : priorityParams.join(", ")}
        </p>
      </Section>

      <Section title="Expertise Level" defaultOpen>
        <select
          value={expertiseLevel}
          onChange={(event) => handleExpertiseChange(event.target.value as ExpertiseLevel)}
          className="w-full cursor-pointer rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1 text-xs text-white/80 focus:border-[#00d2ff] focus:outline-none"
        >
          <option value="operator">Operator</option>
          <option value="engineer">Engineer</option>
          <option value="expert">Expert</option>
        </select>
        {expertiseError && <p className="mt-1 text-xs text-red-400/80">{expertiseError}</p>}
      </Section>

      <div className="mt-auto pt-2">
        {!confirmingClear ? (
          <button
            onClick={() => setConfirmingClear(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-400/70 transition-colors hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
            Clear memory
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => void handleClearMemory()}
              className="flex-1 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:border-red-500/70 hover:bg-red-500/20"
            >
              Confirm clear
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
            >
              Cancel
            </button>
          </div>
        )}
        {clearError && <p className="mt-1 text-center text-xs text-red-400/80">{clearError}</p>}
      </div>
    </div>
  );
}
