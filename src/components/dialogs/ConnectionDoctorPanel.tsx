import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Loader2, Copy, ChevronDown, ChevronUp, Wrench } from "lucide-react";
import type { DiagnosisResult } from "../../lib/connection/ConnectionDoctor";
import type { ConnectionConfig } from "../../lib/db/DbClient";

interface ConnectionDoctorPanelProps {
  isRunning: boolean;
  steps: string[];
  result: DiagnosisResult | null;
  onUseFixedConfig: (config: ConnectionConfig) => void;
  onDismiss: () => void;
}

export function ConnectionDoctorPanel({
  isRunning,
  steps,
  result,
  onUseFixedConfig,
  onDismiss,
}: ConnectionDoctorPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const copySteps = () => {
    if (!result) return;
    const text = [result.explanation, "", "Steps to fix:", ...result.actionSteps].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse AI JSON safely
  let aiParsed: Record<string, unknown> | null = null;
  if (result?.aiDiagnosis) {
    try {
      const match = result.aiDiagnosis.match(/\{[\s\S]*\}/);
      if (match) aiParsed = JSON.parse(match[0]);
    } catch {
      // ignore parse errors
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-[#0d0d14] overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <Wrench size={13} className="text-[#00d2ff]/70" />
        <span className="font-semibold text-white/70">Connection Doctor</span>
        {isRunning && <Loader2 size={12} className="animate-spin text-[#00d2ff]/60 ml-auto" />}
        {result?.fixed && <CheckCircle size={13} className="text-green-400 ml-auto" />}
        {result && !result.fixed && !isRunning && <XCircle size={13} className="text-red-400/70 ml-auto" />}
      </div>

      {/* Diagnostic steps */}
      <div className="px-3 py-2 space-y-1 max-h-28 overflow-y-auto">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-white/50">
            <span className="mt-0.5 shrink-0">
              {step.startsWith("✓") ? "✓" : step.startsWith("✗") ? "✗" : "·"}
            </span>
            <span
              className={
                step.startsWith("✓")
                  ? "text-green-400/70"
                  : step.startsWith("✗")
                  ? "text-red-400/50"
                  : ""
              }
            >
              {step}
            </span>
          </div>
        ))}
        <div ref={stepsEndRef} />
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {result.fixed ? (
            <>
              <p className="text-green-400/80 font-medium">Auto-fixed! Ready to connect.</p>
              <p className="text-white/40">{result.actionSteps[0]}</p>
              <button
                onClick={() => result.fixedConfig && onUseFixedConfig(result.fixedConfig)}
                className="w-full py-1.5 rounded-md bg-green-500/20 border border-green-500/30 text-green-300 hover:bg-green-500/30 transition-colors font-medium"
              >
                Connect with fix applied
              </button>
            </>
          ) : (
            <>
              {/* AI diagnosis if available */}
              {aiParsed ? (
                <div className="space-y-1">
                  <p className="text-white/70 font-medium">
                    {String(aiParsed.root_cause ?? result.explanation)}
                  </p>
                  <div className="space-y-0.5">
                    {((aiParsed.fix_steps as string[] | undefined) ?? result.actionSteps).map(
                      (step, i) => (
                        <div key={i} className="text-white/40 flex gap-1.5">
                          <span className="text-[#00d2ff]/50 shrink-0">{i + 1}.</span>
                          <span>{step}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white/60">{result.explanation}</p>
                  <div className="space-y-0.5">
                    {result.actionSteps.map((step, i) => (
                      <div key={i} className="text-white/40 flex gap-1.5">
                        <span className="text-[#00d2ff]/50 shrink-0">{i + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attempts detail toggle */}
              {result.fixAttempts.length > 0 && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-white/30 hover:text-white/50 transition-colors"
                >
                  {showDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  {result.fixAttempts.length} fix{result.fixAttempts.length !== 1 ? "es" : ""} tried
                </button>
              )}
              {showDetails && (
                <div className="space-y-0.5 pl-2 border-l border-white/5">
                  {result.fixAttempts.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-white/30">
                      <span>{a.success ? "✓" : "✗"}</span>
                      <span>{a.description}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={copySteps}
                  className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/60 hover:border-white/20 transition-colors"
                >
                  <Copy size={11} />
                  {copied ? "Copied!" : "Copy fix"}
                </button>
                <button
                  onClick={onDismiss}
                  className="px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/60 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
