/**
 * SchemaSearch — global metadata search across tables, columns, indexes.
 *
 * Searches all connected schemas in real time without round-trips.
 * Results are grouped by type: Table, View, Column, Index.
 */
import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, Table, Columns, Layers, Key } from "lucide-react";
import type { FullSchema } from "../../lib/db/DbClient";

interface SearchResult {
  kind: "table" | "view" | "column" | "index";
  label: string;           // primary label
  sub: string;             // secondary context (schema.table, type name, etc.)
  connectionName: string;
  onSelect: () => void;
}

interface Props {
  schemas: Record<string, FullSchema>;
  connections: { id: string; display_name: string }[];
  onNavigate: (connectionId: string, sql: string) => void;
}

const KIND_ICON = {
  table: <Table className="w-3 h-3 text-[#00d2ff]/60 shrink-0" />,
  view: <Layers className="w-3 h-3 text-purple-400/60 shrink-0" />,
  column: <Columns className="w-3 h-3 text-white/30 shrink-0" />,
  index: <Key className="w-3 h-3 text-amber-400/50 shrink-0" />,
};

const KIND_ORDER = { table: 0, view: 1, column: 2, index: 3 };

export function SchemaSearch({ schemas, connections, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const out: SearchResult[] = [];

    for (const [connId, schema] of Object.entries(schemas)) {
      const connName = connections.find((c) => c.id === connId)?.display_name ?? connId;

      // Tables + Views
      for (const t of schema.tables) {
        const isView = t.object_type === "view" || t.object_type === "materialized_view";
        const fullName = `${t.schema}.${t.name}`;
        if (t.name.toLowerCase().includes(q) || t.schema.toLowerCase().includes(q)) {
          out.push({
            kind: isView ? "view" : "table",
            label: t.name,
            sub: `${t.schema} · ${connName}`,
            connectionName: connName,
            onSelect: () => onNavigate(connId, `SELECT * FROM ${fullName} LIMIT 500;`),
          });
        }

        // Columns
        const cols = schema.columns[fullName] ?? schema.columns[t.name] ?? [];
        for (const col of cols) {
          if (col.name.toLowerCase().includes(q)) {
            out.push({
              kind: "column",
              label: col.name,
              sub: `${fullName} · ${col.type_name}`,
              connectionName: connName,
              onSelect: () =>
                onNavigate(connId, `SELECT "${col.name}" FROM ${fullName} LIMIT 500;`),
            });
          }
        }
      }

      // Indexes
      for (const ix of schema.indexes ?? []) {
        if (ix.index_name.toLowerCase().includes(q)) {
          out.push({
            kind: "index",
            label: ix.index_name,
            sub: `${ix.table_name} · (${ix.columns.join(", ")})`,
            connectionName: connName,
            onSelect: () => {},
          });
        }
      }
    }

    // Sort by kind priority then alphabetical
    out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
    return out.slice(0, 200);
  }, [query, schemas, connections]);

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="p-3 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-[#111] border border-[#262626] focus-within:border-[#00d2ff]/40 transition-colors">
          <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables, columns, indexes…"
            className="flex-1 bg-transparent text-xs text-white/70 focus:outline-none placeholder:text-white/20"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-white/20 hover:text-white/50 text-xs"
            >
              ✕
            </button>
          )}
        </div>
        {query.length > 0 && query.length < 2 && (
          <p className="text-[9px] text-white/20 px-1 pt-1">Type at least 2 characters</p>
        )}
        {results.length > 0 && (
          <p className="text-[9px] text-white/25 px-1 pt-1">{results.length} result{results.length !== 1 ? "s" : ""}</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {query.length >= 2 && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/20 gap-2">
            <Search className="w-6 h-6" />
            <span className="text-xs">No results for "{query}"</span>
          </div>
        )}

        {results.map((r, i) => (
          <button
            key={i}
            onClick={r.onSelect}
            className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left group"
          >
            {KIND_ICON[r.kind]}
            <div className="flex-1 min-w-0">
              <span className="text-xs text-white/70 group-hover:text-white truncate block">
                {r.label}
              </span>
              <span className="text-[9px] text-white/25 font-mono truncate block">{r.sub}</span>
            </div>
            <span className="text-[8px] text-white/15 uppercase shrink-0">{r.kind}</span>
          </button>
        ))}

        {query.length < 2 && (
          <div className="p-4 space-y-3 text-xs text-white/30">
            <p className="font-medium text-white/40">Search your databases</p>
            <ul className="space-y-1.5 text-[11px]">
              <li>· Table and view names</li>
              <li>· Column names (click to SELECT that column)</li>
              <li>· Index names</li>
              <li>· Works across all open connections</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
