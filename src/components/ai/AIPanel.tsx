import React from "react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { PlanQueue } from "./PlanQueue";
import { AIChat } from "./AIChat";
import { QueryHistory } from "../history/QueryHistory";
import { FullSchema } from "../../lib/db/DbClient";
import { QueryResults } from "../../lib/stores/WorkspaceStore";

interface AIPanelProps {
  activePanel: string; // "agent" | "history" — other panels are never rendered via AIPanel
  currentSQL: string | null;
  currentResults: QueryResults | null;
  currentSchema: FullSchema | null;
  connectionId: string | null;
  onApplySQL: (sql: string) => void;
  onQuerySuccess: (results: QueryResults, sql: string) => void;
}

export function AIPanel({
  activePanel,
  currentSQL,
  currentResults,
  currentSchema,
  connectionId,
  onApplySQL,
  onQuerySuccess,
}: AIPanelProps) {
  const { agentMode, planQueue } = useWorkspaceStore();

  if (activePanel === "history") {
    return <QueryHistory />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Plan Queue — shown in plan mode when there are pending steps */}
      {agentMode === "plan" && planQueue.length > 0 && (
        <PlanQueue />
      )}

      {/* AI Chat */}
      <div className="flex-1 overflow-hidden">
        <AIChat
          currentSQL={currentSQL}
          currentResults={currentResults}
          currentSchema={currentSchema}
          connectionId={connectionId}
          onApplySQL={onApplySQL}
          onQuerySuccess={onQuerySuccess}
        />
      </div>
    </div>
  );
}
