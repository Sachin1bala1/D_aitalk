/**
 * MemoryPanel — surfaces the APEX memory system to the user.
 *
 * Shows four sections:
 *   1. Past Analyses (episodic memory)
 *   2. Priority Parameters (calibration)
 *   3. Expertise Level (calibration)
 *   4. Clear memory button
 */
import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Brain, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { EpisodicMemory } from "../../lib/memory/EpisodicMemory";
import { UserCalibrationProfile } from "../../lib/memory/UserCalibrationProfile";
import type { Episode } from "../../lib/memory/EpisodicMemory";
import type { ExpertiseLevel } from "../../lib/memory/UserCalibrationProfile";
import { BusinessClient, type OutcomeRecord } from "../../lib/business/BusinessClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  return text.length <= max ? text : text.slice(0, max) + "…";
}

// ── Sub-sections ──────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#262626] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#1a1a1a] text-xs font-semibold text-white/60 hover:text-white/90 transition-colors uppercase tracking-widest"
      >
        <span>{title}</span>
        {open ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
      </button>
      {open && <div className="px-3 py-2 bg-[#0d0d0d]">{children}</div>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MemoryPanel() {
  // ── Episodes state ──
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);

  // ── Calibration state ──
  const [priorityParams, setPriorityParams] = useState<string[]>([]);
  const [expertiseLevel, setExpertiseLevel] = useState<ExpertiseLevel>("operator");
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [expertiseError, setExpertiseError] = useState<string | null>(null);

  // ── Clear confirmation state ──
  const [confirmingClear, setConfirmingClear] = useState(false);

  // ── Clear error ──
  const [clearError, setClearError] = useState<string | null>(null);

  // ── Load episodes ──
  const loadEpisodes = useCallback(async () => {
    setEpisodesLoading(true);
    setEpisodesError(null);
    try {
      const recent = await EpisodicMemory.getRecent(10);
      setEpisodes(recent);
    } catch (e: unknown) {
      setEpisodesError((e as Error)?.message ?? String(e));
    } finally {
      setEpisodesLoading(false);
    }
  }, []);

  const loadOutcomes = useCallback(async () => {
    setOutcomesError(null);
    try {
      const rows = await BusinessClient.getPendingOutcomes(12);
      setOutcomes(rows);
    } catch (e: unknown) {
      setOutcomesError((e as Error)?.message ?? String(e));
    }
  }, []);

  // ── Load calibration ──
  const loadCalibration = useCallback(async () => {
    setCalibrationError(null);
    try {
      const [params, profile] = await Promise.all([
        UserCalibrationProfile.getPriorityParameters(),
        UserCalibrationProfile.getProfile(),
      ]);
      setPriorityParams(params);
      setExpertiseLevel(profile.expertiseLevel);
    } catch (e: unknown) {
      setCalibrationError((e as Error)?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    loadEpisodes();
    loadCalibration();
    loadOutcomes();
  }, [loadEpisodes, loadCalibration, loadOutcomes]);

  // ── Handle expertise change ──
  const handleExpertiseChange = async (level: ExpertiseLevel) => {
    const previous = expertiseLevel;
    setExpertiseLevel(level);
    setExpertiseError(null);
    try {
      await UserCalibrationProfile.updateExpertise(level);
    } catch (e: unknown) {
      // Revert on failure
      setExpertiseLevel(previous);
      setExpertiseError((e as Error)?.message ?? String(e));
    }
  };

  // ── Handle clear ──
  const handleClearMemory = async () => {
    setClearError(null);
    try {
      await invoke("memory_clear_episodes");
      setConfirmingClear(false);
      await loadEpisodes();
    } catch (e: unknown) {
      setClearError((e as Error)?.message ?? String(e));
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
    } catch (e: unknown) {
      setOutcomesError((e as Error)?.message ?? String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-[#262626]">
        <Brain className="w-4 h-4 text-[#00d2ff]" />
        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">
          APEX Memory
        </span>
      </div>

      {/* Section 1: Past Analyses */}
      <Section title="Past Analyses" defaultOpen>
        {episodesLoading ? (
          <p className="text-xs text-white/30 animate-pulse py-1">Loading…</p>
        ) : episodesError ? (
          <p className="text-xs text-red-400/80 py-1">{episodesError}</p>
        ) : episodes.length === 0 ? (
          <p className="text-xs text-white/30 py-1">No past analyses yet. Start asking APEX questions.</p>
        ) : (
          <ul className="space-y-1.5">
            {episodes.map((ep) => (
              <li key={ep.id} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 text-white/25 font-mono w-12 text-right">
                  {relativeTime(ep.createdAt)}
                </span>
                <span className="text-white/60 leading-snug">
                  {truncate(ep.problem, 60)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pending Outcomes" defaultOpen>
        {outcomesError ? (
          <p className="text-xs text-red-400/80 py-1">{outcomesError}</p>
        ) : outcomes.length === 0 ? (
          <p className="text-xs text-white/30 py-1">No open learning loops.</p>
        ) : (
          <div className="space-y-2">
            {outcomes.map((outcome) => (
              <div key={outcome.id} className="rounded-lg border border-[#262626] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-white/70 leading-snug">{truncate(outcome.title, 72)}</p>
                    <p className="text-[10px] text-white/25 font-mono mt-1">
                      {outcome.due_at ? `due ${relativeTime(outcome.due_at)}` : "no due date"} · {outcome.status}
                    </p>
                  </div>
                  <select
                    value={outcome.status}
                    onChange={(e) => handleOutcomeStatus(outcome, e.target.value as OutcomeRecord["status"])}
                    className="bg-[#1a1a1a] border border-[#262626] rounded px-1.5 py-1 text-[10px] text-white/70"
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

      {/* Calibration error banner */}
      {calibrationError && (
        <p className="text-xs text-red-400/80 px-1">{calibrationError}</p>
      )}

      {/* Section 2: Priority Parameters */}
      <Section title="Priority Parameters" defaultOpen>
        <p className="text-xs text-white/55 leading-snug">
          {priorityParams.length === 0
            ? <span className="text-white/30">None yet</span>
            : priorityParams.join(", ")}
        </p>
      </Section>

      {/* Section 3: Expertise Level */}
      <Section title="Expertise Level" defaultOpen>
        <select
          value={expertiseLevel}
          onChange={(e) => handleExpertiseChange(e.target.value as ExpertiseLevel)}
          className="w-full bg-[#1a1a1a] border border-[#262626] rounded px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-[#00d2ff] cursor-pointer"
        >
          <option value="operator">Operator</option>
          <option value="engineer">Engineer</option>
          <option value="expert">Expert</option>
        </select>
        {expertiseError && (
          <p className="text-xs text-red-400/80 mt-1">{expertiseError}</p>
        )}
      </Section>

      {/* Section 4: Clear Memory */}
      <div className="mt-auto pt-2">
        {!confirmingClear ? (
          <button
            onClick={() => setConfirmingClear(true)}
            className="flex items-center gap-1.5 w-full justify-center px-3 py-2 rounded-lg border border-red-500/30 text-red-400/70 text-xs hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear memory
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleClearMemory}
              className="flex-1 px-3 py-2 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 hover:border-red-500/70 transition-colors font-semibold"
            >
              Confirm clear
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              className="flex-1 px-3 py-2 rounded-lg border border-white/20 text-white/70 text-xs hover:bg-white/10 hover:text-white/90 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {clearError && (
          <p className="text-xs text-red-400/80 mt-1 text-center">{clearError}</p>
        )}
      </div>
    </div>
  );
}
