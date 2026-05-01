/**
 * DbClient — thin TypeScript wrapper over Tauri invoke() calls.
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
  is_hypertable: boolean;
  hypertable_chunks: number | null;
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
  /** "schema.table" keys that are TimescaleDB hypertables */
  hypertable_tables: string[];
  /** Stored functions and procedures */
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

// ── API ───────────────────────────────────────────────────────────────────────

export const DbClient = {
  async connect(config: ConnectionConfig): Promise<void> {
    // If the connection_string has no embedded password (no "@" with a password component),
    // attempt to restore it from the OS keychain before handing off to Rust.
    let resolved = config;
    if (!config.connection_string?.includes('@')) {
      try {
        const pw = await invoke<string | null>('get_credential', { key: `conn_${config.id}_password` });
        if (pw) {
          resolved = { ...config, connection_string: config.connection_string };
          // Restore pi_config password if applicable, otherwise embed in connection_string
          if (resolved.pi_config !== undefined) {
            resolved = { ...resolved, pi_config: { ...resolved.pi_config, password: pw } };
          }
        }
      } catch { /* keychain unavailable */ }
    }
    return invoke("db_connect", { config: resolved });
  },

  async disconnect(connectionId: string): Promise<void> {
    return invoke("db_disconnect", { connectionId });
  },

  /** Driver-aware connectivity check — works for SQL and NoSQL. */
  async ping(connectionId: string): Promise<void> {
    return invoke("db_ping", { connectionId });
  },

  async listConnections(): Promise<ConnectionConfig[]> {
    return invoke("db_list_connections");
  },

  async getSchema(connectionId: string): Promise<FullSchema> {
    return invoke("db_get_schema", { connectionId });
  },

  /**
   * Execute a SELECT query — streams results as "query_batch" Tauri events.
   * Returns the query_id to correlate batches.
   */
  async executeStreaming(connectionId: string, sql: string, queryId?: string): Promise<string> {
    return invoke("db_execute_streaming", { connectionId, sql, queryId });
  },

  /**
   * Convenience: execute a SELECT and collect all rows.
   * Waits for the final batch, then resolves with a flat row array.
   * Use for small result sets (schema metadata, stats queries).
   */
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
      }).then((fn) => {
        unlisten = fn;
        // Start streaming after listener is registered
        invoke("db_execute_streaming", { connectionId, sql, queryId: qid }).catch((e) => {
          clearTimeout(timeout);
          unlisten?.();
          reject(e);
        });
      }).catch(reject);
    });
  },

  /**
   * Execute DDL/DML — returns affected row count.
   */
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

  /**
   * Signal the streaming query to stop at the next batch boundary.
   * The Rust side emits a final batch then exits the stream loop.
   */
  async cancelQuery(queryId: string): Promise<void> {
    return invoke("db_cancel_query", { queryId });
  },

  async healthCheck(): Promise<{ status: string; version: string }> {
    return invoke("health_check");
  },

  // ── DuckDB ──────────────────────────────────────────────────────────────────

  /** Stream a DuckDB analytical query; results arrive as query_batch events. */
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

  /** Reconstruct CREATE TABLE DDL for a given table (PostgreSQL, MySQL, SQLite). */
  async getTableDdl(connectionId: string, schema: string, table: string): Promise<string> {
    return invoke("db_get_table_ddl", { connectionId, schema, table });
  },

  // ── Connection persistence ─────────────────────────────────────────────────

  /** Persist current connection list to disk (app local data dir). */
  async saveConnections(configs: ConnectionConfig[]): Promise<void> {
    return invoke("save_connections", { configs });
  },

  /** Load persisted connection list from disk. Returns [] if file doesn't exist. */
  async loadConnections(): Promise<ConnectionConfig[]> {
    return invoke("load_connections");
  },

  // ── API Key Keychain ─────────────────────────────────────────────────────

  /** Store an API key in the OS keychain. Pass empty string to delete the key. */
  async storeApiKey(service: string, key: string): Promise<void> {
    if (key) {
      return invoke("store_api_key", { service, key });
    } else {
      return invoke("delete_api_key", { service });
    }
  },

  /** Retrieve an API key from the OS keychain. Returns "" if not set. */
  async getApiKey(service: string): Promise<string> {
    return invoke("get_api_key", { service });
  },

  /** Delete an API key from the OS keychain. */
  async deleteApiKey(service: string): Promise<void> {
    return invoke("delete_api_key", { service });
  },
};
