import { useEffect } from "react";
import { toast } from "sonner";

import type { AppPanel } from "./useAppShellUi";
import { useWorkspaceStore } from "../stores/WorkspaceStore";

interface UseAppKeyboardShortcutsOptions {
  handleSaveSql: () => void;
  handleOpenFile: () => void;
  handleFormatSql: () => void;
  handleExplain: () => void;
  setActivePanel: (panel: AppPanel) => void;
  setShortcutsOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
}

export function useAppKeyboardShortcuts({
  handleSaveSql,
  handleOpenFile,
  handleFormatSql,
  handleExplain,
  setActivePanel,
  setShortcutsOpen,
  setQuickOpenOpen,
}: UseAppKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        handleSaveSql();
      }
      if (ctrl && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
      }
      if (ctrl && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
      if (ctrl && e.shiftKey && e.key === "F") {
        e.preventDefault();
        handleFormatSql();
      }
      if (ctrl && e.key === "t") {
        e.preventDefault();
      }
      if (e.key === "F5" && e.shiftKey) {
        e.preventDefault();
        handleExplain();
      }
      if (ctrl && e.key === "k") {
        e.preventDefault();
        setActivePanel("agent");
        setTimeout(() => {
          (document.querySelector("[data-ai-input]") as HTMLTextAreaElement | null)?.focus();
        }, 60);
      }
      if (ctrl && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setActivePanel("search");
      }
      if (ctrl && e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        setQuickOpenOpen(true);
      }
      if (ctrl && e.key === "z" && !e.shiftKey) {
        const entry = useWorkspaceStore.getState().popUndo();
        if (entry) {
          toast.info(`Undo: ${entry.humanReadable}`);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    handleExplain,
    handleFormatSql,
    handleOpenFile,
    handleSaveSql,
    setActivePanel,
    setQuickOpenOpen,
    setShortcutsOpen,
  ]);
}
