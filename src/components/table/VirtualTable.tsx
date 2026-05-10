/**
 * VirtualTable — billion-row capable data table.
 *
 * Features:
 * - Column header click → server-side ORDER BY via QueryManager
 * - Global filter bar — server-side ILIKE wrap via QueryManager
 * - Export CSV / JSON / XLSX
 * - Inline cell editing (double-click → UPDATE)
 * - Column resize (drag right edge) / Column stats popover (BarChart2 icon)
 * - Row number column (#)
 * - Cell right-click context menu: Copy Value / Copy Row as CSV / Copy Row as JSON
 * - Keyboard: Ctrl+Shift+C (copy row CSV), Ctrl+Shift+J (copy row JSON)
 */
import React, { useRef, useState, useCallback, useEffect } from "react";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import { ArrowUp, ArrowDown, Search, X, Download, Maximize2, BarChart2, Copy, Rows3, Table2, PanelRight, ChevronUp, ChevronDown as ChevronDownIcon, Plus, Pin, PinOff, GitCompare, Columns2 } from "lucide-react";
import { toast } from "sonner";
import { useRowStore, rowStore } from "../../lib/table/RowStore";
import { QueryManager } from "../../lib/table/QueryManager";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { DbClient, ColumnMeta } from "../../lib/db/DbClient";
import { LargeValueModal } from "./LargeValueModal";
import { InsertRowDialog } from "../dialogs/InsertRowDialog";
import { ColumnStatsPopover } from "./ColumnStatsPopover";
import { ChartView } from "./ChartView";
import { ExplainView } from "./ExplainView";
import { GraphBuilderPanel } from "../charts/GraphBuilderPanel";

const COL_WIDTH = 180;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 34;
const FILTER_HEIGHT = 30;
const ROW_NUM_WIDTH = 48;

// ── Cell renderer ─────────────────────────────────────────────────────────────

function CellValue({ value, colName, onExpand }: { value: unknown; colName: string; onExpand?: () => void }) {
  if (value === null || value === undefined)
    return (
      <span className="inline-flex items-center px-1 py-0.5 rounded border border-amber-500/20 bg-amber-500/5 text-amber-400/60 text-[9px] font-mono font-bold uppercase tracking-wide leading-none select-none">
        NULL
      </span>
    );

  const lc = colName.toLowerCase();

  if (typeof value === "boolean")
    return (
      <span className={`font-mono text-xs font-bold ${value ? "text-green-400" : "text-red-400/80"}`}>
        {value ? "true" : "false"}
      </span>
    );

  if (typeof value === "object") {
    const str = JSON.stringify(value);
    return (
      <span className="text-amber-400/70 font-mono text-xs truncate flex items-center gap-1 group w-full">
        <span className="truncate">{str.length > 60 ? str.slice(0, 60) + "…" : str}</span>
        {onExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); onExpand(); }}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/60 transition-opacity"
          >
            <Maximize2 className="w-2.5 h-2.5" />
          </button>
        )}
      </span>
    );
  }

  if (lc.includes("sensor_id") || lc.includes("machine_id") || lc.includes("tag_name") || lc.includes("asset_tag"))
    return (
      <span className="bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 rounded px-1.5 py-0.5 text-[10px] font-mono truncate">
        {String(value)}
      </span>
    );

  if (
    typeof value === "string" &&
    (lc.endsWith("_at") || lc.endsWith("_time") || lc.includes("timestamp") || lc.includes("datetime") || lc === "created" || lc === "updated" || lc === "time")
  )
    return <span className="text-blue-300/80 font-mono text-xs">{value}</span>;

  if (typeof value === "number")
    return (
      <span className="font-mono text-xs text-white/80 w-full text-right block">
        {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4)}
      </span>
    );

  const str = String(value);
  const isLong = str.length > 60;
  return (
    <span className="font-mono text-xs text-white/80 truncate flex items-center gap-1 w-full group">
      <span className="truncate" title={str.length > 100 && !isLong ? str : undefined}>{str}</span>
      {isLong && onExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/60 transition-opacity"
          title="View full value"
        >
          <Maximize2 className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportCsv(columns: { name: string }[], rows: Record<string, unknown>[]) {
  const header = columns.map((c) => `"${c.name}"`).join(",");
  const body = rows
    .map((row) =>
      columns.map((c) => {
        const v = row[c.name];
        if (v === null || v === undefined) return "";
        const str = typeof v === "object" ? JSON.stringify(v) : String(v);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    )
    .join("\n");
  download(`daitalk_export_${Date.now()}.csv`, "text/csv", header + "\n" + body);
}

function exportJson(columns: { name: string }[], rows: Record<string, unknown>[]) {
  download(`daitalk_export_${Date.now()}.json`, "application/json", JSON.stringify(rows, null, 2));
}

function escapeXml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(typeof v === "object" ? JSON.stringify(v) : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function exportXml(columns: { name: string }[], rows: Record<string, unknown>[]) {
  const colTags = columns.map((c) => c.name.replace(/\s+/g, "_"));
  const rowXml = rows.map((r) =>
    `  <row>\n${colTags.map((tag, i) => `    <${tag}>${escapeXml(r[columns[i].name])}</${tag}>`).join("\n")}\n  </row>`
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<results>\n${rowXml}\n</results>`;
  download(`daitalk_export_${Date.now()}.xml`, "application/xml", xml);
}

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return '<em style="color:#888">NULL</em>';
  return String(typeof v === "object" ? JSON.stringify(v) : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function exportHtml(columns: { name: string }[], rows: Record<string, unknown>[]) {
  const thead = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) =>
    `<tr>${columns.map((c) => `<td>${escapeHtml(r[c.name])}</td>`).join("")}</tr>`
  ).join("\n")}</tbody>`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:monospace;font-size:12px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
    th{background:#f0f0f0}tr:nth-child(even){background:#fafafa}
  </style></head><body><table>${thead}${tbody}</table></body></html>`;
  download(`daitalk_export_${Date.now()}.html`, "text/html", html);
}

function exportInsert(tableName: string, columns: { name: string }[], rows: Record<string, unknown>[]) {
  const cols = columns.map((c) => `"${c.name}"`).join(", ");
  const valToSql = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return String(v);
    const str = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `'${str.replace(/'/g, "''")}'`;
  };
  const stmts = rows.map((row) => {
    const vals = columns.map((c) => valToSql(row[c.name])).join(", ");
    return `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`;
  }).join("\n");
  download(`daitalk_insert_${Date.now()}.sql`, "text/plain", stmts);
}

function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Inline editing helper ─────────────────────────────────────────────────────

function sqlLiteral(raw: string, col: ColumnMeta | undefined): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return "NULL";
  if (col?.display_type?.kind === "boolean") {
    return trimmed.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }
  if (col?.display_type?.kind === "integer") {
    const n = parseInt(trimmed, 10);
    if (!isNaN(n)) return String(n);
  }
  if (col?.display_type?.kind === "float") {
    const n = parseFloat(trimmed);
    if (!isNaN(n)) return String(n);
  }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

async function exportXlsx(columns: { name: string }[], rows: Record<string, unknown>[]) {
  // Dynamic import so xlsx doesn't bloat the initial bundle
  const XLSX = await import("xlsx");
  const wsData = [
    columns.map((c) => c.name),
    ...rows.map((row) => columns.map((c) => {
      const v = row[c.name];
      return typeof v === "object" && v !== null ? JSON.stringify(v) : v;
    })),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Results");
  XLSX.writeFile(wb, `daitalk_export_${Date.now()}.xlsx`);
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function rowToCsv(columns: ColumnMeta[], row: Record<string, unknown>): string {
  return columns
    .map((c) => {
      const v = row[c.name];
      if (v === null || v === undefined) return "";
      const str = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `"${str.replace(/"/g, '""')}"`;
    })
    .join(",");
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for environments without clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

function parseSingleSourceTable(sourceTables: string[]): { schema: string; table: string } | null {
  if (sourceTables.length !== 1) return null;
  const [schema, table] = sourceTables[0].split(".");
  if (!schema || !table) return null;
  return { schema, table };
}

function getSingleSourceTableName(sourceTables: string[]): string | null {
  const table = parseSingleSourceTable(sourceTables);
  if (!table) return null;
  return `${table.schema}.${table.table}`;
}

// ── Cell context menu ─────────────────────────────────────────────────────────

interface CellCtxMenu {
  x: number;
  y: number;
  rowIndex: number;
  colName: string;
  value: unknown;
}

function CellContextMenu({
  menu,
  columns,
  rows,
  selectedRows,
  onClose,
}: {
  menu: CellCtxMenu;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  selectedRows: Set<number>;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const w = 220;
  const x = Math.min(menu.x, window.innerWidth - w - 8);
  const y = Math.min(menu.y, window.innerHeight - 200);

  const row = rows[menu.rowIndex];
  const valStr = menu.value === null || menu.value === undefined
    ? "NULL"
    : typeof menu.value === "object"
      ? JSON.stringify(menu.value)
      : String(menu.value);

  const items: { label: string; icon: React.ReactNode; action: () => void; danger?: boolean }[] = [
    {
      label: "Copy value",
      icon: <Copy className="w-3 h-3" />,
      action: () => { copyText(valStr); toast.success("Value copied"); },
    },
    {
      label: "Copy row as CSV",
      icon: <Rows3 className="w-3 h-3" />,
      action: () => { copyText(rowToCsv(columns, row)); toast.success("Row copied as CSV"); },
    },
    {
      label: "Copy row as JSON",
      icon: <Copy className="w-3 h-3" />,
      action: () => {
        const obj: Record<string, unknown> = {};
        for (const c of columns) obj[c.name] = row[c.name] ?? null;
        copyText(JSON.stringify(obj, null, 2));
        toast.success("Row copied as JSON");
      },
    },
    {
      label: "Copy as INSERT",
      icon: <Copy className="w-3 h-3" />,
      action: () => {
        const tableName = QueryManager.inferTableName();
        const cols = columns.map((c) => `"${c.name}"`).join(", ");
        const vals = columns.map((c) => {
          const v = row[c.name];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number" || typeof v === "boolean") return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(", ");
        copyText(`INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`);
        toast.success("INSERT statement copied");
      },
    },
    ...(selectedRows.size > 1
      ? [
          {
            label: `Copy ${selectedRows.size} selected as CSV`,
            icon: <Rows3 className="w-3 h-3" />,
            action: () => {
              const header = columns.map((c) => `"${c.name}"`).join(",");
              const body = [...selectedRows]
                .sort((a, b) => a - b)
                .map((idx) => rowToCsv(columns, rows[idx]))
                .join("\n");
              copyText(header + "\n" + body);
              toast.success(`${selectedRows.size} rows copied as CSV`);
            },
          },
          {
            label: `Copy ${selectedRows.size} as INSERT`,
            icon: <Copy className="w-3 h-3" />,
            action: () => {
              const tableName = QueryManager.inferTableName();
              const cols = columns.map((c) => `"${c.name}"`).join(", ");
              const stmts = [...selectedRows]
                .sort((a, b) => a - b)
                .map((idx) => {
                  const r = rows[idx];
                  const vals = columns.map((c) => {
                    const v = r[c.name];
                    if (v === null || v === undefined) return "NULL";
                    if (typeof v === "number" || typeof v === "boolean") return String(v);
                    return `'${String(v).replace(/'/g, "''")}'`;
                  }).join(", ");
                  return `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`;
                })
                .join("\n");
              copyText(stmts);
              toast.success(`${selectedRows.size} INSERT statements copied`);
            },
          },
        ]
      : []),
  ];

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl py-1.5 text-[11px]"
      style={{ left: x, top: y, width: w }}
    >
      {/* Row indicator */}
      <div className="px-3 py-1.5 mb-1 border-b border-[#1e1e1e]">
        <span className="text-[9px] text-white/25 font-mono uppercase tracking-widest">
          Row {(menu.rowIndex + 1).toLocaleString()} · {menu.colName}
        </span>
        <div className="text-[10px] text-white/50 font-mono truncate mt-0.5" title={valStr}>
          {valStr.length > 30 ? valStr.slice(0, 30) + "…" : valStr}
        </div>
      </div>
      {items.map((item) => (
        <button
          key={item.label}
          className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left ${item.danger ? "text-red-400" : "text-white/60 hover:text-white/90"}`}
          onClick={() => { item.action(); onClose(); }}
        >
          <span className="text-white/30">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Row Detail Panel ──────────────────────────────────────────────────────────

function RowDetailPanel({
  rowIndex,
  totalRows,
  columns,
  rows,
  onClose,
  onNavigate,
}: {
  rowIndex: number;
  totalRows: number;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const row = rows[rowIndex];

  const handleCopyJson = () => {
    const obj: Record<string, unknown> = {};
    for (const c of columns) obj[c.name] = row?.[c.name] ?? null;
    copyText(JSON.stringify(obj, null, 2));
    toast.success("Row copied as JSON");
  };

  const handleCopyInsert = () => {
    const tableName = QueryManager.inferTableName();
    const cols = columns.map((c) => `"${c.name}"`).join(", ");
    const vals = columns.map((c) => {
      const v = row?.[c.name];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    }).join(", ");
    copyText(`INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`);
    toast.success("INSERT statement copied");
  };

  return (
    <div className="w-72 shrink-0 border-l border-[#262626] flex flex-col bg-[#0a0a0a] text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          <PanelRight className="w-3.5 h-3.5 text-[#00d2ff]/60" />
          <span className="font-bold text-white/60 text-[10px] uppercase tracking-widest">
            Row {(rowIndex + 1).toLocaleString()} / {totalRows.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNavigate(Math.max(0, rowIndex - 1))}
            disabled={rowIndex === 0}
            className="p-0.5 text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors"
            title="Previous row (↑)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onNavigate(Math.min(totalRows - 1, rowIndex + 1))}
            disabled={rowIndex >= totalRows - 1}
            className="p-0.5 text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors"
            title="Next row (↓)"
          >
            <ChevronDownIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-0.5 text-white/20 hover:text-white/60 transition-colors ml-1"
            title="Close (Escape)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Key-value list */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#111]">
        {columns.map((col) => {
          const raw = row?.[col.name];
          const isNull = raw === null || raw === undefined;
          const valStr = isNull
            ? "NULL"
            : typeof raw === "object"
            ? JSON.stringify(raw)
            : String(raw);

          return (
            <div key={col.name} className="px-3 py-2.5 hover:bg-white/[0.02] group">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest truncate flex-1">
                  {col.name}
                </span>
                <span className="text-[8px] text-white/15 uppercase font-mono shrink-0">
                  {col.type_name}
                </span>
                <button
                  onClick={() => { copyText(valStr); toast.success("Copied"); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-white/20 hover:text-white/60 transition-all"
                  title="Copy value"
                >
                  <Copy className="w-2.5 h-2.5" />
                </button>
              </div>
              <div
                className={`font-mono text-[11px] break-all leading-relaxed ${
                  isNull
                    ? "text-white/15 italic"
                    : col.display_type?.kind === "integer" || col.display_type?.kind === "float"
                    ? "text-cyan-400/80"
                    : col.display_type?.kind === "boolean"
                    ? raw ? "text-emerald-400/80" : "text-red-400/80"
                    : col.display_type?.kind === "timestamp" || col.display_type?.kind === "date"
                    ? "text-purple-300/70"
                    : "text-white/60"
                }`}
              >
                {valStr.length > 300 ? valStr.slice(0, 300) + "…" : valStr}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="px-3 py-2 border-t border-[#1a1a1a] flex gap-2 shrink-0">
        <button
          onClick={handleCopyJson}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors text-[10px] font-bold"
        >
          <Copy className="w-2.5 h-2.5" /> JSON
        </button>
        <button
          onClick={handleCopyInsert}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors text-[10px] font-bold"
        >
          <Copy className="w-2.5 h-2.5" /> INSERT
        </button>
      </div>
    </div>
  );
}

// ── Pivot / Transpose View ────────────────────────────────────────────────────

/**
 * PivotView — transposes rows↔columns.
 * Left column = field name + type. Each subsequent column = one data row.
 * Capped at first 50 data rows to keep it readable.
 */
function PivotView({
  columns,
  rows,
}: {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
}) {
  const MAX_COLS = 50;
  const displayRows = rows.slice(0, MAX_COLS);
  const NAME_WIDTH = 160;
  const VAL_WIDTH = 140;
  const ROW_H = 32;
  const HEADER_H = 30;

  return (
    <div className="flex-1 overflow-auto bg-[#0a0a0a] relative">
      {/* Info banner when result is truncated */}
      {rows.length > MAX_COLS && (
        <div className="sticky top-0 left-0 z-10 w-full px-3 py-1 bg-amber-500/10 border-b border-amber-500/20 text-[9px] font-mono text-amber-400/70">
          Showing first {MAX_COLS} of {rows.length.toLocaleString()} rows as columns
        </div>
      )}
      <table className="border-collapse text-xs font-mono" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            {/* Field label header */}
            <th
              className="sticky left-0 z-20 bg-[#111] border-r border-b border-[#1a1a1a] px-2 text-[9px] text-white/25 uppercase tracking-widest text-left font-bold"
              style={{ width: NAME_WIDTH, height: HEADER_H, minWidth: NAME_WIDTH }}
            >
              Field
            </th>
            {displayRows.map((_, i) => (
              <th
                key={i}
                className="border-r border-b border-[#1a1a1a] bg-[#0d0d0d] px-2 text-[9px] font-mono text-white/25 text-center font-bold"
                style={{ width: VAL_WIDTH, height: HEADER_H, minWidth: VAL_WIDTH }}
              >
                Row {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((col, colIdx) => (
            <tr
              key={col.name}
              className={colIdx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"}
            >
              {/* Field name cell */}
              <td
                className="sticky left-0 z-10 border-r border-b border-[#1a1a1a] px-2 bg-inherit"
                style={{ width: NAME_WIDTH, height: ROW_H }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-white/70 font-bold truncate flex-1" title={col.name}>
                    {col.name}
                  </span>
                  <span className="text-[8px] text-white/20 shrink-0">{col.type_name.split("(")[0].split(" ")[0]}</span>
                </div>
              </td>
              {/* Value cells */}
              {displayRows.map((row, rowIdx) => {
                const val = row[col.name];
                const isNull = val === null || val === undefined;
                const str = isNull ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
                return (
                  <td
                    key={rowIdx}
                    className="border-r border-b border-[#1a1a1a] px-2 truncate"
                    style={{ width: VAL_WIDTH, height: ROW_H, maxWidth: VAL_WIDTH }}
                    title={str}
                    onClick={() => { navigator.clipboard.writeText(isNull ? "NULL" : str); toast.success("Copied"); }}
                  >
                    {isNull ? (
                      <span className="text-amber-400/40 text-[9px] font-bold">NULL</span>
                    ) : (
                      <span className={
                        typeof val === "number"
                          ? "text-cyan-400/80"
                          : typeof val === "boolean"
                          ? val ? "text-emerald-400/80" : "text-red-400/70"
                          : typeof val === "object"
                          ? "text-amber-400/70"
                          : "text-white/60"
                      }>
                        {str.length > 24 ? str.slice(0, 24) + "…" : str}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface VirtualTableProps {
  isLoading?: boolean;
}

export function VirtualTable({ isLoading }: VirtualTableProps = {}) {
  const store = useRowStore();
  const { rows, columns, isStreaming, elapsedMs } = store;
  const chartRequest = useWorkspaceStore((s) => s.chartRequest);
  const setChartRequest = useWorkspaceStore((s) => s.setChartRequest);
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const currentQueryResult = useWorkspaceStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId)?.queryResults ?? null
  );
  const queryView = useWorkspaceStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId)?.queryView ?? null
  );
  const singleSourceTableName = getSingleSourceTableName(currentQueryResult?.source_tables ?? []);

  const [filterText, setFilterText] = useState(queryView?.globalFilter ?? "");
  const [filterVisible, setFilterVisible] = useState(false);
  const [colFilterVisible, setColFilterVisible] = useState(false);
  const [colFilterValues, setColFilterValues] = useState<Record<string, string>>(queryView?.columnFilters ?? {});
  const colFilterDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [sort, setSort] = useState(queryView?.sort ?? QueryManager.getSort());
  const [expandedCell, setExpandedCell] = useState<{ value: unknown; colName: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    colName: string;
    draftValue: string;
  } | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement | null>(null);
  const [insertRowOpen, setInsertRowOpen] = useState(false);
  const [pinnedRows, setPinnedRows] = useState<Record<string, unknown>[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [statsCell, setStatsCell] = useState<{ col: ColumnMeta; x: number; y: number } | null>(null);
  const [cellCtxMenu, setCellCtxMenu] = useState<CellCtxMenu | null>(null);
  const focusedRowRef = useRef<number>(0);
  const [focusedCol, setFocusedCol] = useState<number>(0);
  const [chartVisible, setChartVisible] = useState(false);
  const [graphBuilderVisible, setGraphBuilderVisible] = useState(false);
  const [pivotMode, setPivotMode] = useState(false);
  const lastTrackedChartSignatureRef = useRef<string | null>(null);

  // Respond to create_chart command from agent
  useEffect(() => {
    if (chartRequest && rows.length > 0) {
      setChartVisible(true);
      setChartRequest(null); // consume
    }
  }, [chartRequest, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    lastTrackedChartSignatureRef.current = null;
  }, [activeConnectionId, currentQueryResult?.queryId]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const lastSelectedRef = useRef<number | null>(null);
  const [rowDetailIdx, setRowDetailIdx] = useState<number | null>(null);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const filterDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resizing = useRef<{ colName: string; startX: number; startWidth: number } | null>(null);
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);

  const getColWidth = (name: string) => colWidths[name] ?? COL_WIDTH;
  // Note: totalWidth computed after visibleColumns is derived (below isExplain check)
  // Placeholder here — actual width computed post-derive
  const _totalWidthFn = (cols: typeof columns) =>
    Math.max(ROW_NUM_WIDTH + cols.reduce((sum, c) => sum + getColWidth(c.name), 0), 400);

  // Column resize — mousemove/mouseup on window
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = e.clientX - resizing.current.startX;
      const newWidth = Math.max(60, resizing.current.startWidth + delta);
      setColWidths((prev) => ({ ...prev, [resizing.current!.colName]: newWidth }));
    };
    const onUp = () => { resizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Ctrl+Shift+C → copy focused row as CSV; Ctrl+Shift+J → as JSON
  // Arrow keys navigate row detail panel; Escape closes it
  // Delete → generate DELETE SQL for selected rows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Row detail panel keyboard nav
      if (rowDetailIdx !== null) {
        if (e.key === "Escape") { setRowDetailIdx(null); return; }
        if (e.key === "ArrowUp" && rowDetailIdx > 0) {
          e.preventDefault();
          setRowDetailIdx(rowDetailIdx - 1);
          return;
        }
        if (e.key === "ArrowDown" && rowDetailIdx < rows.length - 1) {
          e.preventDefault();
          setRowDetailIdx(rowDetailIdx + 1);
          return;
        }
      }

      // Arrow key cell navigation (when not in row-detail, not editing, not in filter input)
      if (!editingCell && rowDetailIdx === null && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.min(focusedRowRef.current + 1, rows.length - 1);
          focusedRowRef.current = next;
          setSelectedRows(new Set([next]));
          lastSelectedRef.current = next;
          virtualizerRef.current?.scrollToIndex(next, { align: "auto" });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = Math.max(focusedRowRef.current - 1, 0);
          focusedRowRef.current = prev;
          setSelectedRows(new Set([prev]));
          lastSelectedRef.current = prev;
          virtualizerRef.current?.scrollToIndex(prev, { align: "auto" });
          return;
        }
        if (e.key === "ArrowRight" && columns.length > 0) {
          e.preventDefault();
          setFocusedCol((c) => Math.min(c + 1, columns.length - 1));
          return;
        }
        if (e.key === "ArrowLeft" && columns.length > 0) {
          e.preventDefault();
          setFocusedCol((c) => Math.max(c - 1, 0));
          return;
        }
        if (e.key === "Home") { e.preventDefault(); setFocusedCol(0); return; }
        if (e.key === "End") { e.preventDefault(); setFocusedCol(columns.length - 1); return; }
        if (e.key === "PageDown") {
          e.preventDefault();
          const next = Math.min(focusedRowRef.current + 20, rows.length - 1);
          focusedRowRef.current = next;
          setSelectedRows(new Set([next]));
          virtualizerRef.current?.scrollToIndex(next, { align: "auto" });
          return;
        }
        if (e.key === "PageUp") {
          e.preventDefault();
          const prev = Math.max(focusedRowRef.current - 20, 0);
          focusedRowRef.current = prev;
          setSelectedRows(new Set([prev]));
          virtualizerRef.current?.scrollToIndex(prev, { align: "auto" });
          return;
        }
        // Enter to open row detail for focused row
        if (e.key === "Enter" && rows.length > 0) {
          e.preventDefault();
          setRowDetailIdx(focusedRowRef.current);
          return;
        }
      }

      // Delete key — generate DELETE SQL for selected rows
      if (e.key === "Delete" && selectedRows.size > 0 && !editingCell) {
        e.preventDefault();
        const tableInfo = parseSingleSourceTable(currentQueryResult?.source_tables ?? []);
        if (!tableInfo) { toast.error("Run a simple SELECT from a single table to enable row deletion"); return; }
        const cols = rowStore.columns;
        const pkCol = cols.find((c) => c.is_primary_key) ?? cols.find((c) => c.name.toLowerCase() === "id") ?? cols[0];
        if (!pkCol) { toast.error("Cannot delete: no identifiable primary key"); return; }
        const selectedArr = [...selectedRows].sort((a, b) => a - b);
        const pkValues = selectedArr.map((i) => {
          const v = rows[i]?.[pkCol.name];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        const inList = pkValues.join(", ");
        const deleteSql = `DELETE FROM "${tableInfo.schema}"."${tableInfo.table}" WHERE "${pkCol.name}" IN (${inList});`;
        copyText(deleteSql);
        toast.success(`DELETE SQL for ${selectedArr.length} row(s) copied — review and run to delete`, { duration: 6000 });
        return;
      }

      if (!ctrl || !e.shiftKey) return;
      const row = rows[focusedRowRef.current];
      if (!row || columns.length === 0) return;
      if (e.key === "C") {
        e.preventDefault();
        copyText(rowToCsv(columns, row));
        toast.success(`Row ${focusedRowRef.current + 1} copied as CSV`);
      } else if (e.key === "J") {
        e.preventDefault();
        const obj: Record<string, unknown> = {};
        for (const c of columns) obj[c.name] = row[c.name] ?? null;
        copyText(JSON.stringify(obj, null, 2));
        toast.success(`Row ${focusedRowRef.current + 1} copied as JSON`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rows, columns, rowDetailIdx, selectedRows, editingCell, currentQueryResult]);

  // Keep local sort state in sync with QueryManager; clear selection on new result set
  const prevColumnsKey = useRef<string>("");
  useEffect(() => {
    setSort(queryView?.sort ?? QueryManager.getSort());
    setFilterText(
      queryView?.nullFilter ? `${queryView.nullFilter} IS NULL` : (queryView?.globalFilter ?? "")
    );
    setColFilterValues(queryView?.columnFilters ?? {});
    const key = columns.map((c) => c.name).join(",");
    if (key !== prevColumnsKey.current) {
      prevColumnsKey.current = key;
      setSelectedRows(new Set());
      setHiddenCols(new Set());
      lastSelectedRef.current = null;
    }
  }, [rows, columns, queryView, activeTabId]);

  const handleSortClick = useCallback(async (colName: string) => {
    await QueryManager.toggleSort(colName);
    setSort(QueryManager.getSort());
  }, []);

  const handleChartRendered = useCallback(async (
    queryId: string | null | undefined,
    chartType: string,
    columnCount: number,
    selection: { xColumn: string; yColumn: string }
  ) => {
    if (!queryId) return;
    const signature = [queryId, chartType, selection.xColumn, selection.yColumn].join("|");
    if (lastTrackedChartSignatureRef.current === signature) return;
    lastTrackedChartSignatureRef.current = signature;

    try {
      await DbClient.recordVisualizationViewed({
        query_id: queryId,
        chart_type: chartType,
        column_count: columnCount,
        viewed_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to record visualization view", error);
    }
  }, []);

  const handleFilterChange = useCallback((value: string) => {
    setFilterText(value);
    clearTimeout(filterDebounce.current);
    filterDebounce.current = setTimeout(() => {
      QueryManager.setFilter(value);
    }, 400);
  }, []);

  const handleClearFilter = useCallback(async () => {
    setFilterText("");
    await QueryManager.setFilter("");
  }, []);

  const handleRowClick = useCallback((rowIndex: number, e: React.MouseEvent) => {
    focusedRowRef.current = rowIndex;
    if (e.shiftKey && lastSelectedRef.current !== null) {
      const lo = Math.min(lastSelectedRef.current, rowIndex);
      const hi = Math.max(lastSelectedRef.current, rowIndex);
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(i);
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
        return next;
      });
      lastSelectedRef.current = rowIndex;
    } else {
      setSelectedRows(new Set([rowIndex]));
      lastSelectedRef.current = rowIndex;
    }
  }, []);

  const handleCellDoubleClick = useCallback((rowIndex: number, colName: string, currentValue: unknown) => {
    if (isStreaming) return;
    setEditingCell({
      rowIndex,
      colName,
      draftValue: currentValue === null || currentValue === undefined ? "" : String(currentValue),
    });
  }, [isStreaming]);

  const handleEditCancel = useCallback(() => setEditingCell(null), []);

  const handleEditCommit = useCallback(async () => {
    if (!editingCell) return;
    const { rowIndex, colName, draftValue } = editingCell;
    setEditingCell(null);

    const tableInfo = QueryManager.getBaseTable();
    const connectionId = QueryManager.getConnectionId();

    if (!tableInfo || !connectionId) {
      toast.error("Cannot update: run a simple SELECT from a single table first");
      return;
    }

    const cols = rowStore.columns;
    const pkCol =
      cols.find((c) => c.is_primary_key) ??
      cols.find((c) => c.name.toLowerCase() === "id") ??
      cols[0];

    if (!pkCol) {
      toast.error("Cannot update: no identifiable primary key");
      return;
    }

    const row = rows[rowIndex];
    const pkValue = row[pkCol.name];
    const colMeta = cols.find((c) => c.name === colName);
    const pkMeta = cols.find((c) => c.name === pkCol.name);

    const newValSql = sqlLiteral(draftValue, colMeta);
    const pkValSql = sqlLiteral(pkValue === null ? "" : String(pkValue), pkMeta);

    const sql = `UPDATE "${tableInfo.schema}"."${tableInfo.table}" SET "${colName}" = ${newValSql} WHERE "${pkCol.name}" = ${pkValSql}`;

    try {
      await DbClient.execute(connectionId, sql);
      toast.success("Cell updated");
      await QueryManager.refresh();
    } catch (e: any) {
      toast.error(`Update failed: ${e.message ?? "unknown error"}`);
    }
  }, [editingCell, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  virtualizerRef.current = virtualizer;

  const virtualItems = virtualizer.getVirtualItems();

  if (columns.length === 0 && rows.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/10 gap-3">
        <div className="text-3xl font-serif italic">No Results</div>
        <p className="text-xs uppercase tracking-widest">Execute a query to see results</p>
      </div>
    );
  }

  // Visible columns (after hiding)
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.name));
  const totalWidth = _totalWidthFn(visibleColumns);

  // Detect EXPLAIN output — single column named "QUERY PLAN"
  const isExplain =
    columns.length === 1 &&
    columns[0].name.toUpperCase().replace(/\s/g, "_") === "QUERY_PLAN" &&
    !isStreaming;

  if (isExplain) {
    return <ExplainView rows={rows} />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className="h-7 border-b border-[#262626] bg-[#0d0d0d] flex items-center px-3 gap-3 shrink-0">
        <div className="flex-1 flex items-center gap-3">
          {isStreaming ? (
            <span className="text-[10px] font-mono text-amber-400/70">
              ● Streaming — {rows.length.toLocaleString()} rows…
            </span>
          ) : rows.length > 0 ? (
            <span className="text-[10px] font-mono text-white/30">
              {rows.length.toLocaleString()} rows · {elapsedMs}ms
              {sort && (
                <span className="ml-2 text-[#00d2ff]/50">
                  sorted by {sort.column} {sort.direction}
                </span>
              )}
              {filterText && (
                <span className="ml-2 text-amber-400/50">
                  filtered: "{filterText}"
                </span>
              )}
            </span>
          ) : null}
          {selectedRows.size > 0 && (
            <button
              onClick={() => setSelectedRows(new Set())}
              className="flex items-center gap-1 text-[10px] font-mono text-amber-400/80 hover:text-amber-400 transition-colors"
              title="Click to deselect all"
            >
              {selectedRows.size} selected ×
            </button>
          )}
        </div>

        {/* Filter toggle + chart toggle + row detail + export buttons */}
        {rows.length > 0 && !isStreaming && (
          <div className="flex items-center gap-1.5 relative">
            {/* Column visibility picker */}
            <button
              onClick={() => setColPickerOpen((v) => !v)}
              className={`p-1 rounded transition-colors ${hiddenCols.size > 0 ? "text-violet-400" : "text-white/20 hover:text-white/50"}`}
              title={`Columns (${columns.length - hiddenCols.size}/${columns.length} visible)`}
            >
              <Rows3 className="w-3 h-3" />
            </button>
            {colPickerOpen && (
              <div className="absolute top-7 right-0 z-50 bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl py-2 w-48 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between px-3 pb-1.5 mb-1 border-b border-[#1e1e1e]">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">Columns</span>
                  <button
                    onClick={() => setHiddenCols(new Set())}
                    className="text-[9px] text-white/25 hover:text-white/60 font-mono"
                  >
                    show all
                  </button>
                </div>
                {columns.map((col) => {
                  const hidden = hiddenCols.has(col.name);
                  return (
                    <label
                      key={col.name}
                      className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.03] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => setHiddenCols((prev) => {
                          const next = new Set(prev);
                          if (next.has(col.name)) next.delete(col.name);
                          else next.add(col.name);
                          return next;
                        })}
                        className="accent-[#00d2ff] w-3 h-3"
                      />
                      <span className="text-[10px] font-mono text-white/60 truncate">{col.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setRowDetailIdx(rowDetailIdx !== null ? null : focusedRowRef.current)}
              className={`p-1 rounded transition-colors ${rowDetailIdx !== null ? "text-[#00d2ff]" : "text-white/20 hover:text-white/50"}`}
              title="Toggle row detail panel"
            >
              <PanelRight className="w-3 h-3" />
            </button>
            <button
              onClick={() => { setChartVisible((v) => !v); setGraphBuilderVisible(false); }}
              className={`p-1 rounded transition-colors ${chartVisible ? "text-[#00d2ff]" : "text-white/20 hover:text-white/50"}`}
              title="Toggle chart view"
            >
              {chartVisible ? <Table2 className="w-3 h-3" /> : <BarChart2 className="w-3 h-3" />}
            </button>
            <button
              onClick={() => { setGraphBuilderVisible((v) => !v); setChartVisible(false); }}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors text-[9px] font-mono font-bold ${graphBuilderVisible ? "bg-[#00d2ff]/20 text-[#00d2ff]" : "text-white/20 hover:text-white/50"}`}
              title="Toggle JMP-style Graph Builder"
            >
              GB
            </button>
            <button
              onClick={() => setPivotMode((v) => !v)}
              className={`p-1 rounded transition-colors ${pivotMode ? "text-violet-400" : "text-white/20 hover:text-white/50"}`}
              title="Transpose / pivot view (rows ↔ columns)"
            >
              <Columns2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => setFilterVisible((v) => !v)}
              className={`p-1 rounded transition-colors ${filterVisible || filterText ? "text-[#00d2ff]" : "text-white/20 hover:text-white/50"}`}
              title="Toggle global filter bar (all columns)"
            >
              <Search className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                setColFilterVisible((v) => !v);
                if (colFilterVisible) {
                  setColFilterValues({});
                  QueryManager.clearColumnFilters();
                }
              }}
              className={`p-1 rounded transition-colors text-[9px] font-mono font-bold ${colFilterVisible || Object.keys(colFilterValues).length > 0 ? "text-amber-400" : "text-white/20 hover:text-white/50"}`}
              title="Toggle per-column filter row"
            >
              <span className="text-[9px] font-mono">⊟</span>
            </button>
            <button
              onClick={() => exportCsv(columns, rows)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export CSV"
            >
              <Download className="w-2.5 h-2.5" /> CSV
            </button>
            <button
              onClick={() => exportJson(columns, rows)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export JSON"
            >
              <Download className="w-2.5 h-2.5" /> JSON
            </button>
            <button
              onClick={() => exportXlsx(columns, rows)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export Excel (.xlsx)"
            >
              <Download className="w-2.5 h-2.5" /> XLSX
            </button>
            <button
              onClick={() => exportXml(columns, rows)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export XML"
            >
              <Download className="w-2.5 h-2.5" /> XML
            </button>
            <button
              onClick={() => exportHtml(columns, rows)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export HTML table"
            >
              <Download className="w-2.5 h-2.5" /> HTML
            </button>
            <button
              onClick={() => {
                if (!singleSourceTableName) {
                  toast.error("INSERT export requires a single source table");
                  return;
                }
                exportInsert(singleSourceTableName, columns, rows);
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/20 hover:text-white/50 transition-colors font-mono uppercase tracking-wider"
              title="Export as INSERT statements"
            >
              <Download className="w-2.5 h-2.5" /> INSERT
            </button>
            <div className="w-px h-3 bg-white/10" />
            <button
              onClick={() => setInsertRowOpen(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-emerald-400/50 hover:text-emerald-400 transition-colors font-mono uppercase tracking-wider"
              title="Insert new row"
            >
              <Plus className="w-2.5 h-2.5" /> Row
            </button>
            <div className="w-px h-3 bg-white/10" />
            <button
              onClick={() => {
                if (pinnedRows) {
                  setPinnedRows(null);
                  setShowDiff(false);
                } else {
                  setPinnedRows([...rows]);
                  toast.success(`${rows.length.toLocaleString()} rows pinned — re-run query to compare`);
                }
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] transition-colors font-mono uppercase tracking-wider ${pinnedRows ? "text-violet-400 hover:text-violet-300" : "text-white/20 hover:text-white/50"}`}
              title={pinnedRows ? "Unpin result" : "Pin result for diff comparison"}
            >
              {pinnedRows ? <PinOff className="w-2.5 h-2.5" /> : <Pin className="w-2.5 h-2.5" />}
              {pinnedRows ? "Unpin" : "Pin"}
            </button>
            {pinnedRows && (
              <button
                onClick={() => setShowDiff((v) => !v)}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] transition-colors font-mono uppercase tracking-wider ${showDiff ? "text-violet-400" : "text-white/20 hover:text-violet-400/60"}`}
                title="Toggle diff view (compare vs pinned result)"
              >
                <GitCompare className="w-2.5 h-2.5" /> Diff
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      {filterVisible && (
        <div
          className="shrink-0 flex items-center gap-2 px-3 border-b border-[#1a1a1a] bg-[#0d0d0d]"
          style={{ height: FILTER_HEIGHT }}
        >
          <Search className="w-3 h-3 text-white/20 shrink-0" />
          <input
            autoFocus
            type="text"
            value={filterText}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder="Filter all columns…"
            className="flex-1 bg-transparent text-xs text-white/70 focus:outline-none placeholder:text-white/20"
          />
          {filterText && (
            <button onClick={handleClearFilter} className="text-white/20 hover:text-white/50">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* ── Main body: table/chart area + optional row detail panel ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Left: Chart or table ──────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

      {/* ── Chart view (replaces table when active) ──────────────────── */}
      {chartVisible && (
        <div className="flex-1 overflow-hidden">
          <ChartView
            rows={rows}
            columns={columns}
            queryId={currentQueryResult?.queryId}
            onChartRendered={handleChartRendered}
          />
        </div>
      )}

      {/* ── Graph Builder view ──────────────────────────────────────── */}
      {graphBuilderVisible && (
        <div className="flex-1 overflow-hidden">
          <GraphBuilderPanel columns={columns} data={rows} />
        </div>
      )}

      {/* ── Pivot / transpose view ────────────────────────────────────── */}
      {!chartVisible && !graphBuilderVisible && pivotMode && (
        <PivotView columns={visibleColumns} rows={rows} />
      )}

      {/* ── Column headers + virtual data (hidden when chart is active) ── */}
      {!chartVisible && !graphBuilderVisible && !pivotMode && (<>
      <div
        ref={headerScrollRef}
        className="shrink-0 overflow-hidden border-b border-[#1a1a1a] bg-[#111]"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="flex h-full" style={{ width: totalWidth }}>
          {/* Row number header */}
          <div
            className="flex items-center justify-center border-r border-[#1a1a1a] shrink-0 bg-[#0d0d0d]"
            style={{ width: ROW_NUM_WIDTH, height: HEADER_HEIGHT }}
          >
            <span className="text-[10px] font-mono text-white/20">#</span>
          </div>
          {visibleColumns.map((col) => {
            const isActive = sort?.column === col.name;
            const w = getColWidth(col.name);
            return (
              <div
                key={col.name}
                className="relative flex items-center gap-1.5 px-3 border-r border-[#1a1a1a] shrink-0 overflow-hidden hover:bg-white/[0.03] transition-colors group/header"
                style={{ width: w, height: HEADER_HEIGHT }}
              >
                {/* Sort clickable area */}
                <button
                  onClick={() => handleSortClick(col.name)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left"
                  title={`Sort by ${col.name} (${col.type_name}) · Drag right edge to resize · Double-click edge to reset`}
                >
                  <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${isActive ? "text-[#00d2ff]" : "text-white/50"}`}>
                    {col.name}
                  </span>
                  <span className="text-[9px] text-white/20 font-mono truncate hidden sm:block shrink-0">
                    {col.type_name}
                  </span>
                  {isActive && (
                    <span className="ml-auto shrink-0 text-[#00d2ff]">
                      {sort?.direction === "asc"
                        ? <ArrowUp className="w-3 h-3" />
                        : <ArrowDown className="w-3 h-3" />}
                    </span>
                  )}
                </button>
                {/* NULL quick-filter button — visible on hover */}
                <button
                  className="shrink-0 opacity-0 group-hover/header:opacity-100 text-white/20 hover:text-amber-400/70 transition-opacity z-10 text-[8px] font-mono font-bold leading-none px-0.5"
                  title={`Filter: show only NULLs in ${col.name}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await QueryManager.setNullFilter(col.name);
                    setFilterText(`${col.name} IS NULL`);
                  }}
                >
                  ∅
                </button>
                {/* Copy as IN list button — visible on hover */}
                <button
                  className="shrink-0 opacity-0 group-hover/header:opacity-100 text-white/20 hover:text-violet-400/70 transition-opacity z-10 text-[8px] font-mono font-bold leading-none px-0.5"
                  title={`Copy ${col.name} values as SQL IN list`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const vals = rows.map((r) => r[col.name]);
                    const unique = [...new Set(vals.filter((v) => v !== null && v !== undefined))];
                    const toSql = (v: unknown) => {
                      if (typeof v === "number") return String(v);
                      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
                      return `'${String(v).replace(/'/g, "''")}'`;
                    };
                    const list = `(${unique.map(toSql).join(", ")})`;
                    copyText(list);
                    toast.success(`${unique.length} distinct values copied as IN list`);
                  }}
                >
                  IN
                </button>
                {/* Column stats button — visible on hover */}
                <button
                  className="shrink-0 opacity-0 group-hover/header:opacity-100 text-white/20 hover:text-[#00d2ff]/70 transition-opacity z-10"
                  title={`Column statistics for ${col.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setStatsCell({ col, x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  <BarChart2 className="w-3 h-3" />
                </button>
                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 group-hover/header:opacity-100 hover:bg-[#00d2ff]/30 active:bg-[#00d2ff]/60 transition-opacity"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resizing.current = { colName: col.name, startX: e.clientX, startWidth: w };
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setColWidths((prev) => { const n = { ...prev }; delete n[col.name]; return n; });
                  }}
                  title="Drag to resize · Double-click to reset"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Per-column filter row ───────────────────────────────────── */}
      {colFilterVisible && (
        <div
          className="shrink-0 border-b border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden"
          style={{ height: 30 }}
        >
          <div className="flex h-full" style={{ width: totalWidth }}>
            <div style={{ width: ROW_NUM_WIDTH }} className="shrink-0 border-r border-[#1a1a1a]" />
            {visibleColumns.map((col) => {
              const w = getColWidth(col.name);
              const val = colFilterValues[col.name] ?? "";
              return (
                <div
                  key={col.name}
                  className="shrink-0 border-r border-[#1a1a1a] flex items-center px-1.5"
                  style={{ width: w, height: 30 }}
                >
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => {
                      const v = e.target.value;
                      setColFilterValues((prev) => ({ ...prev, [col.name]: v }));
                      clearTimeout(colFilterDebounce.current[col.name]);
                      colFilterDebounce.current[col.name] = setTimeout(() => {
                        QueryManager.setColumnFilter(col.name, v);
                      }, 350);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setColFilterValues((prev) => { const n = { ...prev }; delete n[col.name]; return n; });
                        QueryManager.setColumnFilter(col.name, "");
                      }
                    }}
                    placeholder="filter…"
                    className={`w-full bg-transparent text-[9px] font-mono placeholder:text-white/15 focus:outline-none ${val ? "text-amber-300/80" : "text-white/40"}`}
                    style={{ height: 20 }}
                  />
                  {val && (
                    <button
                      onClick={() => {
                        setColFilterValues((prev) => { const n = { ...prev }; delete n[col.name]; return n; });
                        QueryManager.setColumnFilter(col.name, "");
                      }}
                      className="shrink-0 text-white/20 hover:text-white/60 ml-0.5"
                    >
                      <X className="w-2 h-2" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Virtual data area ────────────────────────────────────────── */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        onScroll={(e) => {
          if (headerScrollRef.current)
            headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
          {isLoading && rows.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-20 text-white/30 text-sm">
              Executing…
            </div>
          )}
          {isStreaming && rows.length === 0 && (
            <div className="flex items-center justify-center h-16 text-white/20 text-xs font-mono">
              Waiting for first batch…
            </div>
          )}
          {virtualItems.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItems[0].start}px)`,
              }}
            >
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];

                // Diff highlighting
                let diffClass = "";
                if (showDiff && pinnedRows && columns.length > 0) {
                  const rowKey = JSON.stringify(row);
                  const pinnedKey = pinnedRows[virtualRow.index]
                    ? JSON.stringify(pinnedRows[virtualRow.index])
                    : null;
                  if (!pinnedKey) {
                    diffClass = "bg-emerald-500/10 border-emerald-500/20"; // new row
                  } else if (rowKey !== pinnedKey) {
                    diffClass = "bg-amber-500/10 border-amber-500/20"; // changed
                  }
                }

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    onClick={(e) => handleRowClick(virtualRow.index, e)}
                    className={`flex border-b border-[#161616] cursor-pointer select-none ${
                      diffClass ||
                      (selectedRows.has(virtualRow.index)
                        ? "bg-[#00d2ff]/10 border-[#00d2ff]/20"
                        : virtualRow.index % 2 === 0
                          ? "hover:bg-white/[0.025]"
                          : "bg-white/[0.012] hover:bg-white/[0.025]")
                    }`}
                    style={{ width: totalWidth }}
                  >
                    {/* Row number cell — click to open row detail panel */}
                    <div
                      className="flex items-center justify-end pr-2 border-r border-[#161616] shrink-0 bg-[#0d0d0d]/60 select-none cursor-pointer hover:bg-[#00d2ff]/10 group/rownum transition-colors"
                      style={{ width: ROW_NUM_WIDTH, height: ROW_HEIGHT }}
                      onClick={(e) => { e.stopPropagation(); setRowDetailIdx(virtualRow.index); }}
                      title="Click to open row details"
                    >
                      <span className="text-[10px] font-mono text-white/15 group-hover/rownum:text-[#00d2ff]/60 transition-colors">
                        {(virtualRow.index + 1).toLocaleString()}
                      </span>
                    </div>
                    {visibleColumns.map((col) => {
                      const isEditing =
                        editingCell?.rowIndex === virtualRow.index &&
                        editingCell?.colName === col.name;
                      const isFocusedCell = selectedRows.has(virtualRow.index) && visibleColumns.indexOf(col) === focusedCol;
                      return (
                        <div
                          key={col.name}
                          className={`flex items-center px-3 border-r border-[#161616] shrink-0 overflow-hidden ${isFocusedCell ? "ring-1 ring-inset ring-[#00d2ff]/40 bg-[#00d2ff]/5" : ""}`}
                          style={{ width: getColWidth(col.name), height: ROW_HEIGHT }}
                          onClick={() => { focusedRowRef.current = virtualRow.index; setFocusedCol(visibleColumns.indexOf(col)); }}
                          onDoubleClick={() => handleCellDoubleClick(virtualRow.index, col.name, row?.[col.name])}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            focusedRowRef.current = virtualRow.index;
                            setCellCtxMenu({
                              x: e.clientX,
                              y: e.clientY,
                              rowIndex: virtualRow.index,
                              colName: col.name,
                              value: row?.[col.name] ?? null,
                            });
                          }}
                          title={isEditing ? undefined : "Double-click to edit · Right-click for options"}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="w-full bg-[#0d2030] border border-[#00d2ff]/60 rounded px-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#00d2ff]"
                              style={{ height: ROW_HEIGHT - 8 }}
                              value={editingCell!.draftValue}
                              onChange={(e) =>
                                setEditingCell((prev) =>
                                  prev ? { ...prev, draftValue: e.target.value } : null
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); handleEditCommit(); }
                                if (e.key === "Escape") { e.preventDefault(); handleEditCancel(); }
                              }}
                              onBlur={handleEditCommit}
                              onFocus={(e) => e.target.select()}
                            />
                          ) : (
                            <CellValue
                              value={row?.[col.name]}
                              colName={col.name}
                              onExpand={() => setExpandedCell({ value: row?.[col.name], colName: col.name })}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      </>)} {/* end !chartVisible && !pivotMode */}

      </div> {/* end left: chart/table */}

      {/* ── Right: Row detail panel (slide in) ───────────────────── */}
      {rowDetailIdx !== null && rows.length > 0 && (
        <RowDetailPanel
          rowIndex={Math.min(rowDetailIdx, rows.length - 1)}
          totalRows={rows.length}
          columns={columns}
          rows={rows}
          onClose={() => setRowDetailIdx(null)}
          onNavigate={(idx) => setRowDetailIdx(idx)}
        />
      )}

      </div> {/* end main body flex row */}

      {/* Large Value Modal */}
      {expandedCell && (
        <LargeValueModal
          value={expandedCell.value}
          columnName={expandedCell.colName}
          onClose={() => setExpandedCell(null)}
        />
      )}

      {/* Column Stats Popover */}
      {statsCell && (
        <ColumnStatsPopover
          x={statsCell.x}
          y={statsCell.y}
          col={statsCell.col}
          rows={rows}
          onClose={() => setStatsCell(null)}
        />
      )}

      {/* Cell context menu */}
      {cellCtxMenu && (
        <CellContextMenu
          menu={cellCtxMenu}
          columns={columns}
          rows={rows}
          selectedRows={selectedRows}
          onClose={() => setCellCtxMenu(null)}
        />
      )}

      {/* Insert row dialog */}
      <InsertRowDialog
        open={insertRowOpen}
        onClose={() => setInsertRowOpen(false)}
      />
    </div>
  );
}
