import type { ConnectionConfig, FullSchema } from "../db/DbClient";
import type { WorkspaceSessionSnapshot, QueryResults } from "../stores/WorkspaceStore";
import { createQueryArtifact } from "../artifacts/queryArtifacts";

export function isSmokeMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("smoke") === "1";
}

export function createSmokeConnection(): ConnectionConfig {
  return {
    id: "smoke-connection",
    display_name: "Smoke Demo",
    driver: "postgres",
    connection_string: "postgresql://smoke@demo.local/smoke",
    read_only: true,
  };
}

export function createSmokeSchema(): FullSchema {
  return {
    connection_id: "smoke-connection",
    driver: "postgres",
    tables: [
      {
        schema: "public",
        name: "sales_orders",
        row_estimate: 240,
        size_bytes: 8192,
        object_type: "table",
      },
    ],
    columns: {
      "public.sales_orders": [
        {
          name: "order_date",
          type_name: "timestamp",
          display_type: { kind: "timestamp" },
          nullable: false,
          is_primary_key: false,
        },
        {
          name: "region",
          type_name: "text",
          display_type: { kind: "text" },
          nullable: false,
          is_primary_key: false,
        },
        {
          name: "order_total",
          type_name: "numeric",
          display_type: { kind: "float" },
          nullable: false,
          is_primary_key: false,
        },
      ],
    },
    foreign_keys: [],
    indexes: [
      {
        index_name: "idx_sales_orders_order_date",
        table_name: "public.sales_orders",
        columns: ["order_date"],
        is_unique: false,
        is_primary: false,
      },
    ],
    hypertable_tables: [],
    functions: [],
  };
}

function createSmokeResults(): QueryResults {
  return {
    rows: [
      { order_date: "2026-05-01", region: "North", order_total: 1250.4 },
      { order_date: "2026-05-02", region: "South", order_total: 940.1 },
      { order_date: "2026-05-03", region: "West", order_total: 1512.9 },
    ],
    fields: [
      { name: "order_date" },
      { name: "region" },
      { name: "order_total" },
    ],
    rowCount: 3,
    elapsedMs: 12,
    queryId: "smoke-query-1",
    source_tables: ["public.sales_orders"],
  };
}

export function createSmokeWorkspaceSnapshot(): WorkspaceSessionSnapshot {
  const results = createSmokeResults();
  const sql = "select order_date, region, order_total from public.sales_orders order by order_date limit 100;";
  const queryArtifact = createQueryArtifact({
    name: "Smoke query snapshot",
    results,
    sql,
    connectionId: "smoke-connection",
    sourceTabId: "tab-1",
  });
  const revisionId = `revision-${queryArtifact.id}-1`;

  return {
    version: 4,
    savedAt: Date.now(),
    activeConnectionId: "smoke-connection",
    activeTabId: "tab-1",
    activePanel: "agent",
    graphBuilderRequest: null,
    artifacts: {
      [queryArtifact.id]: queryArtifact,
    },
    artifactRevisions: {
      [queryArtifact.id]: [
        {
          id: revisionId,
          artifactId: queryArtifact.id,
          recordedAt: queryArtifact.updatedAt,
          artifact: queryArtifact,
        },
      ],
    },
    artifactHeads: {
      [queryArtifact.id]: {
        headRevisionId: revisionId,
        hasUncommittedChanges: false,
      },
    },
    tabs: [
      {
        id: "tab-1",
        type: "sql_editor",
        title: "Smoke Query",
        connectionId: "smoke-connection",
        sql,
        queryResults: results,
        queryView: {
          baseSql: sql,
          connectionId: "smoke-connection",
          effectiveSql: sql,
          sort: null,
          globalFilter: "",
          nullFilter: null,
          columnFilters: {},
          columns: results.fields.map((field) => field.name),
          currentQueryId: results.queryId,
        },
        restoredSnapshotAt: null,
      },
    ],
    selectedTableNode: null,
    aiSession: null,
    taskCheckpoint: null,
  };
}
