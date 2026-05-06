import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { GoGSpec } from '../../lib/dashboard/GoGSpec';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CanvasChartProps {
  spec: GoGSpec;
  data: Record<string, unknown>[];
  width: number;
  height: number;
  selectedIndices: number[];
  onSelect: (indices: number[]) => void;
}

interface BrushStart {
  x: number;
  y: number;
}

interface BrushRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const PALETTE = [
  '#0066CC', '#00C49A', '#FF6B35', '#7B61FF', '#FFD700',
  '#FF4D8D', '#39FF14', '#FF9500', '#E040FB', '#00BFA5',
];

function colorScale(value: unknown, allData: Record<string, unknown>[]): string {
  if (value === null || value === undefined) return '#0066CC';
  const uniqueVals = [...new Set(allData.map((d) => d['color_val']))];
  const idx = uniqueVals.indexOf(value);
  return PALETTE[idx % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------

function makeLinearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  const span = domainMax - domainMin || 1;
  return (v: number) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

// ---------------------------------------------------------------------------
// drawAxes
// ---------------------------------------------------------------------------

function drawAxes(
  ctx: CanvasRenderingContext2D,
  spec: GoGSpec,
  data: Record<string, unknown>[],
  width: number,
  height: number,
  xScale: (v: number) => number,
  yScale: (v: number) => number,
  xDomain: [number, number],
  yDomain: [number, number],
): void {
  const LEFT = 60;
  const BOTTOM = height - 40;

  ctx.save();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;

  // X axis line
  ctx.beginPath();
  ctx.moveTo(LEFT, BOTTOM);
  ctx.lineTo(width - 20, BOTTOM);
  ctx.stroke();

  // Y axis line
  ctx.beginPath();
  ctx.moveTo(LEFT, 20);
  ctx.lineTo(LEFT, BOTTOM);
  ctx.stroke();

  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif';

  // X ticks
  const xTickCount = Math.max(2, Math.floor((width - 80) / 80));
  for (let i = 0; i <= xTickCount; i++) {
    const val = xDomain[0] + (i / xTickCount) * (xDomain[1] - xDomain[0]);
    const px = xScale(val);
    ctx.beginPath();
    ctx.moveTo(px, BOTTOM);
    ctx.lineTo(px, BOTTOM + 5);
    ctx.stroke();

    const label = data.length > 0 && spec.geom === 'line'
      ? (() => {
          const n = Number(val);
          if (!isNaN(n) && n > 1e9) return new Date(n).toLocaleDateString();
          return String(Math.round(val));
        })()
      : String(Math.round(val));

    ctx.save();
    ctx.translate(px, BOTTOM + 8);
    ctx.rotate(Math.PI / 4);
    ctx.textAlign = 'left';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  // Y ticks
  const yTickCount = Math.max(2, Math.floor((height - 60) / 50));
  for (let i = 0; i <= yTickCount; i++) {
    const val = yDomain[0] + (i / yTickCount) * (yDomain[1] - yDomain[0]);
    const py = yScale(val);
    ctx.beginPath();
    ctx.moveTo(LEFT - 5, py);
    ctx.lineTo(LEFT, py);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(val * 100) / 100), LEFT - 8, py + 4);
  }

  // Axis labels
  if (spec.guides?.xLabel) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.fillText(spec.guides.xLabel, (LEFT + width - 20) / 2, height - 5);
  }
  if (spec.guides?.yLabel) {
    ctx.save();
    ctx.translate(14, (20 + BOTTOM) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.fillText(spec.guides.yLabel, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawScaleBadge
// ---------------------------------------------------------------------------

function drawScaleBadge(
  ctx: CanvasRenderingContext2D,
  spec: GoGSpec,
  width: number,
  height: number,
): void {
  if (spec._runtime?.strategy === 'binned') {
    const rows = spec._runtime.estimatedRows;
    const label =
      rows >= 1e6
        ? `Showing ${(rows / 1e6).toFixed(1)}M rows · binned`
        : `Showing ${rows.toLocaleString()} rows · binned`;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px monospace';
    ctx.fillText(label, width - 200, height - 8);
  }
}

// ---------------------------------------------------------------------------
// drawOverlayAnnotations
// ---------------------------------------------------------------------------

function drawOverlayAnnotations(
  ctx: CanvasRenderingContext2D,
  spec: GoGSpec,
  data: Record<string, unknown>[],
  width: number,
  height: number,
  yScale: (v: number) => number,
  xScale: (v: number) => number,
): void {
  if (!spec.overlays) return;

  for (const overlay of spec.overlays) {
    ctx.save();

    if (overlay.type === 'ref_line') {
      ctx.strokeStyle = overlay.color ?? '#FF6B35';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      if (overlay.axis === 'y') {
        const py = yScale(overlay.value);
        ctx.moveTo(60, py);
        ctx.lineTo(width - 20, py);
        if (overlay.label) {
          ctx.fillStyle = overlay.color ?? '#FF6B35';
          ctx.font = '11px sans-serif';
          ctx.fillText(overlay.label, width - 20 - ctx.measureText(overlay.label).width - 4, py - 3);
        }
      } else {
        const px = xScale(overlay.value);
        ctx.moveTo(px, 20);
        ctx.lineTo(px, height - 40);
        if (overlay.label) {
          ctx.fillStyle = overlay.color ?? '#FF6B35';
          ctx.font = '11px sans-serif';
          ctx.save();
          ctx.translate(px + 3, 30);
          ctx.fillText(overlay.label, 0, 0);
          ctx.restore();
        }
      }
      ctx.stroke();
    } else if (overlay.type === 'spec_limits') {
      const drawLimit = (val: number, color: string, dash: number[]) => {
        const py = yScale(val);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(60, py);
        ctx.lineTo(width - 20, py);
        ctx.stroke();
      };
      drawLimit(overlay.usl, '#FF4444', [6, 3]);
      drawLimit(overlay.lsl, '#FF4444', [6, 3]);
      if (overlay.target !== undefined) {
        drawLimit(overlay.target, '#00C49A', []);
      }
    } else if (overlay.type === 'mean_line') {
      const yVals = data
        .map((d) => Number(d['y']))
        .filter((v) => !isNaN(v));
      if (yVals.length > 0) {
        const mean = yVals.reduce((a, b) => a + b, 0) / yVals.length;
        const py = yScale(mean);
        ctx.strokeStyle = overlay.color ?? '#FFD700';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(60, py);
        ctx.lineTo(width - 20, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = overlay.color ?? '#FFD700';
        ctx.font = '11px sans-serif';
        ctx.fillText(`mean=${Math.round(mean * 100) / 100}`, 62, py - 3);
      }
    }
    // trend_line: deferred to Sprint 5

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Geom renderers
// ---------------------------------------------------------------------------

function renderScatter(
  ctx: CanvasRenderingContext2D,
  data: Record<string, unknown>[],
  width: number,
  height: number,
  selectedIndices: number[],
): void {
  if (data.length === 0) return;

  const xBins = data.map((b) => Number(b['x_bin']));
  const yBins = data.map((b) => Number(b['y_bin']));
  const xMin = Math.min(...xBins);
  const xMax = Math.max(...xBins);
  const yMin = Math.min(...yBins);
  const yMax = Math.max(...yBins);

  const xScale = makeLinearScale(xMin, xMax, 60, width - 20);
  const yScale = makeLinearScale(yMin, yMax, height - 40, 20);

  const maxCount = Math.max(...data.map((b) => Number(b['point_count'])));
  const countToRadius = (count: number) =>
    Math.max(2, Math.sqrt(count / maxCount) * 10);

  data.forEach((bin, i) => {
    const px = xScale(Number(bin['x_bin']));
    const py = yScale(Number(bin['y_bin']));
    const r = countToRadius(Number(bin['point_count']));
    const color = colorScale(bin['color_val'], data);

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = selectedIndices.length === 0 || selectedIndices.includes(i)
      ? color
      : 'rgba(100,100,100,0.3)';
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function renderLine(
  ctx: CanvasRenderingContext2D,
  data: Record<string, unknown>[],
  width: number,
  height: number,
): void {
  if (data.length === 0) return;

  const parseX = (raw: unknown): number => {
    const n = Number(raw);
    if (!isNaN(n)) return n;
    const d = Date.parse(String(raw));
    return isNaN(d) ? 0 : d;
  };

  const xVals = data.map((d) => parseX(d['x']));
  const yVals = data.map((d) => Number(d['y']));
  const yMinVals = data.map((d) => Number(d['y_min']));
  const yMaxVals = data.map((d) => Number(d['y_max']));

  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const allY = [...yVals, ...yMinVals, ...yMaxVals].filter((v) => !isNaN(v));
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);

  const xScale = makeLinearScale(xMin, xMax, 60, width - 20);
  const yScale = makeLinearScale(yMin, yMax, height - 40, 20);

  const pts = data.map((d, i) => ({
    px: xScale(xVals[i]),
    pyMean: yScale(Number(d['y'])),
    pyMin: yScale(Number(d['y_min'])),
    pyMax: yScale(Number(d['y_max'])),
  }));

  // Confidence band
  ctx.save();
  ctx.beginPath();
  pts.forEach(({ px, pyMin }, i) => {
    if (i === 0) ctx.moveTo(px, pyMin);
    else ctx.lineTo(px, pyMin);
  });
  for (let i = pts.length - 1; i >= 0; i--) {
    ctx.lineTo(pts[i].px, pts[i].pyMax);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 196, 154, 0.15)';
  ctx.fill();
  ctx.restore();

  // Mean line
  ctx.save();
  ctx.strokeStyle = '#00C49A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach(({ px, pyMean }, i) => {
    if (i === 0) ctx.moveTo(px, pyMean);
    else ctx.lineTo(px, pyMean);
  });
  ctx.stroke();
  ctx.restore();
}

function renderBox(
  ctx: CanvasRenderingContext2D,
  data: Record<string, unknown>[],
  width: number,
  height: number,
): void {
  if (data.length === 0) return;

  const allNums: number[] = [];
  data.forEach((d) => {
    ['q1', 'q3', 'whisker_low', 'whisker_high', 'mean'].forEach((k) => {
      const v = Number(d[k]);
      if (!isNaN(v)) allNums.push(v);
    });
  });
  const yMin = Math.min(...allNums);
  const yMax = Math.max(...allNums);
  const yScale = makeLinearScale(yMin, yMax, height - 40, 20);

  const step = (width - 80) / data.length;
  const boxWidth = step * 0.6;

  data.forEach((d, i) => {
    const cx = 60 + (i + 0.5) * step;
    const q1 = yScale(Number(d['q1']));
    const q2 = yScale(Number(d['q2']));
    const q3 = yScale(Number(d['q3']));
    const wLow = yScale(Number(d['whisker_low']));
    const wHigh = yScale(Number(d['whisker_high']));

    // Whisker
    ctx.save();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, wHigh);
    ctx.lineTo(cx, wLow);
    ctx.stroke();

    // Whisker caps
    ctx.beginPath();
    ctx.moveTo(cx - boxWidth / 4, wHigh);
    ctx.lineTo(cx + boxWidth / 4, wHigh);
    ctx.moveTo(cx - boxWidth / 4, wLow);
    ctx.lineTo(cx + boxWidth / 4, wLow);
    ctx.stroke();
    ctx.restore();

    // IQR box
    ctx.save();
    const boxTop = Math.min(q1, q3);
    const boxH = Math.abs(q1 - q3);
    ctx.fillStyle = 'rgba(0, 102, 204, 0.6)';
    ctx.fillRect(cx - boxWidth / 2, boxTop, boxWidth, boxH);
    ctx.strokeStyle = 'rgba(0, 102, 204, 1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxWidth / 2, boxTop, boxWidth, boxH);
    ctx.restore();

    // Median line
    ctx.save();
    ctx.strokeStyle = '#00C49A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - boxWidth / 2, q2);
    ctx.lineTo(cx + boxWidth / 2, q2);
    ctx.stroke();
    ctx.restore();

    // Category label
    ctx.save();
    ctx.fillStyle = '#aaa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(d['x']), cx, height - 25);
    ctx.restore();
  });
}

function renderHistogram(
  ctx: CanvasRenderingContext2D,
  data: Record<string, unknown>[],
  width: number,
  height: number,
): void {
  if (data.length === 0) return;

  const binStarts = data.map((d) => Number(d['bin_start']));
  const binEnds = data.map((d) => Number(d['bin_end']));
  const freqs = data.map((d) => Number(d['frequency']));

  const xMin = Math.min(...binStarts);
  const xMax = Math.max(...binEnds);
  const freqMax = Math.max(...freqs);

  const xScale = makeLinearScale(xMin, xMax, 60, width - 20);
  const yScale = makeLinearScale(0, freqMax, height - 40, 20);

  data.forEach((bin, i) => {
    const x1 = xScale(Number(bin['bin_start']));
    const x2 = xScale(Number(bin['bin_end']));
    const y = yScale(freqs[i]);
    const h = yScale(0) - y;

    ctx.fillStyle = 'rgba(0, 102, 204, 0.7)';
    ctx.fillRect(x1 + 1, y, x2 - x1 - 2, h);
    ctx.strokeStyle = 'rgba(0, 102, 204, 1)';
    ctx.strokeRect(x1 + 1, y, x2 - x1 - 2, h);
  });
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function computeDomains(
  spec: GoGSpec,
  data: Record<string, unknown>[],
): { xDomain: [number, number]; yDomain: [number, number] } {
  if (data.length === 0) return { xDomain: [0, 1], yDomain: [0, 1] };

  if (spec.geom === 'scatter') {
    const xBins = data.map((b) => Number(b['x_bin']));
    const yBins = data.map((b) => Number(b['y_bin']));
    return {
      xDomain: [Math.min(...xBins), Math.max(...xBins)],
      yDomain: [Math.min(...yBins), Math.max(...yBins)],
    };
  }

  if (spec.geom === 'line') {
    const parseX = (raw: unknown): number => {
      const n = Number(raw);
      if (!isNaN(n)) return n;
      const d = Date.parse(String(raw));
      return isNaN(d) ? 0 : d;
    };
    const xVals = data.map((d) => parseX(d['x']));
    const yVals = [
      ...data.map((d) => Number(d['y'])),
      ...data.map((d) => Number(d['y_min'])),
      ...data.map((d) => Number(d['y_max'])),
    ].filter((v) => !isNaN(v));
    return {
      xDomain: [Math.min(...xVals), Math.max(...xVals)],
      yDomain: [Math.min(...yVals), Math.max(...yVals)],
    };
  }

  if (spec.geom === 'histogram') {
    const binStarts = data.map((d) => Number(d['bin_start']));
    const binEnds = data.map((d) => Number(d['bin_end']));
    const freqs = data.map((d) => Number(d['frequency']));
    return {
      xDomain: [Math.min(...binStarts), Math.max(...binEnds)],
      yDomain: [0, Math.max(...freqs)],
    };
  }

  if (spec.geom === 'box') {
    const allNums: number[] = [];
    data.forEach((d) => {
      ['q1', 'q3', 'whisker_low', 'whisker_high'].forEach((k) => {
        const v = Number(d[k]);
        if (!isNaN(v)) allNums.push(v);
      });
    });
    return {
      xDomain: [0, data.length],
      yDomain: [Math.min(...allNums), Math.max(...allNums)],
    };
  }

  return { xDomain: [0, 1], yDomain: [0, 1] };
}

// ---------------------------------------------------------------------------
// Tooltip drawing
// ---------------------------------------------------------------------------

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  bin: Record<string, unknown>,
  geom: string,
  tx: number,
  ty: number,
  width: number,
  height: number,
): void {
  let lines: string[];

  if (geom === 'box') {
    lines = [
      `cat: ${bin['x']}`,
      `q1=${Math.round(Number(bin['q1']) * 100) / 100}`,
      `q2=${Math.round(Number(bin['q2']) * 100) / 100}`,
      `q3=${Math.round(Number(bin['q3']) * 100) / 100}`,
      `lo=${Math.round(Number(bin['whisker_low']) * 100) / 100}`,
      `hi=${Math.round(Number(bin['whisker_high']) * 100) / 100}`,
    ];
  } else if (geom === 'line') {
    const xVal = bin['x'];
    const n = Number(xVal);
    const xDisp = !isNaN(n) && n > 1e9 ? new Date(n).toLocaleDateString() : String(xVal);
    lines = [
      `x=${xDisp}`,
      `avg=${Math.round(Number(bin['y']) * 100) / 100}`,
      `min=${Math.round(Number(bin['y_min']) * 100) / 100}`,
      `max=${Math.round(Number(bin['y_max']) * 100) / 100}`,
    ];
  } else {
    lines = [
      `x=${Math.round(Number(bin['x']) * 100) / 100}`,
      `y=${Math.round(Number(bin['y']) * 100) / 100}`,
      `n=${bin['point_count']} pts`,
    ];
  }

  ctx.save();
  ctx.font = '12px monospace';

  const padding = 8;
  const lineHeight = 16;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padding * 2;
  const boxH = lines.length * lineHeight + padding * 2;

  let bx = tx + 12;
  let by = ty - boxH / 2;
  if (bx + boxW > width - 10) bx = tx - boxW - 12;
  if (by < 5) by = 5;
  if (by + boxH > height - 5) by = height - boxH - 5;

  // Background
  ctx.fillStyle = 'rgba(20,20,30,0.9)';
  ctx.beginPath();
  const r = 6;
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boxW - r, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
  ctx.lineTo(bx + boxW, by + boxH - r);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
  ctx.lineTo(bx + r, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => {
    ctx.fillText(line, bx + padding, by + padding + (i + 1) * lineHeight - 4);
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CanvasChart({
  spec,
  data,
  width,
  height,
  selectedIndices,
  onSelect,
}: CanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredBin, setHoveredBin] = useState<Record<string, unknown> | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [brushStart, setBrushStart] = useState<BrushStart | null>(null);
  const [brushRect, setBrushRect] = useState<BrushRect | null>(null);
  const rafRef = useRef<number>(0);

  // -------------------------------------------------------------------
  // Bottom canvas: static render
  // -------------------------------------------------------------------

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { xDomain, yDomain } = computeDomains(spec, data);
    const xScale = makeLinearScale(xDomain[0], xDomain[1], 60, width - 20);
    const yScale = makeLinearScale(yDomain[0], yDomain[1], height - 40, 20);

    drawAxes(ctx, spec, data, width, height, xScale, yScale, xDomain, yDomain);

    if (spec.geom === 'scatter') {
      renderScatter(ctx, data, width, height, selectedIndices);
    } else if (spec.geom === 'line') {
      renderLine(ctx, data, width, height);
    } else if (spec.geom === 'box') {
      renderBox(ctx, data, width, height);
    } else if (spec.geom === 'histogram') {
      renderHistogram(ctx, data, width, height);
    }

    drawOverlayAnnotations(ctx, spec, data, width, height, yScale, xScale);
    drawScaleBadge(ctx, spec, width, height);
  }, [data, spec, width, height, selectedIndices]);

  // -------------------------------------------------------------------
  // Sync overlay canvas size
  // -------------------------------------------------------------------

  useEffect(() => {
    if (!overlayRef.current) return;
    const canvas = overlayRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }, [width, height]);

  // -------------------------------------------------------------------
  // Overlay canvas: hover tooltip + brush
  // -------------------------------------------------------------------

  const redrawOverlay = useCallback(
    (
      hovered: Record<string, unknown> | null,
      tipPos: { x: number; y: number } | null,
      brush: BrushRect | null,
    ) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      if (brush) {
        ctx.save();
        ctx.strokeStyle = '#00C49A';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(brush.x, brush.y, brush.w, brush.h);
        ctx.restore();
      }

      if (hovered && tipPos) {
        drawTooltip(ctx, hovered, spec.geom, tipPos.x, tipPos.y, width, height);
      }
    },
    [width, height, spec.geom],
  );

  // -------------------------------------------------------------------
  // Bin hit-test helpers
  // -------------------------------------------------------------------

  const findNearestBin = useCallback(
    (cx: number, cy: number): { bin: Record<string, unknown>; idx: number } | null => {
      if (data.length === 0) return null;

      const { xDomain, yDomain } = computeDomains(spec, data);
      const xScale = makeLinearScale(xDomain[0], xDomain[1], 60, width - 20);
      const yScale = makeLinearScale(yDomain[0], yDomain[1], height - 40, 20);

      type BestHit = { bin: Record<string, unknown>; idx: number; dist: number };
      let best: BestHit | null = null;

      data.forEach((bin, i) => {
        let px: number;
        let py: number;

        if (spec.geom === 'scatter') {
          px = xScale(Number(bin['x_bin']));
          py = yScale(Number(bin['y_bin']));
        } else if (spec.geom === 'line') {
          const raw = bin['x'];
          const n = Number(raw);
          const xVal = !isNaN(n) ? n : Date.parse(String(raw));
          px = xScale(xVal);
          py = yScale(Number(bin['y']));
        } else if (spec.geom === 'box') {
          const step = (width - 80) / data.length;
          px = 60 + (i + 0.5) * step;
          py = yScale(Number(bin['q2']));
        } else if (spec.geom === 'histogram') {
          const xMinB = Math.min(...data.map((d) => Number(d['bin_start'])));
          const xMaxB = Math.max(...data.map((d) => Number(d['bin_end'])));
          const xScaleH = makeLinearScale(xMinB, xMaxB, 60, width - 20);
          px = (xScaleH(Number(bin['bin_start'])) + xScaleH(Number(bin['bin_end']))) / 2;
          py = yScale(Number(bin['frequency']));
        } else {
          return;
        }

        const dist = Math.hypot(cx - px, cy - py);
        if (dist < 20 && (!best || dist < best.dist)) {
          best = { bin, idx: i, dist };
        }
      });

      const hit = best as BestHit | null;
      return hit ? { bin: hit.bin, idx: hit.idx } : null;
    },
    [data, spec, width, height],
  );

  const getBinsInRect = useCallback(
    (rect: BrushRect): number[] => {
      if (data.length === 0) return [];

      const { xDomain, yDomain } = computeDomains(spec, data);
      const xScale = makeLinearScale(xDomain[0], xDomain[1], 60, width - 20);
      const yScale = makeLinearScale(yDomain[0], yDomain[1], height - 40, 20);

      const rx1 = Math.min(rect.x, rect.x + rect.w);
      const rx2 = Math.max(rect.x, rect.x + rect.w);
      const ry1 = Math.min(rect.y, rect.y + rect.h);
      const ry2 = Math.max(rect.y, rect.y + rect.h);

      const result: number[] = [];
      data.forEach((bin, i) => {
        let px: number;
        let py: number;

        if (spec.geom === 'scatter') {
          px = xScale(Number(bin['x_bin']));
          py = yScale(Number(bin['y_bin']));
        } else if (spec.geom === 'line') {
          const raw = bin['x'];
          const n = Number(raw);
          const xVal = !isNaN(n) ? n : Date.parse(String(raw));
          px = xScale(xVal);
          py = yScale(Number(bin['y']));
        } else if (spec.geom === 'box') {
          const step = (width - 80) / data.length;
          px = 60 + (i + 0.5) * step;
          py = yScale(Number(bin['q2']));
        } else if (spec.geom === 'histogram') {
          const xMinB = Math.min(...data.map((d) => Number(d['bin_start'])));
          const xMaxB = Math.max(...data.map((d) => Number(d['bin_end'])));
          const xScaleH = makeLinearScale(xMinB, xMaxB, 60, width - 20);
          px = (xScaleH(Number(bin['bin_start'])) + xScaleH(Number(bin['bin_end']))) / 2;
          py = yScale(Number(bin['frequency']));
        } else {
          return;
        }

        if (px >= rx1 && px <= rx2 && py >= ry1 && py <= ry2) {
          result.push(i);
        }
      });

      return result;
    },
    [data, spec, width, height],
  );

  // -------------------------------------------------------------------
  // Mouse handlers
  // -------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (brushStart) {
        const newBrush: BrushRect = {
          x: brushStart.x,
          y: brushStart.y,
          w: cx - brushStart.x,
          h: cy - brushStart.y,
        };
        setBrushRect(newBrush);

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          redrawOverlay(hoveredBin, tooltipPos, newBrush);
        });
        return;
      }

      const hit = findNearestBin(cx, cy);
      const newHovered = hit ? hit.bin : null;
      const newPos = hit ? { x: cx, y: cy } : null;

      setHoveredBin(newHovered);
      setTooltipPos(newPos);

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        redrawOverlay(newHovered, newPos, brushRect);
      });
    },
    [brushStart, brushRect, hoveredBin, tooltipPos, findNearestBin, redrawOverlay],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredBin(null);
    setTooltipPos(null);
    setBrushStart(null);
    setBrushRect(null);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      redrawOverlay(null, null, null);
    });
  }, [redrawOverlay]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setBrushStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setBrushRect(null);
    },
    [],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!brushStart) return;
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const finalRect: BrushRect = {
        x: brushStart.x,
        y: brushStart.y,
        w: cx - brushStart.x,
        h: cy - brushStart.y,
      };

      if (Math.abs(finalRect.w) > 4 || Math.abs(finalRect.h) > 4) {
        const indices = getBinsInRect(finalRect);
        onSelect(indices);
      }

      setBrushStart(null);
      setBrushRect(null);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        redrawOverlay(hoveredBin, tooltipPos, null);
      });
    },
    [brushStart, getBinsInRect, onSelect, hoveredBin, tooltipPos, redrawOverlay],
  );

  // -------------------------------------------------------------------
  // ResizeObserver
  // -------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // Dimensions are controlled by props — trigger re-render
      // by calling the bottom canvas effect's cleanup and re-run cycle.
      // The parent is responsible for passing updated width/height.
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width, height }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      <canvas
        ref={overlayRef}
        style={{ position: 'absolute', top: 0, left: 0, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
}
