import type {
  DashboardDatasourceSnapshot,
  DashboardWidget,
  QueryResults,
} from "../stores/WorkspaceStore";

export const DASHBOARD_QUERY_SAMPLE_LIMIT = 5000;

export type AgentChartType = "bar" | "line" | "scatter" | "pie" | "area";

function isFiniteNumber(value: unknown) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function buildDashboardSnapshot(
  results: QueryResults,
  sql: string,
  connectionId: string | null,
  name?: string,
): DashboardDatasourceSnapshot {
  return {
    id: `dashboard-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name:
      name ??
      `Query snapshot ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    connectionId,
    sql,
    capturedAt: Date.now(),
    rowCount: results.rowCount,
    elapsedMs: results.elapsedMs,
    queryId: results.queryId,
    fields: results.fields,
    rows: results.rows.slice(0, DASHBOARD_QUERY_SAMPLE_LIMIT),
    sourceTables: results.source_tables,
  };
}

function firstNumericField(snapshot: DashboardDatasourceSnapshot) {
  return snapshot.fields
    .map((field) => field.name)
    .find((field) => snapshot.rows.some((row) => isFiniteNumber(row[field])));
}

export function buildInitialDashboardWidget(
  snapshot: DashboardDatasourceSnapshot,
): Omit<DashboardWidget, "id"> {
  const xField = snapshot.fields[0]?.name ?? null;
  const numericField = firstNumericField(snapshot);

  if (xField && numericField) {
    return {
      type: "bar_chart",
      title: `${numericField} by ${xField}`,
      datasourceId: snapshot.id,
      layout: { x: 0, y: 0, w: 8, h: 5, minW: 5, minH: 4 },
      config: {
        xField,
        yField: numericField,
      },
    };
  }

  return {
    type: "table",
    title: "Result preview",
    datasourceId: snapshot.id,
    layout: { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 },
    config: {},
  };
}

function normalizeChartWidgetType(chartType: AgentChartType): DashboardWidget["type"] {
  switch (chartType) {
    case "line":
    case "area":
      return "line_chart";
    case "scatter":
      return "scatter_chart";
    case "pie":
    case "bar":
    default:
      return "bar_chart";
  }
}

export function buildDashboardWidgetFromChartIntent(args: {
  snapshot: DashboardDatasourceSnapshot;
  chartType: AgentChartType;
  xColumn: string;
  yColumn: string;
  title?: string;
}): Omit<DashboardWidget, "id"> {
  const { snapshot, chartType, xColumn, yColumn, title } = args;
  const widgetType = normalizeChartWidgetType(chartType);
  return {
    type: widgetType,
    title: title ?? `${yColumn} by ${xColumn}`,
    datasourceId: snapshot.id,
    layout: { x: 0, y: 0, w: 8, h: 5, minW: 5, minH: 4 },
    config: {
      xField: xColumn,
      yField: yColumn,
      requestedChartType: chartType,
    },
  };
}
