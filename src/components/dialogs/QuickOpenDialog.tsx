/**
 * QuickOpenDialog — Ctrl+P fuzzy table picker.
 * Shows all tables/views from all connected schemas in a searchable list.
 * Selecting a table/view generates SELECT * FROM ... LIMIT 500 and opens it.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Table2, Eye, Layers, Database } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { FullSchema, TableMeta } from "../../lib/db/DbClient";
import type { ConnectionConfig } from "../../lib/db/DbClient";

interface QuickOpenDialogProps {
  open: boolean;
  schemas: Record<string, FullSchema>;
  connections: ConnectionConfig[];
  onClose: () => void;
  onSelect: (connectionId: string, sql: string) => void;
}

interface TableOption {
  connectionId: string;
  connectionName: string;
  schema: string;
  name: string;
  objectType: TableMeta["object_type"];
  key: string;
}

export function QuickOpenDialog({ open, schemas, connections, onClose, onSelect }: QuickOpenDialogProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build flat list of all tables/views
  const allOptions = useMemo((): TableOption[] => {
    const opts: TableOption[] = [];
    for (const conn of connections) {
      const schema = schemas[conn.id];
      if (!schema) continue;
      for (const t of schema.tables) {
        opts.push({
          connectionId: conn.id,
          connectionName: conn.display_name,
          schema: t.schema,
          name: t.name,
          objectType: t.object_type,
          key: `${conn.id}:${t.schema}.${t.name}`,
        });
      }
    }
    return opts;
  }, [schemas, connections]);

  // Fuzzy filter
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allOptions.slice(0, 80);
    return allOptions
      .filter((o) =>
        o.name.toLowerCase().includes(q) ||
        o.schema.toLowerCase().includes(q) ||
        o.connectionName.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [allOptions, query]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Clamp cursor
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll cursor into view
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const handleSelect = (opt: TableOption) => {
    const limit = opt.objectType === "view" || opt.objectType === "materialized_view" ? 200 : 500;
    const sql = `SELECT * FROM "${opt.schema}"."${opt.name}" LIMIT ${limit}`;
    onSelect(opt.connectionId, sql);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === "Enter") { if (filtered[cursor]) handleSelect(filtered[cursor]); return; }
  };

  const iconForType = (t: TableMeta["object_type"]) => {
    if (t === "view") return <Eye className="w-3 h-3 text-blue-400/60" />;
    if (t === "materialized_view") return <Layers className="w-3 h-3 text-purple-400/60" />;
    return <Table2 className="w-3 h-3 text-white/30" />;
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.12 }}
            className="relative w-full max-w-xl bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e1e]">
              <Search className="w-4 h-4 text-white/30 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                placeholder="Search tables and views…"
                className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/20 focus:outline-none font-mono"
              />
              <span className="text-[10px] text-white/20 font-mono shrink-0">{filtered.length} results</span>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="flex items-center justify-center py-8 text-white/20 text-xs font-mono">
                  No tables found
                </div>
              )}
              {filtered.map((opt, i) => (
                <button
                  key={opt.key}
                  onClick={() => handleSelect(opt)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${
                    i === cursor ? "bg-[#00d2ff]/10" : "hover:bg-white/[0.03]"
                  }`}
                >
                  {iconForType(opt.objectType)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-white/80 truncate">{opt.name}</span>
                      <span className="text-[9px] font-mono text-white/25 shrink-0">{opt.schema}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Database className="w-2.5 h-2.5 text-white/15" />
                    <span className="text-[9px] font-mono text-white/25 truncate max-w-[80px]">{opt.connectionName}</span>
                  </div>
                  {i === cursor && (
                    <span className="text-[9px] font-mono text-[#00d2ff]/40 shrink-0">↵ open</span>
                  )}
                </button>
              ))}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-[#1a1a1a] flex items-center gap-3 text-[9px] font-mono text-white/20">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>Esc dismiss</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
