/**
 * SnippetsPanel — save, browse, and insert SQL snippets.
 *
 * - "Save current SQL" button → dialog to name the snippet
 * - Live filter by name/tag
 * - Click snippet → insert into editor
 * - Delete button per snippet
 * - Edit name inline (double-click)
 */
import React, { useState, useRef } from "react";
import { BookMarked, Plus, Trash2, Play, Search, X, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  loadSnippets,
  addSnippet,
  deleteSnippet,
  updateSnippet,
  type Snippet,
} from "../../lib/snippets/SnippetStore";

interface SnippetsPanelProps {
  currentSQL: string | null;
  onInsert: (sql: string) => void;
}

export function SnippetsPanel({ currentSQL, onInsert }: SnippetsPanelProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [filterText, setFilterText] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const saveInputRef = useRef<HTMLInputElement>(null);

  const reload = () => setSnippets(loadSnippets());

  const handleSave = () => {
    if (!draftName.trim()) { toast.error("Snippet name is required"); return; }
    if (!currentSQL?.trim()) { toast.error("No SQL in editor"); return; }
    const tags = draftTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    addSnippet(draftName, currentSQL, tags);
    reload();
    setSaving(false);
    setDraftName("");
    setDraftTags("");
    toast.success("Snippet saved");
  };

  const handleDelete = (id: string, name: string) => {
    deleteSnippet(id);
    reload();
    toast.success(`"${name}" deleted`);
  };

  const commitRename = (id: string) => {
    if (renameDraft.trim()) updateSnippet(id, { name: renameDraft.trim() });
    setRenamingId(null);
    reload();
  };

  const filtered = snippets.filter((s) => {
    const q = filterText.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
  });

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          <BookMarked className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">
            Snippets · {snippets.length}
          </span>
        </div>
        <button
          onClick={() => {
            setSaving(true);
            setDraftName("");
            setDraftTags("");
            setTimeout(() => saveInputRef.current?.focus(), 40);
          }}
          disabled={!currentSQL?.trim()}
          className="flex items-center gap-1 text-[10px] text-[#00d2ff]/60 hover:text-[#00d2ff] disabled:opacity-20 transition-colors font-bold"
          title="Save current SQL as snippet"
        >
          <Plus className="w-3 h-3" /> Save SQL
        </button>
      </div>

      {/* Save form */}
      {saving && (
        <div className="px-3 py-3 border-b border-[#1a1a1a] bg-[#111] shrink-0 space-y-2">
          <p className="text-[9px] text-white/25 uppercase tracking-widest">New snippet</p>
          <input
            ref={saveInputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Snippet name…"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#00d2ff] placeholder:text-white/20"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setSaving(false);
            }}
          />
          <input
            type="text"
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            placeholder="Tags (comma-separated, optional)"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#00d2ff] placeholder:text-white/20"
          />
          {/* SQL preview */}
          <pre className="text-[10px] font-mono text-white/30 bg-black/30 border border-[#1a1a1a] rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap">
            {(currentSQL ?? "").slice(0, 300)}
            {(currentSQL ?? "").length > 300 ? "…" : ""}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 py-1.5 rounded bg-[#00d2ff] text-black text-xs font-bold hover:opacity-90"
            >
              Save
            </button>
            <button
              onClick={() => setSaving(false)}
              className="flex-1 py-1.5 rounded border border-[#2a2a2a] text-white/40 text-xs hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      {snippets.length > 4 && (
        <div className="px-3 py-1.5 border-b border-[#1a1a1a] shrink-0 flex items-center gap-2">
          <Search className="w-3 h-3 text-white/20 shrink-0" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter snippets…"
            className="flex-1 bg-transparent text-xs text-white/60 focus:outline-none placeholder:text-white/20"
          />
          {filterText && (
            <button onClick={() => setFilterText("")} className="text-white/20 hover:text-white/60">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1a1a1a]">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/10 gap-3 p-6 text-center">
            <BookMarked className="w-8 h-8" />
            <p className="text-xs uppercase tracking-widest">
              {snippets.length === 0 ? "No snippets yet" : "No matches"}
            </p>
            {snippets.length === 0 && (
              <p className="text-[10px] text-white/15 leading-relaxed">
                Write a SQL query and click "Save SQL" to create your first snippet.
              </p>
            )}
          </div>
        )}

        {filtered.map((snip) => (
          <div key={snip.id} className="px-3 py-2.5 group hover:bg-white/[0.02] transition-colors">
            {/* Name row */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              {renamingId === snip.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(snip.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(snip.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="flex-1 bg-transparent border-b border-[#00d2ff]/60 text-xs text-white focus:outline-none"
                />
              ) : (
                <span
                  className="text-xs font-semibold text-white/70 truncate flex-1 cursor-pointer hover:text-white transition-colors"
                  onDoubleClick={() => { setRenamingId(snip.id); setRenameDraft(snip.name); }}
                  title="Double-click to rename"
                >
                  {snip.name}
                </span>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => { onInsert(snip.sql); toast.success(`"${snip.name}" inserted`); }}
                  className="p-1 text-[#00d2ff]/40 hover:text-[#00d2ff] transition-colors"
                  title="Insert into editor"
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
                <button
                  onClick={() => handleDelete(snip.id, snip.name)}
                  className="p-1 text-white/20 hover:text-red-400 transition-colors"
                  title="Delete snippet"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* SQL preview */}
            <pre className="text-[10px] font-mono text-white/30 truncate">
              {snip.sql.replace(/\s+/g, " ").slice(0, 80)}
              {snip.sql.length > 80 ? "…" : ""}
            </pre>

            {/* Tags */}
            {snip.tags.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                <Tag className="w-2.5 h-2.5 text-white/15 shrink-0" />
                {snip.tags.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => setFilterText(tag)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 hover:text-white/50 cursor-pointer transition-colors font-mono"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
