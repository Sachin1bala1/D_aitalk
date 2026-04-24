use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::db::connection_manager::ConnectionManager;
use crate::db::duckdb_engine::DuckDbEngine;
use crate::db::introspection::introspect;
use crate::db::query_executor::{execute_ddl, execute_streaming};
use crate::db::types::{ConnectionConfig, FullSchema};

pub type CancelSet = Arc<Mutex<HashSet<String>>>;

pub struct AppState {
    pub connections: Arc<ConnectionManager>,
    pub duckdb: Arc<DuckDbEngine>,
    /// Query IDs that have been requested to cancel.
    /// The streaming loop checks this and emits a final batch then exits.
    pub cancelled_queries: CancelSet,
}

// ── Connection Commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .connections
        .connect(config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_disconnect(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.connections.disconnect(&connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn db_list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, String> {
    Ok(state.connections.list_configs().await)
}

/// Lightweight connectivity check — driver-aware, no schema fetch overhead.
#[tauri::command]
pub async fn db_ping(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::db::connection_manager::ActiveConnection;
    use redis::AsyncCommands;

    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    match conn.as_ref() {
        ActiveConnection::Postgres(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mysql(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Sqlite(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mssql(client) => {
            let mut guard = client.lock().await;
            guard.query("SELECT 1", &[]).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mongodb(client, _) => {
            client.database("admin")
                .run_command(mongodb::bson::doc! { "ping": 1 })
                .await
                .map_err(|e| e.to_string())?;
        }
        ActiveConnection::Redis(mgr) => {
            let mut c = mgr.clone();
            redis::cmd("PING").query_async::<String>(&mut c).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::ClickHouse(client) => {
            client.query("SELECT 1").execute().await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Schema Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_get_schema(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<FullSchema, String> {
    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    let config = state.connections.get_config(&connection_id).await;
    let is_timescale = config
        .as_ref()
        .map(|c| matches!(c.driver, crate::db::types::DbDriver::Timescaledb))
        .unwrap_or(false);

    let mut schema = introspect(conn.as_ref(), &connection_id)
        .await
        .map_err(|e| e.to_string())?;

    // Detect TimescaleDB hypertables — populate hypertable_tables list (no name mutation)
    if is_timescale {
        schema.driver = "timescaledb".to_string();
        if let crate::db::connection_manager::ActiveConnection::Postgres(pool) = conn.as_ref() {
            if let Ok(rows) = sqlx::query(
                "SELECT hypertable_schema, hypertable_name FROM timescaledb_information.hypertables"
            )
            .fetch_all(pool)
            .await {
                use sqlx::Row;
                schema.hypertable_tables = rows.iter()
                    .map(|r| {
                        let s: String = r.try_get("hypertable_schema").unwrap_or_default();
                        let t: String = r.try_get("hypertable_name").unwrap_or_default();
                        format!("{}.{}", s, t)
                    })
                    .collect();
            }
        }
    }

    Ok(schema)
}

// ── Query Commands ────────────────────────────────────────────────────────────

/// Execute a SELECT query — streams results as `query_batch` events to the frontend.
#[tauri::command]
pub async fn db_execute_streaming(
    connection_id: String,
    sql: String,
    query_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let qid = query_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    let qid_clone = qid.clone();
    let cancelled = state.cancelled_queries.clone();
    tokio::spawn(async move {
        if let Err(e) = execute_streaming(conn, sql, qid_clone.clone(), app.clone(), cancelled).await {
            // Emit error as final batch so frontend can display it
            let _ = app.emit(
                "query_batch",
                crate::db::types::QueryBatch {
                    query_id: qid_clone,
                    batch_index: 0,
                    rows: vec![],
                    columns: None,
                    is_final: true,
                    total_elapsed_ms: 0,
                    rows_so_far: 0,
                    error: Some(e.to_string()),
                },
            );
        }
    });

    Ok(qid) // Return the query_id so frontend can correlate batches
}

/// Execute DDL/DML (CREATE, ALTER, INSERT, UPDATE, DELETE) — returns affected rows.
#[tauri::command]
pub async fn db_execute(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    execute_ddl(conn, &sql).await.map_err(|e| e.to_string())
}

/// Signal a running streaming query to cancel at the next batch boundary.
#[tauri::command]
pub async fn db_cancel_query(
    query_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.cancelled_queries.lock().unwrap().insert(query_id);
    Ok(())
}

/// Convenience wrapper for ALTER TABLE ADD COLUMN.
#[tauri::command]
pub async fn db_add_column(
    connection_id: String,
    schema: String,
    table: String,
    column_name: String,
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let null_str = if nullable { "" } else { " NOT NULL" };
    let default_str = default_value
        .map(|d| format!(" DEFAULT {}", d))
        .unwrap_or_default();
    let sql = format!(
        r#"ALTER TABLE "{}"."{}" ADD COLUMN "{}" {}{}{};"#,
        schema, table, column_name, data_type, null_str, default_str
    );
    db_execute(connection_id, sql, state).await.map(|_| ())
}

// ── DuckDB Commands ───────────────────────────────────────────────────────────

/// Run any DuckDB SQL; results stream as query_batch events.
#[tauri::command]
pub async fn duckdb_query(
    sql: String,
    query_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let qid = query_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let duck = state.duckdb.clone();
    let qid_clone = qid.clone();
    let app_clone = app.clone();
    // DuckDB is sync — run on blocking thread pool
    tokio::task::spawn_blocking(move || {
        if let Err(e) = duck.query_streaming(&sql, qid_clone.clone(), &app_clone) {
            let _ = app_clone.emit("query_batch", crate::db::types::QueryBatch {
                query_id: qid_clone,
                batch_index: 0, rows: vec![], columns: None,
                is_final: true, total_elapsed_ms: 0, rows_so_far: 0,
                error: Some(e.to_string()),
            });
        }
    });
    Ok(qid)
}

/// Register a Parquet file as a DuckDB view.
#[tauri::command]
pub async fn duckdb_load_parquet(
    path: String,
    table_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.load_parquet(&path, &table_name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Register a CSV file as a DuckDB view.
#[tauri::command]
pub async fn duckdb_load_csv(
    path: String,
    table_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.load_csv(&path, &table_name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// List all DuckDB views (loaded files).
#[tauri::command]
pub async fn duckdb_list_views(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.list_views())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ── Connection Persistence ────────────────────────────────────────────────────

const CONNECTIONS_FILE: &str = "connections.json";

fn connections_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(CONNECTIONS_FILE)
}

/// Persist connection configs to disk (app local data dir).
/// Passwords are stored in the connection_string — keychain migration is Phase N+1.
#[tauri::command]
pub fn save_connections(
    configs: Vec<crate::db::types::ConnectionConfig>,
    app: AppHandle,
) -> Result<(), String> {
    let path = connections_path(&app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Load persisted connection configs from disk.
/// Returns empty Vec if file doesn't exist yet.
#[tauri::command]
pub fn load_connections(app: AppHandle) -> Result<Vec<crate::db::types::ConnectionConfig>, String> {
    let path = connections_path(&app);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

// ── DDL Commands ─────────────────────────────────────────────────────────────

/// Returns the CREATE TABLE DDL for a given table.
/// Supports PostgreSQL (pg_get_tabledef / information_schema approach),
/// MySQL (SHOW CREATE TABLE), SQLite (sqlite_master).
#[tauri::command]
pub async fn db_get_table_ddl(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use crate::db::connection_manager::ActiveConnection;

    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    match conn.as_ref() {
        ActiveConnection::Postgres(pool) => {
            // Use pg_get_tabledef via information_schema; fall back to reconstructing from columns
            let ddl: Option<(String,)> = sqlx::query_as(
                "SELECT 'CREATE TABLE ' || quote_ident($1) || '.' || quote_ident($2) || ' (' || \
                 string_agg(col_def, ', ') || \
                 COALESCE(pk_clause, '') || ');' AS ddl \
                 FROM ( \
                   SELECT \
                     quote_ident(column_name) || ' ' || \
                     data_type || \
                     CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END || \
                     CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END || \
                     CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END \
                     AS col_def, \
                     ordinal_position \
                   FROM information_schema.columns \
                   WHERE table_schema = $1 AND table_name = $2 \
                   ORDER BY ordinal_position \
                 ) AS cols, \
                 LATERAL ( \
                   SELECT ', PRIMARY KEY (' || string_agg(quote_ident(kcu.column_name), ', ') || ')' AS pk_clause \
                   FROM information_schema.table_constraints tc \
                   JOIN information_schema.key_column_usage kcu \
                     ON tc.constraint_name = kcu.constraint_name \
                     AND tc.table_schema = kcu.table_schema \
                   WHERE tc.constraint_type = 'PRIMARY KEY' \
                     AND tc.table_schema = $1 AND tc.table_name = $2 \
                 ) AS pk \
                 GROUP BY pk_clause"
            )
            .bind(&schema)
            .bind(&table)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

            ddl.map(|(s,)| s)
               .ok_or_else(|| format!("Table {}.{} not found", schema, table))
        }

        ActiveConnection::Mysql(pool) => {
            let row: Option<(String, String)> =
                sqlx::query_as(&format!("SHOW CREATE TABLE `{}`.`{}`", schema, table))
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?;
            row.map(|(_, ddl)| ddl)
               .ok_or_else(|| format!("Table {}.{} not found", schema, table))
        }

        ActiveConnection::Sqlite(pool) => {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
                    .bind(&table)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?;
            row.map(|(s,)| s)
               .ok_or_else(|| format!("Table {} not found", table))
        }

        ActiveConnection::Mssql(client) => {
            // Reconstruct DDL from INFORMATION_SCHEMA + sys primary key info
            let sql = format!(
                r#"
                SELECT
                    'CREATE TABLE [' + c.TABLE_SCHEMA + '].[' + c.TABLE_NAME + '] (' +
                    STRING_AGG(
                        '[' + c.COLUMN_NAME + '] ' +
                        c.DATA_TYPE +
                        CASE
                            WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL AND c.CHARACTER_MAXIMUM_LENGTH = -1
                                THEN '(MAX)'
                            WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL
                                THEN '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS NVARCHAR) + ')'
                            WHEN c.NUMERIC_PRECISION IS NOT NULL AND c.DATA_TYPE IN ('decimal','numeric')
                                THEN '(' + CAST(c.NUMERIC_PRECISION AS NVARCHAR) + ',' + CAST(c.NUMERIC_SCALE AS NVARCHAR) + ')'
                            ELSE ''
                        END +
                        CASE WHEN c.IS_NULLABLE = 'NO' THEN ' NOT NULL' ELSE ' NULL' END,
                        ', '
                    ) WITHIN GROUP (ORDER BY c.ORDINAL_POSITION) + ');' AS ddl
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = '{schema}' AND c.TABLE_NAME = '{table}'
                GROUP BY c.TABLE_SCHEMA, c.TABLE_NAME
                "#,
                schema = schema.replace('\'', "''"),
                table = table.replace('\'', "''"),
            );

            let mut guard = client.lock().await;
            let rows = guard
                .query(&sql, &[])
                .await
                .map_err(|e| e.to_string())?
                .into_first_result()
                .await
                .map_err(|e| e.to_string())?;

            rows.first()
                .and_then(|r| r.get::<&str, _>("ddl"))
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Table {}.{} not found", schema, table))
        }
        ActiveConnection::Mongodb(_, _) => {
            Err(format!("get_table_ddl is not supported for MongoDB collections."))
        }
        ActiveConnection::Redis(_) => {
            Err(format!("get_table_ddl is not supported for Redis."))
        }
        ActiveConnection::ClickHouse(_) => {
            Err(format!("get_table_ddl is not supported for ClickHouse (use SHOW CREATE TABLE instead)."))
        }
    }
}

// ── API Key Keychain ──────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "daitalk";

/// Store an API key in the OS keychain (Windows Credential Manager / macOS Keychain / libsecret).
#[tauri::command]
pub fn store_api_key(service: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &service)
        .map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

/// Retrieve an API key from the OS keychain. Returns empty string if not set.
#[tauri::command]
pub fn get_api_key(service: String) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &service)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(pw),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete an API key from the OS keychain.
#[tauri::command]
pub fn delete_api_key(service: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &service)
        .map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Health Check ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn health_check() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
