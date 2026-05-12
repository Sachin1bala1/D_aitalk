import type { ColumnMeta } from '../db/DbClient';

export type ChartType =
  | 'scatter'
  | 'line'
  | 'bar'
  | 'histogram'
  | 'box'
  | 'heatmap'
  | 'control_chart'
  | 'pareto'
  | 'area'
  | 'violin'
  | 'bubble';

function isNumeric(col: ColumnMeta): boolean {
  const kind = col.display_type?.kind;
  return kind === 'integer' || kind === 'float';
}

function isDate(col: ColumnMeta): boolean {
  const kind = col.display_type?.kind;
  return kind === 'date' || kind === 'timestamp' || kind === 'duration';
}

export function autoSelectChart(
  xCol: ColumnMeta | null,
  yCol: ColumnMeta | null,
  _colorCol?: ColumnMeta | null,
  sizeCol?: ColumnMeta | null,
  _data?: Record<string, unknown>[]
): ChartType {
  if (!xCol && !yCol) return 'bar';

  if (xCol && yCol) {
    if (isDate(xCol) && isNumeric(yCol)) return 'line';
    if (isNumeric(xCol) && isNumeric(yCol) && sizeCol && isNumeric(sizeCol)) return 'bubble';
    if (isNumeric(xCol) && isNumeric(yCol)) return 'scatter';
    if (!isNumeric(xCol) && !isDate(xCol) && isNumeric(yCol)) return 'bar';
    if (!isNumeric(xCol) && !isDate(xCol) && !isNumeric(yCol) && !isDate(yCol)) return 'heatmap';
  }

  if (xCol && !yCol) {
    if (isNumeric(xCol)) return 'histogram';
    return 'bar';
  }

  return 'bar';
}
