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
            formatter={(val: unknown, name: unknown) => String(name) === "delta" ? [(Number(val)).toFixed(2), "Change"] : null}
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
