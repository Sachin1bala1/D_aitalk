/**
 * PlanQueue — shows pending plan steps and executes them when approved.
 *
 * "Approve" dispatches the stored AgentCommand via CommandBus and
 * updates step status to done/failed. "Reject" removes it without running.
 */
import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Shield, Zap, Loader2 } from "lucide-react";
import { useWorkspaceStore, PlanStep } from "../../lib/stores/WorkspaceStore";
import { commandBus } from "../../lib/agent/CommandBus";
import { describeCommand } from "../../lib/agent/commands";
import type { SubTaskStatus, Task, VerificationMode } from "../../lib/agent/TaskState";
import { DbClient } from "../../lib/db/DbClient";
import type { AgentCommand } from "../../lib/agent/commands";
import { toast } from "sonner";
import { verifyMutationCommand } from "../../lib/agent/VerificationEngine";
import { buildCommandReview, type ReviewDossier } from "../../lib/review/DataChangeReviewEngine";
import { ensurePipelinesLoaded, inspectPipelines } from "../../lib/pipelines/PipelineStore";
import { ensureBackgroundAgentsLoaded, listBackgroundAgents } from "../../lib/backgroundAgents/BackgroundAgentStore";

interface ApprovalSyncMeta {
  note: string;
  verificationPassed?: boolean;
  verificationMode?: VerificationMode;
  diagnosis?: string;
  commandType?: string;
  sql?: string;
  queryId?: string | null;
  sourceTables?: string[];
}

async function recordPlanAudit(
  step: PlanStep,
  outcome: "approved" | "rejected" | "failed",
  extra?: Record<string, unknown>,
) {
  const state = useWorkspaceStore.getState();
  await DbClient.recordSecurityAudit({
    event_type: "ai_plan_approval",
    outcome,
    details_json: {
      stepId: step.id,
      taskId: step.taskId ?? null,
      subtaskId: step.subtaskId ?? null,
      commandType: step.commandType,
      riskLevel: step.riskLevel,
      description: step.humanReadable,
      reviewSummary: step.review?.summary ?? null,
      reviewFindings: step.review?.findings ?? [],
      connectionId: state.activeConnectionId,
      activeTabId: state.activeTabId,
      ...extra,
    },
  }).catch(() => {});
}

function syncTaskApprovalState(
  step: PlanStep,
  next: "executing" | "complete" | "failed" | "rejected",
  meta: ApprovalSyncMeta,
) {
  const store = useWorkspaceStore.getState();
  const task = store.currentTask ?? store.taskCheckpoint?.task ?? null;
  if (!task || !step.taskId || task.id !== step.taskId) return;

  const subtaskIndex = task.subtasks.findIndex((subtask) => subtask.id === step.subtaskId);
  if (subtaskIndex === -1) return;

  const mappedStatus: SubTaskStatus =
    next === "executing"
      ? "executing"
      : next === "complete"
        ? "complete"
        : "failed";

  const updatedTask: Task = {
    ...task,
    currentIndex: subtaskIndex,
    status: (next === "executing" ? "running" : next === "complete" ? "complete" : "failed") as Task["status"],
    subtasks: task.subtasks.map((subtask, index) =>
      index === subtaskIndex
        ? {
            ...subtask,
            status: mappedStatus,
            verificationPassed:
              meta.verificationPassed !== undefined
                ? meta.verificationPassed
                : subtask.verificationPassed,
            verificationMode: meta.verificationMode ?? subtask.verificationMode,
            diagnosis: meta.diagnosis ?? subtask.diagnosis,
            provenance: {
              connectionId: store.activeConnectionId,
              activeTabId: store.activeTabId,
              latestSql: meta.sql ?? subtask.provenance?.latestSql ?? subtask.sql,
              latestQueryId: meta.queryId ?? subtask.provenance?.latestQueryId ?? null,
              latestSourceTables: meta.sourceTables ?? subtask.provenance?.latestSourceTables ?? [],
              commandTypes: meta.commandType
                ? Array.from(new Set([...(subtask.provenance?.commandTypes ?? []), meta.commandType]))
                : subtask.provenance?.commandTypes,
              toolNames: subtask.provenance?.toolNames,
            },
            auditLog: [
              ...subtask.auditLog,
              {
                state: mappedStatus,
                timestamp: Date.now(),
                note: meta.note,
                verificationPassed: meta.verificationPassed,
                verificationMode: meta.verificationMode,
                commandTypes: meta.commandType ? [meta.commandType] : undefined,
                sql: meta.sql ?? subtask.sql,
                queryId: meta.queryId ?? subtask.provenance?.latestQueryId ?? null,
                sourceTables: meta.sourceTables ?? subtask.provenance?.latestSourceTables ?? [],
              },
            ],
          }
        : subtask,
    ),
  };

  store.setCurrentTask(updatedTask);
  if (next === "complete" || next === "failed" || next === "rejected") {
    const hasNextSubtask = subtaskIndex + 1 < task.subtasks.length;
    if (next === "complete" && hasNextSubtask) {
      const resumedTask: Task = {
        ...updatedTask,
        currentIndex: subtaskIndex + 1,
        status: "running",
        subtasks: updatedTask.subtasks.map((subtask, index) =>
          index === subtaskIndex + 1
            ? {
                ...subtask,
                status: "planning",
                auditLog: [
                  ...subtask.auditLog,
                  {
                    state: "planning",
                    timestamp: Date.now(),
                    note: `Resuming after approval: ${step.humanReadable}`,
                  },
                ],
              }
            : subtask,
        ),
      };

      store.setCurrentTask(resumedTask);
      if (store.taskCheckpoint) {
        const resumeCheckpoint = {
          ...store.taskCheckpoint,
          task: resumedTask,
          lifecycle: "running" as const,
          updatedAt: Date.now(),
          lastCheckpointNote: meta.note,
        };
        store.setTaskCheckpoint(resumeCheckpoint);
        store.requestPendingTaskResume(resumeCheckpoint);
      }
      return;
    }

    store.clearTaskCheckpoint();
    store.clearPendingTaskResume();
  } else if (store.taskCheckpoint) {
      store.setTaskCheckpoint({
        ...store.taskCheckpoint,
        task: updatedTask,
        lifecycle: "running",
        updatedAt: Date.now(),
        lastCheckpointNote: meta.note,
      });
  }
}

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

  updatePlanStep(step.id, { status: "executing" });
  syncTaskApprovalState(step, "executing", {
    note: `Approved: ${step.humanReadable}`,
  });

  try {
      const result = await commandBus.dispatch(step.command);
    if (result.success) {
      const verification = await verifyMutationCommand(
        step.command,
        useWorkspaceStore.getState().activeConnectionId,
      );
      if (!verification.passed) {
        updatePlanStep(step.id, { status: "failed", errorMessage: verification.diagnosis });
        syncTaskApprovalState(step, "failed", {
          note: verification.diagnosis,
          verificationPassed: false,
          verificationMode: verification.verificationMode,
          diagnosis: verification.diagnosis,
          commandType: step.command.type,
        });
        await recordPlanAudit(step, "failed", {
          phase: "post_verification",
          diagnosis: verification.diagnosis,
          verificationMode: verification.verificationMode,
        });
        toast.error(`Verification failed: ${verification.diagnosis}`);
        return;
      }

      updatePlanStep(step.id, { status: "done" });
      const activeResults = useWorkspaceStore
        .getState()
        .tabs.find((tab) => tab.id === useWorkspaceStore.getState().activeTabId)?.queryResults ?? null;
      syncTaskApprovalState(step, "complete", {
        note: verification.diagnosis,
        verificationPassed: verification.verificationMode === "deterministic" ? true : undefined,
        verificationMode: verification.verificationMode,
        diagnosis: verification.diagnosis,
        commandType: step.command.type,
        queryId: activeResults?.queryId ?? null,
        sourceTables: activeResults?.source_tables ?? [],
      });
      if (verification.verificationMode !== "deterministic") {
        toast.info(`Executed with caution: ${verification.diagnosis}`);
      }
      await recordPlanAudit(step, "approved", {
        diagnosis: verification.diagnosis,
        verificationMode: verification.verificationMode,
      });
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
      syncTaskApprovalState(step, "failed", {
        note: result.error ?? `Approved step failed: ${step.humanReadable}`,
        verificationPassed: false,
        verificationMode: "deterministic",
        diagnosis: result.error ?? `Approved step failed: ${step.humanReadable}`,
        commandType: step.command.type,
      });
      await recordPlanAudit(step, "failed", {
        phase: "dispatch",
        error: result.error ?? `Approved step failed: ${step.humanReadable}`,
      });
      toast.error(`Failed: ${result.error}`);
    }
  } catch (e: any) {
    updatePlanStep(step.id, { status: "failed", errorMessage: e?.message ?? String(e) });
    syncTaskApprovalState(step, "failed", {
      note: e?.message ?? String(e),
      verificationPassed: false,
      verificationMode: "deterministic",
      diagnosis: e?.message ?? String(e),
      commandType: step.command.type,
    });
    await recordPlanAudit(step, "failed", {
      phase: "exception",
      error: e?.message ?? String(e),
    });
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
  const review = step.review;

  useEffect(() => {
    if (!step.command || step.review) return;
    let cancelled = false;
    void (async () => {
      await Promise.all([ensurePipelinesLoaded(), ensureBackgroundAgentsLoaded()]);
      const workspace = useWorkspaceStore.getState();
      const dossier = buildCommandReview(step.command!, workspace, {
        pipelines: inspectPipelines().pipelines,
        backgroundAgents: listBackgroundAgents(),
      });
      if (!cancelled && dossier) {
        updatePlanStep(step.id, { review: dossier });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step.command, step.id, step.review, updatePlanStep]);

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
                  syncTaskApprovalState(step, "rejected", {
                    note: `Rejected: ${step.humanReadable}`,
                    verificationPassed: false,
                    verificationMode: "deterministic",
                    diagnosis: `Rejected: ${step.humanReadable}`,
                    commandType: step.command?.type,
                  });
                  void recordPlanAudit(step, "rejected", {
                    diagnosis: `Rejected: ${step.humanReadable}`,
                  });
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

      {review && (
        <div className="rounded border border-[#1f1f1f] bg-black/20 p-2">
          <div className="text-[9px] font-mono uppercase tracking-widest text-white/25">
            Review Summary
          </div>
          <p className="mt-1 text-[10px] text-white/55">{review.summary}</p>
          <div className="mt-2 space-y-1.5">
            {review.findings.slice(0, 4).map((finding, index) => (
              <div key={`${finding.title}-${index}`} className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5">
                <div className={`text-[10px] font-semibold ${
                  finding.severity === "critical"
                    ? "text-red-300/80"
                    : finding.severity === "warning"
                      ? "text-amber-300/80"
                      : "text-cyan-300/80"
                }`}>
                  {finding.title}
                </div>
                <div className="mt-1 text-[10px] text-white/45">{finding.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step.status === "failed" && step.errorMessage && (
        <p className="text-[10px] text-red-400 font-mono break-all">{step.errorMessage}</p>
      )}
    </div>
  );
}
