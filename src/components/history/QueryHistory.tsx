/**
 * QueryHistory — persisted list of executed queries.
 * Shown in the "History" panel tab. Click any entry to restore it to the editor.
 * Supports search filter and starring (bookmarking) entries.
 */
import React, { useState, useMemo } from "react";
import { Clock, Play, Copy, Trash2, Star, Search, X } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { toast } from "sonner";

const HISTORY_KEY = "daitalk_query_history";
const STARRED_KEY = "daitalk_starred_queries";
const MAX_HISTORY = 200;

export interface HistoryEntry {
  id: string;
  sql: string;
  rowCount: number;
  elapsedMs: number;
  timestamp: number;
  error?: string;
}

// ── History store (localStorage) ─────────────────────────────────────────────

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryEntry[];
  } catch {}
  return [];
}

export function pushHistory(entry: Omit<HistoryEntry, "id">): void {
  const entries = loadHistory();
  // Deduplicate: don't add if same SQL as most recent entry
  if (entries.length > 0 && entries[0].sql === entry.sql && !entry.error) return;
  const newEntry: HistoryEntry = { ...entry, id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  const updated = [newEntry, ...entries].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

function saveStarred(starred: Set<string>): void {
  localStorage.setItem(STARRED_KEY, JSON.stringify([...starred]));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QueryHistory() {
  const { setEditorSql } = useWorkspaceStore();
  const [entries, setEntries] = useState<HistoryEntry[]>(loadHistory);
  const [starred, setStarred] = useState<Set<string>>(loadStarred);
  const [search, setSearch] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);

  const reload = () => setEntries(loadHistory());

  const handleClear = () => {
    clearHistory();
    setEntries([]);
    toast.success("History cleared");
  };

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStarred(next);
      return next;
    });
  };

  const filteredEntries = useMemo(() => {
    let list = entries;
    if (starredOnly) list = list.filter((e) => starred.has(e.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.sql.toLowerCase().includes(q));
    }
    return list;
  }, [entries, starred, starredOnly, search]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/10 gap-2">
        <Clock className="w-8 h-8" />
        <p className="text-xs uppercase tracking-widest">No query history yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="flex-1 flex items-center gap-1.5 bg-[#111] border border-[#2a2a2a] rounded-lg px-2 py-1">
          <Search className="w-3 h-3 text-white/20 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SQL…"
            className="flex-1 bg-transparent text-[10px] text-white/60 placeholder:text-white/20 focus:outline-none font-mono"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-white/20 hover:text-white/60">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setStarredOnly((v) => !v)}
          className={`p-1.5 rounded-lg transition-colors ${starredOnly ? "text-amber-400 bg-amber-500/10" : "text-white/20 hover:text-white/50"}`}
          title={starredOnly ? "Show all" : "Show starred only"}
        >
          <Star className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleClear}
          className="p-1.5 text-white/15 hover:text-red-400/60 transition-colors"
          title="Clear history"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Count line */}
      <div className="px-3 py-1 border-b border-[#111] shrink-0">
        <span className="text-[9px] font-mono text-white/20">
          {filteredEntries.length} of {entries.length} · {starred.size} starred
        </span>
      </div>

      {filteredEntries.length === 0 && (
        <div className="flex items-center justify-center h-24 text-white/15 text-[10px] font-mono">
          No matches
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-[#1a1a1a]">
        {filteredEntries.map((entry) => (
          <HistoryRow
            key={entry.id}
            entry={entry}
            isStarred={starred.has(entry.id)}
            onStar={() => toggleStar(entry.id)}
            onRestore={() => {
              setEditorSql(entry.sql);
              toast.success("SQL restored to editor");
            }}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({
  entry, isStarred, onStar, onRestore,
}: {
  entry: HistoryEntry;
  isStarred: boolean;
  onStar: () => void;
  onRestore: () => void;
}) {
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.sql);
    toast.success("Copied to clipboard");
  };

  return (
    <div className={`px-3 py-2.5 hover:bg-white/[0.02] group transition-colors ${isStarred ? "border-l-2 border-amber-500/40" : ""}`}>
      {/* SQL preview */}
      <pre className="text-[10px] font-mono text-white/60 whitespace-pre-wrap break-all leading-relaxed line-clamp-3">
        {entry.sql.trim()}
      </pre>

      {/* Meta + actions */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-2 text-[9px] font-mono text-white/20">
          <span>{dateStr} {timeStr}</span>
          {entry.error ? (
            <span className="text-red-400/60">error</span>
          ) : (
            <>
              <span className="text-white/10">·</span>
              <span>{entry.rowCount.toLocaleString()} rows</span>
              <span className="text-white/10">·</span>
              <span>{entry.elapsedMs}ms</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onStar}
            className={`p-1 transition-colors ${isStarred ? "text-amber-400 opacity-100" : "text-white/20 hover:text-amber-400/60"}`}
            title={isStarred ? "Unstar" : "Star this query"}
          >
            <Star className={`w-3 h-3 ${isStarred ? "fill-current" : ""}`} />
          </button>
          <button
            onClick={handleCopy}
            className="p-1 text-white/20 hover:text-white/60 transition-colors"
            title="Copy SQL"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={onRestore}
            className="p-1 text-[#00d2ff]/40 hover:text-[#00d2ff] transition-colors"
            title="Restore to editor"
          >
            <Play className="w-3 h-3 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
}
