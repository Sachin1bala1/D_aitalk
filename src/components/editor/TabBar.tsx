/**
 * TabBar - editor tab strip.
 * - Click to switch tab
 * - Double-click title to rename inline
 * - X button to close (also Ctrl+W)
 * - + button / Ctrl+T for new SQL tab
 * - Dashboard button / Ctrl+Shift+T for new dashboard tab
 */
import React, { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Plus, X } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    addTab,
    createDashboardTab,
    updateTab,
    activeConnectionId,
  } = useWorkspaceStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const queryTabCount = tabs.filter((tab) => tab.type !== "dashboard").length;
  const dashboardTabCount = tabs.filter((tab) => tab.type === "dashboard").length;

  const handleNewSqlTab = () => {
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      type: "sql_editor",
      title: `Query ${queryTabCount + 1}`,
      sql: "",
      connectionId: activeConnectionId,
      queryResults: null,
      isExecuting: false,
    });
  };

  const handleNewDashboardTab = () => {
    const id = `dashboard-${Date.now()}`;
    createDashboardTab({
      id,
      title: `Dashboard ${dashboardTabCount + 1}`,
      connectionId: activeConnectionId,
    });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === "w" && tabs.length > 1) {
        e.preventDefault();
        closeTab(activeTabId);
        return;
      }

      if (e.key === "t") {
        e.preventDefault();
        if (e.shiftKey) {
          handleNewDashboardTab();
        } else {
          handleNewSqlTab();
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const currentIdx = tabs.findIndex((tab) => tab.id === activeTabId);
        if (currentIdx === -1) return;

        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + tabs.length) % tabs.length
          : (currentIdx + 1) % tabs.length;

        setActiveTab(tabs[nextIdx].id);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, tabs, closeTab, setActiveTab]);

  const startRename = (tab: { id: string; title: string }) => {
    setRenamingId(tab.id);
    setDraftTitle(tab.title);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 20);
  };

  const commitRename = () => {
    if (renamingId && draftTitle.trim()) {
      updateTab(renamingId, { title: draftTitle.trim() });
    }
    setRenamingId(null);
  };

  return (
    <div className="flex items-end h-9 bg-[#0a0a0a] border-b border-[#262626] overflow-x-auto shrink-0 scrollbar-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isRenaming = renamingId === tab.id;
        const isDashboardTab = tab.type === "dashboard";

        return (
          <div
            key={tab.id}
            onClick={() => {
              if (!isRenaming) setActiveTab(tab.id);
            }}
            className={`group relative flex items-center gap-2 px-4 h-full min-w-0 max-w-[200px] cursor-pointer select-none border-r border-[#1a1a1a] shrink-0 transition-colors ${
              isActive
                ? "bg-[#0d0d0d] text-white/80"
                : "bg-[#0a0a0a] text-white/30 hover:text-white/50 hover:bg-[#0c0c0c]"
            }`}
          >
            {isActive && (
              <span className="absolute top-0 left-0 right-0 h-[2px] bg-[#00d2ff]" />
            )}

            {tab.isExecuting && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}

            {isDashboardTab && (
              <LayoutDashboard
                className={`w-3 h-3 shrink-0 ${
                  isActive ? "text-cyan-300" : "text-cyan-400/60"
                }`}
              />
            )}

            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="text-[11px] font-medium bg-transparent border-b border-[#00d2ff]/60 focus:outline-none text-white w-full min-w-0"
                style={{ maxWidth: 132 }}
              />
            ) : (
              <span
                className="text-[11px] font-medium truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(tab);
                }}
                title={isDashboardTab ? "Dashboard tab" : "Double-click to rename"}
              >
                {tab.title}
              </span>
            )}

            {tabs.length > 1 && !isRenaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={`shrink-0 rounded p-0.5 transition-colors ${
                  isActive
                    ? "text-white/30 hover:text-white/70 hover:bg-white/10"
                    : "text-transparent group-hover:text-white/30 group-hover:hover:text-white/60"
                }`}
                title="Close tab (Ctrl+W)"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={handleNewSqlTab}
        className="flex items-center justify-center w-8 h-full text-white/20 hover:text-white/50 hover:bg-white/5 transition-colors shrink-0"
        title="New SQL tab (Ctrl+T)"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleNewDashboardTab}
        className="flex items-center justify-center w-8 h-full text-cyan-400/30 hover:text-cyan-300 hover:bg-cyan-400/5 transition-colors shrink-0 border-l border-[#1a1a1a]"
        title="New dashboard tab (Ctrl+Shift+T)"
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
