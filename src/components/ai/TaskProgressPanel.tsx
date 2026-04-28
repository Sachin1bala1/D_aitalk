import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function TaskProgressPanel() {
  const currentTask = useWorkspaceStore((s) => s.currentTask);
  if (!currentTask) return null;
  return (
    <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-[#00d2ff]/5 border border-[#00d2ff]/20 text-xs text-[#00d2ff]/70">
      <div className="flex items-center gap-2 min-w-0">
        <span className="animate-spin">⟳</span>
        <span className="font-mono truncate">{currentTask.userGoal}</span>
        <span className="ml-auto text-white/30">{currentTask.status}</span>
      </div>
    </div>
  );
}
