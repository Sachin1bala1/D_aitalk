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
 * - Save/restore chart presets through the native persistence layer
 * - Export: PNG (html2canvas TODO), TSV copy
 * - Selection via shift+click; right-click context menu → "Analyze with APEX"
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, ChevronDown, ChevronRight, BarChart2, TrendingUp, Download, Save, List, Hash, Calendar, Type, HelpCircle } from 'lucide-react';
import type { ColumnMeta } from '../../lib/db/DbClient';
import { GraphBuilder } from './GraphBuilder';
import { autoSelectChart, type ChartType } from '../../lib/charts/chartAutoSelect';
import {
  ensureChartPresetsLoaded,
  loadChartPresets,
  saveChartPresets,
  subscribeChartPresets,
  type SavedChartConfig,
} from '../../lib/charts/ChartPresetStore';
import { useWorkspaceStore } from '../../lib/stores/WorkspaceStore';
import { toast } from 'sonner';

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
  xAxisMode: 'auto' | 'fit' | 'zero' | 'manual';
  yAxisMode: 'auto' | 'fit' | 'zero' | 'manual';
  xAxisMin: string;
  xAxisMax: string;
  yAxisMin: string;
  yAxisMax: string;
  xAxisLabel: string;
  yAxisLabel: string;
  refLineValue: string;
  refLineLabel: string;
  confidenceInterval: 'none' | '95' | '99';
}

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
  zoneKey,
  assignedCol,
  onDrop,
  onRemove,
  disabled = false,
  helperText,
}: {
  label: string;
  zoneKey: keyof AxisAssignments;
  assignedCol: string | null;
  onDrop: (payload: { colName: string; sourceZone: keyof AxisAssignments | null }) => void;
  onRemove: () => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex items-center gap-1.5 h-7 px-2 rounded border transition-colors ${
        disabled
          ? 'border-[#1f1f1f] bg-[#0f0f0f] opacity-50'
          :
        dragOver
          ? 'border-[#00d2ff] bg-[#00d2ff]/10'
          : assignedCol
          ? 'border-[#2a2a2a] bg-[#1a1a1a]'
          : 'border-dashed border-[#2a2a2a] bg-transparent'
      }`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(false);
        const col = e.dataTransfer.getData('column');
        const sourceZone = e.dataTransfer.getData('sourceZone') as keyof AxisAssignments | '';
        if (col) onDrop({ colName: col, sourceZone: sourceZone || null });
      }}
    >
      <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold shrink-0 w-9">{label}</span>
      {assignedCol ? (
        <>
          <span
            className="text-[10px] text-[#00d2ff] font-mono flex-1 truncate cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('column', assignedCol);
              e.dataTransfer.setData('sourceZone', zoneKey);
            }}
            title="Drag to reassign"
          >
            {assignedCol}
          </span>
          <button
            onClick={onRemove}
            className="shrink-0 text-white/20 hover:text-white/60 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </>
      ) : (
        <span className="text-[10px] text-white/15 italic flex-1">
          {disabled ? helperText ?? 'not available' : 'drop column here'}
        </span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface GraphBuilderPanelProps {
  columns: ColumnMeta[];
  data: Record<string, unknown>[];
  initialRequest?: {
    artifactId?: string | null;
    chartType: string;
    xColumn: string;
    yColumn: string;
    colorColumn?: string | null;
    sizeColumn?: string | null;
    title?: string;
    xLabel?: string;
    yLabel?: string;
  } | null;
}

export function GraphBuilderPanel({ columns, data, initialRequest }: GraphBuilderPanelProps) {
  const setGraphBuilderRequest = useWorkspaceStore((s) => s.setGraphBuilderRequest);
  const updateArtifactDraft = useWorkspaceStore((s) => s.updateArtifactDraft);
  const commitArtifactRevision = useWorkspaceStore((s) => s.commitArtifactRevision);
  const discardArtifactDraftChanges = useWorkspaceStore((s) => s.discardArtifactDraftChanges);
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeTab = useWorkspaceStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId) ?? null);
  const artifact = useWorkspaceStore((s) =>
    initialRequest?.artifactId ? s.artifacts[initialRequest.artifactId] ?? null : null
  );
  const artifactHead = useWorkspaceStore((s) =>
    initialRequest?.artifactId ? s.artifactHeads[initialRequest.artifactId] ?? null : null
  );
  const lastConsumedRequestKeyRef = useRef<string | null>(null);
  const [assignments, setAssignments] = useState<AxisAssignments>({
    x: null, y: null, color: null, size: null, facet: null,
  });
  const [title, setTitle] = useState<string>('');
  const [chartTypeOverride, setChartTypeOverride] = useState<ChartType | 'auto'>('auto');
  const [options, setOptions] = useState<ChartOptions>({
    showDataPoints: true,
    showTrendLine: false,
    logScaleX: false,
    logScaleY: false,
    xAxisMode: 'fit',
    yAxisMode: 'fit',
    xAxisMin: '',
    xAxisMax: '',
    yAxisMin: '',
    yAxisMax: '',
    xAxisLabel: '',
    yAxisLabel: '',
    refLineValue: '',
    refLineLabel: '',
    confidenceInterval: 'none',
  });
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [savedChartsCollapsed, setSavedChartsCollapsed] = useState(true);
  const [savedCharts, setSavedCharts] = useState<SavedChartConfig[]>(loadChartPresets);

  // Find ColumnMeta by name
  const colMeta = useCallback(
    (name: string | null) => columns.find((c) => c.name === name) ?? null,
    [columns]
  );
  const supportedColumnNames = useMemo(() => new Set(columns.map((c) => c.name)), [columns]);

  // Auto chart type
  const resolvedChartType: ChartType =
    chartTypeOverride === 'auto'
      ? autoSelectChart(colMeta(assignments.x), colMeta(assignments.y), colMeta(assignments.color), colMeta(assignments.size), data)
      : chartTypeOverride;

  useEffect(() => {
    if (!initialRequest) {
      lastConsumedRequestKeyRef.current = null;
      return;
    }
    if (columns.length === 0) return;

    const requestKey = JSON.stringify({
      chartType: initialRequest.chartType,
      xColumn: initialRequest.xColumn,
      yColumn: initialRequest.yColumn,
      colorColumn: initialRequest.colorColumn ?? null,
      sizeColumn: initialRequest.sizeColumn ?? null,
      title: initialRequest.title ?? '',
      xLabel: initialRequest.xLabel ?? '',
      yLabel: initialRequest.yLabel ?? '',
    });

    if (lastConsumedRequestKeyRef.current === requestKey) return;
    lastConsumedRequestKeyRef.current = requestKey;

    const nextChartType: ChartType | 'auto' = (() => {
      const candidate = initialRequest.chartType === 'pie' ? 'bar' : initialRequest.chartType;
      return CHART_TYPES.some((entry) => entry.type === candidate) ? (candidate as ChartType) : 'auto';
    })();

    setAssignments({
      x: supportedColumnNames.has(initialRequest.xColumn) ? initialRequest.xColumn : null,
      y: supportedColumnNames.has(initialRequest.yColumn) ? initialRequest.yColumn : null,
      color: initialRequest.colorColumn && supportedColumnNames.has(initialRequest.colorColumn) ? initialRequest.colorColumn : null,
      size: initialRequest.sizeColumn && supportedColumnNames.has(initialRequest.sizeColumn) ? initialRequest.sizeColumn : null,
      facet: null,
    });
    setChartTypeOverride(nextChartType);
    setTitle(initialRequest.title ?? '');
    setOptions((prev) => ({
      ...prev,
      xAxisLabel: initialRequest.xLabel ?? initialRequest.xColumn,
      yAxisLabel: initialRequest.yLabel ?? initialRequest.yColumn,
    }));
    setGraphBuilderRequest(null);
  }, [columns.length, initialRequest, setGraphBuilderRequest, supportedColumnNames]);

  const zoneSupport = useMemo(() => ({
    x: true,
    y: true,
    color: ['scatter', 'line', 'bar'].includes(resolvedChartType),
    size: resolvedChartType === 'bubble' || chartTypeOverride === 'auto',
    facet: false,
  }), [chartTypeOverride, resolvedChartType]);

  useEffect(() => {
    const unsubscribe = subscribeChartPresets(() => {
      setSavedCharts(loadChartPresets());
    });
    void ensureChartPresetsLoaded().then(setSavedCharts);
    return unsubscribe;
  }, []);

  // Assign a column to the next empty zone
  const assignToNextEmpty = useCallback((colName: string) => {
    setAssignments((prev) => {
      if (!prev.x) return { ...prev, x: colName };
      if (!prev.y) return { ...prev, y: colName };
      if (!prev.color && zoneSupport.color) return { ...prev, color: colName };
      if (!prev.size && zoneSupport.size) return { ...prev, size: colName };
      return prev;
    });
  }, [zoneSupport.color, zoneSupport.size]);

  const setAssignment = useCallback((zone: keyof AxisAssignments, colName: string | null) => {
    setAssignments((prev) => {
      const next: AxisAssignments = { ...prev, [zone]: colName };
      if (zone === 'size' && colName && chartTypeOverride === 'auto') {
        setChartTypeOverride('bubble');
      }
      return next;
    });
  }, [chartTypeOverride]);

  const handleZoneDrop = useCallback((zone: keyof AxisAssignments, payload: { colName: string; sourceZone: keyof AxisAssignments | null }) => {
    const { colName, sourceZone } = payload;

    setAssignments((prev) => {
      if (sourceZone === 'facet' || zone === 'facet') return prev;
      if (sourceZone === zone && prev[zone] === colName) return prev;

      const next = { ...prev };
      const targetPreviousValue = next[zone];

      next[zone] = colName;

      if (sourceZone && next[sourceZone] === colName) {
        next[sourceZone] = sourceZone === zone ? colName : targetPreviousValue;
      } else {
        (Object.keys(next) as (keyof AxisAssignments)[]).forEach((key) => {
          if (key !== zone && key !== 'facet' && next[key] === colName) {
            next[key] = null;
          }
        });
      }

      return next;
    });

    if (zone === 'size' && colName && chartTypeOverride === 'auto') {
      setChartTypeOverride('bubble');
    }
  }, [chartTypeOverride]);

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
    saveChartPresets(updated);
    setSavedCharts(updated);
  };

  const handleRestoreChart = (config: SavedChartConfig) => {
    setAssignments(config.assignments);
    setChartTypeOverride(config.chartType);
    setOptions(config.options);
  };

  const handleDeleteSavedChart = (id: string) => {
    const updated = savedCharts.filter((c) => c.id !== id);
    saveChartPresets(updated);
    setSavedCharts(updated);
  };

  const handleSaveArtifactRevision = useCallback(() => {
    if (!artifact || artifact.kind !== 'chart') return;
    commitArtifactRevision({
      ...artifact,
      updatedAt: Date.now(),
      name: title || artifact.name,
      chart: {
        chartType: chartTypeOverride,
        assignments,
        options,
      },
    });
    toast.success('Chart revision saved');
  }, [artifact, assignments, chartTypeOverride, commitArtifactRevision, options, title]);

  const handleDiscardArtifactDraft = useCallback(() => {
    if (!initialRequest?.artifactId) return;
    discardArtifactDraftChanges(initialRequest.artifactId);
    toast.success('Draft changes discarded');
  }, [discardArtifactDraftChanges, initialRequest?.artifactId]);

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
  const parseAxisNumber = (value: string): number | null => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  useEffect(() => {
    if (!artifact || artifact.kind !== 'chart') return;

    setAssignments(artifact.chart.assignments);
    setChartTypeOverride(
      CHART_TYPES.some((entry) => entry.type === artifact.chart.chartType)
        ? (artifact.chart.chartType as ChartType)
        : 'auto'
    );
    setTitle(artifact.name);
    setOptions(artifact.chart.options);
  }, [artifact]);

  useEffect(() => {
    if (!initialRequest?.artifactId || !activeTab?.queryResults) return;

    const nextArtifact = {
      ...(artifact ?? {
        id: initialRequest.artifactId,
        kind: 'chart' as const,
        createdAt: Date.now(),
        lineage: {
          connectionId: activeConnectionId,
          sql: activeTab.sql,
          queryId: activeTab.queryResults.queryId,
          sourceTables: activeTab.queryResults.source_tables,
          sourceTabId: activeTabId,
        },
        snapshot: {
          id: `dashboard-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: title || `${assignments.y ?? 'Chart'} by ${assignments.x ?? 'X'}`,
          connectionId: activeConnectionId,
          sql: activeTab.sql,
          capturedAt: Date.now(),
          rowCount: activeTab.queryResults.rowCount,
          elapsedMs: activeTab.queryResults.elapsedMs,
          queryId: activeTab.queryResults.queryId,
          fields: activeTab.queryResults.fields,
          rows: activeTab.queryResults.rows,
          sourceTables: activeTab.queryResults.source_tables,
        },
      }),
      updatedAt: Date.now(),
      name: title || artifact?.name || `${assignments.y ?? 'Chart'} by ${assignments.x ?? 'X'}`,
      chart: {
        chartType: chartTypeOverride,
        assignments,
        options,
      },
    };

    updateArtifactDraft(nextArtifact);
  }, [
    activeConnectionId,
    activeTab,
    activeTabId,
    artifact,
    assignments,
    chartTypeOverride,
    initialRequest?.artifactId,
    options,
    title,
    updateArtifactDraft,
  ]);

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
            <DropZone zoneKey="x" label="X" assignedCol={assignments.x} onDrop={(payload) => handleZoneDrop('x', payload)} onRemove={() => setAssignment('x', null)} />
            <DropZone zoneKey="y" label="Y" assignedCol={assignments.y} onDrop={(payload) => handleZoneDrop('y', payload)} onRemove={() => setAssignment('y', null)} />
            <DropZone zoneKey="color" label="Color" assignedCol={assignments.color} onDrop={(payload) => handleZoneDrop('color', payload)} onRemove={() => setAssignment('color', null)} disabled={!zoneSupport.color} helperText="unsupported for this chart" />
            <DropZone zoneKey="size" label="Size" assignedCol={assignments.size} onDrop={(payload) => handleZoneDrop('size', payload)} onRemove={() => setAssignment('size', null)} disabled={!zoneSupport.size} helperText="use bubble or auto" />
          </div>
          <DropZone zoneKey="facet" label="Group" assignedCol={assignments.facet} onDrop={(payload) => handleZoneDrop('facet', payload)} onRemove={() => setAssignment('facet', null)} disabled={!zoneSupport.facet} helperText="faceting not implemented" />
        </div>

        {/* Export toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[#1a1a1a] bg-[#0d0d0d]">
          <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold font-mono">
            {title || resolvedChartType.replace('_', ' ')}
          </span>
          {data.length > 0 && (
            <span className="text-[9px] text-white/15 font-mono">{data.length.toLocaleString()} rows</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {initialRequest?.artifactId && (
              <>
                <button
                  onClick={handleDiscardArtifactDraft}
                  disabled={!artifactHead?.hasUncommittedChanges}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-white/25 hover:text-white/60 font-mono uppercase tracking-wider transition-colors disabled:opacity-25"
                  title="Discard unsaved chart draft changes"
                >
                  <X className="w-2.5 h-2.5" /> Discard
                </button>
                <button
                  onClick={handleSaveArtifactRevision}
                  disabled={!artifactHead?.hasUncommittedChanges}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-cyan-300/60 hover:text-cyan-200 font-mono uppercase tracking-wider transition-colors disabled:opacity-25"
                  title="Commit the current chart draft as a new revision"
                >
                  <Save className="w-2.5 h-2.5" /> Save Rev
                </button>
              </>
            )}
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
              title="Save current chart preset"
            >
              <Save className="w-2.5 h-2.5" /> Preset
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
              xAxisMode={options.xAxisMode}
              yAxisMode={options.yAxisMode}
              xAxisMin={parseAxisNumber(options.xAxisMin)}
              xAxisMax={parseAxisNumber(options.xAxisMax)}
              yAxisMin={parseAxisNumber(options.yAxisMin)}
              yAxisMax={parseAxisNumber(options.yAxisMax)}
              xAxisLabel={options.xAxisLabel || assignments.x}
              yAxisLabel={options.yAxisLabel || assignments.y}
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

            <div className="space-y-2">
              <p className="text-[9px] text-white/25 uppercase tracking-widest font-bold">Axis</p>

              {([
                { axis: 'x', label: 'X Axis', modeKey: 'xAxisMode', minKey: 'xAxisMin', maxKey: 'xAxisMax' },
                { axis: 'y', label: 'Y Axis', modeKey: 'yAxisMode', minKey: 'yAxisMin', maxKey: 'yAxisMax' },
              ] as const).map(({ axis, label, modeKey, minKey, maxKey }) => (
                <div key={axis} className="rounded border border-[#1e1e1e] bg-[#121212] p-2 space-y-1.5">
                  <p className="text-[9px] text-white/35 uppercase tracking-widest font-bold">{label}</p>
                  <select
                    value={options[modeKey]}
                    onChange={(e) => setOptions((prev) => ({ ...prev, [modeKey]: e.target.value as ChartOptions[typeof modeKey] }))}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white/60 focus:outline-none focus:border-[#00d2ff]"
                  >
                    <option value="auto">Auto</option>
                    <option value="fit">Fit to data</option>
                    <option value="zero">Zero-based</option>
                    <option value="manual">Manual</option>
                  </select>
                  {options[modeKey] === 'manual' && (
                    <div className="grid grid-cols-2 gap-1">
                      <input
                        type="number"
                        value={options[minKey]}
                        onChange={(e) => setOptions((prev) => ({ ...prev, [minKey]: e.target.value }))}
                        placeholder="min"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff]"
                      />
                      <input
                        type="number"
                        value={options[maxKey]}
                        onChange={(e) => setOptions((prev) => ({ ...prev, [maxKey]: e.target.value }))}
                        placeholder="max"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff]"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-[9px] text-white/25 uppercase tracking-widest font-bold">Labels</p>
              <input
                type="text"
                value={options.xAxisLabel}
                onChange={(e) => setOptions((prev) => ({ ...prev, xAxisLabel: e.target.value }))}
                placeholder={assignments.x ?? 'X axis label'}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff]"
              />
              <input
                type="text"
                value={options.yAxisLabel}
                onChange={(e) => setOptions((prev) => ({ ...prev, yAxisLabel: e.target.value }))}
                placeholder={assignments.y ?? 'Y axis label'}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white/60 font-mono focus:outline-none focus:border-[#00d2ff]"
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
