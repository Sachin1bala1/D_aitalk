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
