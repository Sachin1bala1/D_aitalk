/**
 * GraphBuilder — Recharts-based chart renderer for the JMP-Style Graph Builder.
 *
 * Supported chart types: scatter, line, bar, histogram, box, heatmap,
 * control_chart, pareto, area, violin (treated as box), bubble.
 *
 * Selection: shift+click to add a point to the selection.
 * TODO: lasso select
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  ResponsiveContainer,
  Scatter,
  Line,
  Bar,
  ComposedChart,
  AreaChart,
  Area,
  BarChart,
  LineChart,
  ScatterChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { ChartType } from '../../lib/charts/chartAutoSelect';

// ── Palette ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#00d2ff', '#ff6b6b', '#ffd166', '#06d6a0', '#a29bfe',
  '#fd79a8', '#e17055', '#74b9ff', '#55efc4', '#fab1a0',
];

function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length];
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function numericValues(data: Record<string, unknown>[], col: string): number[] {
  return data.map((r) => toNum(r[col])).filter((v): v is number => v !== null);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function skewness(vals: number[]): number {
  if (vals.length < 3) return 0;
  const m = mean(vals);
  const s = stdDev(vals);
  if (s === 0) return 0;
  const n = vals.length;
  return (vals.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) * n) / ((n - 1) * (n - 2));
}

/** Freedman-Diaconis bin width */
function fdBins(vals: number[], overrideBinCount?: number): { bins: { x: number; count: number }[]; binWidth: number } {
  if (vals.length === 0) return { bins: [], binWidth: 1 };
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const min = sorted[0];
  const max = sorted[n - 1];
  const range = max - min || 1;

  let binCount: number;
  if (overrideBinCount) {
    binCount = overrideBinCount;
  } else {
    const bw = iqr === 0 ? range / 10 : 2 * iqr * Math.pow(n, -1 / 3);
    binCount = Math.max(5, Math.min(50, Math.ceil(range / bw)));
  }

  const binWidth = range / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    x: min + (i + 0.5) * binWidth,
    count: 0,
  }));

  for (const v of vals) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binWidth));
    bins[idx].count++;
  }
  return { bins, binWidth };
}

/** Western Electric rule violations for SPC */
function westernElectricViolations(vals: number[], ucl: number, lcl: number): number[] {
  return vals.reduce<number[]>((acc, v, i) => {
    if (v > ucl || v < lcl) acc.push(i);
    return acc;
  }, []);
}

// Recharts tooltip formatter — we use `unknown` params to avoid complex generic variance issues,
// then cast at call site with `as any`.
const makeFormatter = (fn: (v: number, n: string) => [string, string]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((value: unknown, name: unknown) => {
    const v = value === undefined || value === null ? 0 : Number(value);
    const n = name === undefined || name === null ? '' : String(name);
    return fn(v, n);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphBuilderProps {
  data: Record<string, unknown>[];
  xCol: string | null;
  yCol: string | null;
  colorCol?: string | null;
  sizeCol?: string | null;
  chartType: ChartType;
  showDataPoints?: boolean;
  showTrendLine?: boolean;
  logScaleX?: boolean;
  logScaleY?: boolean;
  referenceLineY?: { value: number; label: string } | null;
  confidenceInterval?: 'none' | '95' | '99';
  selectedIndices?: Set<number>;
  onPointClick?: (index: number) => void;
  onRightClickSelection?: (indices: number[], dataSummary: string) => void;
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface CtxMenuState { x: number; y: number }

function ChartContextMenu({
  state,
  selectedCount,
  onAnalyze,
  onClose,
}: {
  state: CtxMenuState;
  selectedCount: number;
  onAnalyze: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl py-1.5 text-[11px] w-52"
      style={{ left: state.x, top: state.y }}
    >
      <div className="px-3 py-1.5 border-b border-[#1e1e1e] mb-1">
        <span className="text-[9px] text-white/25 font-mono uppercase tracking-widest">
          {selectedCount} point{selectedCount !== 1 ? 's' : ''} selected
        </span>
      </div>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left text-white/60 hover:text-white/90"
        onClick={() => { onAnalyze(); onClose(); }}
      >
        Analyze selection with APEX
      </button>
    </div>
  );
}

// ── Scatter chart ─────────────────────────────────────────────────────────────

function ScatterChartImpl({
  data, xCol, yCol, colorCol, showTrendLine, selectedIndices, onPointClick,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
  colorCol?: string | null;
  showTrendLine?: boolean;
  selectedIndices: Set<number>;
  onPointClick?: (i: number) => void;
}) {
  const groups: Map<string, { index: number; x: number; y: number }[]> = new Map();

  data.forEach((row, index) => {
    const xv = toNum(row[xCol]);
    const yv = toNum(row[yCol]);
    if (xv === null || yv === null) return;
    const groupKey = colorCol ? String(row[colorCol] ?? 'Unknown') : '__all__';
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ index, x: xv, y: yv });
  });

  const groupEntries = [...groups.entries()];

  // Simple linear regression for trend line
  let trendPoints: { x: number; y: number }[] = [];
  if (showTrendLine) {
    const allX = data.map((r) => toNum(r[xCol])).filter((v): v is number => v !== null);
    const allY = data.map((r) => toNum(r[yCol])).filter((v): v is number => v !== null);
    const n = Math.min(allX.length, allY.length);
    if (n > 1) {
      const mx = mean(allX.slice(0, n));
      const my = mean(allY.slice(0, n));
      const num = allX.slice(0, n).reduce((s, x, i) => s + (x - mx) * (allY[i] - my), 0);
      const den = allX.slice(0, n).reduce((s, x) => s + (x - mx) ** 2, 0);
      const slope = den === 0 ? 0 : num / den;
      const intercept = my - slope * mx;
      const xMin = Math.min(...allX);
      const xMax = Math.max(...allX);
      trendPoints = [
        { x: xMin, y: slope * xMin + intercept },
        { x: xMax, y: slope * xMax + intercept },
      ];
    }
  }

  const tooltipFormatter = makeFormatter((v, n) => [v.toFixed(3), n]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="x" type="number" name={xCol} stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis dataKey="y" type="number" name={yCol} stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
          formatter={tooltipFormatter}
        />
        {groupEntries.length > 1 && <Legend wrapperStyle={{ fontSize: 10, color: '#ffffff60' }} />}
        {groupEntries.map(([groupKey, points], gi) => (
          <Scatter
            key={groupKey}
            name={groupKey === '__all__' ? yCol : groupKey}
            data={points}
            fill={colorAt(gi)}
            opacity={0.8}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(point: any) => {
              const idx = typeof point?.index === 'number' ? (point.index as number) : undefined;
              if (idx !== undefined) onPointClick?.(idx);
            }}
          >
            {points.map((pt) => (
              <Cell
                key={pt.index}
                fill={selectedIndices.has(pt.index) ? '#ffffff' : colorAt(gi)}
                stroke={selectedIndices.has(pt.index) ? '#00d2ff' : 'none'}
                strokeWidth={selectedIndices.has(pt.index) ? 2 : 0}
              />
            ))}
          </Scatter>
        ))}
        {showTrendLine && trendPoints.length === 2 && (
          <Line
            data={trendPoints}
            dataKey="y"
            dot={false}
            strokeDasharray="6 3"
            stroke="#ffffff50"
            strokeWidth={1.5}
            legendType="none"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Line chart ────────────────────────────────────────────────────────────────

function LineChartImpl({
  data, xCol, yCol, colorCol, referenceLineY, selectedIndices,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
  colorCol?: string | null;
  referenceLineY?: { value: number; label: string } | null;
  selectedIndices: Set<number>;
}) {
  const groups: Map<string, boolean> = new Map();
  data.forEach((row) => {
    const groupKey = colorCol ? String(row[colorCol] ?? 'Unknown') : '__all__';
    groups.set(groupKey, true);
  });

  const chartData = data.map((row, index) => {
    const entry: Record<string, unknown> = { _x: row[xCol], _index: index };
    groups.forEach((_, gk) => {
      if (colorCol) {
        const rowGroup = String(row[colorCol] ?? 'Unknown');
        entry[gk] = rowGroup === gk ? toNum(row[yCol]) : null;
      } else {
        entry['__all__'] = toNum(row[yCol]);
      }
    });
    return entry;
  });

  const groupKeys = [...groups.keys()];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 30, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="_x" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
        />
        {groupKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 10, color: '#ffffff60' }} />}
        <Brush dataKey="_x" height={20} stroke="#ffffff20" fill="#0a0a0a" travellerWidth={6} />
        {referenceLineY && (
          <ReferenceLine y={referenceLineY.value} label={{ value: referenceLineY.label, fill: '#ffd166', fontSize: 9 }} stroke="#ffd166" strokeDasharray="4 2" />
        )}
        {groupKeys.map((gk, gi) => (
          <Line
            key={gk}
            type="monotone"
            dataKey={gk}
            stroke={colorAt(gi)}
            strokeWidth={2}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              if (props.cx === undefined || props.cy === undefined) return <g key={props.index} />;
              const idx = props.index ?? 0;
              const selected = selectedIndices.has(idx);
              return (
                <circle
                  key={idx}
                  cx={props.cx}
                  cy={props.cy}
                  r={selected ? 5 : 3}
                  fill={selected ? '#ffffff' : colorAt(gi)}
                  stroke={selected ? '#00d2ff' : 'none'}
                  strokeWidth={selected ? 2 : 0}
                />
              );
            }}
            connectNulls
            name={gk === '__all__' ? yCol : gk}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChartImpl({
  data, xCol, yCol, colorCol, selectedIndices, onPointClick,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
  colorCol?: string | null;
  selectedIndices: Set<number>;
  onPointClick?: (i: number) => void;
}) {
  const aggMap = new Map<string, Record<string, unknown>>();
  const colorKeys = new Set<string>();

  data.forEach((row, index) => {
    const xv = String(row[xCol] ?? '');
    const yv = toNum(row[yCol]) ?? 0;
    const ck = colorCol ? String(row[colorCol] ?? 'Unknown') : '__all__';
    colorKeys.add(ck);
    if (!aggMap.has(xv)) aggMap.set(xv, { _x: xv, _index: index });
    const entry = aggMap.get(xv)!;
    entry[ck] = ((entry[ck] as number | undefined) ?? 0) + yv;
  });

  const chartData = [...aggMap.values()].sort((a, b) => {
    const sumA = [...colorKeys].reduce((s, k) => s + ((a[k] as number) || 0), 0);
    const sumB = [...colorKeys].reduce((s, k) => s + ((b[k] as number) || 0), 0);
    return sumB - sumA;
  });

  const ckArr = [...colorKeys];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey="_x" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 9 }} angle={-25} textAnchor="end" />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
        />
        {ckArr.length > 1 && <Legend wrapperStyle={{ fontSize: 10, color: '#ffffff60' }} />}
        {ckArr.map((ck, gi) => (
          <Bar
            key={ck}
            dataKey={ck}
            stackId={colorCol ? 'a' : undefined}
            fill={colorAt(gi)}
            name={ck === '__all__' ? yCol : ck}
            radius={[2, 2, 0, 0]}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(entry: any) => {
              const idx = typeof entry?._index === 'number' ? (entry._index as number) : undefined;
              if (idx !== undefined) onPointClick?.(idx);
            }}
          >
            {chartData.map((entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={selectedIndices.has(entry._index as number) ? '#ffffff' : colorAt(gi)}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Histogram ─────────────────────────────────────────────────────────────────

function HistogramImpl({
  data, xCol, binCount,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  binCount?: number;
}) {
  const vals = numericValues(data, xCol);
  if (vals.length === 0) return <div className="flex items-center justify-center h-full text-white/20 text-xs">No numeric data</div>;

  const { bins } = fdBins(vals, binCount);
  const sk = skewness(vals);
  const showNormal = Math.abs(sk) < 0.5;

  const m = mean(vals);
  const s = stdDev(vals);
  const binSpan = bins.length > 1 ? bins[1].x - bins[0].x : 1;
  const normalData = bins.map((b) => ({
    ...b,
    normal: showNormal && s > 0
      ? (vals.length * binSpan) * (1 / (s * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((b.x - m) / s) ** 2)
      : undefined,
  }));

  const tooltipFormatter = makeFormatter((v, n) => [
    v.toFixed(2),
    n === 'count' ? 'Count' : 'Normal fit',
  ]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={normalData} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey="x" type="number" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }}
          tickFormatter={(v: number) => v.toFixed(1)} />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
          formatter={tooltipFormatter}
        />
        <Bar dataKey="count" fill="#00d2ff" fillOpacity={0.7} name="count" />
        {showNormal && (
          <Line type="monotone" dataKey="normal" stroke="#ffd166" strokeWidth={2} dot={false} name="normal" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Box plot ──────────────────────────────────────────────────────────────────

function BoxPlotImpl({
  data, xCol, yCol,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
}) {
  const groups = new Map<string, number[]>();
  data.forEach((row) => {
    const gk = String(row[xCol] ?? '');
    const yv = toNum(row[yCol]);
    if (yv === null) return;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(yv);
  });

  const boxData = [...groups.entries()].map(([category, vals]) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const med = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    return {
      category,
      base: q1,
      lower: med - q1,
      upper: q3 - med,
    };
  });

  const tooltipFormatter = makeFormatter((v, n) => [v.toFixed(3), n]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={boxData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey="category" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
          formatter={tooltipFormatter}
        />
        {/* Invisible base */}
        <Bar dataKey="base" fill="transparent" stackId="box" legendType="none" />
        {/* Q1 → median */}
        <Bar dataKey="lower" fill="#00d2ff" fillOpacity={0.5} stackId="box" name="Q1→Median" stroke="#00d2ff" strokeWidth={1} />
        {/* median → Q3 */}
        <Bar dataKey="upper" fill="#00d2ff" fillOpacity={0.8} stackId="box" name="Median→Q3" stroke="#00d2ff" strokeWidth={1} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

function HeatmapImpl({
  data, xCol, yCol,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
}) {
  const xVals = [...new Set(data.map((r) => String(r[xCol] ?? '')))].slice(0, 30);
  const yVals = [...new Set(data.map((r) => String(r[yCol] ?? '')))].slice(0, 20);

  const counts = new Map<string, number>();
  data.forEach((row) => {
    const key = `${row[xCol]}__${row[yCol]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const maxCount = Math.max(1, ...counts.values());

  const CELL_W = Math.max(20, Math.min(60, 500 / (xVals.length || 1)));
  const CELL_H = Math.max(16, Math.min(40, 300 / (yVals.length || 1)));
  const LABEL_W = 80;
  const LABEL_H = 24;
  const svgW = LABEL_W + xVals.length * CELL_W + 10;
  const svgH = LABEL_H + yVals.length * CELL_H + 10;

  function heatColor(count: number): string {
    const t = count / maxCount;
    if (t < 0.5) {
      const r = Math.round(0 + t * 2 * 255);
      return `rgb(${r},${r},255)`;
    }
    const tt = (t - 0.5) * 2;
    const b = Math.round(255 * (1 - tt));
    return `rgb(255,${b},${b})`;
  }

  return (
    <div className="flex-1 overflow-auto p-2">
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {xVals.map((xv, xi) => (
          <text
            key={xv}
            x={LABEL_W + xi * CELL_W + CELL_W / 2}
            y={LABEL_H - 4}
            textAnchor="middle"
            fontSize={9}
            fill="#ffffff40"
          >
            {xv.length > 8 ? xv.slice(0, 8) + '…' : xv}
          </text>
        ))}
        {yVals.map((yv, yi) => (
          <text
            key={yv}
            x={LABEL_W - 4}
            y={LABEL_H + yi * CELL_H + CELL_H / 2 + 4}
            textAnchor="end"
            fontSize={9}
            fill="#ffffff40"
          >
            {yv.length > 10 ? yv.slice(0, 10) + '…' : yv}
          </text>
        ))}
        {yVals.map((yv, yi) =>
          xVals.map((xv, xi) => {
            const count = counts.get(`${xv}__${yv}`) ?? 0;
            return (
              <rect
                key={`${xv}-${yv}`}
                x={LABEL_W + xi * CELL_W}
                y={LABEL_H + yi * CELL_H}
                width={CELL_W - 1}
                height={CELL_H - 1}
                fill={count === 0 ? '#1a1a1a' : heatColor(count)}
                rx={2}
              >
                <title>{`${xv} / ${yv}: ${count}`}</title>
              </rect>
            );
          })
        )}
      </svg>
    </div>
  );
}

// ── Control chart (SPC) ───────────────────────────────────────────────────────

function ControlChartImpl({
  data, yCol,
}: {
  data: Record<string, unknown>[];
  yCol: string;
}) {
  const vals = numericValues(data, yCol);
  if (vals.length === 0) return <div className="flex items-center justify-center h-full text-white/20 text-xs">No data</div>;

  const m = mean(vals);
  const s = stdDev(vals);
  const ucl = m + 3 * s;
  const lcl = m - 3 * s;
  const violations = new Set(westernElectricViolations(vals, ucl, lcl));

  const chartData = data.map((row, i) => ({
    index: i,
    value: toNum(row[yCol]),
    violation: violations.has(i),
  }));

  const tooltipFormatter = makeFormatter((v, n) => [
    v.toFixed(3),
    n === 'value' ? yCol : n,
  ]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 80, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="index" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
          formatter={tooltipFormatter}
        />
        <ReferenceLine y={ucl} stroke="#ff6b6b" strokeDasharray="4 2" label={{ value: `UCL=${ucl.toFixed(2)}`, fill: '#ff6b6b', fontSize: 9, position: 'right' }} />
        <ReferenceLine y={lcl} stroke="#ff6b6b" strokeDasharray="4 2" label={{ value: `LCL=${lcl.toFixed(2)}`, fill: '#ff6b6b', fontSize: 9, position: 'right' }} />
        <ReferenceLine y={m} stroke="#06d6a0" strokeDasharray="2 2" label={{ value: `CL=${m.toFixed(2)}`, fill: '#06d6a0', fontSize: 9, position: 'right' }} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#00d2ff"
          strokeWidth={1.5}
          dot={(props: { cx?: number; cy?: number; payload?: { violation?: boolean }; index?: number }) => {
            if (props.cx === undefined || props.cy === undefined) return <g key={props.index} />;
            const isViolation = props.payload?.violation;
            return (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={isViolation ? 5 : 3}
                fill={isViolation ? '#ff6b6b' : '#00d2ff'}
                stroke={isViolation ? '#ff000080' : 'none'}
                strokeWidth={isViolation ? 2 : 0}
              />
            );
          }}
          connectNulls
          name="value"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Pareto chart ──────────────────────────────────────────────────────────────

function ParetoImpl({
  data, xCol, yCol,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
}) {
  const aggMap = new Map<string, number>();
  data.forEach((row) => {
    const xv = String(row[xCol] ?? '');
    const yv = toNum(row[yCol]) ?? 0;
    aggMap.set(xv, (aggMap.get(xv) ?? 0) + yv);
  });

  const sorted = [...aggMap.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  let cumSum = 0;
  const chartData = sorted.map(([category, value]) => {
    cumSum += value;
    return { category, value, cumPct: total > 0 ? (cumSum / total) * 100 : 0 };
  });

  const tooltipFormatter = makeFormatter((v, n) => [
    n === 'cumPct' ? `${v.toFixed(1)}%` : v.toFixed(2),
    n === 'cumPct' ? 'Cumulative %' : yCol,
  ]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 40, bottom: 40, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
        <XAxis dataKey="category" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 9 }} angle={-25} textAnchor="end" />
        <YAxis yAxisId="left" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#ffd166" tick={{ fill: '#ffd16680', fontSize: 10 }}
          tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
          formatter={tooltipFormatter}
        />
        <Bar yAxisId="left" dataKey="value" fill="#00d2ff" fillOpacity={0.7} name="value" radius={[2, 2, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="#ffd166" strokeWidth={2} dot={{ r: 3, fill: '#ffd166' }} name="cumPct" />
        <ReferenceLine yAxisId="right" y={80} stroke="#ff6b6b" strokeDasharray="4 2"
          label={{ value: '80%', fill: '#ff6b6b', fontSize: 9, position: 'right' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Area chart ────────────────────────────────────────────────────────────────

function AreaChartImpl({
  data, xCol, yCol,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
}) {
  const chartData = data.map((r) => ({ x: r[xCol], y: toNum(r[yCol]) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00d2ff" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#00d2ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="x" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
        />
        <Area type="monotone" dataKey="y" stroke="#00d2ff" fill="url(#areaGrad)" strokeWidth={2} name={yCol} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Bubble chart (scatter with size) ─────────────────────────────────────────

function BubbleChartImpl({
  data, xCol, yCol, sizeCol,
}: {
  data: Record<string, unknown>[];
  xCol: string;
  yCol: string;
  sizeCol?: string | null;
}) {
  const sizeVals = sizeCol ? numericValues(data, sizeCol) : [];
  const maxSize = sizeVals.length > 0 ? Math.max(...sizeVals) : 1;

  const points = data
    .map((row, index) => {
      const xv = toNum(row[xCol]);
      const yv = toNum(row[yCol]);
      if (xv === null || yv === null) return null;
      const sv = sizeCol ? toNum(row[sizeCol]) : null;
      const z = sv !== null ? Math.max(4, (sv / maxSize) * 20) : 8;
      return { index, x: xv, y: yv, z };
    })
    .filter((p): p is { index: number; x: number; y: number; z: number } => p !== null);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="x" type="number" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <YAxis dataKey="y" type="number" stroke="#ffffff30" tick={{ fill: '#ffffff40', fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#ffffff60' }}
        />
        <Scatter data={points} fill="#00d2ff" fillOpacity={0.6}>
          {points.map((pt) => (
            <Cell key={pt.index} fill="#00d2ff" opacity={0.6} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Main GraphBuilder ─────────────────────────────────────────────────────────

export function GraphBuilder({
  data,
  xCol,
  yCol,
  colorCol,
  sizeCol,
  chartType,
  showDataPoints: _showDataPoints,
  showTrendLine,
  referenceLineY,
  selectedIndices = new Set(),
  onPointClick,
  onRightClickSelection,
}: GraphBuilderProps) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleContainerClick = useCallback(
    (_e: React.MouseEvent) => {
      // TODO: lasso select — shift+click on the chart area
    },
    []
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (selectedIndices.size > 0 && onRightClickSelection) {
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }
    },
    [selectedIndices, onRightClickSelection]
  );

  const handleAnalyze = useCallback(() => {
    if (!onRightClickSelection) return;
    const indices = [...selectedIndices];
    const summary = indices
      .slice(0, 5)
      .map((i) => {
        const row = data[i];
        const parts: string[] = [];
        if (xCol && row[xCol] !== undefined) parts.push(`${xCol}=${row[xCol]}`);
        if (yCol && row[yCol] !== undefined) parts.push(`${yCol}=${row[yCol]}`);
        return parts.join(', ');
      })
      .join('; ');
    onRightClickSelection(indices, summary);
  }, [selectedIndices, data, xCol, yCol, onRightClickSelection]);

  const MAX_POINTS = 2000;
  const displayData = data.length > MAX_POINTS
    ? data.filter((_, i) => i % Math.ceil(data.length / MAX_POINTS) === 0).slice(0, MAX_POINTS)
    : data;

  const renderChart = () => {
    if (!xCol && !yCol) {
      return (
        <div className="flex items-center justify-center h-full text-white/20 text-xs">
          Assign columns to X or Y axis to build a chart
        </div>
      );
    }

    switch (chartType) {
      case 'scatter':
        return xCol && yCol ? (
          <ScatterChartImpl
            data={displayData}
            xCol={xCol}
            yCol={yCol}
            colorCol={colorCol}
            showTrendLine={showTrendLine}
            selectedIndices={selectedIndices}
            onPointClick={onPointClick}
          />
        ) : null;

      case 'line':
        return xCol && yCol ? (
          <LineChartImpl
            data={displayData}
            xCol={xCol}
            yCol={yCol}
            colorCol={colorCol}
            referenceLineY={referenceLineY}
            selectedIndices={selectedIndices}
          />
        ) : null;

      case 'bar':
        return xCol && yCol ? (
          <BarChartImpl
            data={displayData}
            xCol={xCol}
            yCol={yCol}
            colorCol={colorCol}
            selectedIndices={selectedIndices}
            onPointClick={onPointClick}
          />
        ) : null;

      case 'histogram':
        return xCol ? (
          <HistogramImpl data={displayData} xCol={xCol} />
        ) : null;

      case 'box':
      case 'violin': // violin falls back to box
        return xCol && yCol ? (
          <BoxPlotImpl data={displayData} xCol={xCol} yCol={yCol} />
        ) : null;

      case 'heatmap':
        return xCol && yCol ? (
          <HeatmapImpl data={displayData} xCol={xCol} yCol={yCol} />
        ) : null;

      case 'control_chart':
        return yCol ? (
          <ControlChartImpl data={displayData} yCol={yCol} />
        ) : null;

      case 'pareto':
        return xCol && yCol ? (
          <ParetoImpl data={displayData} xCol={xCol} yCol={yCol} />
        ) : null;

      case 'area':
        return xCol && yCol ? (
          <AreaChartImpl data={displayData} xCol={xCol} yCol={yCol} />
        ) : null;

      case 'bubble':
        return xCol && yCol ? (
          <BubbleChartImpl data={displayData} xCol={xCol} yCol={yCol} sizeCol={sizeCol} />
        ) : null;

      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onClick={handleContainerClick}
      onContextMenu={handleContextMenu}
    >
      {renderChart()}
      {ctxMenu && (
        <ChartContextMenu
          state={ctxMenu}
          selectedCount={selectedIndices.size}
          onAnalyze={handleAnalyze}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
