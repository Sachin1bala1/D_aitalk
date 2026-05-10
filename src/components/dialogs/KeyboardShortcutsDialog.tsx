/**
 * KeyboardShortcutsDialog — lists all keyboard shortcuts.
 * Opened via the Settings gear icon or Ctrl+/
 */
import React from "react";
import { X, Keyboard } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { category: string; items: { keys: string[]; description: string }[] }[] = [
  {
    category: "Query Execution",
    items: [
      { keys: ["Ctrl", "Enter"], description: "Execute current query" },
      { keys: ["Ctrl", "Shift", "Enter"], description: "Execute selected SQL only" },
      { keys: ["Shift", "F5"], description: "EXPLAIN ANALYZE current query" },
    ],
  },
  {
    category: "SQL Editor",
    items: [
      { keys: ["Ctrl", "Shift", "F"], description: "Format / prettify SQL (dialect-aware)" },
      { keys: ["Ctrl", "Z"], description: "Undo (editor)" },
      { keys: ["Ctrl", "Y"], description: "Redo (editor)" },
      { keys: ["Ctrl", "A"], description: "Select all SQL" },
      { keys: ["Ctrl", "/"], description: "Toggle line comment" },
      { keys: ["Ctrl", "F"], description: "Find in editor" },
      { keys: ["Ctrl", "H"], description: "Find and replace" },
    ],
  },
  {
    category: "Result Table",
    items: [
      { keys: ["↑↓←→"], description: "Navigate cells (arrow keys)" },
      { keys: ["PgUp / PgDn"], description: "Jump 20 rows up/down" },
      { keys: ["Enter"], description: "Open row detail panel" },
      { keys: ["Delete"], description: "Copy DELETE SQL for selected rows" },
      { keys: ["Ctrl", "Shift", "C"], description: "Copy selected row as CSV" },
      { keys: ["Ctrl", "Shift", "J"], description: "Copy selected row as JSON" },
      { keys: ["Dbl-click"], description: "Edit cell inline (Enter to save, Esc to cancel)" },
    ],
  },
  {
    category: "Sidebar",
    items: [
      { keys: ["Dbl-click"], description: "SELECT * from table" },
      { keys: ["Right-click"], description: "Open table context menu" },
    ],
  },
  {
    category: "File",
    items: [
      { keys: ["Ctrl", "S"], description: "Save SQL file" },
      { keys: ["Ctrl", "O"], description: "Open .sql file" },
    ],
  },
  {
    category: "Navigation",
    items: [
      { keys: ["Ctrl", "T"], description: "New tab" },
      { keys: ["Ctrl", "W"], description: "Close current tab" },
      { keys: ["Ctrl", "Tab"], description: "Next tab" },
      { keys: ["Ctrl", "P"], description: "Quick open — fuzzy table picker" },
      { keys: ["Ctrl", "Shift", "S"], description: "Open schema search panel" },
      { keys: ["Ctrl", "Shift", "F"], description: "Focus schema search" },
      { keys: ["Escape"], description: "Close dialog / panel" },
    ],
  },
  {
    category: "AI Agent",
    items: [
      { keys: ["Ctrl", "Z"], description: "Undo last agent action (in chat)" },
      { keys: ["Ctrl", "K"], description: "Focus AI chat input" },
      { keys: ["Ctrl", "/"], description: "Toggle Plan Mode" },
    ],
  },
];

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-[#333] bg-[#1a1a1a] text-[10px] font-mono text-white/60">
      {label}
    </kbd>
  );
}

export function KeyboardShortcutsDialog({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[#00d2ff]" />
            <h2 className="text-sm font-bold">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {SHORTCUTS.map((section) => (
            <div key={section.category}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">
                {section.category}
              </h3>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div key={item.description} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-white/60">{item.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, i) => (
                        <React.Fragment key={k}>
                          {i > 0 && <span className="text-white/20 text-[10px]">+</span>}
                          <Key label={k} />
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
