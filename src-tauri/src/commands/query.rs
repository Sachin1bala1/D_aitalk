use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::db::query_executor::{execute_ddl, execute_streaming};
use crate::db::types::ExecuteStreamingResponse;
use crate::intelligence::events::{QueryExecutedEvent, SecurityAuditEvent};
use crate::intelligence::sql_analyzer::analyze_query;
use crate::intelligence::store::{
    affinity_candidates_from_analysis, first_source_table, record_parameter_affinity,
    record_query_event, record_security_audit_event, IntelligenceStore,
};
use crate::security::{acquire_query_permit, classify_sql_operation, enforce_connection_policy};

use super::AppState;

async fn audit_policy_event(
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
        tracing::warn!("failed to record security audit event: {}", error);
    }
}

#[tauri::command]
pub async fn db_execute_streaming(
    connection_id: String,
    sql: String,
    query_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteStreamingResponse, String> {
    let qid = query_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let analysis = analyze_query(&sql);
    let config = state
        .connections
        .get_config(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;
    let operation = classify_sql_operation(&sql);

    if let Err(error) = enforce_connection_policy(&config, operation) {
        audit_policy_event(
            &app,
            "policy_block",
            "blocked",
            serde_json::json!({
                "connection_id": connection_id,
                "query_id": qid,
                "operation": format!("{operation:?}"),
                "reason": "read_only_policy",
                "sql": sql,
            }),
        )
        .await;
        return Err(error);
    }

    let permit = match acquire_query_permit(&state.query_guards, &connection_id) {
        Ok(permit) => permit,
        Err(error) => {
            audit_policy_event(
                &app,
                "rate_limit",
                "blocked",
                serde_json::json!({
                    "connection_id": connection_id,
                    "query_id": qid,
                    "reason": "too_many_concurrent_queries",
                    "sql": sql,
                }),
            )
            .await;
            return Err(error);
        }
    };

    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    let qid_clone = qid.clone();
    let cancelled = state.cancelled_queries.clone();
    let app_clone = app.clone();
    let connection_id_clone = connection_id.clone();
    let analysis_clone = analysis.clone();
    let sql_clone = sql.clone();

    tokio::spawn(async move {
        let _permit = permit;
        match execute_streaming(conn, sql, qid_clone.clone(), app_clone.clone(), cancelled).await {
            Ok(()) => {
                let store = app_clone.state::<IntelligenceStore>();
                let event = QueryExecutedEvent {
                    query_id: qid_clone.clone(),
                    sql: sql_clone.clone(),
                    source_table: first_source_table(&analysis_clone),
                    source_tables: analysis_clone.source_tables.clone(),
                    row_count: 0,
                    duration_ms: 0,
                    success: true,
                    error_message: None,
                    executed_at: chrono::Utc::now().to_rfc3339(),
                };

                if let Err(error) = record_query_event(event, store.inner()).await {
                    tracing::warn!("failed to record query event: {}", error);
                }

                if let Some((source_table, columns)) =
                    affinity_candidates_from_analysis(&analysis_clone)
                {
                    if let Err(error) = record_parameter_affinity(
                        &connection_id_clone,
                        &source_table,
                        &columns,
                        store.inner(),
                    )
                    .await
                    {
                        tracing::warn!("failed to update parameter hotspots: {}", error);
                    }
                }
            }
            Err(error) => {
                let message = error.to_string();
                let store = app_clone.state::<IntelligenceStore>();
                let event = QueryExecutedEvent {
                    query_id: qid_clone.clone(),
                    sql: sql_clone.clone(),
                    source_table: first_source_table(&analysis_clone),
                    source_tables: analysis_clone.source_tables.clone(),
                    row_count: 0,
                    duration_ms: 0,
                    success: false,
                    error_message: Some(message.clone()),
                    executed_at: chrono::Utc::now().to_rfc3339(),
                };
                if let Err(record_err) = record_query_event(event, store.inner()).await {
                    tracing::warn!("failed to record failed query event: {}", record_err);
                }

                if message == "Query cancelled" {
                    return;
                }

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
                        error: Some(message),
                    },
                );
            }
        }
    });

    Ok(ExecuteStreamingResponse {
        query_id: qid,
        source_tables: analysis.source_tables,
    })
}

#[tauri::command]
pub async fn db_execute(
    connection_id: String,
    sql: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let config = state
        .connections
        .get_config(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;
    let operation = classify_sql_operation(&sql);

    if let Err(error) = enforce_connection_policy(&config, operation) {
        audit_policy_event(
            &app,
            "policy_block",
            "blocked",
            serde_json::json!({
                "connection_id": connection_id,
                "operation": format!("{operation:?}"),
                "reason": "read_only_policy",
                "sql": sql,
            }),
        )
        .await;
        return Err(error);
    }

    let _permit = match acquire_query_permit(&state.query_guards, &connection_id) {
        Ok(permit) => permit,
        Err(error) => {
            audit_policy_event(
                &app,
                "rate_limit",
                "blocked",
                serde_json::json!({
                    "connection_id": connection_id,
                    "reason": "too_many_concurrent_queries",
                    "sql": sql,
                }),
            )
            .await;
            return Err(error);
        }
    };

    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    match execute_ddl(conn, &sql).await {
        Ok(affected_rows) => {
            if matches!(
                operation,
                crate::security::OperationKind::DataMutation
                    | crate::security::OperationKind::SchemaMutation
            ) {
                audit_policy_event(
                    &app,
                    "db_mutation",
                    "executed",
                    serde_json::json!({
                        "connection_id": connection_id,
                        "operation": format!("{operation:?}"),
                        "affected_rows": affected_rows,
                        "sql": sql,
                    }),
                )
                .await;
            }
            Ok(affected_rows)
        }
        Err(error) => {
            if matches!(
                operation,
                crate::security::OperationKind::DataMutation
                    | crate::security::OperationKind::SchemaMutation
            ) {
                audit_policy_event(
                    &app,
                    "db_mutation",
                    "failed",
                    serde_json::json!({
                        "connection_id": connection_id,
                        "operation": format!("{operation:?}"),
                        "sql": sql,
                        "error": error.to_string(),
                    }),
                )
                .await;
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn db_cancel_query(
    query_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.cancelled_queries.lock().unwrap().insert(query_id);
    Ok(())
}

#[tauri::command]
pub async fn get_query_concurrency_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let guard = state
        .query_guards
        .lock()
        .map_err(|_| "query guard lock poisoned".to_string())?;

    Ok(serde_json::json!({
        "total_in_flight": guard.total_in_flight(),
        "max_global": crate::security::max_global_in_flight_queries(),
        "per_connection": guard.per_connection_counts(),
    }))
}
