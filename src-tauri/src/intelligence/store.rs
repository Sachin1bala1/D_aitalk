use std::path::PathBuf;

use chrono::Utc;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};

use super::events::{
    BenchmarkCapturedEvent, BenchmarkContext, BenchmarkRecord, LocalDataStats,
    ParameterHotspotRecord, QueryExecutedEvent, QueryHistoryRecord, SecurityAuditEvent,
    SecurityAuditRecord, VisualizationViewedEvent,
};
use super::sql_analyzer::{QueryAnalysis, StatementType};

const INTELLIGENCE_DB_FILE: &str = "user_intelligence.db";
const CURRENT_SCHEMA_VERSION: i64 = 4;

pub struct IntelligenceStore {
    pool: Pool<Sqlite>,
    db_path: PathBuf,
}

impl IntelligenceStore {
    pub async fn initialize(app: &AppHandle) -> Result<Self, String> {
        let db_path = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join(INTELLIGENCE_DB_FILE);

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .min_connections(1)
            .connect_with(options)
            .await
            .map_err(|e| e.to_string())?;

        initialize_schema(&pool).await?;

        Ok(Self { pool, db_path })
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }
}

pub async fn initialize_schema(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut current_version = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(version) AS version FROM schema_version",
    )
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    while current_version < CURRENT_SCHEMA_VERSION {
        current_version += 1;
        match current_version {
            1 => migrate_v1(pool).await?,
            2 => migrate_v2(pool).await?,
            3 => migrate_v3(pool).await?,
            4 => migrate_v4(pool).await?,
            _ => return Err(format!("unsupported intelligence schema version: {current_version}")),
        }
    }

    Ok(())
}

async fn migrate_v1(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parameter_hotspots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 1,
            last_observed_at TEXT NOT NULL,
            UNIQUE(connection_id, table_name, column_name)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_parameter_hotspots_connection_hits
        ON parameter_hotspots(connection_id, hit_count DESC)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_parameter_hotspots_last_observed
        ON parameter_hotspots(last_observed_at)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS historical_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parameter_name TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            metric_value REAL NOT NULL,
            context_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_historical_benchmarks_parameter_metric_created
        ON historical_benchmarks(parameter_name, metric_type, created_at DESC)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_historical_benchmarks_created
        ON historical_benchmarks(created_at)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    insert_schema_version(pool, 1).await
}

async fn migrate_v2(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS query_executed_events (
            query_id TEXT PRIMARY KEY,
            sql TEXT NOT NULL,
            source_table TEXT NULL,
            row_count INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            success INTEGER NOT NULL,
            error_message TEXT NULL,
            executed_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS visualization_viewed_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_id TEXT NOT NULL,
            chart_type TEXT NOT NULL,
            column_count INTEGER NOT NULL,
            viewed_at TEXT NOT NULL,
            FOREIGN KEY(query_id) REFERENCES query_executed_events(query_id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_id TEXT NOT NULL,
            context_json TEXT NOT NULL,
            context_version INTEGER NOT NULL,
            table_name TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_context_table_version
        ON benchmarks(table_name, context_version, timestamp DESC)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO benchmarks (query_id, context_json, context_version, table_name, timestamp)
        SELECT
            'legacy-' || id,
            json_object(
                'version', 1,
                'db_path', '',
                'row_count', 0,
                'column_count', 0,
                'table_name', parameter_name,
                'notes', 'legacy_metric:' || metric_type || '=' || metric_value || '; legacy_context=' || context_json
            ),
            1,
            parameter_name,
            created_at
        FROM historical_benchmarks
        WHERE EXISTS (SELECT 1 FROM historical_benchmarks)
          AND NOT EXISTS (SELECT 1 FROM benchmarks)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    insert_schema_version(pool, 2).await
}

async fn migrate_v3(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS query_event_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            FOREIGN KEY(query_id) REFERENCES query_executed_events(query_id),
            UNIQUE(query_id, table_name)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_query_event_tables_table_name
        ON query_event_tables(table_name)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT OR IGNORE INTO query_event_tables (query_id, table_name)
        SELECT query_id, source_table
        FROM query_executed_events
        WHERE source_table IS NOT NULL
          AND TRIM(source_table) <> ''
          AND INSTR(source_table, ',') = 0
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    insert_schema_version(pool, 3).await
}

async fn migrate_v4(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS security_audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            outcome TEXT NOT NULL,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_security_audit_events_created_at
        ON security_audit_events(created_at DESC)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_security_audit_events_type_outcome
        ON security_audit_events(event_type, outcome, created_at DESC)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    insert_schema_version(pool, 4).await
}

async fn insert_schema_version(pool: &Pool<Sqlite>, version: i64) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?1, ?2)")
        .bind(version)
        .bind(Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn record_query_event(
    event: QueryExecutedEvent,
    store: &IntelligenceStore,
) -> Result<(), String> {
    let mut tx = store.pool().begin().await.map_err(|e| e.to_string())?;
    let redacted_sql = redact_sql_for_storage(&event.sql);

    sqlx::query(
        r#"
        INSERT INTO query_executed_events (
            query_id, sql, source_table, row_count, duration_ms,
            success, error_message, executed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(&event.query_id)
    .bind(&redacted_sql)
    .bind(&event.source_table)
    .bind(i64::try_from(event.row_count).map_err(|e| e.to_string())?)
    .bind(i64::try_from(event.duration_ms).map_err(|e| e.to_string())?)
    .bind(if event.success { 1 } else { 0 })
    .bind(&event.error_message)
    .bind(&event.executed_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    for table_name in event.source_tables {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO query_event_tables (query_id, table_name)
            VALUES (?1, ?2)
            "#,
        )
        .bind(&event.query_id)
        .bind(table_name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

fn redact_sql_for_storage(sql: &str) -> String {
    let mut redacted = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_single_quote = false;

    while let Some(ch) = chars.next() {
        if ch == '\'' {
            if in_single_quote && chars.peek() == Some(&'\'') {
                redacted.push('\'');
                redacted.push('\'');
                chars.next();
                continue;
            }

            in_single_quote = !in_single_quote;
            redacted.push('\'');
            if in_single_quote {
                redacted.push_str("[REDACTED]");
            }
            continue;
        }

        if !in_single_quote {
            redacted.push(ch);
        }
    }

    redacted
}

pub async fn record_visualization_event(
    event: VisualizationViewedEvent,
    store: &IntelligenceStore,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO visualization_viewed_events (
            query_id, chart_type, column_count, viewed_at
        )
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(event.query_id)
    .bind(event.chart_type)
    .bind(i64::try_from(event.column_count).map_err(|e| e.to_string())?)
    .bind(event.viewed_at)
    .execute(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn record_security_audit_event(
    event: SecurityAuditEvent,
    store: &IntelligenceStore,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO security_audit_events (
            event_type, outcome, details_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(event.event_type)
    .bind(event.outcome)
    .bind(serde_json::to_string(&event.details_json).map_err(|e| e.to_string())?)
    .bind(event.created_at)
    .execute(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn record_benchmark_event(
    event: BenchmarkCapturedEvent,
    store: &IntelligenceStore,
) -> Result<(), String> {
    let context = migrate_benchmark_context(event.context);
    sqlx::query(
        r#"
        INSERT INTO benchmarks (
            query_id, context_json, context_version, table_name, timestamp
        )
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(event.query_id)
    .bind(serde_json::to_string(&context).map_err(|e| e.to_string())?)
    .bind(i64::from(context.version))
    .bind(context.table_name.clone())
    .bind(event.captured_at)
    .execute(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn record_parameter_affinity(
    connection_id: &str,
    source_table: &str,
    columns: &[String],
    store: &IntelligenceStore,
) -> Result<(), String> {
    let mut tx = store.pool().begin().await.map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    for column in columns.iter().filter(|column| !column.trim().is_empty()) {
        sqlx::query(
            r#"
            INSERT INTO parameter_hotspots (
                connection_id, table_name, column_name, hit_count, last_observed_at
            )
            VALUES (?1, ?2, ?3, 1, ?4)
            ON CONFLICT(connection_id, table_name, column_name)
            DO UPDATE SET
                hit_count = parameter_hotspots.hit_count + 1,
                last_observed_at = excluded.last_observed_at
            "#,
        )
        .bind(connection_id)
        .bind(source_table)
        .bind(column)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

pub fn benchmark_context_from_legacy_json(
    context_json: serde_json::Value,
    fallback_table_name: &str,
) -> BenchmarkContext {
    let db_path = context_json
        .get("db_path")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let row_count = context_json
        .get("row_count")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let column_count = context_json
        .get("column_count")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let table_name = context_json
        .get("table_name")
        .and_then(|value| value.as_str())
        .unwrap_or(fallback_table_name)
        .to_string();

    BenchmarkContext {
        version: 1,
        db_path,
        row_count,
        column_count,
        table_name,
        notes: context_json
            .get("notes")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    }
}

pub fn migrate_benchmark_context(context: BenchmarkContext) -> BenchmarkContext {
    if context.version >= 1 {
        return context;
    }

    BenchmarkContext {
        version: 1,
        db_path: context.db_path,
        row_count: context.row_count,
        column_count: context.column_count,
        table_name: context.table_name,
        notes: context.notes,
    }
}

pub fn first_source_table(analysis: &QueryAnalysis) -> Option<String> {
    analysis.source_tables.first().cloned()
}

pub fn affinity_candidates_from_analysis(analysis: &QueryAnalysis) -> Option<(String, Vec<String>)> {
    if analysis.statement_type != StatementType::Select || analysis.source_tables.len() != 1 {
        return None;
    }

    let source_table = analysis.source_tables[0].clone();
    let columns = analysis
        .referenced_columns
        .iter()
        .filter_map(|column| {
            if column == "*" || column.ends_with(".*") {
                return None;
            }
            Some(column.rsplit('.').next().unwrap_or(column).to_string())
        })
        .collect::<Vec<_>>();

    if columns.is_empty() {
        return None;
    }

    Some((source_table, columns))
}

pub async fn list_parameter_hotspots(
    connection_id: Option<&str>,
    table_name: Option<&str>,
    limit: u32,
    store: &IntelligenceStore,
) -> Result<Vec<ParameterHotspotRecord>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, i64, String)>(
        r#"
        SELECT connection_id, table_name, column_name, hit_count, last_observed_at
        FROM parameter_hotspots
        WHERE (?1 IS NULL OR connection_id = ?1)
          AND (?2 IS NULL OR table_name = ?2)
        ORDER BY hit_count DESC, last_observed_at DESC
        LIMIT ?3
        "#,
    )
    .bind(connection_id)
    .bind(table_name)
    .bind(i64::from(limit))
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(
            |(connection_id, table_name, column_name, hit_count, last_observed_at)| {
                ParameterHotspotRecord {
                    connection_id,
                    table_name,
                    column_name,
                    hit_count: hit_count.max(0) as u64,
                    last_observed_at,
                }
            },
        )
        .collect())
}

pub async fn list_recent_benchmarks(
    table_name: Option<&str>,
    limit: u32,
    store: &IntelligenceStore,
) -> Result<Vec<BenchmarkRecord>, String> {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT query_id, context_json, timestamp
        FROM benchmarks
        WHERE (?1 IS NULL OR table_name = ?1)
        ORDER BY timestamp DESC
        LIMIT ?2
        "#,
    )
    .bind(table_name)
    .bind(i64::from(limit))
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(|(query_id, context_json, captured_at)| {
            let parsed: BenchmarkContext =
                serde_json::from_str(&context_json).map_err(|e| e.to_string())?;
            Ok(BenchmarkRecord {
                query_id,
                context: migrate_benchmark_context(parsed),
                captured_at,
            })
        })
        .collect()
}

pub async fn list_query_history_by_table(
    table_name: &str,
    limit: u32,
    store: &IntelligenceStore,
) -> Result<Vec<QueryHistoryRecord>, String> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, i64, i64, i64, Option<String>, String)>(
        r#"
        SELECT DISTINCT
            q.query_id,
            q.sql,
            q.source_table,
            q.row_count,
            q.duration_ms,
            q.success,
            q.error_message,
            q.executed_at
        FROM query_executed_events q
        JOIN query_event_tables t ON t.query_id = q.query_id
        WHERE t.table_name = ?1
        ORDER BY q.executed_at DESC
        LIMIT ?2
        "#,
    )
    .bind(table_name)
    .bind(i64::from(limit))
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    let mut history = Vec::with_capacity(rows.len());
    for (query_id, sql, source_table, row_count, duration_ms, success, error_message, executed_at) in rows {
        let source_tables = sqlx::query_scalar::<_, String>(
            "SELECT table_name FROM query_event_tables WHERE query_id = ?1 ORDER BY table_name",
        )
        .bind(&query_id)
        .fetch_all(store.pool())
        .await
        .map_err(|e| e.to_string())?;

        history.push(QueryHistoryRecord {
            query_id,
            sql,
            source_table,
            source_tables,
            row_count: row_count.max(0) as u64,
            duration_ms: duration_ms.max(0) as u64,
            success: success != 0,
            error_message,
            executed_at,
        });
    }

    Ok(history)
}

pub async fn list_recent_security_audit_events(
    event_type: Option<&str>,
    outcome: Option<&str>,
    limit: u32,
    store: &IntelligenceStore,
) -> Result<Vec<SecurityAuditRecord>, String> {
    let rows = sqlx::query_as::<_, (i64, String, String, String, String)>(
        r#"
        SELECT id, event_type, outcome, details_json, created_at
        FROM security_audit_events
        WHERE (?1 IS NULL OR event_type = ?1)
          AND (?2 IS NULL OR outcome = ?2)
        ORDER BY created_at DESC, id DESC
        LIMIT ?3
        "#,
    )
    .bind(event_type)
    .bind(outcome)
    .bind(i64::from(limit))
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(|(id, event_type, outcome, details_json, created_at)| {
            Ok(SecurityAuditRecord {
                id,
                event_type,
                outcome,
                details_json: serde_json::from_str(&details_json).map_err(|e| e.to_string())?,
                created_at,
            })
        })
        .collect()
}

pub async fn list_security_audit_event_types(
    store: &IntelligenceStore,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT DISTINCT event_type
        FROM security_audit_events
        ORDER BY event_type ASC
        "#,
    )
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())
}

pub async fn list_security_audit_outcomes(
    store: &IntelligenceStore,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT DISTINCT outcome
        FROM security_audit_events
        ORDER BY outcome ASC
        "#,
    )
    .fetch_all(store.pool())
    .await
    .map_err(|e| e.to_string())
}

pub async fn get_local_data_stats(store: &IntelligenceStore) -> Result<LocalDataStats, String> {
    async fn count(pool: &Pool<Sqlite>, sql: &str) -> Result<u64, String> {
        let value = sqlx::query_scalar::<_, i64>(sql)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(value.max(0) as u64)
    }

    Ok(LocalDataStats {
        query_history_count: count(store.pool(), "SELECT COUNT(*) FROM query_executed_events").await?,
        visualization_count: count(store.pool(), "SELECT COUNT(*) FROM visualization_viewed_events").await?,
        benchmark_count: count(store.pool(), "SELECT COUNT(*) FROM benchmarks").await?,
        hotspot_count: count(store.pool(), "SELECT COUNT(*) FROM parameter_hotspots").await?,
        security_audit_count: count(store.pool(), "SELECT COUNT(*) FROM security_audit_events").await?,
    })
}

pub async fn clear_local_data(scope: &str, store: &IntelligenceStore) -> Result<(), String> {
    let mut tx = store.pool().begin().await.map_err(|e| e.to_string())?;

    match scope {
        "query_history" => {
            sqlx::query("DELETE FROM query_event_tables")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM query_executed_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        "telemetry" => {
            sqlx::query("DELETE FROM visualization_viewed_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM parameter_hotspots")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        "benchmarks" => {
            sqlx::query("DELETE FROM benchmarks")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        "security_audit" => {
            sqlx::query("DELETE FROM security_audit_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        "all" => {
            sqlx::query("DELETE FROM visualization_viewed_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM query_event_tables")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM query_executed_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM parameter_hotspots")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM benchmarks")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM security_audit_events")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("unsupported local data clear scope: {scope}")),
    }

    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        affinity_candidates_from_analysis, benchmark_context_from_legacy_json, first_source_table,
        clear_local_data, get_local_data_stats, initialize_schema, list_query_history_by_table,
        list_recent_security_audit_events, list_security_audit_event_types,
        list_security_audit_outcomes, record_benchmark_event, record_parameter_affinity,
        record_query_event, record_security_audit_event, record_visualization_event,
        redact_sql_for_storage, IntelligenceStore,
    };
    use crate::intelligence::events::{
        BenchmarkCapturedEvent, BenchmarkContext, QueryExecutedEvent, SecurityAuditEvent,
        VisualizationViewedEvent,
    };
    use crate::intelligence::sql_analyzer::analyze_query;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::{Pool, Row, Sqlite};
    use uuid::Uuid;

    async fn make_test_store() -> IntelligenceStore {
        let db_path = std::env::temp_dir().join(format!("daitalk-intelligence-{}.db", Uuid::new_v4()));
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .connect_with(options)
            .await
            .expect("connect test sqlite");

        initialize_schema(&pool).await.expect("initialize schema");

        IntelligenceStore { pool, db_path }
    }

    async fn fetch_scalar_i64(pool: &Pool<Sqlite>, sql: &str) -> i64 {
        sqlx::query_scalar::<_, i64>(sql)
            .fetch_one(pool)
            .await
            .expect("fetch scalar")
    }

    #[tokio::test]
    async fn initializes_schema_idempotently() {
        let store = make_test_store().await;
        initialize_schema(store.pool()).await.expect("reinitialize schema");

        let version = fetch_scalar_i64(store.pool(), "SELECT MAX(version) FROM schema_version").await;
        assert_eq!(version, 4);
    }

    #[tokio::test]
    async fn records_query_visualization_and_affinity() {
        let store = make_test_store().await;
        record_query_event(
            QueryExecutedEvent {
                query_id: "q-1".to_string(),
                sql: "SELECT temperature FROM sensor_readings".to_string(),
                source_table: Some("sensor_readings".to_string()),
                source_tables: vec!["sensor_readings".to_string()],
                row_count: 42,
                duration_ms: 12,
                success: true,
                error_message: None,
                executed_at: "2026-04-24T00:00:00Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record query event");

        record_visualization_event(
            VisualizationViewedEvent {
                query_id: "q-1".to_string(),
                chart_type: "line".to_string(),
                column_count: 2,
                viewed_at: "2026-04-24T00:00:05Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record visualization");

        record_parameter_affinity(
            "conn-1",
            "sensor_readings",
            &["temperature".to_string(), "pressure".to_string()],
            &store,
        )
        .await
        .expect("record affinity");

        record_parameter_affinity(
            "conn-1",
            "sensor_readings",
            &["temperature".to_string()],
            &store,
        )
        .await
        .expect("record affinity again");

        let query_count = fetch_scalar_i64(store.pool(), "SELECT COUNT(*) FROM query_executed_events").await;
        let viz_count = fetch_scalar_i64(store.pool(), "SELECT COUNT(*) FROM visualization_viewed_events").await;
        let lineage_count = fetch_scalar_i64(store.pool(), "SELECT COUNT(*) FROM query_event_tables").await;
        let temp_hits = sqlx::query("SELECT hit_count FROM parameter_hotspots WHERE column_name = 'temperature'")
            .fetch_one(store.pool())
            .await
            .expect("fetch hotspot")
            .get::<i64, _>("hit_count");

        assert_eq!(query_count, 1);
        assert_eq!(viz_count, 1);
        assert_eq!(lineage_count, 1);
        assert_eq!(temp_hits, 2);
    }

    #[tokio::test]
    async fn migrates_legacy_benchmark_context_and_persists_benchmark() {
        let store = make_test_store().await;
        let context = benchmark_context_from_legacy_json(
            serde_json::json!({
                "db_path": "C:/data/demo.db",
                "row_count": 100,
                "column_count": 4,
                "table_name": "measurements",
                "notes": "legacy"
            }),
            "fallback_table",
        );

        record_benchmark_event(
            BenchmarkCapturedEvent {
                query_id: "q-legacy".to_string(),
                context,
                captured_at: "2026-04-24T01:00:00Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record benchmark");

        let row = sqlx::query("SELECT context_version, table_name, context_json FROM benchmarks WHERE query_id = 'q-legacy'")
            .fetch_one(store.pool())
            .await
            .expect("fetch benchmark");

        let context_version = row.get::<i64, _>("context_version");
        let table_name = row.get::<String, _>("table_name");
        let context_json = row.get::<String, _>("context_json");
        let parsed: BenchmarkContext = serde_json::from_str(&context_json).expect("deserialize benchmark context");

        assert_eq!(context_version, 1);
        assert_eq!(table_name, "measurements");
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.row_count, 100);
    }

    #[test]
    fn derives_affinity_candidates_from_single_table_select() {
        let analysis = analyze_query("SELECT public.alpha.temperature, pressure FROM public.alpha");
        let (table, columns) = affinity_candidates_from_analysis(&analysis).expect("single table candidates");
        assert_eq!(table, "public.alpha");
        assert!(columns.contains(&"temperature".to_string()));
        assert!(columns.contains(&"pressure".to_string()));
        assert_eq!(first_source_table(&analysis), Some("public.alpha".to_string()));
    }

    #[test]
    fn skips_affinity_candidates_for_multi_table_queries() {
        let analysis = analyze_query("SELECT a.id, b.value FROM a JOIN b ON a.id = b.a_id");
        assert!(affinity_candidates_from_analysis(&analysis).is_none());
        assert_eq!(first_source_table(&analysis), Some("a".to_string()));
    }

    #[tokio::test]
    async fn stores_normalized_multi_table_lineage() {
        let store = make_test_store().await;
        record_query_event(
            QueryExecutedEvent {
                query_id: "q-join".to_string(),
                sql: "SELECT a.id, b.value FROM a JOIN b ON a.id = b.a_id".to_string(),
                source_table: Some("a".to_string()),
                source_tables: vec!["a".to_string(), "b".to_string()],
                row_count: 5,
                duration_ms: 4,
                success: true,
                error_message: None,
                executed_at: "2026-04-24T02:00:00Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record multi-table query");

        let history = list_query_history_by_table("b", 10, &store)
            .await
            .expect("load query history");

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].source_tables, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn redacts_string_literals_before_storage() {
        let sql = "SELECT * FROM users WHERE email = 'user@example.com' AND token = 'abc123'";
        let redacted = redact_sql_for_storage(sql);
        assert!(redacted.contains("'[REDACTED]'"));
        assert!(!redacted.contains("user@example.com"));
        assert!(!redacted.contains("abc123"));
    }

    #[tokio::test]
    async fn records_security_audit_events() {
        let store = make_test_store().await;
        record_security_audit_event(
            SecurityAuditEvent {
                event_type: "policy_block".to_string(),
                outcome: "blocked".to_string(),
                details_json: serde_json::json!({
                    "reason": "read_only",
                    "connection_id": "conn-1"
                }),
                created_at: "2026-04-30T00:00:00Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record audit");

        let count = fetch_scalar_i64(store.pool(), "SELECT COUNT(*) FROM security_audit_events").await;
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn filters_and_lists_security_audit_dimensions() {
        let store = make_test_store().await;

        for (event_type, outcome) in [
            ("policy_block", "blocked"),
            ("approval", "approved"),
            ("approval", "rejected"),
        ] {
            record_security_audit_event(
                SecurityAuditEvent {
                    event_type: event_type.to_string(),
                    outcome: outcome.to_string(),
                    details_json: serde_json::json!({ "marker": outcome }),
                    created_at: format!("2026-05-01T00:00:0{}Z", if outcome == "blocked" { 1 } else if outcome == "approved" { 2 } else { 3 }),
                },
                &store,
            )
            .await
            .expect("record audit");
        }

        let filtered = list_recent_security_audit_events(Some("approval"), Some("approved"), 10, &store)
            .await
            .expect("filter audit");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].event_type, "approval");
        assert_eq!(filtered[0].outcome, "approved");

        let event_types = list_security_audit_event_types(&store)
            .await
            .expect("list event types");
        let outcomes = list_security_audit_outcomes(&store)
            .await
            .expect("list outcomes");

        assert_eq!(event_types, vec!["approval".to_string(), "policy_block".to_string()]);
        assert_eq!(outcomes, vec!["approved".to_string(), "blocked".to_string(), "rejected".to_string()]);
    }

    #[tokio::test]
    async fn lists_and_clears_local_data_scopes() {
        let store = make_test_store().await;

        record_query_event(
            QueryExecutedEvent {
                query_id: "q-clear".to_string(),
                sql: "SELECT * FROM users WHERE email = 'user@example.com'".to_string(),
                source_table: Some("users".to_string()),
                source_tables: vec!["users".to_string()],
                row_count: 1,
                duration_ms: 5,
                success: true,
                error_message: None,
                executed_at: "2026-05-01T00:00:00Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record query");

        record_visualization_event(
            VisualizationViewedEvent {
                query_id: "q-clear".to_string(),
                chart_type: "bar".to_string(),
                column_count: 2,
                viewed_at: "2026-05-01T00:00:01Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record visualization");

        record_benchmark_event(
            BenchmarkCapturedEvent {
                query_id: "q-clear".to_string(),
                context: BenchmarkContext {
                    version: 1,
                    db_path: "C:/demo.db".to_string(),
                    row_count: 10,
                    column_count: 2,
                    table_name: "users".to_string(),
                    notes: None,
                },
                captured_at: "2026-05-01T00:00:02Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record benchmark");

        record_parameter_affinity(
            "conn-clear",
            "users",
            &["email".to_string()],
            &store,
        )
        .await
        .expect("record affinity");

        record_security_audit_event(
            SecurityAuditEvent {
                event_type: "policy_block".to_string(),
                outcome: "blocked".to_string(),
                details_json: serde_json::json!({ "reason": "test" }),
                created_at: "2026-05-01T00:00:03Z".to_string(),
            },
            &store,
        )
        .await
        .expect("record audit");

        let audit = list_recent_security_audit_events(None, None, 10, &store)
            .await
            .expect("list audit");
        assert_eq!(audit.len(), 1);

        let stats = get_local_data_stats(&store).await.expect("get stats");
        assert_eq!(stats.query_history_count, 1);
        assert_eq!(stats.visualization_count, 1);
        assert_eq!(stats.benchmark_count, 1);
        assert_eq!(stats.hotspot_count, 1);
        assert_eq!(stats.security_audit_count, 1);

        clear_local_data("all", &store).await.expect("clear local data");

        let cleared = get_local_data_stats(&store).await.expect("get cleared stats");
        assert_eq!(cleared.query_history_count, 0);
        assert_eq!(cleared.visualization_count, 0);
        assert_eq!(cleared.benchmark_count, 0);
        assert_eq!(cleared.hotspot_count, 0);
        assert_eq!(cleared.security_audit_count, 0);
    }
}
