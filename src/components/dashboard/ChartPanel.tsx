import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { CanvasChart } from "./CanvasChart";

export function ChartPanel() {
  const gogChartRequest = useWorkspaceStore((s) => s.gogChartRequest);
  const setGogChartRequest = useWorkspaceStore((s) => s.setGogChartRequest);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 600, height: 400 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (!gogChartRequest) return null;

  const { spec, binData, strategy, estimatedRows } = gogChartRequest;
  const useCanvas = strategy === "binned" && binData !== null && binData.length > 0;

  const rowLabel =
    estimatedRows >= 1_000_000
      ? `${(estimatedRows / 1e6).toFixed(1)}M rows`
      : estimatedRows > 0
      ? `${estimatedRows.toLocaleString()} rows`
      : null;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] border-t border-white/5">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 text-xs text-white/60 shrink-0">
        <span className="font-semibold text-white/80">
          {spec.guides?.title ?? `${spec.geom} — ${spec.aes.x}${spec.aes.y ? ` vs ${spec.aes.y}` : ""}`}
        </span>
        {rowLabel && (
          <span className="text-white/30 ml-1">
            {rowLabel}
            {strategy === "binned" && " · binned"}
          </span>
        )}
        <button
          onClick={() => setGogChartRequest(null)}
          className="ml-auto hover:text-white/80 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0 p-2">
        {useCanvas ? (
          <CanvasChart
            spec={spec}
            data={binData!}
            width={size.width - 16}
            height={size.height - 16}
            selectedIndices={[]}
            onSelect={() => {}}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            {strategy === "raw"
              ? "Small dataset — switch to GraphBuilder for interactive charts"
              : "No chart data available"}
          </div>
        )}
      </div>
    </div>
  );
}
