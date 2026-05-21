import React, { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { useWorkspaceStore, type WorkspacePanel } from "../../lib/stores/WorkspaceStore";
import {
  createSmokeConnection,
  createSmokeSchema,
  createSmokeWorkspaceSnapshot,
} from "../../lib/app/SmokeWorkspace";
import { WorkspaceSearchPanel } from "../search/WorkspaceSearchPanel";
import { ArtifactsPanel } from "../artifacts/ArtifactsPanel";
import { PipelinePanel } from "../pipelines/PipelinePanel";
import { BackgroundAgentsPanel } from "../agents/BackgroundAgentsPanel";

const PANEL_ORDER: WorkspacePanel[] = [
  "agent",
  "background_agents",
  "artifacts",
  "pipelines",
  "search",
];

export function SmokeWorkspaceShell() {
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("search");
  const {
    schemas,
    connections,
    activeConnectionId,
    activeTabId,
    updateTab,
    setActiveConnection,
    setEditorSql,
    setPendingChatInput,
    addConnection,
    setSchema,
    hydrateWorkspaceSession,
  } = useWorkspaceStore();

  useEffect(() => {
    const connection = createSmokeConnection();
    addConnection(connection);
    setSchema(connection.id, createSmokeSchema());
    setActiveConnection(connection.id);
    hydrateWorkspaceSession(createSmokeWorkspaceSnapshot());
  }, [addConnection, hydrateWorkspaceSession, setActiveConnection, setSchema]);

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-white overflow-hidden" data-testid="app-shell">
      <div className="w-64 border-r border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0" data-testid="schema-sidebar">
        <div className="h-12 flex items-center gap-2 px-4 border-b border-[#262626]">
          <div className="w-6 h-6 bg-[#00d2ff] rounded flex items-center justify-center">
            <Database className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="font-bold tracking-tight text-sm">DAITALK</span>
        </div>
        <div className="p-4 text-xs text-white/40">
          Smoke workspace
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0" data-testid="workspace-center">
        <div className="h-12 border-b border-[#262626] flex items-center px-4 text-xs text-white/40">
          Smoke-mode workspace shell
        </div>
        <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
          Core workspace surface
        </div>
      </div>

      <div className="w-96 border-l border-[#262626] flex flex-col bg-[#0d0d0d] shrink-0" data-testid="right-panel">
        <div className="h-12 border-b border-[#262626] flex items-center px-4 gap-4 shrink-0">
          {PANEL_ORDER.map((panel) => (
            <button
              key={panel}
              onClick={() => setActivePanel(panel)}
              data-testid={`panel-tab-${panel}`}
              className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                activePanel === panel ? "text-[#00d2ff]" : "text-white/30 hover:text-white/50"
              }`}
            >
              {panel === "agent"
                ? "AI"
                : panel === "background_agents"
                  ? "Agents"
                  : panel === "artifacts"
                    ? "Artifacts"
                    : panel === "pipelines"
                      ? "Pipes"
                      : "Search"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden" data-testid={`panel-content-${activePanel}`}>
          {activePanel === "search" ? (
            <WorkspaceSearchPanel
              schemas={schemas}
              connections={connections}
              onNavigate={(connId, sql) => {
                setActiveConnection(connId);
                updateTab(activeTabId, { connectionId: connId });
                setEditorSql(sql);
              }}
              onSelectPanel={(panel) => setActivePanel(panel)}
            />
          ) : activePanel === "artifacts" ? (
            <ArtifactsPanel />
          ) : activePanel === "pipelines" ? (
            <PipelinePanel />
          ) : activePanel === "background_agents" ? (
            <BackgroundAgentsPanel
              onTakeoverPrompt={(prompt) => {
                setPendingChatInput(prompt);
                setActivePanel("agent");
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/35" data-testid="ai-panel-stub">
              AI panel available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
