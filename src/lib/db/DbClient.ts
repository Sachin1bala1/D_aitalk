/**
 * DbClient - thin TypeScript wrapper over Tauri invoke() calls.
 * Replaces the old DatabaseService.ts fetch()-based approach.
 */
import { invoke } from "@tauri-apps/api/core";

export interface ColumnMeta {
  name: string;
  type_name: string;
  display_type: DisplayType;
  nullable: boolean;
  is_primary_key: boolean;
}

export type DisplayType =
  | { kind: "integer" }
  | { kind: "float" }
  | { kind: "text" }
  | { kind: "boolean" }
  | { kind: "timestamp" }
  | { kind: "date" }
  | { kind: "duration" }
  | { kind: "json" }
  | { kind: "bytes" }
  | { kind: "sensor_id" }
  | { kind: "unit"; unit: string }
  | { kind: "unknown" };

export interface TableMeta {
  schema: string;
  name: string;
  row_estimate: number | null;
  size_bytes: number | null;
  object_type: "table" | "view" | "materialized_view" | "foreign_table";
  is_hypertable?: boolean;
  hypertable_chunks?: number | null;
}

export type FunctionKind = "function" | "procedure" | "aggregate" | "trigger";

export interface FunctionMeta {
  schema: string;
  name: string;
  return_type: string;
  kind: FunctionKind;
  language: string;
}

export interface FullSchema {
  connection_id: string;
  driver: string;
  tables: TableMeta[];
  columns: Record<string, ColumnMeta[]>;
  foreign_keys: ForeignKey[];
  indexes: IndexMeta[];
  hypertable_tables: string[];
  functions: FunctionMeta[];
}

export interface ForeignKey {
  constraint_name: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface IndexMeta {
  index_name: string;
  table_name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface PIConfig {
  base_url: string;
  username: string;
  password: string;
  verify_ssl: boolean;
}

export interface ConnectionConfig {
  id: string;
  display_name: string;
  driver: DbDriver;
  connection_string: string;
  pool_min?: number;
  pool_max?: number;
  read_only?: boolean;
  pi_config?: PIConfig;
}

export type DbDriver =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "mssql"
  | "mariadb"
  | "timescaledb"
  | "mongodb"
  | "redis"
  | "clickhouse"
  | "p_i_historian";

export interface QueryBatch {
  query_id: string;
  batch_index: number;
  rows: Record<string, unknown>[];
  columns: ColumnMeta[] | null;
  is_final: boolean;
  total_elapsed_ms: number;
  rows_so_far: number;
  error: string | null;
}

export interface ExecuteStreamingResponse {
  query_id: string;
  source_tables: string[];
}

export interface SortStateLike {
  column: string;
  direction: "asc" | "desc";
}

export interface QueryTransformInput {
  base_sql: string;
  sort: SortStateLike | null;
  global_filter: string;
  null_filter: string | null;
  column_filters: Record<string, string>;
  columns: string[];
}

export interface ParameterObservation {
  table_name?: string | null;
  column_name: string;
}

export interface BenchmarkInput {
  parameter_name: string;
  metric_type: string;
  metric_value: number;
  context_json: unknown;
  query_id?: string;
}

export interface VisualizationViewedEvent {
  query_id: string;
  chart_type: string;
  column_count: number;
  viewed_at: string;
}

export interface ParameterHotspotRecord {
  connection_id: string;
  table_name: string;
  column_name: string;
  hit_count: number;
  last_observed_at: string;
}

export interface BenchmarkContextRecord {
  version: number;
  db_path: string;
  row_count: number;
  column_count: number;
  table_name: string;
  notes?: string | null;
}

export interface BenchmarkRecord {
  query_id: string;
  context: BenchmarkContextRecord;
  captured_at: string;
}

export interface QueryHistoryRecord {
  query_id: string;
  sql: string;
  source_table?: string | null;
  source_tables: string[];
  row_count: number;
  duration_ms: number;
  success: boolean;
  error_message?: string | null;
  executed_at: string;
}

export interface SecurityAuditInput {
  event_type: string;
  outcome: string;
  details_json?: unknown;
}

export interface SecurityAuditRecord {
  id: number;
  event_type: string;
  outcome: string;
  details_json: unknown;
  created_at: string;
}

export interface LocalDataStats {
  query_history_count: number;
  visualization_count: number;
  benchmark_count: number;
  hotspot_count: number;
  security_audit_count: number;
}

export interface QueryConcurrencyStatus {
  total_in_flight: number;
  max_global: number;
  per_connection: Record<string, number>;
}

export const DbClient = {
  async connect(config: ConnectionConfig): Promise<ConnectionConfig> {
    let resolved = config;

    try {
      const needsKeychain =
        config.pi_config !== undefined
          ? !config.pi_config.password
          : (() => {
              try {
                return !new URL(config.connection_string ?? "").password;
              } catch {
                return false;
              }
            })();

      if (needsKeychain) {
        const pw = await invoke<string | null>("get_credential", {
          key: `conn_${config.id}_password`,
        });

        if (pw) {
          if (config.pi_config !== undefined) {
            resolved = {
              ...config,
              pi_config: { ...config.pi_config, password: pw },
            };
          } else if (config.connection_string) {
            try {
              const url = new URL(config.connection_string);
              url.password = pw;
              resolved = { ...config, connection_string: url.toString() };
            } catch {
              // Non-URL connection strings can continue as-is.
            }
          }
        }
      }
    } catch {
      // Keychain unavailable - continue with provided config.
    }

    await invoke("db_connect", { config: resolved });
    return resolved;
  },

  async testConnection(config: ConnectionConfig): Promise<void> {
    return invoke("db_test_connection", { config });
  },

  async disconnect(connectionId: string): Promise<void> {
    return invoke("db_disconnect", { connectionId });
  },

  async ping(connectionId: string): Promise<void> {
    return invoke("db_ping", { connectionId });
  },

  async listConnections(): Promise<ConnectionConfig[]> {
    return invoke("db_list_connections");
  },

  async getSchema(connectionId: string): Promise<FullSchema> {
    return invoke("db_get_schema", { connectionId });
  },

  async buildEffectiveSql(input: QueryTransformInput): Promise<string> {
    const response = await invoke<{ effective_sql: string }>("db_build_effective_sql", {
      request: input,
    });
    return response.effective_sql;
  },

  async executeStreaming(
    connectionId: string,
    sql: string,
    queryId?: string
  ): Promise<ExecuteStreamingResponse> {
    return invoke("db_execute_streaming", { connectionId, sql, queryId });
  },

  async query(connectionId: string, sql: string): Promise<Record<string, unknown>[]> {
    const { listen } = await import("@tauri-apps/api/event");
    const qid = `overview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows: Record<string, unknown>[] = [];

    return new Promise((resolve, reject) => {
      let unlisten: (() => void) | null = null;
      const timeout = setTimeout(() => {
        unlisten?.();
        reject(new Error("Query timeout (10s)"));
      }, 10_000);

      listen<QueryBatch>("query_batch", (event) => {
        const batch = event.payload;
        if (batch.query_id !== qid) return;
        if (batch.error) {
          clearTimeout(timeout);
          unlisten?.();
          reject(new Error(batch.error));
          return;
        }
        rows.push(...batch.rows);
        if (batch.is_final) {
          clearTimeout(timeout);
          unlisten?.();
          resolve(rows);
        }
      })
        .then((fn) => {
          unlisten = fn;
          invoke("db_execute_streaming", { connectionId, sql, queryId: qid }).catch((e) => {
            clearTimeout(timeout);
            unlisten?.();
            reject(e);
          });
        })
        .catch(reject);
    });
  },

  async execute(connectionId: string, sql: string): Promise<number> {
    return invoke("db_execute", { connectionId, sql });
  },

  async addColumn(
    connectionId: string,
    schema: string,
    table: string,
    columnName: string,
    dataType: string,
    nullable: boolean,
    defaultValue?: string
  ): Promise<void> {
    return invoke("db_add_column", {
      connectionId,
      schema,
      table,
      columnName,
      dataType,
      nullable,
      defaultValue,
    });
  },

  async cancelQuery(queryId: string): Promise<void> {
    return invoke("db_cancel_query", { queryId });
  },

  async updateParameterAffinity(
    connectionId: string,
    parameters: ParameterObservation[]
  ): Promise<void> {
    return invoke("db_update_parameter_affinity", { connectionId, parameters });
  },

  async saveBenchmark(benchmark: BenchmarkInput): Promise<void> {
    return invoke("db_save_benchmark", { benchmark });
  },

  async recordVisualizationViewed(event: VisualizationViewedEvent): Promise<void> {
    return invoke("record_visualization_viewed", { event });
  },

  async recordSecurityAudit(input: SecurityAuditInput): Promise<void> {
    return invoke("record_security_audit", { input });
  },

  async getParameterHotspots(input: {
    connection_id?: string | null;
    table_name?: string | null;
    limit?: number;
  }): Promise<ParameterHotspotRecord[]> {
    return invoke("db_get_parameter_hotspots", { input });
  },

  async getRecentBenchmarks(input: {
    table_name?: string | null;
    limit?: number;
  }): Promise<BenchmarkRecord[]> {
    return invoke("db_get_recent_benchmarks", { input });
  },

  async getQueryHistory(input: {
    table_name: string;
    limit?: number;
  }): Promise<QueryHistoryRecord[]> {
    return invoke("db_get_query_history", { input });
  },

  async getSecurityAudit(input: {
    event_type?: string | null;
    outcome?: string | null;
    limit?: number;
  }): Promise<SecurityAuditRecord[]> {
    return invoke("db_get_security_audit", { input });
  },

  async getSecurityAuditEventTypes(): Promise<string[]> {
    return invoke("db_get_security_audit_event_types");
  },

  async getSecurityAuditOutcomes(): Promise<string[]> {
    return invoke("db_get_security_audit_outcomes");
  },

  async getLocalDataStats(): Promise<LocalDataStats> {
    return invoke("db_get_local_data_stats");
  },

  async clearLocalData(
    scope: "query_history" | "telemetry" | "benchmarks" | "security_audit" | "all"
  ): Promise<void> {
    return invoke("db_clear_local_data", { input: { scope } });
  },

  async getQueryConcurrencyStatus(): Promise<QueryConcurrencyStatus> {
    return invoke("get_query_concurrency_status");
  },

  async healthCheck(): Promise<{ status: string; version: string }> {
    return invoke("health_check");
  },

  async duckdbQuery(sql: string, queryId?: string): Promise<string> {
    return invoke("duckdb_query", { sql, queryId });
  },

  async duckdbLoadParquet(path: string, tableName: string): Promise<void> {
    return invoke("duckdb_load_parquet", { path, tableName });
  },

  async duckdbLoadCsv(path: string, tableName: string): Promise<void> {
    return invoke("duckdb_load_csv", { path, tableName });
  },

  async duckdbListViews(): Promise<string[]> {
    return invoke("duckdb_list_views");
  },

  async getTableDdl(connectionId: string, schema: string, table: string): Promise<string> {
    return invoke("db_get_table_ddl", { connectionId, schema, table });
  },

  async saveConnections(configs: ConnectionConfig[]): Promise<void> {
    return invoke("save_connections", { configs });
  },

  async loadConnections(): Promise<ConnectionConfig[]> {
    return invoke("load_connections");
  },

  async saveWorkspaceSession(sessionJson: string): Promise<void> {
    return invoke("save_workspace_session", { sessionJson });
  },

  async loadWorkspaceSession(): Promise<string | null> {
    return invoke("load_workspace_session");
  },

  async clearWorkspaceSession(): Promise<void> {
    return invoke("clear_workspace_session");
  },

  async saveAppDocument(key: string, json: string): Promise<void> {
    return invoke("save_app_document", { key, json });
  },

  async loadAppDocument(key: string): Promise<string | null> {
    return invoke("load_app_document", { key });
  },

  async deleteAppDocument(key: string): Promise<void> {
    return invoke("delete_app_document", { key });
  },

  async storeApiKey(service: string, key: string): Promise<void> {
    if (key) {
      return invoke("store_api_key", { service, key });
    }
    return invoke("delete_api_key", { service });
  },

  async getApiKey(service: string): Promise<string> {
    return invoke("get_api_key", { service });
  },

  async hasApiKey(service: string): Promise<boolean> {
    return invoke("has_api_key", { service });
  },

  async deleteApiKey(service: string): Promise<void> {
    return invoke("delete_api_key", { service });
  },
};
