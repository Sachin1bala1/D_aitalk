import React from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import type { ReviewDossier } from "../../lib/review/DataChangeReviewEngine";

interface Props {
  open: boolean;
  dossier: ReviewDossier | null;
  title?: string;
  approveLabel?: string;
  onApprove: () => void;
  onCancel: () => void;
}

const severityStyle = {
  info: {
    icon: <Info className="h-3.5 w-3.5 text-cyan-300/70" />,
    text: "text-cyan-300/80",
    border: "border-cyan-500/20",
    bg: "bg-cyan-500/5",
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-300/70" />,
    text: "text-amber-300/80",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
  },
  critical: {
    icon: <ShieldAlert className="h-3.5 w-3.5 text-red-300/70" />,
    text: "text-red-300/80",
    border: "border-red-500/20",
    bg: "bg-red-500/5",
  },
} as const;

export function DataChangeReviewDialog({
  open,
  dossier,
  title,
  approveLabel = "Approve",
  onApprove,
  onCancel,
}: Props) {
  if (!open || !dossier) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-[#262626] bg-[#0d0d0d] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#1a1a1a] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/25">
              {title ?? "Review Required"}
            </div>
            <div className="mt-1 text-sm font-semibold text-white/80">{dossier.title}</div>
            <div className="mt-1 text-[11px] text-white/45">{dossier.summary}</div>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {dossier.sqlPreview && (
            <div className="mb-4">
              <div className="text-[9px] font-mono uppercase tracking-widest text-white/20">SQL / Query Preview</div>
              <pre className="mt-2 overflow-x-auto rounded border border-[#1f1f1f] bg-black/20 p-3 text-[10px] text-white/55">
                {dossier.sqlPreview}
              </pre>
            </div>
          )}

          <div className="space-y-2">
            {dossier.findings.map((finding, index) => {
              const tone = severityStyle[finding.severity];
              return (
                <div
                  key={`${finding.title}-${index}`}
                  className={`rounded-lg border px-3 py-2 ${tone.border} ${tone.bg}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">{tone.icon}</span>
                    <div className="min-w-0">
                      <div className={`text-[11px] font-semibold ${tone.text}`}>{finding.title}</div>
                      <div className="mt-1 text-[11px] leading-snug text-white/60">{finding.detail}</div>
                      {finding.evidence && finding.evidence.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[10px] font-mono text-white/35">
                          {finding.evidence.map((line) => (
                            <li key={line}>- {line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#1a1a1a] px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded border border-[#262626] px-3 py-2 text-[11px] font-semibold text-white/55 hover:text-white/80"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
