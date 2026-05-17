import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import type { SubTask, SubTaskStatus } from "../../lib/agent/TaskState";

function StatusIcon({ status }: { status: SubTaskStatus }) {
  if (status === "complete") {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  }
  if (status === "failed") {
    return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  }
  if (status === "awaiting_approval" || status === "retry_requested") {
    return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  }
  if (status === "pending") {
    return <Clock3 className="w-3.5 h-3.5 text-white/25" />;
  }
  return <LoaderCircle className="w-3.5 h-3.5 text-[#00d2ff] animate-spin" />;
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function verificationMeta(subtask: SubTask): {
  icon: ReactNode;
  label: string;
  tone: string;
} | null {
  if (subtask.verificationPassed === true) {
    if (subtask.verificationMode === "best_effort") {
      return {
        icon: <AlertTriangle className="w-3 h-3" />,
        label: "not deterministically verified",
        tone: "text-amber-300",
      };
    }
    return {
      icon: <ShieldCheck className="w-3 h-3" />,
      label: "verified",
      tone: "text-emerald-300",
    };
  }

  if (subtask.verificationPassed === false) {
    return {
      icon: <ShieldAlert className="w-3 h-3" />,
      label: "verification failed",
      tone: "text-red-300",
    };
  }

  if (subtask.status === "complete" && subtask.diagnosis) {
    return {
      icon: <AlertTriangle className="w-3 h-3" />,
      label: "not deterministically verified",
      tone: "text-amber-300",
    };
  }

  return null;
}

export function TaskProgressPanel() {
  const currentTask = useWorkspaceStore((state) => state.currentTask);
  const taskCheckpoint = useWorkspaceStore((state) => state.taskCheckpoint);
  if (!currentTask) {
    if (taskCheckpoint?.lifecycle !== "interrupted") return null;

    const interruptedSubtask =
      taskCheckpoint.task.subtasks[taskCheckpoint.task.currentIndex] ?? null;

    return (
      <div className="mx-4 mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-mono text-amber-200/80 truncate">{taskCheckpoint.task.userGoal}</span>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-white/35">
            interrupted
          </span>
        </div>
        {interruptedSubtask && (
          <div className="mt-2 rounded bg-white/[0.04] px-2 py-1 text-white/65">
            {interruptedSubtask.goal}
          </div>
        )}
      </div>
    );
  }

  const activeSubtask = currentTask.subtasks[currentTask.currentIndex] ?? null;

  return (
    <div className="mx-4 mb-2 rounded-lg border border-[#00d2ff]/20 bg-[#00d2ff]/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <LoaderCircle className="w-3.5 h-3.5 text-[#00d2ff] animate-spin shrink-0" />
        <span className="font-mono text-[#00d2ff]/80 truncate">{currentTask.userGoal}</span>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-white/35">
          {statusLabel(currentTask.status)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {currentTask.subtasks.map((subtask, index) => {
          const verification = verificationMeta(subtask);
          return (
            <div
              key={subtask.id}
              className={`flex items-center gap-2 rounded px-2 py-1 ${
                index === currentTask.currentIndex ? "bg-white/[0.04]" : ""
              }`}
            >
              <div className="flex w-full min-w-0 items-start gap-2">
                <div className="pt-0.5">
                  <StatusIcon status={subtask.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-white/75">
                      {subtask.goal}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-white/30">
                      {statusLabel(subtask.status)}
                    </span>
                  </div>
                  {(subtask.diagnosis || verification) && (
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      {verification && (
                        <span className={`inline-flex items-center gap-1 uppercase tracking-widest ${verification.tone}`}>
                          {verification.icon}
                          {verification.label}
                        </span>
                      )}
                      {subtask.diagnosis && (
                        <span className="truncate text-white/45">{subtask.diagnosis}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activeSubtask?.auditLog.length ? (
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/40 font-mono truncate">
          {activeSubtask.auditLog[activeSubtask.auditLog.length - 1]?.note ?? "Working"}
        </div>
      ) : null}
    </div>
  );
}
