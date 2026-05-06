import React, { useMemo, useState } from "react";
import {
  BarChart3,
  LayoutDashboard,
  MousePointerSquareDashed,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  DashboardDatasourceSnapshot,
  DashboardTabState,
  DashboardWidget,
  DashboardWidgetType,
} from "../../lib/stores/WorkspaceStore";

interface DashboardWorkspaceProps {
  tab: DashboardTabState;
  onAddWidget: (widget: Omit<DashboardWidget, "id">) => void;
  onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
  onRemoveWidget: (widgetId: string) => void;
  onSelectWidget: (widgetId: string | null, mode?: "browse" | "edit") => void;
}

const MAX_CHART_POINTS = 1500;
const MAX_TABLE_PREVIEW_ROWS = 12;
const MAX_FIELD_CHIPS = 8;

type DashboardAggregate = "row_count" | "sum" | "avg" | "min" | "max";
type SupportedChartWidgetType = "bar_chart" | "line_chart" | "scatter_chart";
type WidgetRole = "xField" | "yField" | "metricField";

interface DashboardFieldDragPayload {
  datasourceId: string;
  fieldName: string;
  fieldKind: "numeric" | "dimension";
}

const DASHBOARD_FIELD_DRAG_MIME = "application/x-daitalk-dashboard-field";

function sampleRows(rows: Record<string, unknown>[]) {
  if (rows.length <= MAX_CHART_POINTS) return rows;
  const step = Math.ceil(rows.length / MAX_CHART_POINTS);
  return rows.filter((_, index) => index % step === 0).slice(0, MAX_CHART_POINTS);
}

function fieldNames(snapshot: DashboardDatasourceSnapshot | undefined) {
  return snapshot?.fields.map((field) => field.name) ?? [];
}

function numericFields(snapshot: DashboardDatasourceSnapshot | undefined) {
  if (!snapshot || snapshot.rows.length === 0) return [] as string[];
  return snapshot.fields
    .map((field) => field.name)
    .filter((field) =>
      snapshot.rows.some((row) => {
        const value = row[field];
        return value !== null && value !== undefined && Number.isFinite(Number(value));
      })
    );
}

function isNumericField(
  snapshot: DashboardDatasourceSnapshot | undefined,
  fieldName: string | null | undefined
) {
  if (!snapshot || !fieldName) return false;
  return numericFields(snapshot).includes(fieldName);
}

function defaultWidgetLayout(type: DashboardWidgetType) {
  switch (type) {
    case "metric":
      return { x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 };
    case "table":
      return { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 };
    default:
      return { x: 0, y: 0, w: 8, h: 5, minW: 5, minH: 4 };
  }
}

function isSupportedChartWidgetType(type: DashboardWidget["type"]): type is SupportedChartWidgetType {
  return type === "bar_chart" || type === "line_chart" || type === "scatter_chart";
}

function getDefaultWidgetTitle(type: DashboardWidget["type"]) {
  switch (type) {
    case "metric":
      return "Metric";
    case "table":
      return "Table preview";
    case "line_chart":
      return "Line chart";
    case "scatter_chart":
      return "Scatter chart";
    case "area_chart":
      return "Area chart";
    case "pie_chart":
      return "Pie chart";
    case "text":
      return "Text note";
    default:
      return "Bar chart";
  }
}

function getWidgetSnapshot(
  widget: DashboardWidget,
  datasources: Record<string, DashboardDatasourceSnapshot>
) {
  if (!widget.datasourceId) return undefined;
  return datasources[widget.datasourceId];
}

function getCompatibleChartFields(
  snapshot: DashboardDatasourceSnapshot | undefined,
  type: DashboardWidget["type"]
) {
  const fields = fieldNames(snapshot);
  const numerics = numericFields(snapshot);
  const xField =
    type === "scatter_chart"
      ? numerics[0] ?? fields[0] ?? null
      : fields[0] ?? numerics[0] ?? null;
  const yField =
    type === "scatter_chart"
      ? numerics.find((field) => field !== xField) ?? numerics[0] ?? null
      : numerics[0] ?? null;

  return { fields, numerics, xField, yField };
}

function sanitizeWidgetConfig(
  widget: DashboardWidget,
  snapshot: DashboardDatasourceSnapshot | undefined
) {
  if (widget.type === "metric") {
    const numerics = numericFields(snapshot);
    const nextMetricField =
      typeof widget.config.metricField === "string" && numerics.includes(widget.config.metricField)
        ? widget.config.metricField
        : null;
    const nextAggregate =
      typeof widget.config.aggregate === "string" &&
      ["row_count", "sum", "avg", "min", "max"].includes(widget.config.aggregate)
        ? (widget.config.aggregate as DashboardAggregate)
        : "row_count";

    return {
      metricField: nextMetricField,
      aggregate: nextMetricField ? nextAggregate : "row_count",
    };
  }

  if (!isSupportedChartWidgetType(widget.type)) {
    return widget.config;
  }

  const { fields, numerics, xField: fallbackXField, yField: fallbackYField } =
    getCompatibleChartFields(snapshot, widget.type);
  const nextXField =
    typeof widget.config.xField === "string" && fields.includes(widget.config.xField)
      ? widget.config.xField
      : fallbackXField;
  const nextYField =
    typeof widget.config.yField === "string" && numerics.includes(widget.config.yField)
      ? widget.config.yField
      : fallbackYField;

  return {
    ...widget.config,
    xField: nextXField,
    yField: nextYField,
  };
}

function parseDashboardFieldDragPayload(event: React.DragEvent) {
  const raw = event.dataTransfer.getData(DASHBOARD_FIELD_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as DashboardFieldDragPayload;
    if (!parsed.datasourceId || !parsed.fieldName || !parsed.fieldKind) return null;
    if (parsed.fieldKind !== "numeric" && parsed.fieldKind !== "dimension") return null;
    return parsed;
  } catch {
    return null;
  }
}

function widgetRoleLabel(role: WidgetRole) {
  switch (role) {
    case "xField":
      return "X";
    case "yField":
      return "Y";
    default:
      return "Metric";
  }
}

function widgetRoleValue(widget: DashboardWidget, role: WidgetRole) {
  const value = widget.config[role];
  return typeof value === "string" ? value : null;
}

function widgetSupportsRole(widget: DashboardWidget, role: WidgetRole) {
  if (widget.type === "metric") return role === "metricField";
  if (widget.type === "table") return false;
  return isSupportedChartWidgetType(widget.type) && (role === "xField" || role === "yField");
}

function canDropFieldOnRole(
  widget: DashboardWidget,
  role: WidgetRole,
  payload: DashboardFieldDragPayload
) {
  if (!widgetSupportsRole(widget, role)) return false;
  if (role === "yField" || role === "metricField") return payload.fieldKind === "numeric";
  return true;
}

function buildDroppedRoleConfig(
  widget: DashboardWidget,
  role: WidgetRole,
  payload: DashboardFieldDragPayload,
  datasources: Record<string, DashboardDatasourceSnapshot>
) {
  const nextWidget = {
    ...widget,
    datasourceId: payload.datasourceId,
    config: {
      ...widget.config,
      [role]: payload.fieldName,
    },
  };
  const nextSnapshot = datasources[payload.datasourceId];
  return sanitizeWidgetConfig(nextWidget, nextSnapshot);
}

function EmptyWidgetState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[#2a2a2a] bg-[#0b0b0c] px-4 text-center text-sm text-white/35">
      {message}
    </div>
  );
}

function DashboardChartWidget({
  widget,
  snapshot,
}: {
  widget: DashboardWidget;
  snapshot: DashboardDatasourceSnapshot | undefined;
}) {
  if (!snapshot) {
    return <EmptyWidgetState message="Bind this widget to a datasource snapshot to render it." />;
  }

  if (!isSupportedChartWidgetType(widget.type)) {
    return (
      <EmptyWidgetState message="This chart type is reserved for a later dashboard wave. Use bar, line, or scatter for now." />
    );
  }

  const sanitizedConfig = sanitizeWidgetConfig(widget, snapshot);
  const xField = typeof sanitizedConfig.xField === "string" ? sanitizedConfig.xField : null;
  const yField = typeof sanitizedConfig.yField === "string" ? sanitizedConfig.yField : null;

  if (!xField || !yField) {
    return (
      <EmptyWidgetState message="This datasource needs at least one dimension field and one numeric field before it can render a chart." />
    );
  }

  const sampled = sampleRows(snapshot.rows).map((row) => ({
    ...row,
    __x: row[xField],
    __y: Number(row[yField] ?? 0),
  }));
  const hasRenderablePoints = sampled.some((row) => Number.isFinite(row.__y));

  if (!hasRenderablePoints) {
    return <EmptyWidgetState message="The selected Y field does not contain numeric values that can be charted." />;
  }

  const isNumericXAxis = sampled.every((row) => {
    if (row.__x === null || row.__x === undefined || row.__x === "") return false;
    return Number.isFinite(Number(row.__x));
  });

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {widget.type === "bar_chart" ? (
          <BarChart data={sampled}>
            <CartesianGrid stroke="#ffffff12" strokeDasharray="3 3" />
            <XAxis dataKey="__x" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#0f0f10", border: "1px solid #262626", color: "#fff" }} />
            <Bar dataKey="__y" fill="#00d2ff" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : widget.type === "line_chart" ? (
          <LineChart data={sampled}>
            <CartesianGrid stroke="#ffffff12" strokeDasharray="3 3" />
            <XAxis dataKey="__x" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#0f0f10", border: "1px solid #262626", color: "#fff" }} />
            <Line type="monotone" dataKey="__y" stroke="#00d2ff" dot={false} strokeWidth={2} />
          </LineChart>
        ) : (
          <ScatterChart>
            <CartesianGrid stroke="#ffffff12" strokeDasharray="3 3" />
            <XAxis
              dataKey="__x"
              name={xField}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              type={isNumericXAxis ? "number" : "category"}
            />
            <YAxis dataKey="__y" name={yField} tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0f0f10", border: "1px solid #262626", color: "#fff" }} />
            <Scatter data={sampled} fill="#00d2ff" />
          </ScatterChart>
        )}
      </ResponsiveContainer>
      {snapshot.rows.length > sampled.length && (
        <div className="absolute bottom-2 right-2 rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-mono text-white/35">
          sampled {sampled.length.toLocaleString()} / {snapshot.rows.length.toLocaleString()}
        </div>
      )}
    </div>
  );
}

function DashboardMetricWidget({
  widget,
  snapshot,
}: {
  widget: DashboardWidget;
  snapshot: DashboardDatasourceSnapshot | undefined;
}) {
  if (!snapshot) {
    return <EmptyWidgetState message="Bind this widget to a datasource snapshot to render it." />;
  }

  const sanitizedConfig = sanitizeWidgetConfig(widget, snapshot);
  const metricField =
    typeof sanitizedConfig.metricField === "string" ? sanitizedConfig.metricField : null;
  const aggregate =
    typeof sanitizedConfig.aggregate === "string"
      ? (sanitizedConfig.aggregate as DashboardAggregate)
      : "row_count";

  let value = snapshot.rowCount.toLocaleString();
  let label = "Rows";

  if (metricField) {
    const values = snapshot.rows
      .map((row) => Number(row[metricField]))
      .filter((entry) => Number.isFinite(entry));

    if (values.length > 0) {
      switch (aggregate) {
        case "avg":
          value = (values.reduce((sum, entry) => sum + entry, 0) / values.length).toLocaleString(
            undefined,
            { maximumFractionDigits: 2 }
          );
          label = `Avg ${metricField}`;
          break;
        case "max":
          value = Math.max(...values).toLocaleString();
          label = `Max ${metricField}`;
          break;
        case "min":
          value = Math.min(...values).toLocaleString();
          label = `Min ${metricField}`;
          break;
        case "sum":
          value = values
            .reduce((sum, entry) => sum + entry, 0)
            .toLocaleString(undefined, { maximumFractionDigits: 2 });
          label = `Sum ${metricField}`;
          break;
        default:
          value = snapshot.rowCount.toLocaleString();
          label = "Rows";
          break;
      }
    }
  }

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-[#1f1f1f] bg-[radial-gradient(circle_at_top_left,_rgba(0,210,255,0.12),_transparent_50%)] p-5">
      <span className="text-[11px] uppercase tracking-[0.24em] text-white/35">{label}</span>
      <div className="space-y-2">
        <div className="text-4xl font-semibold tracking-tight text-white">{value}</div>
        <div className="text-xs text-white/35">{snapshot.name}</div>
      </div>
    </div>
  );
}

function DashboardTableWidget({
  snapshot,
}: {
  snapshot: DashboardDatasourceSnapshot | undefined;
}) {
  if (!snapshot) {
    return <EmptyWidgetState message="Bind this widget to a datasource snapshot to render it." />;
  }

  const preview = snapshot.rows.slice(0, MAX_TABLE_PREVIEW_ROWS);
  return (
    <div className="h-full overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#0c0c0d]">
      <div className="h-full overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[#121214] text-white/50">
            <tr>
              {snapshot.fields.map((field) => (
                <th key={field.name} className="border-b border-[#1f1f1f] px-3 py-2 font-semibold">
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[#151515]">
                {snapshot.fields.map((field) => (
                  <td
                    key={`${rowIndex}-${field.name}`}
                    className="max-w-[220px] truncate px-3 py-2 text-white/75"
                  >
                    {row[field.name] === null || row[field.name] === undefined ? (
                      <span className="text-white/25">NULL</span>
                    ) : (
                      String(row[field.name])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot.rows.length > preview.length && (
        <div className="border-t border-[#1a1a1a] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/30">
          previewing {preview.length.toLocaleString()} / {snapshot.rows.length.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  widget,
  snapshot,
  selected,
  onSelect,
  onRemove,
  onRoleDrop,
  activeDragField,
}: {
  widget: DashboardWidget;
  snapshot: DashboardDatasourceSnapshot | undefined;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRoleDrop: (widget: DashboardWidget, role: WidgetRole, payload: DashboardFieldDragPayload) => void;
  activeDragField: DashboardFieldDragPayload | null;
}) {
  const renderRoleDropZone = (role: WidgetRole) => {
    if (!widgetSupportsRole(widget, role)) return null;

    const isActive = activeDragField ? canDropFieldOnRole(widget, role, activeDragField) : false;
    const currentValue = widgetRoleValue(widget, role);

    return (
      <div
        key={role}
        onDragOver={(event) => {
          const payload = parseDashboardFieldDragPayload(event);
          if (payload && canDropFieldOnRole(widget, role, payload)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const payload = parseDashboardFieldDragPayload(event);
          if (!payload || !canDropFieldOnRole(widget, role, payload)) return;
          event.preventDefault();
          event.stopPropagation();
          onRoleDrop(widget, role, payload);
        }}
        className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
          isActive
            ? "border-[#00d2ff]/55 bg-[#06212a] text-white"
            : "border-[#252527] bg-[#0d0d0e] text-white/65"
        }`}
      >
        <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">
          {widgetRoleLabel(role)}
        </div>
        <div className="mt-1 truncate text-xs">
          {currentValue ?? (role === "xField" ? "Drop any field" : "Drop numeric field")}
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={onSelect}
      className={`group relative flex min-h-[260px] flex-col rounded-2xl border bg-[#101011] p-4 transition-colors ${
        selected
          ? "border-[#00d2ff]/55 shadow-[0_0_0_1px_rgba(0,210,255,0.18)]"
          : "border-[#1f1f20] hover:border-[#2f2f31]"
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{widget.title}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-white/30">
            {widget.type.replaceAll("_", " ")}
          </div>
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-md p-1 text-white/25 transition-colors hover:bg-red-500/10 hover:text-red-300"
          title="Remove widget"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {widget.type === "metric" ? (
          <DashboardMetricWidget widget={widget} snapshot={snapshot} />
        ) : widget.type === "table" ? (
          <DashboardTableWidget snapshot={snapshot} />
        ) : (
          <DashboardChartWidget widget={widget} snapshot={snapshot} />
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {renderRoleDropZone("xField")}
        {renderRoleDropZone("yField")}
        {renderRoleDropZone("metricField")}
      </div>
    </div>
  );
}

function FieldChip({
  datasourceId,
  fieldName,
  fieldKind,
}: DashboardFieldDragPayload) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          DASHBOARD_FIELD_DRAG_MIME,
          JSON.stringify({ datasourceId, fieldName, fieldKind } satisfies DashboardFieldDragPayload)
        );
        event.dataTransfer.setData("text/plain", fieldName);
      }}
      className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
        fieldKind === "numeric"
          ? "border-[#1f4852] bg-[#0b171a] text-[#8befff] hover:border-[#00d2ff]/45"
          : "border-[#2a2a2a] bg-[#121214] text-white/60 hover:border-white/20"
      }`}
      title={`Drag ${fieldName} into a widget role`}
    >
      {fieldName}
    </button>
  );
}

function InspectorRoleDropZone({
  widget,
  role,
  currentValue,
  activeDragField,
  onRoleDrop,
}: {
  widget: DashboardWidget;
  role: WidgetRole;
  currentValue: string | null;
  activeDragField: DashboardFieldDragPayload | null;
  onRoleDrop: (widget: DashboardWidget, role: WidgetRole, payload: DashboardFieldDragPayload) => void;
}) {
  if (!widgetSupportsRole(widget, role)) return null;

  const isActive = activeDragField ? canDropFieldOnRole(widget, role, activeDragField) : false;

  return (
    <div
      onDragOver={(event) => {
        const payload = parseDashboardFieldDragPayload(event);
        if (payload && canDropFieldOnRole(widget, role, payload)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const payload = parseDashboardFieldDragPayload(event);
        if (!payload || !canDropFieldOnRole(widget, role, payload)) return;
        event.preventDefault();
        onRoleDrop(widget, role, payload);
      }}
      className={`rounded-xl border px-3 py-3 transition-colors ${
        isActive
          ? "border-[#00d2ff]/55 bg-[#06212a]"
          : "border-[#1f2628] bg-[#0f1314]"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">
        {widgetRoleLabel(role)} role
      </div>
      <div className="mt-1 text-sm text-white/75">
        {currentValue ?? (role === "xField" ? "Drop any field here" : "Drop a numeric field here")}
      </div>
    </div>
  );
}

export function DashboardWorkspace({
  tab,
  onAddWidget,
  onUpdateWidget,
  onRemoveWidget,
  onSelectWidget,
}: DashboardWorkspaceProps) {
  const dashboard = tab.dashboard;
  const dataSources = useMemo(
    () => Object.values(dashboard.datasources).sort((a, b) => b.capturedAt - a.capturedAt),
    [dashboard.datasources]
  );
  const selectedWidget =
    dashboard.widgets.find((widget) => widget.id === dashboard.selectedWidget.widgetId) ?? null;
  const selectedSnapshot = selectedWidget
    ? getWidgetSnapshot(selectedWidget, dashboard.datasources)
    : undefined;
  const selectedFieldNames = fieldNames(selectedSnapshot);
  const selectedNumericFields = numericFields(selectedSnapshot);
  const selectedSanitizedConfig = selectedWidget
    ? sanitizeWidgetConfig(selectedWidget, selectedSnapshot)
    : null;
  const [activeDragField, setActiveDragField] = useState<DashboardFieldDragPayload | null>(null);

  const addWidget = (type: DashboardWidgetType) => {
    const firstDataSource = dataSources[0];
    const { numerics, xField, yField } = getCompatibleChartFields(firstDataSource, type);
    const baseWidget: Omit<DashboardWidget, "id"> = {
      type,
      title: getDefaultWidgetTitle(type),
      datasourceId: firstDataSource?.id ?? null,
      layout: defaultWidgetLayout(type),
      config: {},
    };

    if (type === "metric") {
      baseWidget.config = {
        metricField: numerics[0] ?? null,
        aggregate: numerics[0] ? "sum" : "row_count",
      };
    } else if (isSupportedChartWidgetType(type)) {
      baseWidget.config = {
        xField,
        yField,
      };
    }

    onAddWidget(baseWidget);
  };

  const handleRemoveWidget = (widgetId: string) => {
    if (dashboard.selectedWidget.widgetId === widgetId) {
      onSelectWidget(null, "browse");
    }
    onRemoveWidget(widgetId);
  };

  const handleDatasourceChange = (widget: DashboardWidget, datasourceId: string | null) => {
    const nextSnapshot = datasourceId ? dashboard.datasources[datasourceId] : undefined;
    const nextWidget = {
      ...widget,
      datasourceId,
    };

    onUpdateWidget(widget.id, {
      datasourceId,
      config: sanitizeWidgetConfig(nextWidget, nextSnapshot),
    });
  };

  const handleChartTypeChange = (
    widget: DashboardWidget,
    nextType: SupportedChartWidgetType
  ) => {
    const nextSnapshot = getWidgetSnapshot(widget, dashboard.datasources);
    const nextTitle =
      widget.title === getDefaultWidgetTitle(widget.type)
        ? getDefaultWidgetTitle(nextType)
        : widget.title;
    const nextWidget = {
      ...widget,
      type: nextType,
      title: nextTitle,
    };

    onUpdateWidget(widget.id, {
      type: nextType,
      title: nextTitle,
      config: sanitizeWidgetConfig(nextWidget, nextSnapshot),
    });
  };

  const handleWidgetRoleDrop = (
    widget: DashboardWidget,
    role: WidgetRole,
    payload: DashboardFieldDragPayload
  ) => {
    if (!canDropFieldOnRole(widget, role, payload)) return;
    onUpdateWidget(widget.id, {
      datasourceId: payload.datasourceId,
      config: buildDroppedRoleConfig(widget, role, payload, dashboard.datasources),
    });
    onSelectWidget(widget.id, "edit");
    setActiveDragField(null);
  };

  return (
    <div
      className="flex h-full bg-[#0a0a0a]"
      onDragStartCapture={(event) => {
        const payload = parseDashboardFieldDragPayload(event);
        if (payload) setActiveDragField(payload);
      }}
      onDragEndCapture={() => setActiveDragField(null)}
      onDropCapture={() => setActiveDragField(null)}
    >
      <aside className="w-72 shrink-0 border-r border-[#202022] bg-[#0d0d0e]">
        <div className="border-b border-[#202022] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <LayoutDashboard className="h-4 w-4 text-[#00d2ff]" />
            Dashboard Sources
          </div>
          <p className="mt-2 text-xs leading-5 text-white/40">
            This foundation wave binds widgets to frozen query result snapshots so dashboard state stays deterministic.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {dataSources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#2a2a2a] p-4 text-sm text-white/35">
              No datasource snapshots yet. Create this dashboard from a query tab with results to seed it.
            </div>
          ) : (
            dataSources.map((snapshot) => (
              <div key={snapshot.id} className="rounded-xl border border-[#1c1c1e] bg-[#111113] p-3">
                <div className="text-sm font-medium text-white">{snapshot.name}</div>
                <div className="mt-1 text-[11px] text-white/35">
                  {snapshot.rowCount.toLocaleString()} rows · {snapshot.fields.length} fields
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {snapshot.fields.slice(0, MAX_FIELD_CHIPS).map((field) => (
                    <FieldChip
                      key={field.name}
                      datasourceId={snapshot.id}
                      fieldName={field.name}
                      fieldKind={isNumericField(snapshot, field.name) ? "numeric" : "dimension"}
                    />
                  ))}
                  {snapshot.fields.length > MAX_FIELD_CHIPS && (
                    <span className="rounded-full border border-[#2a2a2a] px-2 py-1 text-[11px] text-white/35">
                      +{(snapshot.fields.length - MAX_FIELD_CHIPS).toLocaleString()} more
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#202022] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">{tab.title}</div>
            <div className="mt-1 text-xs text-white/35">
              First foundation wave: tab-owned datasources, widgets, and inspector-ready widget specs.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addWidget("bar_chart")}
              className="flex items-center gap-2 rounded-lg border border-[#1f3f47] bg-[#071b20] px-3 py-2 text-xs font-semibold text-[#7ae7ff] transition-colors hover:border-[#00d2ff]/45"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Add chart
            </button>
            <button
              onClick={() => addWidget("metric")}
              className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs font-semibold text-white/75 transition-colors hover:border-white/20"
            >
              <Plus className="h-3.5 w-3.5" />
              Add metric
            </button>
            <button
              onClick={() => addWidget("table")}
              className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs font-semibold text-white/75 transition-colors hover:border-white/20"
            >
              <Table2 className="h-3.5 w-3.5" />
              Add table
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
          <section className="overflow-auto p-5">
            {dashboard.widgets.length === 0 ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-[#2a2a2a] bg-[#0e0e0f] px-6 text-center">
                <MousePointerSquareDashed className="mb-4 h-10 w-10 text-white/20" />
                <div className="text-lg font-semibold text-white/70">Start building a dashboard</div>
                <div className="mt-2 max-w-md text-sm leading-6 text-white/35">
                  Add chart, metric, and table widgets from the toolbar. Drag datasource fields directly into widget roles to rebind charts and metrics without leaving the canvas.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                {dashboard.widgets.map((widget) => (
                  <WidgetCard
                    key={widget.id}
                    widget={widget}
                    snapshot={getWidgetSnapshot(widget, dashboard.datasources)}
                    selected={dashboard.selectedWidget.widgetId === widget.id}
                    onSelect={() => onSelectWidget(widget.id, "edit")}
                    onRemove={() => handleRemoveWidget(widget.id)}
                    onRoleDrop={handleWidgetRoleDrop}
                    activeDragField={activeDragField}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="border-l border-[#202022] bg-[#0d0d0e] p-5">
            <div className="mb-4 text-sm font-semibold text-white">Inspector</div>
            {!selectedWidget ? (
              <div className="rounded-xl border border-dashed border-[#2a2a2a] p-4 text-sm text-white/35">
                Select a widget to edit its binding and field roles.
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Title</span>
                  <input
                    value={selectedWidget.title}
                    onChange={(event) => onUpdateWidget(selectedWidget.id, { title: event.target.value })}
                    className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Datasource</span>
                  <select
                    value={selectedWidget.datasourceId ?? ""}
                    onChange={(event) => handleDatasourceChange(selectedWidget, event.target.value || null)}
                    className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                  >
                    <option value="">Unbound</option>
                    {dataSources.map((snapshot) => (
                      <option key={snapshot.id} value={snapshot.id}>
                        {snapshot.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/35">Drop roles</div>
                  <InspectorRoleDropZone
                    widget={selectedWidget}
                    role="xField"
                    currentValue={
                      typeof selectedSanitizedConfig?.xField === "string"
                        ? selectedSanitizedConfig.xField
                        : null
                    }
                    activeDragField={activeDragField}
                    onRoleDrop={handleWidgetRoleDrop}
                  />
                  <InspectorRoleDropZone
                    widget={selectedWidget}
                    role="yField"
                    currentValue={
                      typeof selectedSanitizedConfig?.yField === "string"
                        ? selectedSanitizedConfig.yField
                        : null
                    }
                    activeDragField={activeDragField}
                    onRoleDrop={handleWidgetRoleDrop}
                  />
                  <InspectorRoleDropZone
                    widget={selectedWidget}
                    role="metricField"
                    currentValue={
                      typeof selectedSanitizedConfig?.metricField === "string"
                        ? selectedSanitizedConfig.metricField
                        : null
                    }
                    activeDragField={activeDragField}
                    onRoleDrop={handleWidgetRoleDrop}
                  />
                </div>

                {(selectedWidget.type === "bar_chart" ||
                  selectedWidget.type === "line_chart" ||
                  selectedWidget.type === "area_chart" ||
                  selectedWidget.type === "pie_chart" ||
                  selectedWidget.type === "scatter_chart") && (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Chart Type</span>
                      <select
                        value={isSupportedChartWidgetType(selectedWidget.type) ? selectedWidget.type : "bar_chart"}
                        onChange={(event) =>
                          handleChartTypeChange(
                            selectedWidget,
                            event.target.value as SupportedChartWidgetType
                          )
                        }
                        className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                      >
                        <option value="bar_chart">Bar</option>
                        <option value="line_chart">Line</option>
                        <option value="scatter_chart">Scatter</option>
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">X Field</span>
                      <select
                        value={typeof selectedSanitizedConfig?.xField === "string" ? selectedSanitizedConfig.xField : ""}
                        onChange={(event) =>
                          onUpdateWidget(selectedWidget.id, {
                            config: {
                              ...selectedWidget.config,
                              xField: event.target.value || null,
                            },
                          })
                        }
                        className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                        disabled={!selectedSnapshot}
                      >
                        <option value="">{selectedSnapshot ? "Select field" : "No datasource bound"}</option>
                        {selectedFieldNames.map((fieldName) => (
                          <option key={fieldName} value={fieldName}>
                            {fieldName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Y Field</span>
                      <select
                        value={typeof selectedSanitizedConfig?.yField === "string" ? selectedSanitizedConfig.yField : ""}
                        onChange={(event) =>
                          onUpdateWidget(selectedWidget.id, {
                            config: {
                              ...selectedWidget.config,
                              yField: event.target.value || null,
                            },
                          })
                        }
                        className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                        disabled={!selectedSnapshot || selectedNumericFields.length === 0}
                      >
                        <option value="">
                          {!selectedSnapshot
                            ? "No datasource bound"
                            : selectedNumericFields.length === 0
                              ? "No numeric fields available"
                              : "Select field"}
                        </option>
                        {selectedNumericFields.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                {selectedWidget.type === "metric" && (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Metric Field</span>
                      <select
                        value={typeof selectedSanitizedConfig?.metricField === "string" ? selectedSanitizedConfig.metricField : ""}
                        onChange={(event) =>
                          onUpdateWidget(selectedWidget.id, {
                            config: {
                              ...selectedWidget.config,
                              metricField: event.target.value || null,
                            },
                          })
                        }
                        className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                        disabled={!selectedSnapshot || selectedNumericFields.length === 0}
                      >
                        <option value="">
                          {!selectedSnapshot
                            ? "Row count (no datasource bound)"
                            : selectedNumericFields.length === 0
                              ? "Row count (no numeric fields)"
                              : "Row count"}
                        </option>
                        {selectedNumericFields.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-white/35">Aggregate</span>
                      <select
                        value={typeof selectedSanitizedConfig?.aggregate === "string" ? selectedSanitizedConfig.aggregate : "row_count"}
                        onChange={(event) =>
                          onUpdateWidget(selectedWidget.id, {
                            config: {
                              ...selectedWidget.config,
                              aggregate: event.target.value,
                            },
                          })
                        }
                        className="w-full rounded-lg border border-[#2a2a2a] bg-[#111113] px-3 py-2 text-sm text-white outline-none focus:border-[#00d2ff]/45"
                        disabled={!selectedSnapshot}
                      >
                        <option value="row_count">Row count</option>
                        <option value="sum">Sum</option>
                        <option value="avg">Average</option>
                        <option value="min">Min</option>
                        <option value="max">Max</option>
                      </select>
                    </label>
                  </>
                )}

                <div className="rounded-xl border border-[#1c1c1e] bg-[#111113] p-3 text-xs leading-6 text-white/35">
                  This wave keeps dashboard widgets bound to tab-owned result snapshots only. The next scale wave should introduce server-side aggregated datasources, tiled layout persistence, linked brushing, and multi-role grammars closer to JMP Graph Builder.
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
