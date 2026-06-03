use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::intelligence::events::SecurityAuditEvent;
use crate::intelligence::store::{record_security_audit_event, IntelligenceStore};
use crate::security::{acquire_query_permit, validate_local_import_path};

use super::AppState;

async fn audit_duckdb_event(
    app: &AppHandle,
    event_type: &str,
    outcome: &str,
    details_json: serde_json::Value,
) {
    let store = app.state::<IntelligenceStore>();
    if let Err(error) = record_security_audit_event(
        SecurityAuditEvent {
            event_type: event_type.to_string(),
            outcome: outcome.to_string(),
            details_json,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        store.inner(),
    )
    .await
    {
        tracing::warn!("failed to record duckdb audit event: {}", error);
    }
}

#[tauri::command]
pub async fn duckdb_query(
    sql: String,
    query_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let qid = query_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let duck = state.duckdb.clone();
    let permit = match acquire_query_permit(&state.query_guards, "__duckdb__") {
        Ok(permit) => permit,
        Err(error) => {
            audit_duckdb_event(
                &app,
                "rate_limit",
                "blocked",
                serde_json::json!({
                    "engine": "duckdb",
                    "reason": "too_many_concurrent_queries",
                    "sql": sql,
                }),
            )
            .await;
            return Err(error);
        }
    };
    let qid_clone = qid.clone();
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if let Err(e) = duck.query_streaming(&sql, qid_clone.clone(), &app_clone) {
            let _ = app_clone.emit(
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
    Ok(qid)
}

#[tauri::command]
pub async fn duckdb_load_parquet(
    path: String,
    table_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Err(error) = validate_local_import_path(&path, &["parquet", "pq"]) {
        audit_duckdb_event(
            &app,
            "local_file_access",
            "blocked",
            serde_json::json!({
                "engine": "duckdb",
                "path": path,
                "table_name": table_name,
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.load_parquet(&path, &table_name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn duckdb_load_csv(
    path: String,
    table_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Err(error) = validate_local_import_path(&path, &["csv"]) {
        audit_duckdb_event(
            &app,
            "local_file_access",
            "blocked",
            serde_json::json!({
                "engine": "duckdb",
                "path": path,
                "table_name": table_name,
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.load_csv(&path, &table_name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

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

#[tauri::command]
pub async fn register_file_with_duckdb(
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.register_file(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_duckdb_views(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let duck = state.duckdb.clone();
    tokio::task::spawn_blocking(move || duck.list_views())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
