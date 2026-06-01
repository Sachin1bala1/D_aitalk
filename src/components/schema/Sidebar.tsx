import React, { useEffect, useRef, useState, useCallback } from "react";
import { Table, ChevronRight, ChevronDown, Columns, Key, Search, X, Database, Power, ExternalLink, Layers, Hash, FolderOpen, Clock, BarChart2, Eye, Braces, Cog, Sigma, SlidersHorizontal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { TableContextMenu } from "./TableContextMenu";
import { SchemaFilterPopover } from "./SchemaFilterPopover";
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
  // Multi-connection
  connections?: ConnectionConfig[];
  activeConnectionId?: string | null;
  connectionHealth?: Record<string, "healthy" | "error" | "checking">;
  onSwitchConnection?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  visibleSchemas?: string[];
  onVisibleSchemasChange?: (schemas: string[]) => void;
  // Loading state
  isLoadingSchema?: boolean;
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
  connections = [],
  activeConnectionId,
  connectionHealth = {},
  onSwitchConnection,
  onDisconnect,
  visibleSchemas,
  onVisibleSchemasChange,
  isLoadingSchema,
}: SidebarProps) {
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const focusedRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const activeDriver = connections.find((c) => c.id === activeConnectionId)?.driver ?? "postgres";
  const hypertableSet = new Set(fullSchema?.hypertable_tables ?? []);

  // Ctrl+F inside sidebar focuses search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
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
    // No active connection at all — show empty state
    if (!activeConnectionId) {
      return (
        <div className="flex flex-col items-center justify-center h-32 text-white/20 text-xs text-center px-4">
          <Database className="w-6 h-6 mb-2 opacity-30" />
          Connect a database to browse its schema
        </div>
      );
    }
    // Connection exists but schema is loading — show skeleton
    if (isLoadingSchema) {
      return (
        <div className="flex flex-col gap-2 p-3">
          <div className="animate-pulse bg-zinc-700/30 h-3 rounded w-3/4" />
          <div className="animate-pulse bg-zinc-700/30 h-3 rounded w-3/4" />
          <div className="animate-pulse bg-zinc-700/30 h-3 rounded w-3/4" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2 px-4 text-center">
        <Database className="w-8 h-8" />
        <span className="text-xs">Connect a database to browse its schema</span>
      </div>
    );
  }

  const allTableEntries = Object.entries(schema);
  if (allTableEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <Table className="w-8 h-8 text-white/20" />
        <span className="text-xs text-white/30">No tables found</span>
        {onRefreshSchema && (
          <button
            onClick={onRefreshSchema}
            className="px-3 py-1.5 text-xs rounded-md bg-[#00d2ff]/10 border border-[#00d2ff]/20 text-[#00d2ff] hover:bg-[#00d2ff]/20 transition-colors"
          >
            Retry loading schema
          </button>
        )}
        <p className="text-[10px] text-white/20 leading-relaxed">
          Check your connection permissions or try a direct (non-pooler) connection URL.
        </p>
      </div>
    );
  }

  // ── Schema grouping ─────────────────────────────────────────────────────────
  const hasSchemas =
    fullSchema != null &&
    fullSchema.tables.length > 0 &&
    fullSchema.tables.some((t) => t.schema && t.schema !== "");

  const schemaGroups: Record<string, string[]> = {};
  if (hasSchemas && fullSchema) {
    for (const t of fullSchema.tables) {
      const s = t.schema || "public";
      if (!schemaGroups[s]) schemaGroups[s] = [];
      schemaGroups[s].push(t.name);
    }
  }

  const allDiscoveredSchemas = Object.keys(schemaGroups).sort();

  const schemasToShow =
    hasSchemas && visibleSchemas !== undefined
      ? allDiscoveredSchemas.filter((s) => visibleSchemas.includes(s))
      : allDiscoveredSchemas;

  const ctxTable = contextMenu ? schema[contextMenu.tableName] ?? [] : [];

  const tableMatchesSearch = (tableName: string) =>
    !searchText || tableName.toLowerCase().includes(searchText.toLowerCase());

  const totalVisible = hasSchemas
    ? schemasToShow.reduce(
        (n, s) => n + (schemaGroups[s]?.filter(tableMatchesSearch).length ?? 0),
        0
      )
    : allTableEntries.filter(([n]) => tableMatchesSearch(n)).length;

  const isSchemaExpanded = (s: string) =>
    expandedSchemas[s] !== undefined ? expandedSchemas[s] : s === "public";

  const toggleSchema = (s: string) =>
    setExpandedSchemas((prev) => ({ ...prev, [s]: !isSchemaExpanded(s) }));

  const renderTableRow = (tableName: string, rowSchemaName: string = schemaName ?? "public") => {
    const isFocused =
      focusedNode != null &&
      focusedNode === `${rowSchemaName}.${tableName}`;
    const tableMeta = fullSchema?.tables.find(
      (t) => t.name === tableName && (!hasSchemas || t.schema === rowSchemaName)
    );
    // NOTE: fullSchema.columns is keyed by bare table name (not "schema.table").
    // If two schemas have a table with the same name, this returns the last-written columns.
    // Fix requires keying by "schema.table" in the Rust introspection layer — tracked as a future improvement.
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
    const columns = schema[tableName] ?? [];

    return (
      <div key={`${rowSchemaName}.${tableName}`} className="group" ref={isFocused ? focusedRef : null}>
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
          {(() => {
            const fullKey = `${rowSchemaName}.${tableName}`;
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
          {tableMeta?.is_hypertable && tableMeta.hypertable_chunks != null && (
            <span
              className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-amber-400/10 text-amber-400/70 font-mono border border-amber-400/20"
              title={`TimescaleDB hypertable — ${tableMeta.hypertable_chunks} chunks`}
            >
              {tableMeta.hypertable_chunks} chunks
            </span>
          )}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <>
      {/* Connection chips */}
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

      {/* Search bar + schema filter button */}
      <div
        className="px-2 pt-1 pb-0.5 relative"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-1">
          <div className="flex-1">
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
                title="Filter tables (Ctrl+F)"
              >
                <Search className="w-3 h-3" />
                <span>
                  {totalVisible} table{totalVisible !== 1 ? "s" : ""}
                </span>
              </button>
            )}
          </div>
          {hasSchemas && onVisibleSchemasChange && (
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`p-1 rounded transition-colors shrink-0 ${filterOpen ? "text-[#00d2ff] bg-[#00d2ff]/10" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`}
              title="Filter schemas"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {searchText && (
          <p className="text-[9px] text-white/25 px-2 pt-0.5">
            {totalVisible} matching
          </p>
        )}
        {hasSchemas && onVisibleSchemasChange && (
          <SchemaFilterPopover
            open={filterOpen}
            allSchemas={allDiscoveredSchemas}
            visibleSchemas={visibleSchemas ?? allDiscoveredSchemas}
            onChange={(schemas) => {
              onVisibleSchemasChange(schemas);
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </div>

      {/* Schema tree (Postgres/MSSQL) or flat list (SQLite/Redis/etc.) */}
      {hasSchemas ? (
        <div className="py-1">
          {schemasToShow.length === 0 ? (
            <div className="px-4 py-4 text-center">
              <p className="text-[11px] text-white/30">No schemas visible</p>
              <p className="text-[10px] text-white/20 mt-1">
                Use the filter ↗ to show schemas
              </p>
            </div>
          ) : (
            schemasToShow.map((s) => {
              const tables = (schemaGroups[s] ?? []).filter(tableMatchesSearch);
              const expanded = isSchemaExpanded(s);
              return (
                <div key={s}>
                  <button
                    onClick={() => toggleSchema(s)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 transition-colors group/schema"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
                    )}
                    <span className="text-[10px] font-semibold text-white/40 group-hover/schema:text-white/60 uppercase tracking-wider flex-1 text-left truncate">
                      {s}
                    </span>
                    <span className="text-[9px] text-white/20 shrink-0">
                      {tables.length}
                    </span>
                  </button>
                  {expanded && (
                    <div className="pl-2 space-y-0.5">
                      {tables.map((tableName) => renderTableRow(tableName, s))}
                      {tables.length === 0 && searchText && (
                        <p className="text-[10px] text-white/20 px-3 py-1">No matches</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-0.5 py-1">
          {allTableEntries
            .filter(([name]) => tableMatchesSearch(name))
            .map(([tableName]) => renderTableRow(tableName))}
        </div>
      )}

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

      {/* Context menu */}
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
        />
      )}
    </>
  );
}
