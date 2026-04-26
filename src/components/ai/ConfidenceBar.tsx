import React from "react";

interface Props {
  confidence: number;
  system: "fast" | "slow";
}

export function ConfidenceBar({ confidence, system }: Props) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.85 ? "#39FF14" : confidence >= 0.6 ? "#FFD700" : "#FF4D8D";

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">
        {system === "fast" ? "⚡ fast" : "🧠 slow"}
      </span>
      <div className="h-1 rounded-full bg-white/10 w-16">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-mono" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}
