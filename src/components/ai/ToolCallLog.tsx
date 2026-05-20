import React, { useState } from "react";
import { ChevronDown, ChevronRight, Database, BarChart2, Cpu, CheckCircle2, AlertTriangle, Loader2, Play, Clock } from "lucide-react";
import { StatResultView } from "./StatResultView";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolLogEntry {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** undefined = still running */
  result?: { success: boolean; summary: string; data?: unknown };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NAMESPACE_COLOR: Record<string, string> = {
  execute_sql: "#00d2ff",
  set_editor_content: "#00d2ff",
  stat: "#39FF14",
  run_duckdb_analysis: "#7B61FF",
  create_chart: "#FF6B35",
  notify_user: "#FFD700",
  open_table: "#00d2ff",
  default: "#888",
};

function getColor(toolName: string): string {
  if (toolName.startsWith("stat__") || toolName.startsWith("analyze_loaded_")) return NAMESPACE_COLOR.stat;
  return NAMESPACE_COLOR[toolName] ?? NAMESPACE_COLOR.default;
}

function ToolIcon({ toolName }: { toolName: string }) {
  if (toolName.startsWith("execute_sql") || toolName.startsWith("set_editor") || toolName.startsWith("open_table")) {
    return <Database className="w-3 h-3" />;
  }
  if (toolName.startsWith("stat__") || toolName.startsWith("analyze_loaded_") || toolName === "run_duckdb_analysis") {
    return <BarChart2 className="w-3 h-3" />;
  }
  return <Cpu className="w-3 h-3" />;
}

function parseStatResult(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  try {
    if (typeof data === "string") {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    }
  } catch {}
  return null;
}

// ── Single collapsible tool row ───────────────────────────────────────────────

function ToolRow({ entry, onApplySQL }: { entry: ToolLogEntry; onApplySQL?: (sql: string) => void }) {
  const [open, setOpen] = useState(false);
  const color = getColor(entry.toolName);
  const isRunning = entry.result === undefined;
  const isStat = entry.toolName.startsWith("stat__") || entry.toolName.startsWith("analyze_loaded_");
  const sql = typeof entry.input?.sql === "string" ? entry.input.sql : null;

  return (
    <div
      className="rounded border"
      style={{ borderColor: `${color}25`, background: "rgba(0,0,0,0.2)" }}
    >
      <button
        onClick={() => !isRunning && setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 text-white/30 flex-shrink-0 animate-spin" />
        ) : open ? (
          <ChevronDown className="w-3 h-3 text-white/30 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-white/30 flex-shrink-0" />
        )}

        <span
          className="flex items-center gap-1.5 text-[11px] font-mono font-semibold flex-shrink-0"
          style={{ color }}
        >
          <ToolIcon toolName={entry.toolName} />
          {entry.toolName}
        </span>

        <span className="text-[10px] text-white/25 flex-1 truncate font-mono">
          {sql
            ? sql.replace(/\s+/g, " ").slice(0, 60)
            : Object.entries(entry.input)
                .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 20)}`)
                .join(" ")
                .slice(0, 60)}
        </span>

        {entry.result && (
          entry.result.success
            ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "#39FF14" }} />
            : <AlertTriangle className="w-3 h-3 flex-shrink-0 text-red-400" />
        )}
        {isRunning && (
          <Clock className="w-3 h-3 flex-shrink-0 text-white/20" />
        )}
      </button>

      {open && entry.result && (
        <div className="px-3 pb-2.5 space-y-1.5">
          {/* SQL block with Apply button */}
          {sql && (
            <div className="relative">
              <pre className="text-[10px] font-mono text-white/50 bg-black/40 rounded p-2 whitespace-pre-wrap break-all leading-relaxed">
                {sql}
              </pre>
              {onApplySQL && (
                <button
                  onClick={() => onApplySQL(sql)}
                  className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] text-[#00d2ff] hover:text-white px-1.5 py-0.5 rounded bg-[#00d2ff]/10 hover:bg-[#00d2ff]/20 transition-colors"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  Apply
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {!entry.result.success && (
            <p className="text-[10px] text-red-400">Error: {entry.result.summary}</p>
          )}

          {/* Stat result grid */}
          {isStat && entry.result.success && (() => {
            const parsed = parseStatResult(entry.result.data);
            return parsed ? <StatResultView data={parsed} /> : null;
          })()}

          {/* Generic result summary for non-stat tools */}
          {!isStat && entry.result.success && entry.result.summary && (
            <p className="text-[10px] text-white/30 font-mono">{entry.result.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Log container ─────────────────────────────────────────────────────────────

interface Props {
  entries: ToolLogEntry[];
  onApplySQL?: (sql: string) => void;
}

export function ToolCallLog({ entries, onApplySQL }: Props) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
      <span className="text-[9px] uppercase tracking-widest text-white/20 font-bold">
        Tool Calls
      </span>
      {entries.map((entry) => (
        <ToolRow key={entry.id} entry={entry} onApplySQL={onApplySQL} />
      ))}
    </div>
  );
}
