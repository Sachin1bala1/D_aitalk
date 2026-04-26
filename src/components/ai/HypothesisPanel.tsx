import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Hypothesis } from "../../lib/ai/types";

interface Props {
  hypotheses: Hypothesis[];
}

export function HypothesisPanel({ hypotheses }: Props) {
  const [open, setOpen] = useState(false);
  if (!hypotheses?.length) return null;

  const sorted = [...hypotheses].sort((a, b) => b.probability - a.probability);

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
          {sorted.map((h, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1.5 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#7B61FF] transition-all"
                    style={{ width: `${h.probability * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-[#7B61FF] w-8 text-right">
                  {Math.round(h.probability * 100)}%
                </span>
              </div>
              <p className="text-[11px] text-white/70 leading-relaxed">{h.text}</p>
              {h.evidence_for.length > 0 && (
                <p className="text-[10px] text-green-400/60 mt-0.5">
                  + {h.evidence_for.join(" · ")}
                </p>
              )}
              {h.evidence_against.length > 0 && (
                <p className="text-[10px] text-red-400/60 mt-0.5">
                  − {h.evidence_against.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
