import React, { useState } from "react";
import { Copy, MessageSquarePlus } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

interface ViolationItem { rule: number; index: number; value: number; description: string; }
interface AnomalyItem { index: number; value: number; z_score: number; }
interface FreqItem { frequency: number; amplitude: number; }
interface DetailedFactorItem {
  feature: string;
  contribution_pct?: number;
  correlation?: number;
  effect_direction?: string;
  effect_strength?: number;
}
interface RegressionFactorItem {
  feature: string;
  coefficient?: number;
  correlation?: number;
  effect_direction?: string;
  significance_band?: string;
  vif?: number | null;
}

interface Props {
  data: Record<string, unknown>;
  /** Optional label shown in the "Ask APEX" pre-fill text (e.g. "stat__describe result") */
  label?: string;
}

export function StatResultView({ data, label = "this statistical result" }: Props) {
  const setPendingChatInput = useWorkspaceStore((s) => s.setPendingChatInput);
  const [copied, setCopied] = useState(false);

  const scalars = Object.entries(data).filter(
    ([, v]) => typeof v === "number" || typeof v === "string"
  ) as [string, number | string][];

  const violations = Array.isArray(data.violations) ? data.violations as ViolationItem[] : null;
  const anomalies = Array.isArray(data.anomalies) ? data.anomalies as AnomalyItem[] : null;
  const dominantFreqs = Array.isArray(data.dominant_frequencies) ? data.dominant_frequencies as FreqItem[] : null;
  const detailedFactors = Array.isArray(data.detailed_factors) ? data.detailed_factors as DetailedFactorItem[] : null;
  const enrichedCoefficients = Array.isArray(data.enriched_coefficients) ? data.enriched_coefficients as RegressionFactorItem[] : null;

  function handleCopyData() {
    const raw = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  function handleAskApex() {
    const scalarSummary = scalars
      .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : v.toPrecision(5)) : v}`)
      .join(", ");
    const prompt = `Explain ${label}: ${scalarSummary || JSON.stringify(data).slice(0, 200)}. What does this mean for the process, and what should I do next?`;
    setPendingChatInput(prompt);
  }

  return (
    <div className="space-y-2 mt-1">
      {/* Toolbar */}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={handleCopyData}
          title="Copy raw data as JSON"
          className="flex items-center gap-1 text-[9px] text-white/25 hover:text-white/60 transition-colors font-mono uppercase tracking-widest"
        >
          <Copy className="w-2.5 h-2.5" />
          {copied ? "Copied!" : "Copy data"}
        </button>
        <button
          onClick={handleAskApex}
          title="Pre-fill chat with a question about this result"
          className="flex items-center gap-1 text-[9px] text-[#00d2ff]/50 hover:text-[#00d2ff] transition-colors font-mono uppercase tracking-widest"
        >
          <MessageSquarePlus className="w-2.5 h-2.5" />
          Ask APEX
        </button>
      </div>

      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          {scalars.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-[9px] text-white/30 uppercase tracking-wide font-mono">{k}</span>
              <span className="text-[10px] font-mono text-[#39FF14]">
                {typeof v === "number" ? (Number.isInteger(v) ? v : v.toPrecision(5)) : v}
              </span>
            </div>
          ))}
        </div>
      )}

      {violations !== null && (
        <div>
          <span className={`text-[9px] uppercase tracking-wide font-bold ${violations.length > 0 ? "text-red-400" : "text-[#39FF14]"}`}>
            {violations.length === 0 ? "✓ No violations" : `${violations.length} violation${violations.length !== 1 ? "s" : ""}`}
          </span>
          {violations.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {violations.slice(0, 5).map((v, i) => (
                <div key={i} className="text-[9px] text-red-300/70 font-mono">
                  Rule {v.rule} @ i={v.index}: {v.description}
                </div>
              ))}
              {violations.length > 5 && (
                <div className="text-[9px] text-white/30">+{violations.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {anomalies !== null && (
        <div>
          <span className={`text-[9px] uppercase tracking-wide font-bold ${anomalies.length > 0 ? "text-orange-400" : "text-[#39FF14]"}`}>
            {anomalies.length === 0 ? "✓ No anomalies" : `${anomalies.length} anomal${anomalies.length !== 1 ? "ies" : "y"}`}
          </span>
          {anomalies.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {anomalies.slice(0, 5).map((a, i) => (
                <div key={i} className="text-[9px] text-orange-300/70 font-mono">
                  i={a.index}: {a.value} (z={a.z_score})
                </div>
              ))}
              {anomalies.length > 5 && (
                <div className="text-[9px] text-white/30">+{anomalies.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {dominantFreqs !== null && dominantFreqs.length > 0 && (
        <div>
          <span className="text-[9px] text-white/30 uppercase tracking-wide">Dominant Frequencies</span>
          <div className="mt-0.5 space-y-0.5">
            {dominantFreqs.map((f, i) => (
              <div key={i} className="text-[9px] font-mono text-white/50">
                {f.frequency} Hz — amp {f.amplitude}
              </div>
            ))}
          </div>
        </div>
      )}

      {detailedFactors !== null && detailedFactors.length > 0 && (
        <div>
          <span className="text-[9px] text-white/30 uppercase tracking-wide">Top Drivers</span>
          <div className="mt-0.5 space-y-0.5">
            {detailedFactors.slice(0, 5).map((factor, i) => (
              <div key={i} className="text-[9px] font-mono text-white/60">
                {factor.feature}: {factor.contribution_pct?.toFixed?.(2) ?? factor.contribution_pct}% · {factor.effect_direction} · r={factor.correlation}
              </div>
            ))}
          </div>
        </div>
      )}

      {enrichedCoefficients !== null && enrichedCoefficients.length > 0 && (
        <div>
          <span className="text-[9px] text-white/30 uppercase tracking-wide">Regression Effects</span>
          <div className="mt-0.5 space-y-0.5">
            {enrichedCoefficients.slice(0, 5).map((factor, i) => (
              <div key={i} className="text-[9px] font-mono text-white/60">
                {factor.feature}: coef={factor.coefficient} · {factor.effect_direction} · band={factor.significance_band}
                {factor.vif != null ? ` · vif=${factor.vif}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
