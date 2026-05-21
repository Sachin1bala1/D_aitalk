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
