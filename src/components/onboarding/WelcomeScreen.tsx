import React, { useState } from "react";
import { Activity, FileSpreadsheet, Database, ChevronRight, CheckCircle2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { PITag } from "../../lib/stores/WorkspaceStore";

// ── Process type spec limits ──────────────────────────────────────────────────

export type ProcessType = "reactor" | "pump" | "compressor" | "hx" | "column" | "boiler";

export interface ProcessSpecLimits {
  ucl: number;
  lcl: number;
  unit: string;
}

export const PROCESS_SPEC_LIMITS: Record<ProcessType, ProcessSpecLimits> = {
  reactor:    { ucl: 185, lcl: 145, unit: "°C" },
  pump:       { ucl: 12,  lcl: 2,   unit: "mm/s" },
  compressor: { ucl: 150, lcl: 50,  unit: "psi" },
  hx:         { ucl: 95,  lcl: 55,  unit: "°C" },
  column:     { ucl: 110, lcl: 70,  unit: "°C" },
  boiler:     { ucl: 200, lcl: 150, unit: "°C" },
};

const PROCESS_OPTIONS: { key: ProcessType; label: string }[] = [
  { key: "reactor",    label: "Reactor" },
  { key: "pump",       label: "Pump" },
  { key: "compressor", label: "Compressor" },
  { key: "hx",         label: "Heat Exchanger" },
  { key: "column",     label: "Column" },
  { key: "boiler",     label: "Boiler" },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface WelcomeScreenProps {
  /** Called when user picks the PI historian path — opens ConnectionDialog pre-set to PI */
  onConnectPi: () => void;
  /** Called when user picks the CSV path — opens FileImportDialog */
  onOpenFile: () => void;
  /** Called when user picks the database path — opens ConnectionDialog with SQL drivers */
  onConnect: (driver: string) => void;
  /** Called when user dismisses the welcome screen */
  onDismiss: () => void;
  /**
   * Called after the PI connection succeeds and the user selects a process type.
   * Provides the selected process type, its spec limits, and any example tags found.
   */
  onPiConnected?: (
    processType: ProcessType,
    limits: ProcessSpecLimits,
    tags: PITag[],
  ) => void;
  /**
   * PI connection credentials — passed back from ConnectionDialog when PI connects.
   * If set, WelcomeScreen shows the post-connect process selector.
   */
  piConnection?: { baseUrl: string; username: string; password: string } | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = "paths" | "pi_process_select";

export function WelcomeScreen({
  onConnectPi,
  onOpenFile,
  onConnect,
  onDismiss,
  onPiConnected,
  piConnection,
}: WelcomeScreenProps) {
  const [step, setStep] = useState<Step>("paths");
  const [exampleTags, setExampleTags] = useState<PITag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<ProcessType | null>(null);

  // When piConnection becomes available (after PI dialog closes), auto-fetch example tags
  const handlePiPath = () => {
    onConnectPi();
  };

  // Called when the ConnectionDialog returns a successful PI connection and we
  // want to show the process selector. Parent may call this via piConnection prop.
  const enterProcessSelect = async (conn: { baseUrl: string; username: string; password: string }) => {
    setStep("pi_process_select");
    setTagsLoading(true);
    try {
      const tags = await invoke<PITag[]>("pi_search_tags_direct", {
        baseUrl: conn.baseUrl,
        username: conn.username,
        password: conn.password,
        query: "*",
        maxCount: 10,
      });
      setExampleTags(tags);
    } catch {
      setExampleTags([]);
    } finally {
      setTagsLoading(false);
    }
  };

  // If parent passes a fresh piConnection and we're still on paths step, advance
  React.useEffect(() => {
    if (piConnection && step === "paths") {
      void enterProcessSelect(piConnection);
    }
  }, [piConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProcessSelect = (processType: ProcessType) => {
    setSelectedProcess(processType);
    const limits = PROCESS_SPEC_LIMITS[processType];
    onPiConnected?.(processType, limits, exampleTags);
    onDismiss();
  };

  // ── Render: process-type selector ─────────────────────────────────────────

  if (step === "pi_process_select") {
    return (
      <div className="fixed inset-0 bg-[#080808] z-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-8 w-full max-w-lg px-6">
          {/* Header */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-[#00d2ff]/10 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#00d2ff]" />
            </div>
            <span className="text-2xl font-bold text-white">Which process are you analyzing?</span>
            <span className="text-white/40 text-sm text-center">
              DataIQ will pre-configure typical control limits for the selected process type.
            </span>
          </div>

          {/* Example tags found */}
          {tagsLoading && (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <span className="w-4 h-4 border-2 border-white/20 border-t-[#00d2ff] rounded-full animate-spin" />
              Searching for example tags…
            </div>
          )}
          {!tagsLoading && exampleTags.length > 0 && (
            <div className="w-full p-3 rounded-lg border border-[#262626] bg-[#0d0d0d]">
              <p className="text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">
                Found {exampleTags.length} example tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {exampleTags.slice(0, 8).map((tag) => (
                  <span
                    key={tag.web_id}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00d2ff]/8 border border-[#00d2ff]/20 text-[#00d2ff]/70"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Process type grid */}
          <div className="grid grid-cols-3 gap-3 w-full">
            {PROCESS_OPTIONS.map(({ key, label }) => {
              const limits = PROCESS_SPEC_LIMITS[key];
              const isSelected = selectedProcess === key;
              return (
                <button
                  key={key}
                  onClick={() => handleProcessSelect(key)}
                  className={`flex flex-col gap-2 p-4 rounded-xl border text-left transition-all hover:border-[#00d2ff]/60 hover:bg-[#00d2ff]/5 ${
                    isSelected
                      ? "border-[#00d2ff] bg-[#00d2ff]/10"
                      : "border-[#262626] bg-[#0d0d0d]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-sm">{label}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-[#00d2ff]" />}
                  </div>
                  <div className="text-[10px] font-mono text-white/35">
                    UCL {limits.ucl} {limits.unit}
                    <br />
                    LCL {limits.lcl} {limits.unit}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={onDismiss}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip — I'll configure limits later
          </button>
        </div>
      </div>
    );
  }

  // ── Render: three-path screen ─────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-[#080808] z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 w-full max-w-2xl px-6">
        {/* Logo + tagline */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl font-bold text-[#00d2ff]">DataIQ</span>
          <span className="text-white/50 text-sm">Your AI-powered process data platform</span>
        </div>

        {/* Three-path cards */}
        <div className="grid grid-cols-1 gap-4 w-full sm:grid-cols-3">
          {/* Path 1 — PI Historian */}
          <div className="flex flex-col gap-4 p-5 rounded-xl border border-[#262626] bg-[#0d0d0d] hover:border-[#00d2ff]/40 transition-colors group">
            <div className="w-10 h-10 rounded-lg bg-[#00d2ff]/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#00d2ff]" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-bold text-white text-sm leading-tight">
                I have a PI historian
              </span>
              <p className="text-white/40 text-xs leading-relaxed">
                Connect to OSIsoft PI Web API. Browse tags, pull history, and analyze process data.
              </p>
            </div>
            <button
              onClick={handlePiPath}
              className="mt-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00d2ff] text-black text-xs font-bold hover:opacity-90 transition-opacity self-start"
            >
              Connect PI
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Path 2 — CSV export */}
          <div className="flex flex-col gap-4 p-5 rounded-xl border border-[#262626] bg-[#0d0d0d] hover:border-amber-500/40 transition-colors group">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-bold text-white text-sm leading-tight">
                I have a CSV export
              </span>
              <p className="text-white/40 text-xs leading-relaxed">
                Import a CSV from your historian or DCS. DataIQ will detect tags and time points automatically.
              </p>
            </div>
            <button
              onClick={onOpenFile}
              className="mt-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/80 text-black text-xs font-bold hover:opacity-90 transition-opacity self-start"
            >
              Open CSV
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Path 3 — Database */}
          <div className="flex flex-col gap-4 p-5 rounded-xl border border-[#262626] bg-[#0d0d0d] hover:border-emerald-500/40 transition-colors group">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-bold text-white text-sm leading-tight">
                I have a database
              </span>
              <p className="text-white/40 text-xs leading-relaxed">
                Connect to PostgreSQL, ClickHouse, TimescaleDB, or any other SQL/NoSQL database.
              </p>
            </div>
            <button
              onClick={() => onConnect("postgresql")}
              className="mt-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/80 text-black text-xs font-bold hover:opacity-90 transition-opacity self-start"
            >
              Connect DB
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Skip link — bottom-right */}
      <button
        onClick={onDismiss}
        className="absolute bottom-6 right-6 text-xs text-white/30 hover:text-white/60 transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}
