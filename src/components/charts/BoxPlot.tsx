// src/components/charts/BoxPlot.tsx
import React, { useMemo } from "react";
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
