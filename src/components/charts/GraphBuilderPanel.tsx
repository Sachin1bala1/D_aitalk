/**
 * GraphBuilderPanel — JMP-Style Graph Builder panel.
 *
 * Three-column layout:
 *   [LEFT 200px: column list] [CENTER flex: drop zones + chart] [RIGHT 180px: chart options]
 *
 * Features:
 * - HTML5 drag-and-drop from column list to drop zones
 * - Auto chart type selection via autoSelectChart()
 * - Manual chart type override via right panel buttons
 * - Chart options: show data points, trend line, log scale, reference line, CI
 * - Save/restore chart configs to localStorage
 * - Export: PNG (html2canvas TODO), TSV copy
 * - Selection via shift+click; right-click context menu → "Analyze with APEX"
 */
import React, { useState, useCallback } from 'react';
import { X, ChevronDown, ChevronRight, BarChart2, TrendingUp, Download, Save, List, Hash, Calendar, Type, HelpCircle } from 'lucide-react';
import type { ColumnMeta } from '../../lib/db/DbClient';
import { GraphBuilder } from './GraphBuilder';
import { autoSelectChart, type ChartType } from '../../lib/charts/chartAutoSelect';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AxisAssignments {
  x: string | null;
  y: string | null;
  color: string | null;
  size: string | null;
  facet: string | null;
}

interface ChartOptions {
  showDataPoints: boolean;
  showTrendLine: boolean;
  logScaleX: boolean;
  logScaleY: boolean;
  refLineValue: string;
  refLineLabel: string;
  confidenceInterval: 'none' | '95' | '99';
}

interface SavedChartConfig {
  id: string;
  name: string;
  assignments: AxisAssignments;
  chartType: ChartType | 'auto';
  options: ChartOptions;
  savedAt: number;
}

const STORAGE_KEY = 'daitalk_saved_charts';
const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: 'scatter', label: 'Scatter', icon: <span className="text-[10px]">⟡</span> },
  { type: 'line', label: 'Line', icon: <TrendingUp className="w-3 h-3" /> },
  { type: 'bar', label: 'Bar', icon: <BarChart2 className="w-3 h-3" /> },
  { type: 'histogram', label: 'Histogram', icon: <span className="text-[10px]">▦</span> },
  { type: 'box', label: 'Box', icon: <span className="text-[10px]">□</span> },
  { type: 'heatmap', label: 'Heatmap', icon: <span className="text-[10px]">▤</span> },
  { type: 'control_chart', label: 'Control', icon: <span className="text-[10px]">⊞</span> },
  { type: 'pareto', label: 'Pareto', icon: <span className="text-[10px]">⦿</span> },
  { type: 'area', label: 'Area', icon: <span className="text-[10px]">◺</span> },
  { type: 'bubble', label: 'Bubble', icon: <span className="text-[10px]">◎</span> },
];

// ── Column type icon ──────────────────────────────────────────────────────────

function ColTypeIcon({ col }: { col: ColumnMeta }) {
  const kind = col.display_type?.kind;
  if (kind === 'integer' || kind === 'float') return <Hash className="w-3 h-3 text-cyan-400/70 shrink-0" />;
  if (kind === 'date' || kind === 'timestamp' || kind === 'duration') return <Calendar className="w-3 h-3 text-purple-400/70 shrink-0" />;
  if (kind === 'text' || kind === 'boolean') return <Type className="w-3 h-3 text-amber-400/60 shrink-0" />;
  return <HelpCircle className="w-3 h-3 text-white/20 shrink-0" />;
}

// ── Column item (draggable) ───────────────────────────────────────────────────

function ColumnItem({
  col,
  data,
  onDragStart,
  onClick,
}: {
  col: ColumnMeta;
  data: Record<string, unknown>[];
  onDragStart: (colName: string) => void;
  onClick: (colName: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Sample values for tooltip
  const samples = data
    .map((r) => r[col.name])
    .filter((v) => v !== null && v !== undefined)
    .slice(0, 3)
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)));

  return (
    <div
      className="relative flex items-center gap-1.5 px-2 py-1.5 rounded cursor-grab hover:bg-white/[0.05] transition-colors group select-none"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('column', col.name);
        onDragStart(col.name);
      }}
      onClick={() => onClick(col.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ColTypeIcon col={col} />
      <span className="text-[11px] text-white/70 truncate flex-1 font-mono">{col.name}</span>

      {/* Tooltip with type + sample values */}
      {hovered && samples.length > 0 && (
        <div className="absolute left-full top-0 ml-2 z-50 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 shadow-xl pointer-events-none min-w-[140px] max-w-[220px]">
          <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1 font-mono">{col.type_name}</p>
          {samples.map((s, i) => (
            <p key={i} className="text-[10px] text-white/60 font-mono truncate">{s}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  label,
  assignedCol,
  onDrop,
  onRemove,
}: {
  label: string;
  assignedCol: string | null;
  onDrop: (colName: string) => void;
  onRemove: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex items-center gap-1.5 h-7 px-2 rounded border transition-colors ${
        dragOver
          ? 'border-[#00d2ff] bg-[#00d2ff]/10'
          : assignedCol
          ? 'border-[#2a2a2a] bg-[#1a1a1a]'
          : 'border-dashed border-[#2a2a2a] bg-transparent'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const col = e.dataTransfer.getData('column');
        if (col) onDrop(col);
      }}
    >
      <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold shrink-0 w-9">{label}</span>
      {assignedCol ? (
        <>
          <span className="text-[10px] text-[#00d2ff] font-mono flex-1 truncate">{assignedCol}</span>
          <button
            onClick={onRemove}
            className="shrink-0 text-white/20 hover:text-white/60 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </>
      ) : (
        <span className="text-[10px] text-white/15 italic flex-1">drop column here</span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface GraphBuilderPanelProps {
  columns: ColumnMeta[];
  data: Record<string, unknown>[];
}

export function GraphBuilderPanel({ columns, data }: GraphBuilderPanelProps) {
  const [assignments, setAssignments] = useState<AxisAssignments>({
    x: null, y: null, color: null, size: null, facet: null,
  });
  const [chartTypeOverride, setChartTypeOverride] = useState<ChartType | 'auto'>('auto');
  const [options, setOptions] = useState<ChartOptions>({
    showDataPoints: true,
    showTrendLine: false,
    logScaleX: false,
    logScaleY: false,
    refLineValue: '',
    refLineLabel: '',
    confidenceInterval: 'none',
  });
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [savedChartsCollapsed, setSavedChartsCollapsed] = useState(true);
  const [savedCharts, setSavedCharts] = useState<SavedChartConfig[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedChartConfig[];
    } catch {
      return [];
    }
  });

  // Find ColumnMeta by name
  const colMeta = useCallback(
    (name: string | null) => columns.find((c) => c.name === name) ?? null,
    [columns]
  );

  // Auto chart type
  const resolvedChartType: ChartType =
    chartTypeOverride === 'auto'
      ? autoSelectChart(colMeta(assignments.x), colMeta(assignments.y), colMeta(assignments.color), data)
      : chartTypeOverride;

  // Assign a column to the next empty zone
  const assignToNextEmpty = useCallback((colName: string) => {
    setAssignments((prev) => {
      if (!prev.x) return { ...prev, x: colName };
      if (!prev.y) return { ...prev, y: colName };
      if (!prev.color) return { ...prev, color: colName };
      return prev;
    });
  }, []);

  const setAssignment = useCallback((zone: keyof AxisAssignments, colName: string | null) => {
    setAssignments((prev) => ({ ...prev, [zone]: colName }));
  }, []);

  // Save chart config
  const handleSaveChart = () => {
    const name = `Chart ${new Date().toLocaleTimeString()}`;
    const config: SavedChartConfig = {
      id: `chart_${Date.now()}`,
      name,
      assignments,
      chartType: chartTypeOverride,
      options,
      savedAt: Date.now(),
    };
    const updated = [...savedCharts, config];
    setSavedCharts(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleRestoreChart = (config: SavedChartConfig) => {
    setAssignments(config.assignments);
    setChartTypeOverride(config.chartType);
    setOptions(config.options);
  };

  const handleDeleteSavedChart = (id: string) => {
    const updated = savedCharts.filter((c) => c.id !== id);
    setSavedCharts(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  // Export: TSV copy
  const handleCopyTsv = () => {
    const activeCols = [assignments.x, assignments.y, assignments.color, assignments.size]
      .filter((c): c is string => c !== null);
    if (activeCols.length === 0) return;
    const header = activeCols.join('\t');
    const rows = data.map((row) => activeCols.map((c) => {
      const v = row[c];
      return v === null || v === undefined ? '' : String(v);
    }).join('\t')).join('\n');
    navigator.clipboard.writeText(header + '\n' + rows).catch(() => {});
  };

  // Right-click selection handler
  const handleRightClickSelection = useCallback((indices: number[], summary: string) => {
    // Send to AI panel context via window custom event (consumed by AIPanel if listening)
    window.dispatchEvent(new CustomEvent('apex:analyze-selection', {
      detail: { indices, summary, chartType: resolvedChartType },
    }));
  }, [resolvedChartType]);

  // Reference line
  const refLineY: { value: number; label: string } | null = (() => {
    const v = parseFloat(options.refLineValue);
    if (!isNaN(v)) return { value: v, label: options.refLineLabel || String(v) };
    return null;
  })();

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0a0a0a]">
      {/* ── LEFT: Column list ──────────────────────────────────────────────── */}
      <div className="w-48 shrink-0 flex flex-col border-r border-[#1a1a1a] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#1a1a1a] flex items-center gap-2 shrink-0">
          <List className="w-3 h-3 text-white/25" />
          <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold">Columns</span>
          <span className="ml-auto text-[9px] text-white/15 font-mono">{columns.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {columns.length === 0 ? (
            <p className="text-[10px] text-white/20 text-center mt-4 px-2">Run a query to see columns</p>
          ) : (
            columns.map((col) => (
              <ColumnItem
                key={col.name}
                col={col}
                data={data}
                onDragStart={() => {}}
                onClick={assignToNextEmpty}
              />
            ))
          )}
        </div>
      </div>

      {/* ── CENTER: Drop zones + chart ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Drop zones */}
        <div className="shrink-0 px-3 py-2 border-b border-[#1a1a1a] space-y-1 bg-[#0d0d0d]">
          <div className="grid grid-cols-2 gap-1.5">
            <DropZone label="X" assignedCol={assignments.x} onDrop={(c) => setAssignment('x', c)} onRemove={() => setAssignment('x', null)} />
            <DropZone label="Y" assignedCol={assignments.y} onDrop={(c) => setAssignment('y', c)} onRemove={() => setAssignment('y', null)} />
            <DropZone label="Color" assignedCol={assignments.color} onDrop={(c) => setAssignment('color', c)} onRemove={() => setAssignment('color', null)} />
            <DropZone label="Size" assignedCol={assignments.size} onDrop={(c) => setAssignment('size', c)} onRemove={() => setAssignment('size', null)} />
          </div>
          <DropZone label="Group" assignedCol={assignments.facet} onDrop={(c) => setAssignment('facet', c)} onRemove={() => setAssignment('facet', null)} />
        </div>

        {/* Export toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[#1a1a1a] bg-[#0d0d0d]">
          <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold font-mono">
            {resolvedChartType.replace('_', ' ')}
          </span>
          {data.length > 0 && (
            <span className="text-[9px] text-white/15 font-mono">{data.length.toLocaleString()} rows</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {/* TODO: html2canvas export */}
            <button
              disabled
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/15 font-mono uppercase tracking-wider cursor-not-allowed"
              title="PNG export — html2canvas not installed"
            >
              <Download className="w-2.5 h-2.5" /> PNG
            </button>
            <button
              onClick={handleCopyTsv}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/30 hover:text-white/60 font-mono uppercase tracking-wider transition-colors"
              title="Copy visible columns as TSV"
            >
              <Download className="w-2.5 h-2.5" /> TSV
            </button>
            <button
              onClick={handleSaveChart}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-emerald-400/50 hover:text-emerald-400 font-mono uppercase tracking-wider transition-colors"
              title="Save current chart configuration"
            >
              <Save className="w-2.5 h-2.5" /> Save
            </button>
          </div>
        </div>

        {/* Chart area */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          data-graph-builder-chart
        >
          {data.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15 gap-3">
              <BarChart2 className="w-8 h-8" />
              <p className="text-xs uppercase tracking-widest">No query results</p>
              <p className="text-[10px] text-white/10">Run a query, then assign columns to axes</p>
            </div>
          ) : (
            <GraphBuilder
              data={data}
              xCol={assignments.x}
              yCol={assignments.y}
              colorCol={assignments.color}
              sizeCol={assignments.size}
              chartType={resolvedChartType}
              showDataPoints={options.showDataPoints}
              showTrendLine={options.showTrendLine}
              logScaleX={options.logScaleX}
              logScaleY={options.logScaleY}
              referenceLineY={refLineY}
              confidenceInterval={options.confidenceInterval}
              selectedIndices={selectedIndices}
              onPointClick={(i) => {
                setSelectedIndices((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                });
              }}
              onRightClickSelection={handleRightClickSelection}
            />
          )}
        </div>
      </div>

      {/* ── RIGHT: Chart options ───────────────────────────────────────────── */}
      <div className="w-44 shrink-0 flex flex-col border-l border-[#1a1a1a] overflow-y-auto bg-[#0d0d0d]">
        {/* Chart type */}
        <div className="px-2 py-2 border-b border-[#1a1a1a]">
          <button
            className="w-full flex items-center justify-between text-[9px] text-white/25 uppercase tracking-widest font-bold mb-2"
            onClick={() => setOptionsCollapsed((v) => !v)}
          >
            Chart Type
            {optionsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {!optionsCollapsed && (
            <>
              <button
                className={`w-full text-left text-[10px] px-2 py-1 rounded mb-1 transition-colors ${
                  chartTypeOverride === 'auto'
                    ? 'bg-[#00d2ff]/20 text-[#00d2ff]'
                    : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'
                }`}
                onClick={() => setChartTypeOverride('auto')}
              >
                Auto
              </button>
              <div className="grid grid-cols-2 gap-0.5">
                {CHART_TYPES.map(({ type, label, icon }) => (
                  <button
                    key={type}
                    onClick={() => setChartTypeOverride(type)}
                    className={`flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${
                      chartTypeOverride === type
                        ? 'bg-[#00d2ff]/20 text-[#00d2ff]'
                        : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Options */}
        {!optionsCollapsed && (
          <div className="px-2 py-2 border-b border-[#1a1a1a] space-y-2">
            <p className="text-[9px] text-white/25 uppercase tracking-widest font-bold">Options</p>

            {[
              { key: 'showDataPoints' as const, label: 'Data points' },
              { key: 'showTrendLine' as const, label: 'Trend line' },
              { key: 'logScaleX' as const, label: 'Log X' },
              { key: 'logScaleY' as const, label: 'Log Y' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="accent-[#00d2ff] w-3 h-3"
                />
                <span className="text-[10px] text-white/50">{label}</span>
              </label>
            ))}

            {/* Reference line */}
            <div>
              <p className="text-[9px] text-white/20 mb-1">Reference line Y</p>
              <input
                type="number"
                value={options.refLineValue}
                onChange={(e) => setOptions((prev) => ({ ...prev, refLineValue: e.target.value }))}
                placeholder="value"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff] mb-1"
              />
              <input
                type="text"
                value={options.refLineLabel}
                onChange={(e) => setOptions((prev) => ({ ...prev, refLineLabel: e.target.value }))}
                placeholder="label"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff]"
              />
            </div>

            {/* Confidence interval */}
            <div>
              <p className="text-[9px] text-white/20 mb-1">Confidence interval</p>
              <select
                value={options.confidenceInterval}
                onChange={(e) => setOptions((prev) => ({ ...prev, confidenceInterval: e.target.value as ChartOptions['confidenceInterval'] }))}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5 text-[10px] text-white/60 focus:outline-none focus:border-[#00d2ff]"
              >
                <option value="none">None</option>
                <option value="95">95%</option>
                <option value="99">99%</option>
              </select>
            </div>
          </div>
        )}

        {/* Saved charts */}
        <div className="px-2 py-2">
          <button
            className="w-full flex items-center justify-between text-[9px] text-white/25 uppercase tracking-widest font-bold mb-1"
            onClick={() => setSavedChartsCollapsed((v) => !v)}
          >
            My Charts
            {savedChartsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {!savedChartsCollapsed && (
            <div className="space-y-1">
              {savedCharts.length === 0 ? (
                <p className="text-[9px] text-white/15 text-center py-2">No saved charts. Build a chart and save it.</p>
              ) : (
                savedCharts.map((sc) => (
                  <div
                    key={sc.id}
                    className="flex items-center gap-1 group"
                  >
                    <button
                      className="flex-1 text-left text-[10px] text-white/40 hover:text-white/70 transition-colors px-1.5 py-1 rounded hover:bg-white/[0.04] truncate"
                      onClick={() => handleRestoreChart(sc)}
                      title={`Restore: ${sc.name}`}
                    >
                      {sc.name}
                    </button>
                    <button
                      onClick={() => handleDeleteSavedChart(sc.id)}
                      className="opacity-0 group-hover:opacity-100 text-white/15 hover:text-red-400/60 transition-all"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
