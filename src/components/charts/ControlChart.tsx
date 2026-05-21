// src/components/charts/ControlChart.tsx
import React, { useMemo } from "react";
import {
  ComposedChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
            dot={(props: { cx?: number; cy?: number; payload?: Record<string, unknown> }) => {
              const { cx, cy, payload } = props;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={payload?._violation ? "#f87171" : "#00d2ff"}
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
