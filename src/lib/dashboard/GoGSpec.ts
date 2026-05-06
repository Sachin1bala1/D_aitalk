export interface GoGSpec {
  table: string;
  schema: string;
  connectionId: string;
  whereClause?: string;
  aes: {
    x: string;
    y?: string;
    color?: string;
    size?: string;
    facet?: string;
    group?: string;
    label?: string;
  };
  geom: "scatter" | "line" | "bar" | "histogram" | "box" | "area";
  stat: "identity" | "bin" | "count" | "summary";
  scales?: {
    x?: { type: "linear" | "log" | "time" | "ordinal"; domain?: [number, number] };
    y?: { type: "linear" | "log"; domain?: [number, number] };
  };
  coord?: "cartesian" | "polar";
  guides?: {
    title?: string;
    xLabel?: string;
    yLabel?: string;
    showLegend?: boolean;
  };
  overlays?: Array<
    | { type: "ref_line"; axis: "x" | "y"; value: number; label?: string; color?: string }
    | { type: "trend_line"; method: "ols" | "loess" }
    | { type: "spec_limits"; lsl: number; usl: number; target?: number }
    | { type: "mean_line"; color?: string }
  >;
  _runtime?: {
    strategy: "raw" | "binned";
    estimatedRows: number;
    generatedSQL: string;
  };
}
