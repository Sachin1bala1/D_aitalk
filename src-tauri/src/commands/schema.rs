use tauri::{AppHandle, State};

use crate::db::connection_manager::ActiveConnection;
use crate::db::introspection::introspect;
use crate::db::query_transform::{build_effective_sql, QueryTransformRequest, QueryTransformResponse};
use crate::db::types::FullSchema;

use super::{db_execute, AppState};

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

    if is_timescale {
        schema.driver = "timescaledb".to_string();
        if let ActiveConnection::Postgres(pool) = conn.as_ref() {
            if let Ok(rows) = sqlx::query(
                "SELECT hypertable_schema, hypertable_name FROM timescaledb_information.hypertables",
            )
            .persistent(false)
            .fetch_all(pool)
            .await
            {
                use sqlx::Row;
                schema.hypertable_tables = rows
                    .iter()
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

#[tauri::command]
pub async fn db_build_effective_sql(
    request: QueryTransformRequest,
) -> Result<QueryTransformResponse, String> {
    Ok(QueryTransformResponse {
        effective_sql: build_effective_sql(&request),
    })
}

#[tauri::command]
pub async fn db_add_column(
    connection_id: String,
    schema: String,
    table: String,
    column_name: String,
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
    app: AppHandle,
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
    db_execute(connection_id, sql, app, state).await.map(|_| ())
}

#[tauri::command]
pub async fn db_get_table_ddl(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    match conn.as_ref() {
        ActiveConnection::Postgres(pool) => {
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
                 GROUP BY pk_clause",
            )
            .persistent(false)
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
            Err("get_table_ddl is not supported for MongoDB collections.".to_string())
        }
        ActiveConnection::Redis(_) => Err("get_table_ddl is not supported for Redis.".to_string()),
        ActiveConnection::ClickHouse(_) => Err(
            "get_table_ddl is not supported for ClickHouse (use SHOW CREATE TABLE instead)."
                .to_string(),
        ),
        ActiveConnection::DuckDb(_) => Err("get_table_ddl is not supported for DuckDB.".to_string()),
        ActiveConnection::RestApi(_) => Err("get_table_ddl is not supported for REST API connections.".to_string()),
    }
}
