/**
 * PlanQueue — shows pending plan steps and executes them when approved.
 *
 * "Approve" dispatches the stored AgentCommand via CommandBus and
 * updates step status to done/failed. "Reject" removes it without running.
 */
import React, { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Shield, Zap, Loader2 } from "lucide-react";
import { useWorkspaceStore, PlanStep } from "../../lib/stores/WorkspaceStore";
import { commandBus } from "../../lib/agent/CommandBus";
import { describeCommand } from "../../lib/agent/commands";
import { toast } from "sonner";
import { DbClient } from "../../lib/db/DbClient";

export function PlanQueue() {
  const { planQueue, clearPlanQueue, updatePlanStep, removePlanStep } = useWorkspaceStore();
  const pending = planQueue.filter((s) => s.status === "pending");

  const approveAll = async () => {
    for (const step of pending) {
      await executeStep(step, updatePlanStep);
    }
  };

  if (planQueue.length === 0) return null;

  return (
    <div className="border-b border-[#262626] bg-[#0d0d0d]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
          Planned Actions ({pending.length} pending)
        </span>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <button
              onClick={approveAll}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold transition-colors"
            >
              Approve All
            </button>
          )}
          <span className="text-white/20">·</span>
          <button
            onClick={() => clearPlanQueue()}
            className="text-[10px] text-white/30 hover:text-white/50 font-bold transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto divide-y divide-[#1a1a1a]">
        {planQueue.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

async function executeStep(
  step: PlanStep,
  updatePlanStep: (id: string, updates: Partial<PlanStep>) => void
) {
  if (!step.command) {
    updatePlanStep(step.id, { status: "failed", errorMessage: "Command not stored in step" });
    return;
  }

  updatePlanStep(step.id, { status: "approved" });
  await DbClient.recordSecurityAudit({
    event_type: "destructive_action_approval",
    outcome: "approved",
    details_json: {
      step_id: step.id,
      command_type: step.command.type,
      human_readable: step.humanReadable,
    },
  }).catch(() => {});

  updatePlanStep(step.id, { status: "executing" });

  try {
    const result = await commandBus.dispatch(step.command);
    if (result.success) {
      updatePlanStep(step.id, { status: "done" });
      await DbClient.recordSecurityAudit({
        event_type: "destructive_action_execution",
        outcome: "executed",
        details_json: {
          step_id: step.id,
          command_type: step.command.type,
          human_readable: step.humanReadable,
        },
      }).catch(() => {});
      toast.success(`Done: ${step.humanReadable}`);

      // Push to undo stack
      useWorkspaceStore.getState().pushUndo({
        id: step.id,
        humanReadable: step.humanReadable,
        command: step.command,
        timestamp: Date.now(),
      });
    } else {
      updatePlanStep(step.id, { status: "failed", errorMessage: result.error });
      await DbClient.recordSecurityAudit({
        event_type: "destructive_action_execution",
        outcome: "failed",
        details_json: {
          step_id: step.id,
          command_type: step.command.type,
          human_readable: step.humanReadable,
          error: result.error,
        },
      }).catch(() => {});
      toast.error(`Failed: ${result.error}`);
    }
  } catch (e: any) {
    updatePlanStep(step.id, { status: "failed", errorMessage: e?.message ?? String(e) });
    await DbClient.recordSecurityAudit({
      event_type: "destructive_action_execution",
      outcome: "failed",
      details_json: {
        step_id: step.id,
        command_type: step.command.type,
        human_readable: step.humanReadable,
        error: e?.message ?? String(e),
      },
    }).catch(() => {});
    toast.error(`Error: ${e?.message}`);
  }
}

const RISK_CONFIG = {
  safe: {
    icon: <Shield className="w-3 h-3 text-emerald-400" />,
    label: "SAFE",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  caution: {
    icon: <Zap className="w-3 h-3 text-amber-400" />,
    label: "CAUTION",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  destructive: {
    icon: <AlertTriangle className="w-3 h-3 text-red-400" />,
    label: "DESTRUCTIVE",
    color: "text-red-400",
    bg: "bg-red-500/10",
  },
} as const;

function StepCard({ step }: { step: PlanStep }) {
  const { updatePlanStep, removePlanStep } = useWorkspaceStore();
  const [running, setRunning] = useState(false);
  const risk = RISK_CONFIG[step.riskLevel];

  const handleApprove = async () => {
    setRunning(true);
    await executeStep(step, updatePlanStep);
    setRunning(false);
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span
            className={`shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${risk.bg} ${risk.color} flex items-center gap-1`}
          >
            {risk.icon}
            {risk.label}
          </span>
          <span className="text-xs text-white/70 leading-tight break-words">{step.humanReadable}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {step.status === "pending" && (
            <>
              <button
                onClick={handleApprove}
                disabled={running}
                className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors disabled:opacity-40"
                title="Approve & Run"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  updatePlanStep(step.id, { status: "rejected" });
                  DbClient.recordSecurityAudit({
                    event_type: "destructive_action_approval",
                    outcome: "rejected",
                    details_json: {
                      step_id: step.id,
                      command_type: step.commandType,
                      human_readable: step.humanReadable,
                    },
                  }).catch(() => {});
                  removePlanStep(step.id);
                }}
                className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Reject"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          )}
          {(step.status === "executing" || running) && (
            <Loader2 className="w-4 h-4 text-[#00d2ff] animate-spin" />
          )}
          {step.status === "done" && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          {step.status === "failed" && (
            <span className="text-[10px] text-red-400 font-bold">Failed</span>
          )}
          {step.status === "rejected" && (
            <span className="text-[10px] text-white/30 font-bold">Rejected</span>
          )}
        </div>
      </div>

      {step.sqlPreview && (
        <pre className="text-[10px] font-mono text-white/40 bg-black/40 rounded p-2 overflow-x-auto border border-[#1a1a1a]">
          {step.sqlPreview}
        </pre>
      )}

      {step.status === "failed" && step.errorMessage && (
        <p className="text-[10px] text-red-400 font-mono break-all">{step.errorMessage}</p>
      )}
    </div>
  );
}
