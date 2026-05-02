import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function HypothesisPanel() {
  const activeHypotheses = useWorkspaceStore((s) => s.activeHypotheses);
  const problemFrame = useWorkspaceStore((s) => s.hypothesisProblemFrame);
  const [open, setOpen] = useState(true);

  if (!activeHypotheses || activeHypotheses.length === 0) {
    return (
      <div className="mt-2 rounded border border-[#7B61FF]/20 px-3 py-2">
        <span className="text-[10px] font-mono text-white/30">No active hypotheses</span>
      </div>
    );
  }

  const sorted = [...activeHypotheses].sort((a, b) => b.probability - a.probability);

  return (
    <div className="mt-2 rounded border border-[#7B61FF]/20 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-[#7B61FF]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#7B61FF]" />
        )}
        <span className="text-[9px] font-mono text-[#7B61FF] uppercase tracking-widest">
          Hypotheses
        </span>
        <span className="ml-auto text-[9px] text-white/30">
          {sorted.length} competing · top {Math.round(sorted[0].probability * 100)}%
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-3">
          {problemFrame && (
            <p className="text-[10px] text-white/50 italic border-b border-white/10 pb-2 pt-1">
              {problemFrame}
            </p>
          )}
          {sorted.map((h, i) => {
            const pct = h.probability * 100;
            const barColor =
              h.probability > 0.6
                ? "bg-green-500"
                : h.probability >= 0.3
                ? "bg-amber-500"
                : "bg-red-500";

            return (
              <div key={i}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/60 w-8 text-right">
                    {Math.round(pct)}%
                  </span>
                </div>
                <p className="text-[11px] font-bold text-white leading-relaxed">{h.statement}</p>
                {h.evidence_for && (
                  <p className="text-[10px] text-green-400 mt-0.5">For: {h.evidence_for}</p>
                )}
                {h.evidence_against && (
                  <p className="text-[10px] text-red-400 mt-0.5">Against: {h.evidence_against}</p>
                )}
                {h.discriminating_test && (
                  <p className="text-[10px] text-teal-400 italic mt-0.5">
                    Test: {h.discriminating_test}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
