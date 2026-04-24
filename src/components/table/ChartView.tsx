/**
 * ChartView — pure-SVG bar/line chart for query results.
 *
 * No external chart library — renders directly to SVG.
 * Auto-detects numeric columns for Y-axis; any column for X-axis label.
 * Supports up to 200 data points (samples if more rows loaded).
 */
import React, { useState, useRef, useCallback } from "react";
import { BarChart2, TrendingUp, ChevronDown } from "lucide-react";
import type { ColumnMeta } from "../../lib/db/DbClient";

interface ChartViewProps {
  rows: Record<string, unknown>[];
  columns: ColumnMeta[];
}

type ChartType = "bar" | "line";

const MAX_POINTS = 200;
const MARGIN = { top: 20, right: 20, bottom: 60, left: 60 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function formatLabel(v: unknown, maxLen = 12): string {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function niceMax(max: number): number {
  if (max === 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(max))));
  return Math.ceil(max / magnitude) * magnitude;
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipState {
  x: number;
  y: number;
  label: string;
  value: string;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ChartView({ rows, columns }: ChartViewProps) {
  const numericCols = columns.filter((c) => {
    const kind = c.display_type?.kind;
    return kind === "integer" || kind === "float";
  });
  const allCols = columns;

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xCol, setXCol] = useState<string>(allCols[0]?.name ?? "");
  const [yCol, setYCol] = useState<string>(numericCols[0]?.name ?? allCols[0]?.name ?? "");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Sample if too many rows
  const data = rows.length > MAX_POINTS
    ? rows.filter((_, i) => i % Math.ceil(rows.length / MAX_POINTS) === 0).slice(0, MAX_POINTS)
    : rows;

  const yValues = data.map((r) => toNum(r[yCol]));
  const validYValues = yValues.filter((v) => v !== null) as number[];

  if (numericCols.length === 0 || validYValues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/20 gap-3">
        <BarChart2 className="w-10 h-10" />
        <p className="text-xs uppercase tracking-widest">No numeric columns to chart</p>
        <p className="text-[10px] text-white/15">Run a query that returns numeric values</p>
      </div>
    );
  }

  const yMin = Math.min(0, ...validYValues);
  const yMax = niceMax(Math.max(...validYValues));
  const yRange = yMax - yMin || 1;

  const TICK_COUNT = 5;
  const yTicks = Array.from({ length: TICK_COUNT + 1 }, (_, i) =>
    yMin + (yRange * i) / TICK_COUNT
  );

  // We don't know the SVG container size at render time, so use a viewBox approach
  const VB_W = 800;
  const VB_H = 400;
  const chartW = VB_W - MARGIN.left - MARGIN.right;
  const chartH = VB_H - MARGIN.top - MARGIN.bottom;

  const barWidth = Math.max(2, (chartW / data.length) * 0.7);
  const barGap = chartW / data.length;

  const toSvgY = (v: number) =>
    chartH - ((v - yMin) / yRange) * chartH;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = VB_W / rect.width;
      const svgX = (e.clientX - rect.left) * scaleX - MARGIN.left;
      const idx = Math.round(svgX / barGap);
      if (idx < 0 || idx >= data.length) { setTooltip(null); return; }
      const row = data[idx];
      const v = toNum(row[yCol]);
      if (v === null) { setTooltip(null); return; }
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        label: formatLabel(row[xCol], 20),
        value: formatNum(v),
      });
    },
    [data, xCol, yCol, barGap]
  );

  // Line path
  const linePts = data
    .map((row, i) => {
      const v = toNum(row[yCol]);
      if (v === null) return null;
      return `${i * barGap + barGap / 2},${toSvgY(v)}`;
    })
    .filter(Boolean);
  const linePath = linePts.length > 1 ? `M ${linePts.join(" L ")}` : "";

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1a1a1a] shrink-0 flex-wrap">
        {/* Chart type toggle */}
        <div className="flex rounded overflow-hidden border border-[#2a2a2a]">
          <button
            onClick={() => setChartType("bar")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold transition-colors ${chartType === "bar" ? "bg-[#00d2ff]/20 text-[#00d2ff]" : "text-white/30 hover:text-white/60"}`}
          >
            <BarChart2 className="w-3 h-3" /> Bar
          </button>
          <button
            onClick={() => setChartType("line")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold transition-colors ${chartType === "line" ? "bg-[#00d2ff]/20 text-[#00d2ff]" : "text-white/30 hover:text-white/60"}`}
          >
            <TrendingUp className="w-3 h-3" /> Line
          </button>
        </div>

        {/* X axis column */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold">X</span>
          <div className="relative">
            <select
              value={xCol}
              onChange={(e) => setXCol(e.target.value)}
              className="appearance-none bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 pr-6 py-1 text-[10px] text-white/70 focus:outline-none focus:border-[#00d2ff]"
            >
              {allCols.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
          </div>
        </div>

        {/* Y axis column */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold">Y</span>
          <div className="relative">
            <select
              value={yCol}
              onChange={(e) => setYCol(e.target.value)}
              className="appearance-none bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 pr-6 py-1 text-[10px] text-white/70 focus:outline-none focus:border-[#00d2ff]"
            >
              {allCols.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
          </div>
        </div>

        <span className="text-[9px] text-white/20 font-mono ml-auto">
          {data.length.toLocaleString()} pts{rows.length > MAX_POINTS ? ` (sampled from ${rows.length.toLocaleString()})` : ""}
        </span>
      </div>

      {/* SVG Chart */}
      <div className="flex-1 relative" onMouseLeave={() => setTooltip(null)}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          onMouseMove={handleMouseMove}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Grid lines + Y ticks */}
            {yTicks.map((tick, i) => {
              const sy = toSvgY(tick);
              return (
                <g key={i}>
                  <line
                    x1={0} y1={sy} x2={chartW} y2={sy}
                    stroke="#ffffff10" strokeWidth={1}
                  />
                  <text
                    x={-8} y={sy + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="#ffffff40"
                  >
                    {formatNum(tick)}
                  </text>
                </g>
              );
            })}

            {/* Zero line */}
            {yMin < 0 && (
              <line
                x1={0} y1={toSvgY(0)} x2={chartW} y2={toSvgY(0)}
                stroke="#ffffff30" strokeWidth={1} strokeDasharray="4 2"
              />
            )}

            {/* Bars */}
            {chartType === "bar" && data.map((row, i) => {
              const v = toNum(row[yCol]);
              if (v === null) return null;
              const barH = Math.abs(toSvgY(v) - toSvgY(0));
              const barY = v >= 0 ? toSvgY(v) : toSvgY(0);
              const cx = i * barGap + barGap / 2;
              return (
                <rect
                  key={i}
                  x={cx - barWidth / 2}
                  y={barY}
                  width={barWidth}
                  height={Math.max(1, barH)}
                  fill="#00d2ff"
                  fillOpacity={0.7}
                  rx={1}
                />
              );
            })}

            {/* Line */}
            {chartType === "line" && linePath && (
              <>
                <path d={linePath} stroke="#00d2ff" strokeWidth={2} fill="none" strokeLinejoin="round" />
                {data.map((row, i) => {
                  const v = toNum(row[yCol]);
                  if (v === null) return null;
                  return (
                    <circle
                      key={i}
                      cx={i * barGap + barGap / 2}
                      cy={toSvgY(v)}
                      r={data.length > 50 ? 0 : 3}
                      fill="#00d2ff"
                    />
                  );
                })}
              </>
            )}

            {/* X axis labels — only show when few points */}
            {data.length <= 40 && data.map((row, i) => (
              <text
                key={i}
                x={i * barGap + barGap / 2}
                y={chartH + 16}
                textAnchor="end"
                fontSize={9}
                fill="#ffffff30"
                transform={`rotate(-35, ${i * barGap + barGap / 2}, ${chartH + 16})`}
              >
                {formatLabel(row[xCol], 10)}
              </text>
            ))}

            {/* Axes */}
            <line x1={0} y1={0} x2={0} y2={chartH} stroke="#ffffff20" strokeWidth={1} />
            <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="#ffffff20" strokeWidth={1} />

            {/* Y axis label */}
            <text
              x={-(chartH / 2)}
              y={-44}
              textAnchor="middle"
              fontSize={10}
              fill="#ffffff30"
              transform="rotate(-90)"
            >
              {yCol}
            </text>

            {/* X axis label */}
            <text
              x={chartW / 2}
              y={chartH + 50}
              textAnchor="middle"
              fontSize={10}
              fill="#ffffff30"
            >
              {xCol}
            </text>
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 shadow-xl z-10"
            style={{ left: tooltip.x + 12, top: Math.max(0, tooltip.y - 40) }}
          >
            <p className="text-[10px] text-white/50 truncate max-w-[160px]">{tooltip.label}</p>
            <p className="text-sm font-bold font-mono text-[#00d2ff]">{tooltip.value}</p>
          </div>
        )}
      </div>
    </div>
  );
}
