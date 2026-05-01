import React from "react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function ConfidenceBar() {
  const activeConfidence = useWorkspaceStore((s) => s.activeConfidence);

  if (!activeConfidence) return null;

  const {
    confidence,
    confidenceLabel,
    dataQuality,
    whatWouldChangeConclusion,
    dataGaps,
  } = activeConfidence;

  const pct = Math.round(confidence * 100);

  const barColor =
    confidenceLabel === "high"
      ? "#34d399"
      : confidenceLabel === "medium"
      ? "#f59e0b"
      : confidenceLabel === "low"
      ? "#f87171"
      : "#6b7280"; // insufficient_data

  const labelBg =
    confidenceLabel === "high"
      ? "bg-emerald-500/20 text-emerald-400"
      : confidenceLabel === "medium"
      ? "bg-amber-500/20 text-amber-400"
      : confidenceLabel === "low"
      ? "bg-red-500/20 text-red-400"
      : "bg-zinc-500/20 text-zinc-400"; // insufficient_data

  return (
    <div className="px-3 py-2 border-t border-[#262626] bg-[#111] space-y-1.5">
      {/* Bar row */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest shrink-0">
          Confidence
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>
        <span className="text-[9px] font-mono" style={{ color: barColor }}>
          {pct}%
        </span>
        <span
          className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-widest ${labelBg}`}
        >
          {confidenceLabel.replace("_", " ")}
        </span>
        {dataQuality && (
          <span className="text-[9px] font-mono text-white/25 px-1.5 py-0.5 rounded bg-white/5 uppercase tracking-widest">
            Data: {dataQuality}
          </span>
        )}
      </div>

      {/* What would change conclusion */}
      <p className="text-[9px] italic text-white/35 leading-snug">
        What would change this: {whatWouldChangeConclusion}
      </p>

      {/* Data gaps */}
      {dataGaps && (
        <p className="text-[9px] text-white/25 leading-snug">
          Gaps: {dataGaps}
        </p>
      )}
    </div>
  );
}
