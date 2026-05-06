/**
 * ColumnStatsPopover — instant in-memory column statistics.
 *
 * Computes statistics from the already-loaded rows in RowStore (up to 2M).
 * No DB roundtrip required — appears instantly.
 *
 * Stats shown:
 *  - Row count / non-null / null count + null%
 *  - Distinct values count
 *  - For numbers: min, max, avg, sum
 *  - For strings: shortest / longest / avg length
 *  - Top-5 most common values (for low-cardinality columns)
 */
import React, { useMemo, useEffect, useRef, useState } from "react";
import { X, BarChart2 } from "lucide-react";
import { DbClient, type ColumnMeta, type ParameterHotspotRecord } from "../../lib/db/DbClient";
import { QueryManager } from "../../lib/table/QueryManager";

interface ColumnStatsPopoverProps {
  x: number;
  y: number;
  col: ColumnMeta;
  rows: Record<string, unknown>[];
  onClose: () => void;
}

interface Stats {
  total: number;
  nonNull: number;
  nullCount: number;
  nullPct: string;
  distinct: number;
  // numeric
  min?: number;
  max?: number;
  avg?: string;
  sum?: string;
  // string
  minLen?: number;
  maxLen?: number;
  avgLen?: string;
  // top values
  topValues: { value: string; count: number }[];
}

function computeStats(col: ColumnMeta, rows: Record<string, unknown>[]): Stats {
  const total = rows.length;
  const values = rows.map((r) => r[col.name]);
  const nonNullValues = values.filter((v) => v !== null && v !== undefined);
  const nonNull = nonNullValues.length;
  const nullCount = total - nonNull;
  const nullPct = total > 0 ? ((nullCount / total) * 100).toFixed(1) : "0.0";

  // Distinct count (using string representation)
  const seen = new Set(nonNullValues.map((v) => String(v)));
  const distinct = seen.size;

  const kind = col.display_type?.kind;
  const isNumeric = kind === "integer" || kind === "float";

  let min: number | undefined, max: number | undefined, avg: string | undefined, sum: string | undefined;
  let minLen: number | undefined, maxLen: number | undefined, avgLen: string | undefined;

  if (isNumeric && nonNullValues.length > 0) {
    const nums = nonNullValues.map((v) => Number(v)).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      min = Math.min(...nums);
      max = Math.max(...nums);
      const s = nums.reduce((a, b) => a + b, 0);
      avg = (s / nums.length).toFixed(4).replace(/\.?0+$/, "");
      sum = s.toLocaleString();
    }
  } else if (!isNumeric && nonNullValues.length > 0) {
    const strs = nonNullValues.map((v) => String(v));
    const lens = strs.map((s) => s.length);
    minLen = Math.min(...lens);
    maxLen = Math.max(...lens);
    avgLen = (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1);
  }

  // Top-5 values — only for low-cardinality (distinct ≤ 200)
  let topValues: { value: string; count: number }[] = [];
  if (distinct <= 200 && total > 0) {
    const freq: Record<string, number> = {};
    for (const v of nonNullValues) {
      const k = String(v);
      freq[k] = (freq[k] ?? 0) + 1;
    }
    topValues = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }

  return { total, nonNull, nullCount, nullPct, distinct, min, max, avg, sum, minLen, maxLen, avgLen, topValues };
}

export function ColumnStatsPopover({ x, y, col, rows, onClose }: ColumnStatsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [hotspot, setHotspot] = useState<ParameterHotspotRecord | null>(null);

  const stats = useMemo(() => computeStats(col, rows), [col.name, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    const connectionId = QueryManager.getConnectionId();
    const tableInfo = QueryManager.getBaseTable();
    if (!connectionId || !tableInfo) {
      setHotspot(null);
      return;
    }

    let cancelled = false;
    DbClient.getParameterHotspots({
      connection_id: connectionId,
      table_name: `${tableInfo.schema}.${tableInfo.table}`,
      limit: 50,
    }).then((records) => {
      if (cancelled) return;
      setHotspot(records.find((record) => record.column_name === col.name) ?? null);
    }).catch(() => {
      if (!cancelled) setHotspot(null);
    });

    return () => {
      cancelled = true;
    };
  }, [col.name]);

  const w = 240;
  const clampedX = Math.min(x, window.innerWidth - w - 8);
  const clampedY = Math.min(y, window.innerHeight - 320);

  const Row = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-white/35 shrink-0">{label}</span>
      <span className={`text-[10px] font-mono truncate ${accent ? "text-[#00d2ff]/80" : "text-white/65"}`}>{value}</span>
    </div>
  );

  const pct = stats.total > 0 ? (stats.nonNull / stats.total) * 100 : 0;

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl py-3"
      style={{ left: clampedX, top: clampedY, width: w }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 mb-2">
        <div className="flex items-center gap-1.5">
          <BarChart2 className="w-3 h-3 text-[#00d2ff]/60" />
          <span className="text-[11px] font-bold text-white/80 truncate">{col.name}</span>
          <span className="text-[9px] text-white/25 font-mono">{col.type_name}</span>
        </div>
        <button onClick={onClose} className="text-white/20 hover:text-white/60 transition-colors">
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="px-3 space-y-1.5">
        {/* Fill bar */}
        <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-[#00d2ff]/60 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Core stats */}
        <Row label="Total rows" value={stats.total.toLocaleString()} />
        <Row label="Non-null" value={`${stats.nonNull.toLocaleString()} (${(100 - parseFloat(stats.nullPct)).toFixed(1)}%)`} accent />
        <Row label="Null" value={`${stats.nullCount.toLocaleString()} (${stats.nullPct}%)`} />
        <Row label="Distinct" value={stats.distinct.toLocaleString()} />
        {hotspot && (
          <Row label="Hotspot hits" value={`${hotspot.hit_count.toLocaleString()} local`} accent />
        )}

        {/* Numeric stats */}
        {stats.min !== undefined && (
          <>
            <div className="border-t border-[#1e1e1e] my-1" />
            <Row label="Min" value={stats.min.toLocaleString()} />
            <Row label="Max" value={stats.max!.toLocaleString()} />
            <Row label="Avg" value={stats.avg!} />
            <Row label="Sum" value={stats.sum!} />
          </>
        )}

        {/* String stats */}
        {stats.minLen !== undefined && (
          <>
            <div className="border-t border-[#1e1e1e] my-1" />
            <Row label="Min length" value={String(stats.minLen)} />
            <Row label="Max length" value={String(stats.maxLen)} />
            <Row label="Avg length" value={stats.avgLen!} />
          </>
        )}

        {/* Top values */}
        {stats.topValues.length > 0 && (
          <>
            <div className="border-t border-[#1e1e1e] my-1" />
            <p className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Top values</p>
            {stats.topValues.map(({ value, count }) => {
              const barPct = stats.nonNull > 0 ? (count / stats.nonNull) * 100 : 0;
              return (
                <div key={value} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-white/55 truncate flex-1" title={value}>
                    {value.length > 20 ? value.slice(0, 20) + "…" : value}
                  </span>
                  <div className="w-12 h-1 rounded-full bg-[#1a1a1a] overflow-hidden shrink-0">
                    <div className="h-full rounded-full bg-amber-500/50" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="text-[9px] font-mono text-white/30 shrink-0 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </>
        )}

        <p className="text-[9px] text-white/15 pt-1">Based on {stats.total.toLocaleString()} loaded rows</p>
      </div>
    </div>
  );
}
