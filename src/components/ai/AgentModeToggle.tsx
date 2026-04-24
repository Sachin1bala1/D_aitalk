import React from "react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function AgentModeToggle() {
  const { agentMode, setAgentMode } = useWorkspaceStore();

  return (
    <div className="flex items-center gap-1 rounded-full border border-[#333] p-0.5 bg-[#1a1a1a]">
      <button
        onClick={() => setAgentMode("plan")}
        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
          agentMode === "plan"
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
            : "text-white/30 hover:text-white/50"
        }`}
      >
        Plan
      </button>
      <button
        onClick={() => setAgentMode("auto")}
        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
          agentMode === "auto"
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
            : "text-white/30 hover:text-white/50"
        }`}
      >
        Auto
      </button>
    </div>
  );
}
