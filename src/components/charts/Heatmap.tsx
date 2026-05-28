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
