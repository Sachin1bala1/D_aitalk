/**
 * TabBar — editor tab strip.
 * - Click to switch tab
 * - Double-click title to rename inline
 * - × button to close (also Ctrl+W)
 * - + button / Ctrl+T for new tab
 */
import React, { useState, useRef, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab, updateTab, activeConnectionId, connections } =
    useWorkspaceStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleNewTab = () => {
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      type: "sql_editor",
      title: `Query ${tabs.length + 1}`,
      sql: "",
      connectionId: activeConnectionId,
      queryResults: null,
      isExecuting: false,
    });
  };

  // Tab keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === "w" && tabs.length > 1) {
        e.preventDefault();
        closeTab(activeTabId);
      } else if (e.key === "t") {
        e.preventDefault();
        handleNewTab();
      } else if (e.key === "Tab") {
        // Ctrl+Tab → next tab; Ctrl+Shift+Tab → previous tab
        e.preventDefault();
        const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
        if (currentIdx === -1) return;
        const next = e.shiftKey
          ? (currentIdx - 1 + tabs.length) % tabs.length
          : (currentIdx + 1) % tabs.length;
        setActiveTab(tabs[next].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, tabs]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const isDisconnected =
          !!tab.connectionId && !connections.some((connection) => connection.id === tab.connectionId);
        const hasRestoredSnapshot =
          (tab.type === "sql_editor" || tab.type === "table_viewer") && !!tab.restoredSnapshotAt;

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isRenaming) setActiveTab(tab.id); }}
            className={`group relative flex items-center gap-2 px-4 h-full min-w-0 max-w-[180px] cursor-pointer select-none border-r border-[#1a1a1a] shrink-0 transition-colors ${
              isActive
                ? "bg-[#0d0d0d] text-white/80"
                : "bg-[#0a0a0a] text-white/30 hover:text-white/50 hover:bg-[#0c0c0c]"
            }`}
          >
            {/* Active tab top accent */}
            {isActive && (
              <span className="absolute top-0 left-0 right-0 h-[2px] bg-[#00d2ff]" />
            )}

            {/* Executing indicator */}
            {tab.isExecuting && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}

            {/* Title — inline rename on double-click */}
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
                style={{ maxWidth: 120 }}
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="text-[11px] font-medium truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(tab); }}
                  title="Double-click to rename"
                >
                  {tab.title}
                </span>
                {hasRestoredSnapshot && (
                  <span className="shrink-0 rounded border border-amber-500/20 bg-amber-500/5 px-1 py-0.5 text-[8px] font-mono uppercase tracking-widest text-amber-300/70">
                    snapshot
                  </span>
                )}
                {isDisconnected && (
                  <span className="shrink-0 rounded border border-red-500/20 bg-red-500/5 px-1 py-0.5 text-[8px] font-mono uppercase tracking-widest text-red-300/70">
                    offline
                  </span>
                )}
              </div>
            )}

            {/* Close button */}
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

      {/* New tab button */}
      <button
        onClick={handleNewTab}
        className="flex items-center justify-center w-8 h-full text-white/20 hover:text-white/50 hover:bg-white/5 transition-colors shrink-0"
        title="New tab (Ctrl+T)"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
