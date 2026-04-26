import React from "react";

interface ViolationItem { rule: number; index: number; value: number; description: string; }
interface AnomalyItem { index: number; value: number; z_score: number; }
interface FreqItem { frequency: number; amplitude: number; }

interface Props {
  data: Record<string, unknown>;
}

export function StatResultView({ data }: Props) {
  const scalars = Object.entries(data).filter(
    ([, v]) => typeof v === "number" || typeof v === "string"
  ) as [string, number | string][];

  const violations = Array.isArray(data.violations) ? data.violations as ViolationItem[] : null;
  const anomalies = Array.isArray(data.anomalies) ? data.anomalies as AnomalyItem[] : null;
  const dominantFreqs = Array.isArray(data.dominant_frequencies) ? data.dominant_frequencies as FreqItem[] : null;

  return (
    <div className="space-y-2 mt-1">
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
    </div>
  );
}
