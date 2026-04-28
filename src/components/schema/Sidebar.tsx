import React, { useEffect, useRef, useState, useCallback } from "react";
import { Table, ChevronRight, ChevronDown, Columns, Key, Search, X, Database, Power, ExternalLink, Layers, Hash, FolderOpen, Clock, BarChart2, Eye, Braces, Cog, Sigma, Pin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TableContextMenu } from "./TableContextMenu";
import type { ConnectionConfig, FullSchema } from "../../lib/db/DbClient";

// Legacy flat schema type (kept for fallback path)
type TableSchema = Record<string, { name: string; type: string }[]>;

interface SidebarProps {
  schema: TableSchema | null;
  fullSchema?: FullSchema | null;
  onTableClick: (tableName: string) => void;
  focusedNode?: string | null;              // "schema.table" — set by focus_schema_node command
  schemaName?: string;                      // default schema name for context menu
  onSelectAll?: (table: string) => void;
  onInsertTemplate?: (table: string, columns: { name: string; type: string }[]) => void;
  onExplain?: () => void;
  onCountRows?: (table: string) => void;
  onRefreshSchema?: () => void;
  onDropTable?: (schema: string, table: string) => void;
  onViewDdl?: (schema: string, table: string) => void;
  onRunTableSql?: (sql: string, description: string) => void;
  driver?: string;
  onViewFunctionDdl?: (fnSchema: string, fnName: string) => void;
  onOpenInNewTab?: (tableName: string) => void;
  // Multi-connection
  connections?: ConnectionConfig[];
  activeConnectionId?: string | null;
  connectionHealth?: Record<string, "healthy" | "error" | "checking">;
  onSwitchConnection?: (id: string) => void;
  onDisconnect?: (id: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  tableName: string;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + "GB";
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + "MB";
  if (bytes >= 1_024) return (bytes / 1_024).toFixed(0) + "KB";
  return bytes + "B";
}

function fmtRows(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function Sidebar({
  schema,
  fullSchema,
  onTableClick,
  focusedNode,
  schemaName = "public",
  onSelectAll,
  onInsertTemplate,
  onExplain,
  onCountRows,
  onRefreshSchema,
  onDropTable,
  onViewDdl,
  onViewFunctionDdl,
  onRunTableSql,
  driver,
  onOpenInNewTab,
  connections = [],
  activeConnectionId,
  connectionHealth = {},
  onSwitchConnection,
  onDisconnect,
}: SidebarProps) {
  // Persist expanded state to localStorage
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("daitalk_expanded_tables") ?? "{}"); }
    catch { return {}; }
  });

  // Persist pinned tables to localStorage
  const [pinnedTables, setPinnedTables] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("daitalk_pinned_tables") ?? "[]")); }
    catch { return new Set(); }
  });

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const focusedRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const activeDriver = connections.find((c) => c.id === activeConnectionId)?.driver ?? "postgres";
  const hypertableSet = new Set(fullSchema?.hypertable_tables ?? []);

  // Persist expanded state changes to localStorage
  useEffect(() => {
    localStorage.setItem("daitalk_expanded_tables", JSON.stringify(expandedTables));
  }, [expandedTables]);

  const togglePin = (tableName: string) => {
    setPinnedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName); else next.add(tableName);
      localStorage.setItem("daitalk_pinned_tables", JSON.stringify([...next]));
      return next;
    });
  };

  // Ctrl+F / Ctrl+Shift+F inside sidebar focuses search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyF" && e.shiftKey) {
      e.preventDefault();
      setSearchVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "f" && !e.shiftKey) {
      e.preventDefault();
      setSearchVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    if (e.key === "Escape" && searchVisible) {
      setSearchText("");
      setSearchVisible(false);
    }
  }, [searchVisible]);

  const toggleTable = (tableName: string) => {
    setExpandedTables(prev => ({ ...prev, [tableName]: !prev[tableName] }));
  };

  // When focusedNode changes, auto-expand the target table and scroll to it
  useEffect(() => {
    if (!focusedNode) return;
    const targetTable = focusedNode.includes(".") ? focusedNode.split(".").pop()! : focusedNode;
    setExpandedTables(prev => ({ ...prev, [targetTable]: true }));
    const timer = setTimeout(() => {
      focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 180);
    return () => clearTimeout(timer);
  }, [focusedNode]);

  const handleContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tableName });
  };

  if (!schema) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2">
        <Table className="w-8 h-8" />
        <span className="text-xs">No tables found</span>
      </div>
    );
  }

  const ctxTable = contextMenu ? schema[contextMenu.tableName] ?? [] : [];
  const allEntries = Object.entries(schema);
  const filtered = searchText
    ? allEntries.filter(([name]) => name.toLowerCase().includes(searchText.toLowerCase()))
    : allEntries;

  // Pinned tables float to the top
  const sorted = [
    ...filtered.filter(([name]) => pinnedTables.has(name)),
    ...filtered.filter(([name]) => !pinnedTables.has(name)),
  ];

  return (
    <>
      {/* Connection chips — shown when multiple connections are open */}
      {connections.length > 1 && (
        <div className="px-2 pt-2 pb-1 border-b border-[#1a1a1a] space-y-1">
          <p className="text-[9px] uppercase tracking-widest text-white/20 px-1 mb-1">Connections</p>
          {connections.map((conn) => {
            const isActive = conn.id === activeConnectionId;
            return (
              <div
                key={conn.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors group/conn ${
                  isActive ? "bg-[#00d2ff]/10 border border-[#00d2ff]/20" : "hover:bg-white/5"
                }`}
                onClick={() => !isActive && onSwitchConnection?.(conn.id)}
              >
                <Database className={`w-3 h-3 shrink-0 ${isActive ? "text-[#00d2ff]/70" : "text-white/30"}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-[10px] font-semibold truncate block ${isActive ? "text-[#00d2ff]" : "text-white/50"}`}>
                    {conn.display_name}
                  </span>
                  <span className="text-[9px] text-white/20 font-mono">{conn.driver}</span>
                </div>
                {/* Health dot */}
                {(() => {
                  const h = connectionHealth[conn.id];
                  if (!h) return null;
                  return (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        h === "healthy" ? "bg-emerald-400" :
                        h === "error" ? "bg-red-400 animate-pulse" :
                        "bg-amber-400/60 animate-pulse"
                      }`}
                      title={h === "healthy" ? "Connected" : h === "error" ? "Connection lost" : "Checking…"}
                    />
                  );
                })()}
                {!isActive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDisconnect?.(conn.id); }}
                    className="opacity-0 group-hover/conn:opacity-100 p-0.5 text-white/20 hover:text-red-400 transition-all"
                    title="Disconnect"
                  >
                    <Power className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Search bar */}
      <div
        className="px-2 pt-1 pb-0.5"
        onKeyDown={handleKeyDown}
      >
        {searchVisible ? (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1a1a1a] border border-[#00d2ff]/30">
            <Search className="w-3 h-3 text-white/30 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Filter tables…"
              className="flex-1 bg-transparent text-xs text-white/70 focus:outline-none placeholder:text-white/20"
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchText(""); setSearchVisible(false); }
              }}
            />
            <button
              onClick={() => { setSearchText(""); setSearchVisible(false); }}
              className="text-white/20 hover:text-white/60"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setSearchVisible(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-white/20 hover:text-white/40 hover:bg-white/[0.03] transition-colors text-[10px]"
            title="Filter tables (Ctrl+F / Ctrl+Shift+F)"
          >
            <Search className="w-3 h-3" />
            <span>
              {allEntries.length} table{allEntries.length !== 1 ? "s" : ""}
            </span>
          </button>
        )}
        {searchText && (
          <p className="text-[9px] text-white/25 px-2 pt-0.5">
            {filtered.length} of {allEntries.length} matching
          </p>
        )}
      </div>

      {/* Virtualized table list */}
      <div ref={listContainerRef} className="overflow-auto flex-1 py-1" style={{ minHeight: 0 }}>
        <VirtualizedTableList
          sorted={sorted}
          schema={schema}
          fullSchema={fullSchema}
          expandedTables={expandedTables}
          pinnedTables={pinnedTables}
          focusedNode={focusedNode ?? null}
          schemaName={schemaName}
          activeDriver={activeDriver}
          hypertableSet={hypertableSet}
          focusedRef={focusedRef}
          listContainerRef={listContainerRef}
          toggleTable={toggleTable}
          togglePin={togglePin}
          handleContextMenu={handleContextMenu}
          onTableClick={onTableClick}
        />
      </div>

      {/* Functions / Procedures section */}
      {fullSchema && fullSchema.functions && fullSchema.functions.length > 0 && (
        <div className="border-t border-[#1a1a1a] mt-1 pt-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[9px] uppercase tracking-widest text-white/20">
            <Braces className="w-2.5 h-2.5" />
            Functions &amp; Procedures
            <span className="ml-auto">{fullSchema.functions.length}</span>
          </div>
          <div className="space-y-0.5">
            {fullSchema.functions
              .filter((fn) =>
                !searchText || fn.name.toLowerCase().includes(searchText.toLowerCase())
              )
              .slice(0, 100)
              .map((fn) => {
                const Icon =
                  fn.kind === "procedure" ? Cog :
                  fn.kind === "aggregate" ? Sigma :
                  Braces;
                return (
                  <div
                    key={`${fn.schema}.${fn.name}`}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.03] rounded cursor-pointer group/fn"
                    onClick={() => onViewFunctionDdl?.(fn.schema, fn.name)}
                    title={`${fn.kind} · returns ${fn.return_type} · ${fn.language}`}
                  >
                    <Icon className="w-3 h-3 text-purple-400/50 shrink-0" />
                    <span className="text-[10px] text-white/50 truncate flex-1">{fn.name}</span>
                    <span className="text-[8px] text-white/20 font-mono shrink-0">{fn.return_type.split("(")[0].slice(0, 12)}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Context menu — renders at fixed cursor position */}
      {contextMenu && (
        <TableContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tableName={contextMenu.tableName}
          schemaName={schemaName}
          onClose={() => setContextMenu(null)}
          onSelectAll={() => onSelectAll?.(contextMenu.tableName) ?? onTableClick(contextMenu.tableName)}
          onInsertTemplate={() => onInsertTemplate?.(contextMenu.tableName, ctxTable)}
          onCopyTableName={() => navigator.clipboard.writeText(contextMenu.tableName)}
          onCopySchema={() => navigator.clipboard.writeText(`"${schemaName}"."${contextMenu.tableName}"`)}
          onExplain={() => onExplain?.()}
          onCountRows={() => onCountRows?.(contextMenu.tableName)}
          onRefreshSchema={() => onRefreshSchema?.()}
          onDropTable={() => onDropTable?.(schemaName, contextMenu.tableName)}
          onViewDdl={onViewDdl ? () => onViewDdl(schemaName, contextMenu.tableName) : undefined}
          driver={driver}
          onRunSql={onRunTableSql}
          onOpenInNewTab={onOpenInNewTab ? () => onOpenInNewTab(contextMenu.tableName) : undefined}
        />
      )}
    </>
  );
}

// ─── Virtualized inner list ──────────────────────────────────────────────────

interface VirtualizedTableListProps {
  sorted: [string, { name: string; type: string }[]][];
  schema: Record<string, { name: string; type: string }[]>;
  fullSchema?: FullSchema | null;
  expandedTables: Record<string, boolean>;
  pinnedTables: Set<string>;
  focusedNode: string | null;
  schemaName: string;
  activeDriver: string;
  hypertableSet: Set<string>;
  focusedRef: React.MutableRefObject<HTMLDivElement | null>;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  toggleTable: (name: string) => void;
  togglePin: (name: string) => void;
  handleContextMenu: (e: React.MouseEvent, name: string) => void;
  onTableClick: (name: string) => void;
}

function VirtualizedTableList({
  sorted,
  fullSchema,
  expandedTables,
  pinnedTables,
  focusedNode,
  schemaName,
  activeDriver,
  hypertableSet,
  focusedRef,
  listContainerRef,
  toggleTable,
  togglePin,
  handleContextMenu,
  onTableClick,
}: VirtualizedTableListProps) {
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => listContainerRef.current,
    estimateSize: (index) => {
      const [tableName] = sorted[index];
      return expandedTables[tableName] ? 200 : 36;
    },
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
      {rowVirtualizer.getVirtualItems().map((vItem) => {
        const [tableName, columns] = sorted[vItem.index];

        const isFocused =
          focusedNode != null &&
          (focusedNode === tableName || focusedNode.endsWith(`.${tableName}`));
        const isPinned = pinnedTables.has(tableName);

        // Enriched metadata from fullSchema
        const tableMeta = fullSchema?.tables.find((t) => t.name === tableName);
        const richCols = fullSchema?.columns[tableName];
        const fkColumns = new Set(
          fullSchema?.foreign_keys
            .filter((fk) => fk.from_table === tableName)
            .map((fk) => fk.from_column) ?? []
        );
        const fkTargets = Object.fromEntries(
          (fullSchema?.foreign_keys ?? [])
            .filter((fk) => fk.from_table === tableName)
            .map((fk) => [fk.from_column, `${fk.to_table}.${fk.to_column}`])
        );
        const tableIndexes = fullSchema?.indexes.filter((ix) => ix.table_name === tableName) ?? [];

        return (
          <div
            key={tableName}
            data-index={vItem.index}
            ref={useCallback((el: HTMLDivElement | null) => {
              rowVirtualizer.measureElement(el);
              if (isFocused && el) (focusedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [isFocused, rowVirtualizer.measureElement])}
            style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
            className="group"
          >
            <div
              className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                isFocused
                  ? "bg-[#00d2ff]/10 border border-[#00d2ff]/20"
                  : "hover:bg-white/5"
              }`}
              onClick={() => toggleTable(tableName)}
              onContextMenu={(e) => handleContextMenu(e, tableName)}
            >
              {expandedTables[tableName] ? (
                <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
              )}
              {/* Driver-aware table icon */}
              {(() => {
                const fullKey = `${schemaName}.${tableName}`;
                const isHypertable = hypertableSet.has(fullKey);
                const objType = tableMeta?.object_type;
                const iconCls = `w-3.5 h-3.5 shrink-0 ${isFocused ? "text-[#00d2ff]" : "text-[#00d2ff]/60"}`;
                if (isHypertable) return <span title="TimescaleDB hypertable"><Clock className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-amber-400" : "text-amber-400/70"}`} /></span>;
                if (objType === "view") return <span title="View"><Eye className={iconCls} /></span>;
                if (objType === "materialized_view") return <span title="Materialized view"><Layers className={iconCls} /></span>;
                if (activeDriver === "mongodb") return <span title="Collection"><FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-emerald-400" : "text-emerald-400/70"}`} /></span>;
                if (activeDriver === "redis") return <span title="Key namespace"><Hash className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-red-400" : "text-red-400/60"}`} /></span>;
                if (activeDriver === "clickhouse") return <span title="ClickHouse table"><BarChart2 className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-yellow-400" : "text-yellow-400/60"}`} /></span>;
                return <Table className={iconCls} />;
              })()}
              <span
                className={`text-xs font-medium truncate flex-1 ${
                  isFocused ? "text-[#00d2ff]" : "text-white/80 group-hover:text-white"
                }`}
                onDoubleClick={() => onTableClick(tableName)}
                title="Double-click to SELECT * · Right-click for more options"
              >
                {tableName}
              </span>
              {/* Row estimate + size */}
              {tableMeta && (
                <span className="shrink-0 text-[9px] font-mono text-white/20 leading-none text-right">
                  {tableMeta.row_estimate != null && (
                    <span title="Estimated row count">~{fmtRows(tableMeta.row_estimate)}</span>
                  )}
                  {tableMeta.size_bytes != null && tableMeta.row_estimate != null && (
                    <span className="mx-0.5 opacity-50">·</span>
                  )}
                  {tableMeta.size_bytes != null && (
                    <span title="Table size">{fmtBytes(tableMeta.size_bytes)}</span>
                  )}
                </span>
              )}
              {isFocused && (
                <span className="shrink-0 text-[9px] text-[#00d2ff]/50 font-mono uppercase tracking-wider">
                  focus
                </span>
              )}
              {/* Pin button */}
              <button
                onClick={(e) => { e.stopPropagation(); togglePin(tableName); }}
                className={`shrink-0 p-0.5 transition-all ${
                  isPinned
                    ? "text-amber-400/70 opacity-100"
                    : "text-white/20 opacity-0 group-hover:opacity-100 hover:text-amber-400/70"
                }`}
                title={isPinned ? "Unpin table" : "Pin table to top"}
              >
                <Pin className="w-3 h-3" />
              </button>
            </div>

            <AnimatePresence>
              {expandedTables[tableName] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden ml-6 border-l border-[#262626]"
                >
                  {/* Columns */}
                  {(richCols ?? columns).map((col) => {
                    const isPK = "is_primary_key" in col ? col.is_primary_key : col.type.toLowerCase().includes("key");
                    const isFK = fkColumns.has(col.name);
                    const colType = "type_name" in col ? col.type_name : col.type;
                    return (
                      <div
                        key={col.name}
                        className="flex items-center gap-2 px-3 py-1 text-[11px] text-white/40 hover:text-white/60"
                        title={isFK ? `FK → ${fkTargets[col.name]}` : undefined}
                      >
                        {isPK ? (
                          <Key className="w-3 h-3 text-amber-500/50 shrink-0" />
                        ) : isFK ? (
                          <ExternalLink className="w-3 h-3 text-purple-400/60 shrink-0" />
                        ) : (
                          <Columns className="w-3 h-3 shrink-0" />
                        )}
                        <span className="truncate">{col.name}</span>
                        {isFK && (
                          <span className="text-[8px] text-purple-400/50 font-mono shrink-0">FK</span>
                        )}
                        <span className="text-[9px] opacity-50 uppercase shrink-0 ml-auto">{colType}</span>
                      </div>
                    );
                  })}

                  {/* Indexes section */}
                  {tableIndexes.length > 0 && (
                    <div className="mt-0.5 border-t border-[#1a1a1a]">
                      <div className="flex items-center gap-1.5 px-3 py-1 text-[9px] uppercase tracking-widest text-white/20">
                        <Layers className="w-2.5 h-2.5" />
                        Indexes
                      </div>
                      {tableIndexes.map((ix) => (
                        <div
                          key={ix.index_name}
                          className="flex items-center gap-2 px-3 py-0.5 text-[10px] text-white/30"
                          title={`${ix.columns.join(", ")}${ix.is_unique ? " · UNIQUE" : ""}${ix.is_primary ? " · PRIMARY" : ""}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${ix.is_primary ? "bg-amber-500/50" : ix.is_unique ? "bg-[#00d2ff]/40" : "bg-white/20"}`} />
                          <span className="truncate font-mono">{ix.index_name}</span>
                          <span className="shrink-0 text-[8px] opacity-50">{ix.columns.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Foreign Keys section */}
                  {Object.keys(fkTargets).length > 0 && (
                    <div className="mt-0.5 border-t border-[#1a1a1a]">
                      <div className="flex items-center gap-1.5 px-3 py-1 text-[9px] uppercase tracking-widest text-white/20">
                        <ExternalLink className="w-2.5 h-2.5" />
                        Foreign Keys
                      </div>
                      {Object.entries(fkTargets).map(([col, target]) => (
                        <div key={col} className="flex items-center gap-2 px-3 py-0.5 text-[10px] text-white/30">
                          <span className="font-mono text-purple-400/60">{col}</span>
                          <span className="text-white/20">→</span>
                          <span className="font-mono text-white/40 truncate">{target}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
