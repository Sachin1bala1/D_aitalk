/**
 * ObjectPropertiesPanel — resizable bottom panel showing properties
 * of the currently selected table node (Columns, Indexes, Foreign Keys, DDL, Data).
 */
import React, { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { DbClient, FullSchema } from "../../lib/db/DbClient";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

type TabId = "columns" | "indexes" | "foreign_keys" | "ddl" | "data";

interface ObjectPropertiesPanelProps {
  connectionId: string | null;
  fullSchema: FullSchema | null;
  onClose: () => void;
}

export function ObjectPropertiesPanel({
  connectionId,
  fullSchema,
  onClose,
}: ObjectPropertiesPanelProps) {
  const selectedTableNode = useWorkspaceStore((s) => s.selectedTableNode);

  const [activeTab, setActiveTab] = useState<TabId>("columns");
  const [panelHeight, setPanelHeight] = useState<number>(() =>
    parseInt(localStorage.getItem("daitalk_props_panel_height") ?? "280", 10)
  );

  // DDL tab state
  const [ddl, setDdl] = useState<string | null>(null);
  const [ddlLoading, setDdlLoading] = useState(false);
  const [ddlError, setDdlError] = useState<string | null>(null);

  // Data tab state
  interface DataRow { [key: string]: unknown }
  const [dataRows, setDataRows] = useState<DataRow[]>([]);
  const [dataFields, setDataFields] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Reset tab-specific state when the selected table changes
  useEffect(() => {
    setDdl(null);
    setDdlError(null);
    setDataRows([]);
    setDataFields([]);
    setDataError(null);
  }, [selectedTableNode?.schema, selectedTableNode?.table]);

  // Fetch DDL when DDL tab is active
  useEffect(() => {
    if (activeTab !== "ddl" || !connectionId || !selectedTableNode) return;
    if (ddl || ddlLoading) return;
    setDdlLoading(true);
    setDdlError(null);
    DbClient.getTableDdl(connectionId, selectedTableNode.schema, selectedTableNode.table)
      .then((result) => setDdl(result))
      .catch((e) => setDdlError(e?.message ?? String(e)))
      .finally(() => setDdlLoading(false));
  }, [activeTab, connectionId, selectedTableNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Data when Data tab is active
  useEffect(() => {
    if (activeTab !== "data" || !connectionId || !selectedTableNode) return;
    if (dataRows.length > 0 || dataLoading) return;
    setDataLoading(true);
    setDataError(null);
    const sql = `SELECT * FROM "${selectedTableNode.schema}"."${selectedTableNode.table}" LIMIT 200`;
    DbClient.query(connectionId, sql)
      .then((rows) => {
        setDataRows(rows as DataRow[]);
        if (rows.length > 0) setDataFields(Object.keys(rows[0]));
      })
      .catch((e) => setDataError(e?.message ?? String(e)))
      .finally(() => setDataLoading(false));
  }, [activeTab, connectionId, selectedTableNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draggable divider
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY; // dragging up increases height
      const newHeight = Math.min(
        Math.max(startHeight + delta, 120),
        window.innerHeight * 0.6
      );
      setPanelHeight(newHeight);
      localStorage.setItem("daitalk_props_panel_height", String(Math.round(newHeight)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  if (!selectedTableNode) return null;

  const tableName = selectedTableNode.table;
  const schemaName = selectedTableNode.schema;

  // Resolve column key — FullSchema.columns is keyed by "schema.table" or just "table"
  const colKey = `${schemaName}.${tableName}`;
  const columns = fullSchema?.columns[colKey] ?? fullSchema?.columns[tableName] ?? [];

  const fkSet = new Set(
    (fullSchema?.foreign_keys ?? [])
      .filter((fk) => fk.from_table === tableName)
      .map((fk) => fk.from_column)
  );

  const indexes = (fullSchema?.indexes ?? []).filter(
    (ix) => ix.table_name === tableName
  );

  const foreignKeys = (fullSchema?.foreign_keys ?? []).filter(
    (fk) => fk.from_table === tableName
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: "columns", label: "Columns" },
    { id: "indexes", label: "Indexes" },
    { id: "foreign_keys", label: "Foreign Keys" },
    { id: "ddl", label: "DDL" },
    { id: "data", label: "Data" },
  ];

  return (
    <div
      className="shrink-0 border-t border-[#262626] bg-[#0d0d0d] flex flex-col overflow-hidden"
      style={{ height: panelHeight }}
    >
      {/* Draggable top divider */}
      <div
        className="h-1 bg-[#1a1a1a] hover:bg-[#00d2ff]/30 cursor-row-resize shrink-0 transition-colors"
        onMouseDown={handleMouseDown}
        title="Drag to resize"
      />

      {/* Tab bar + close button */}
      <div className="flex items-center border-b border-[#262626] shrink-0 px-2">
        <span className="text-[10px] text-white/25 font-mono mr-3 truncate max-w-[160px]" title={`${schemaName}.${tableName}`}>
          {schemaName}.{tableName}
        </span>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-b-2 border-[#00d2ff] text-[#00d2ff]"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={onClose}
          className="ml-auto p-1.5 text-white/30 hover:text-white/70 transition-colors"
          title="Close panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto min-h-0">
        {/* Columns tab */}
        {activeTab === "columns" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="sticky top-0 bg-[#0d0d0d] border-b border-[#262626]">
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Name</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Type</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Nullable</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Default</th>
                <th className="text-center px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">PK</th>
                <th className="text-center px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">FK</th>
              </tr>
            </thead>
            <tbody>
              {columns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-white/25">
                    No column data available
                  </td>
                </tr>
              ) : (
                columns.map((col, i) => (
                  <tr
                    key={col.name}
                    className={`border-b border-[#1a1a1a] hover:bg-white/[0.04] transition-colors ${
                      i % 2 === 0 ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-white/80">{col.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[#00d2ff]/70">{col.type_name}</td>
                    <td className="px-3 py-1.5 text-white/50">{col.nullable ? "YES" : "NO"}</td>
                    <td className="px-3 py-1.5 text-white/30 font-mono">—</td>
                    <td className="px-3 py-1.5 text-center">{col.is_primary_key ? "🔑" : ""}</td>
                    <td className="px-3 py-1.5 text-center">{fkSet.has(col.name) ? "🔗" : ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* Indexes tab */}
        {activeTab === "indexes" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="sticky top-0 bg-[#0d0d0d] border-b border-[#262626]">
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Index Name</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Columns</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Unique</th>
                <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Primary</th>
              </tr>
            </thead>
            <tbody>
              {indexes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-white/25">No indexes</td>
                </tr>
              ) : (
                indexes.map((ix, i) => (
                  <tr
                    key={ix.index_name}
                    className={`border-b border-[#1a1a1a] hover:bg-white/[0.04] transition-colors ${
                      i % 2 === 0 ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-white/70">{ix.index_name}</td>
                    <td className="px-3 py-1.5 font-mono text-white/50">{ix.columns.join(", ")}</td>
                    <td className="px-3 py-1.5">
                      {ix.is_unique && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#00d2ff]/10 text-[#00d2ff]/70 border border-[#00d2ff]/20 font-bold uppercase tracking-wider">
                          UNIQUE
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {ix.is_primary && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/70 border border-amber-500/20 font-bold uppercase tracking-wider">
                          PRIMARY
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* Foreign Keys tab */}
        {activeTab === "foreign_keys" && (
          foreignKeys.length === 0 ? (
            <div className="px-3 py-8 text-center text-white/25 text-xs">No foreign keys</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="sticky top-0 bg-[#0d0d0d] border-b border-[#262626]">
                  <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">Column</th>
                  <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">References Table</th>
                  <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold">References Column</th>
                </tr>
              </thead>
              <tbody>
                {foreignKeys.map((fk, i) => (
                  <tr
                    key={fk.constraint_name}
                    className={`border-b border-[#1a1a1a] hover:bg-white/[0.04] transition-colors ${
                      i % 2 === 0 ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-purple-400/80">{fk.from_column}</td>
                    <td className="px-3 py-1.5 font-mono text-white/70">{fk.to_table}</td>
                    <td className="px-3 py-1.5 font-mono text-white/50">{fk.to_column}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* DDL tab */}
        {activeTab === "ddl" && (
          <div className="p-3">
            {ddlLoading && (
              <div className="flex items-center gap-2 text-white/40 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading DDL…
              </div>
            )}
            {ddlError && (
              <div className="text-red-400/80 text-xs bg-red-500/10 border border-red-500/20 rounded p-3">
                {ddlError}
              </div>
            )}
            {ddl && !ddlLoading && (
              <pre className="font-mono text-xs text-green-400/80 bg-black/30 p-3 rounded overflow-auto whitespace-pre-wrap">
                {ddl}
              </pre>
            )}
          </div>
        )}

        {/* Data tab */}
        {activeTab === "data" && (
          <div className="p-0">
            {dataLoading && (
              <div className="flex items-center gap-2 text-white/40 text-xs p-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Fetching rows…
              </div>
            )}
            {dataError && (
              <div className="text-red-400/80 text-xs bg-red-500/10 border border-red-500/20 rounded m-3 p-3">
                {dataError}
              </div>
            )}
            {!dataLoading && !dataError && dataRows.length === 0 && (
              <div className="px-3 py-8 text-center text-white/25 text-xs">No rows returned</div>
            )}
            {dataRows.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[9px] text-white/30 border-b border-[#1a1a1a]">
                  {dataRows.length} row{dataRows.length !== 1 ? "s" : ""} (LIMIT 200)
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="sticky top-0 bg-[#0d0d0d] border-b border-[#262626]">
                        {dataFields.map((f) => (
                          <th
                            key={f}
                            className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/30 font-semibold whitespace-nowrap"
                          >
                            {f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-b border-[#1a1a1a] hover:bg-white/[0.04] transition-colors ${
                            i % 2 === 0 ? "bg-white/[0.02]" : ""
                          }`}
                        >
                          {dataFields.map((f) => (
                            <td
                              key={f}
                              className="px-3 py-1.5 font-mono text-white/60 max-w-[240px] truncate"
                              title={row[f] != null ? String(row[f]) : "NULL"}
                            >
                              {row[f] == null ? (
                                <span className="text-white/20 italic">NULL</span>
                              ) : (
                                String(row[f])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
