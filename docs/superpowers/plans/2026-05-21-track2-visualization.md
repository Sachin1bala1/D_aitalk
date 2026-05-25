# Track 2: Visualization & Chart Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 chart types (including control chart with SPC overlays), an inline `ChartEditor` toolbar that re-renders in <100ms without AI round-trips, and an "Explain this" button on every chart.

**Architecture:** New `ChartEditor.tsx` toolbar component sits below every chart. It manages a local `ChartConfig` state that drives Recharts directly. New chart type components (`ControlChart`, `Histogram`, `BoxPlot`, `Heatmap`, `Waterfall`) live in `src/components/charts/`. `ArtifactChartViewer` and `ChartPanel` both mount `ChartEditor`. Tool schema updated to expose new chart types to the AI agent.

**Tech Stack:** React, Recharts (already installed), TypeScript, existing `ArtifactChartViewer.tsx`, `ChartPanel.tsx`, `toolDefinitions.ts`.

---

## File Map

| File | Change |
|------|--------|
| `src/components/charts/ChartEditor.tsx` | **NEW** — toolbar with type/axis/color/SPC/export controls |
| `src/components/charts/ControlChart.tsx` | **NEW** — Recharts control chart with 3σ bands |
| `src/components/charts/Histogram.tsx` | **NEW** — histogram with auto binning |
| `src/components/charts/BoxPlot.tsx` | **NEW** — box+whisker via ComposedChart |
| `src/components/charts/Heatmap.tsx` | **NEW** — 2D color grid |
| `src/components/charts/Waterfall.tsx` | **NEW** — cumulative delta bar chart |
| `src/components/artifacts/ArtifactChartViewer.tsx` | Mount `ChartEditor` below chart |
| `src/components/dashboard/ChartPanel.tsx` | Mount `ChartEditor` below chart |
| `src/lib/agent/toolDefinitions.ts` | Add new `chartType` enum values + `explain_chart` tool |

---

## Task 1: ChartEditor toolbar component

**Files:**
- Create: `src/components/charts/ChartEditor.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/charts/ChartEditor.tsx
import React, { useState } from "react";

export type ChartType =
  | "bar" | "line" | "area" | "scatter" | "pie"
  | "histogram" | "box_plot" | "heatmap" | "waterfall" | "control_chart";

export interface ChartConfig {
  chartType: ChartType;
  xColumn: string;
  yColumn: string;
  colorColumn?: string;
  groupBy?: string;
  title?: string;
  /** Control chart specific */
  ucl?: number;
  lcl?: number;
  centerLine?: number;
}

interface ChartEditorProps {
  config: ChartConfig;
  columns: string[];
  onChange: (next: ChartConfig) => void;
  onExplain?: () => void;
  onExportPng?: () => void;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "line",          label: "Line" },
  { value: "bar",           label: "Bar" },
  { value: "area",          label: "Area" },
  { value: "scatter",       label: "Scatter" },
  { value: "pie",           label: "Pie" },
  { value: "histogram",     label: "Histogram" },
  { value: "box_plot",      label: "Box Plot" },
  { value: "heatmap",       label: "Heatmap" },
  { value: "waterfall",     label: "Waterfall" },
  { value: "control_chart", label: "Control Chart (SPC)" },
];

export function ChartEditor({ config, columns, onChange, onExplain, onExportPng }: ChartEditorProps) {
  const [showSpc, setShowSpc] = useState(config.chartType === "control_chart");

  const set = (patch: Partial<ChartConfig>) => onChange({ ...config, ...patch });

  const sel = "bg-[#0d0d0d] border border-[#333] text-white/80 text-[11px] rounded px-2 py-1 focus:border-[#00d2ff] outline-none";
  const btn = "px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded border";

  return (
    <div className="border-t border-[#1a1a1a] bg-[#0a0a0a] px-3 py-2 flex flex-wrap gap-3 items-end">
      {/* Chart type */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-white/30 uppercase tracking-widest">Type</span>
        <select
          className={sel}
          value={config.chartType}
          onChange={(e) => {
            const t = e.target.value as ChartType;
            set({ chartType: t });
            setShowSpc(t === "control_chart");
          }}
        >
          {CHART_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>{ct.label}</option>
          ))}
        </select>
      </div>

      {/* X axis */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-white/30 uppercase tracking-widest">X</span>
        <select className={sel} value={config.xColumn} onChange={(e) => set({ xColumn: e.target.value })}>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Y axis */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-white/30 uppercase tracking-widest">Y</span>
        <select className={sel} value={config.yColumn} onChange={(e) => set({ yColumn: e.target.value })}>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Group by */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-white/30 uppercase tracking-widest">Group</span>
        <select className={sel} value={config.colorColumn ?? ""} onChange={(e) => set({ colorColumn: e.target.value || undefined })}>
          <option value="">—</option>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* SPC overlays — shown only for control_chart */}
      {showSpc && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">UCL</span>
            <input
              type="number"
              className={sel + " w-20"}
              value={config.ucl ?? ""}
              placeholder="auto"
              onChange={(e) => set({ ucl: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">LCL</span>
            <input
              type="number"
              className={sel + " w-20"}
              value={config.lcl ?? ""}
              placeholder="auto"
              onChange={(e) => set({ lcl: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">CL</span>
            <input
              type="number"
              className={sel + " w-20"}
              value={config.centerLine ?? ""}
              placeholder="mean"
              onChange={(e) => set({ centerLine: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 ml-auto items-end">
        {onExplain && (
          <button
            className={btn + " border-[#00d2ff33] text-[#00d2ff] hover:bg-[#00d2ff11]"}
            onClick={onExplain}
          >
            Explain
          </button>
        )}
        {onExportPng && (
          <button
            className={btn + " border-[#333] text-white/40 hover:text-white/60"}
            onClick={onExportPng}
          >
            PNG
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/ChartEditor.tsx
git commit -m "feat(viz): add ChartEditor toolbar — type/axis/SPC/export controls"
```

---

## Task 2: ControlChart component

**Files:**
- Create: `src/components/charts/ControlChart.tsx`

- [ ] **Step 1: Create ControlChart**

```tsx
// src/components/charts/ControlChart.tsx
import React, { useMemo } from "react";
import {
  ComposedChart, Line, ReferenceLine, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface ControlChartProps {
  data: Record<string, unknown>[];
  xColumn: string;
  yColumn: string;
  /** User-supplied UCL — if omitted, computed as mean + 3σ */
  ucl?: number;
  /** User-supplied LCL — if omitted, computed as mean - 3σ */
  lcl?: number;
  /** User-supplied center line — if omitted, computed as mean */
  centerLine?: number;
  title?: string;
}

function computeStats(data: Record<string, unknown>[], col: string) {
  const vals = data
    .map((r) => parseFloat(String(r[col])))
    .filter((v) => !Number.isNaN(v));
  if (vals.length === 0) return { mean: 0, sigma: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, sigma: Math.sqrt(variance) };
}

export function ControlChart({ data, xColumn, yColumn, ucl, lcl, centerLine, title }: ControlChartProps) {
  const stats = useMemo(() => computeStats(data, yColumn), [data, yColumn]);
  const cl = centerLine ?? stats.mean;
  const upper = ucl ?? cl + 3 * stats.sigma;
  const lower = lcl ?? cl - 3 * stats.sigma;

  const chartData = data.map((row) => {
    const val = parseFloat(String(row[yColumn]));
    return {
      ...row,
      [yColumn]: val,
      _violation: !Number.isNaN(val) && (val > upper || val < lower),
    };
  });

  const violationCount = chartData.filter((r) => r._violation).length;

  return (
    <div className="w-full">
      {title && (
        <div className="text-[11px] font-bold text-white/60 px-2 pb-1">{title}</div>
      )}
      {violationCount > 0 && (
        <div className="text-[10px] text-red-400 px-2 pb-1">
          ⚠ {violationCount} point{violationCount !== 1 ? "s" : ""} outside control limits
        </div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey={xColumn} tick={{ fill: "#666", fontSize: 10 }} />
          <YAxis tick={{ fill: "#666", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#0d0d0d", border: "1px solid #333", fontSize: 11 }}
            labelStyle={{ color: "#00d2ff" }}
          />
          <ReferenceLine y={upper} stroke="#f87171" strokeDasharray="4 2" label={{ value: "UCL", fill: "#f87171", fontSize: 9 }} />
          <ReferenceLine y={lower} stroke="#f87171" strokeDasharray="4 2" label={{ value: "LCL", fill: "#f87171", fontSize: 9 }} />
          <ReferenceLine y={cl} stroke="#34d399" strokeDasharray="2 2" label={{ value: "CL", fill: "#34d399", fontSize: 9 }} />
          {/* Normal points */}
          <Line
            type="linear"
            dataKey={yColumn}
            stroke="#00d2ff"
            strokeWidth={1.5}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={payload._violation ? "#f87171" : "#00d2ff"}
                  stroke="none"
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/ControlChart.tsx
git commit -m "feat(viz): add ControlChart component with auto 3-sigma limits"
```

---

## Task 3: Histogram, BoxPlot, Heatmap, Waterfall components

**Files:**
- Create: `src/components/charts/Histogram.tsx`
- Create: `src/components/charts/BoxPlot.tsx`
- Create: `src/components/charts/Heatmap.tsx`
- Create: `src/components/charts/Waterfall.tsx`

- [ ] **Step 1: Create Histogram**

```tsx
// src/components/charts/Histogram.tsx
import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface HistogramProps {
  data: Record<string, unknown>[];
  column: string;
  bins?: number;
  title?: string;
}

export function Histogram({ data, column, bins = 20, title }: HistogramProps) {
  const chartData = useMemo(() => {
    const vals = data.map((r) => parseFloat(String(r[column]))).filter((v) => !Number.isNaN(v));
    if (vals.length === 0) return [];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const step = (max - min) / bins || 1;
    const counts = Array.from({ length: bins }, (_, i) => ({
      bin: `${(min + i * step).toFixed(1)}–${(min + (i + 1) * step).toFixed(1)}`,
      count: 0,
    }));
    vals.forEach((v) => {
      const idx = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[idx].count++;
    });
    return counts;
  }, [data, column, bins]);

  return (
    <div className="w-full">
      {title && <div className="text-[11px] font-bold text-white/60 px-2 pb-1">{title}</div>}
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 40, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="bin" tick={{ fill: "#666", fontSize: 9 }} angle={-45} textAnchor="end" interval={2} />
          <YAxis tick={{ fill: "#666", fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid #333", fontSize: 11 }} />
          <Bar dataKey="count" fill="#00d2ff" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create BoxPlot**

```tsx
// src/components/charts/BoxPlot.tsx
import React, { useMemo } from "react";
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface BoxPlotProps {
  data: Record<string, unknown>[];
  xColumn: string;
  yColumn: string;
  title?: string;
}

function quartiles(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const median = s[Math.floor(s.length * 0.5)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const iqr = q3 - q1;
  return { min: q1 - 1.5 * iqr, q1, median, q3, max: q3 + 1.5 * iqr };
}

export function BoxPlot({ data, xColumn, yColumn, title }: BoxPlotProps) {
  const chartData = useMemo(() => {
    const groups: Record<string, number[]> = {};
    data.forEach((row) => {
      const key = String(row[xColumn] ?? "all");
      const val = parseFloat(String(row[yColumn]));
      if (!Number.isNaN(val)) {
        groups[key] = groups[key] ?? [];
        groups[key].push(val);
      }
    });
    return Object.entries(groups).map(([name, vals]) => {
      const q = quartiles(vals);
      return { name, min: q.min, q1: q.q1, median: q.median, q3: q.q3, max: q.max, iqr: q.q3 - q.q1 };
    });
  }, [data, xColumn, yColumn]);

  return (
    <div className="w-full">
      {title && <div className="text-[11px] font-bold text-white/60 px-2 pb-1">{title}</div>}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="name" tick={{ fill: "#666", fontSize: 10 }} />
          <YAxis tick={{ fill: "#666", fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid #333", fontSize: 11 }} />
          {/* IQR box: stacked bar from q1 baseline + iqr height */}
          <Bar dataKey="q1" stackId="box" fill="transparent" />
          <Bar dataKey="iqr" stackId="box" fill="#00d2ff" fillOpacity={0.5} stroke="#00d2ff" radius={[2, 2, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Create Heatmap**

```tsx
// src/components/charts/Heatmap.tsx
import React, { useMemo } from "react";

interface HeatmapProps {
  data: Record<string, unknown>[];
  xColumn: string;
  yColumn: string;
  valueColumn: string;
  title?: string;
}

export function Heatmap({ data, xColumn, yColumn, valueColumn, title }: HeatmapProps) {
  const { cells, xs, ys, minVal, maxVal } = useMemo(() => {
    const xs = [...new Set(data.map((r) => String(r[xColumn])))];
    const ys = [...new Set(data.map((r) => String(r[yColumn])))];
    const cells: Record<string, number> = {};
    let minVal = Infinity, maxVal = -Infinity;
    data.forEach((r) => {
      const key = `${r[xColumn]}__${r[yColumn]}`;
      const v = parseFloat(String(r[valueColumn]));
      if (!Number.isNaN(v)) {
        cells[key] = v;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    });
    return { cells, xs, ys, minVal, maxVal };
  }, [data, xColumn, yColumn, valueColumn]);

  const color = (v: number) => {
    const t = maxVal === minVal ? 0.5 : (v - minVal) / (maxVal - minVal);
    const r = Math.round(13 + t * (0 - 13));
    const g = Math.round(13 + t * (210 - 13));
    const b = Math.round(13 + t * (255 - 13));
    return `rgb(${r},${g},${b})`;
  };

  const cellW = Math.max(20, Math.min(60, Math.floor(560 / xs.length)));
  const cellH = Math.max(16, Math.min(40, Math.floor(280 / ys.length)));

  return (
    <div className="w-full overflow-auto">
      {title && <div className="text-[11px] font-bold text-white/60 px-2 pb-1">{title}</div>}
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
        {/* Header row */}
        <div style={{ display: "flex", gap: 1, marginLeft: 60 }}>
          {xs.map((x) => (
            <div key={x} style={{ width: cellW, fontSize: 9, color: "#666", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x}</div>
          ))}
        </div>
        {ys.map((y) => (
          <div key={y} style={{ display: "flex", gap: 1, alignItems: "center" }}>
            <div style={{ width: 56, fontSize: 9, color: "#666", textAlign: "right", paddingRight: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y}</div>
            {xs.map((x) => {
              const v = cells[`${x}__${y}`];
              return (
                <div
                  key={x}
                  title={v !== undefined ? `${x}, ${y}: ${v}` : "—"}
                  style={{
                    width: cellW,
                    height: cellH,
                    background: v !== undefined ? color(v) : "#111",
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: "#000",
                    fontWeight: "bold",
                  }}
                >
                  {v !== undefined ? v.toFixed(1) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create Waterfall**

```tsx
// src/components/charts/Waterfall.tsx
import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface WaterfallProps {
  data: Record<string, unknown>[];
  xColumn: string;
  yColumn: string;
  title?: string;
}

export function Waterfall({ data, xColumn, yColumn, title }: WaterfallProps) {
  const chartData = useMemo(() => {
    let cumulative = 0;
    return data.map((row) => {
      const val = parseFloat(String(row[yColumn])) || 0;
      const start = cumulative;
      cumulative += val;
      return { name: String(row[xColumn] ?? ""), delta: val, start, end: cumulative, positive: val >= 0 };
    });
  }, [data, xColumn, yColumn]);

  return (
    <div className="w-full">
      {title && <div className="text-[11px] font-bold text-white/60 px-2 pb-1">{title}</div>}
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="name" tick={{ fill: "#666", fontSize: 10 }} />
          <YAxis tick={{ fill: "#666", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#0d0d0d", border: "1px solid #333", fontSize: 11 }}
            formatter={(val: number, name: string) => name === "delta" ? [val.toFixed(2), "Change"] : null}
          />
          {/* invisible base bar */}
          <Bar dataKey="start" stackId="wf" fill="transparent" />
          {/* visible delta bar */}
          <Bar dataKey="delta" stackId="wf" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.positive ? "#34d399" : "#f87171"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/Histogram.tsx src/components/charts/BoxPlot.tsx src/components/charts/Heatmap.tsx src/components/charts/Waterfall.tsx
git commit -m "feat(viz): add Histogram, BoxPlot, Heatmap, Waterfall chart components"
```

---

## Task 4: Wire ChartEditor into ArtifactChartViewer

**Files:**
- Modify: `src/components/artifacts/ArtifactChartViewer.tsx`

- [ ] **Step 1: Read current ArtifactChartViewer structure**

Before editing, read the file to understand current state:
```bash
grep -n "chartType\|SUPPORTED_CHART_TYPES\|displayedArtifact\|columns\|useState\|return" src/components/artifacts/ArtifactChartViewer.tsx | head -40
```

- [ ] **Step 2: Add ChartConfig state and ChartEditor mount**

At the top of `ArtifactChartViewer.tsx`, add imports:

```typescript
import { ChartEditor, ChartConfig } from "../charts/ChartEditor";
import { ControlChart } from "../charts/ControlChart";
import { Histogram } from "../charts/Histogram";
import { BoxPlot } from "../charts/BoxPlot";
import { Heatmap } from "../charts/Heatmap";
import { Waterfall } from "../charts/Waterfall";
```

Inside the component, after the artifact is loaded and `displayedArtifact` is available, initialize config state:

```typescript
  const [chartConfig, setChartConfig] = useState<ChartConfig>(() => ({
    chartType: (displayedArtifact?.chart?.chartType as any) ?? "line",
    xColumn: displayedArtifact?.chart?.xColumn ?? "",
    yColumn: displayedArtifact?.chart?.yColumn ?? "",
    colorColumn: displayedArtifact?.chart?.colorColumn,
  }));
```

Note: `useState` initializer runs once — if `displayedArtifact` changes (revision navigation), add a `useEffect` to sync:

```typescript
  useEffect(() => {
    if (displayedArtifact?.chart) {
      setChartConfig({
        chartType: (displayedArtifact.chart.chartType as any) ?? "line",
        xColumn: displayedArtifact.chart.xColumn ?? "",
        yColumn: displayedArtifact.chart.yColumn ?? "",
        colorColumn: displayedArtifact.chart.colorColumn,
      });
    }
  }, [displayedArtifact?.id]);
```

- [ ] **Step 3: Route chart rendering through chartConfig**

Find where the chart component is rendered (the section with `chartType` switch or conditional). Replace the `chartType` source from `displayedArtifact.chart.chartType` with `chartConfig.chartType`. Do the same for `xColumn`, `yColumn`, `colorColumn`.

For the new types, add branches:

```tsx
{chartConfig.chartType === "control_chart" && chartData && (
  <ControlChart
    data={chartData}
    xColumn={chartConfig.xColumn}
    yColumn={chartConfig.yColumn}
    ucl={chartConfig.ucl}
    lcl={chartConfig.lcl}
    centerLine={chartConfig.centerLine}
    title={chartConfig.title}
  />
)}
{chartConfig.chartType === "histogram" && chartData && (
  <Histogram data={chartData} column={chartConfig.yColumn} title={chartConfig.title} />
)}
{chartConfig.chartType === "box_plot" && chartData && (
  <BoxPlot data={chartData} xColumn={chartConfig.xColumn} yColumn={chartConfig.yColumn} title={chartConfig.title} />
)}
{chartConfig.chartType === "heatmap" && chartData && (
  <Heatmap data={chartData} xColumn={chartConfig.xColumn} yColumn={chartConfig.yColumn} valueColumn={chartConfig.yColumn} title={chartConfig.title} />
)}
{chartConfig.chartType === "waterfall" && chartData && (
  <Waterfall data={chartData} xColumn={chartConfig.xColumn} yColumn={chartConfig.yColumn} title={chartConfig.title} />
)}
```

`chartData` is the query result rows — find the variable name used in the existing component.

- [ ] **Step 4: Mount ChartEditor below the chart**

Find the closing `</div>` of the chart container. Before it, add:

```tsx
<ChartEditor
  config={chartConfig}
  columns={columns}
  onChange={setChartConfig}
  onExplain={onExplain ? () => onExplain(chartConfig) : undefined}
  onExportPng={() => {
    // PNG export via html-to-image or browser print
    const el = document.querySelector("[data-chart-container]") as HTMLElement;
    if (!el) return;
    import("html-to-image").then(({ toPng }) =>
      toPng(el).then((url) => {
        const a = document.createElement("a");
        a.download = `${chartConfig.title ?? "chart"}.png`;
        a.href = url;
        a.click();
      })
    ).catch(() => window.print());
  }}
/>
```

Add `data-chart-container` attribute to the chart wrapper div so the export selector works.

- [ ] **Step 5: Install html-to-image if not present**

```bash
npm list html-to-image 2>/dev/null || npm install html-to-image
```

- [ ] **Step 6: Get column list for ChartEditor**

The `columns` prop needs the list of column names from the current query result. Find where `queryResults` or `rows` are available in the component. Derive columns:

```typescript
const columns = useMemo(
  () => (chartData && chartData.length > 0 ? Object.keys(chartData[0]) : []),
  [chartData]
);
```

- [ ] **Step 7: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/artifacts/ArtifactChartViewer.tsx
git commit -m "feat(viz): wire ChartEditor into ArtifactChartViewer — inline toolbar"
```

---

## Task 5: Update toolDefinitions.ts — new chart types + explain_chart tool

**Files:**
- Modify: `src/lib/agent/toolDefinitions.ts`

- [ ] **Step 1: Expand chartType enum in create_chart**

Find the `create_chart` tool definition (around line 282). Change:
```typescript
chartType: { type: "string", enum: ["bar", "line", "scatter", "pie", "area"], description: "Chart type" },
```
To:
```typescript
chartType: {
  type: "string",
  enum: ["bar", "line", "scatter", "pie", "area", "histogram", "box_plot", "heatmap", "waterfall", "control_chart"],
  description: "Chart type. Use control_chart for time-series SPC analysis, histogram for distributions, box_plot for group comparisons, heatmap for 2D density, waterfall for cumulative deltas.",
},
ucl: { type: "number", description: "Upper control limit for control_chart. If omitted, computed as mean+3σ." },
lcl: { type: "number", description: "Lower control limit for control_chart. If omitted, computed as mean-3σ." },
centerLine: { type: "number", description: "Center line for control_chart. If omitted, computed as mean." },
```

Do the same for `create_analysis_chart` (around line 302).

- [ ] **Step 2: Add explain_chart tool**

After the `create_analysis_chart` tool definition, add:

```typescript
  {
    name: "explain_chart",
    description:
      "Ask the AI to explain the visible patterns in an existing chart artifact. Provide the artifactId. The AI will describe trends, anomalies, outliers, and statistical patterns in plain English.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "ID of the chart artifact to explain" },
        question: { type: "string", description: "Optional specific question about the chart, e.g. 'why is there a spike on Tuesday?'" },
      },
      required: ["artifactId"],
    },
  },
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/toolDefinitions.ts
git commit -m "feat(viz): add new chart types and explain_chart tool to agent schema"
```

---

## Task 6: Final validation

- [ ] Run `npm run lint` — zero errors
- [ ] Run `npm run dev` — app starts at localhost:1420
- [ ] Manually: open AI panel, trigger a chart creation — verify ChartEditor toolbar appears below chart
- [ ] Manually: change chart type to "Control Chart (SPC)" — verify UCL/LCL inputs appear
- [ ] Manually: change X/Y axis — verify chart re-renders without AI call
- [ ] Manually: click PNG export — verify image downloads
- [ ] Run `npm run tauri:dev` — desktop window opens, no compile errors
