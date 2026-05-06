use tauri::State;
use uuid::Uuid;

use crate::intelligence::events::{
    BenchmarkCapturedEvent, BenchmarkContext, LocalDataStats, SecurityAuditEvent,
    SecurityAuditRecord, VisualizationViewedEvent,
};
use crate::intelligence::store::{
    benchmark_context_from_legacy_json, clear_local_data, get_local_data_stats,
    list_parameter_hotspots, list_query_history_by_table, list_recent_benchmarks,
    list_recent_security_audit_events, list_security_audit_event_types,
    list_security_audit_outcomes, record_benchmark_event, record_parameter_affinity,
    record_security_audit_event, record_visualization_event, IntelligenceStore,
};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct LegacyParameterObservation {
    pub table_name: Option<String>,
    pub column_name: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct LegacyBenchmarkInput {
    pub parameter_name: String,
    pub metric_type: String,
    pub metric_value: f64,
    pub context_json: serde_json::Value,
    #[serde(default)]
    pub query_id: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct HotspotQuery {
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub table_name: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct BenchmarkQuery {
    #[serde(default)]
    pub table_name: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct QueryHistoryQuery {
    pub table_name: String,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SecurityAuditInput {
    pub event_type: String,
    pub outcome: String,
    #[serde(default)]
    pub details_json: serde_json::Value,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SecurityAuditQuery {
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ClearLocalDataInput {
    pub scope: String,
}

fn default_limit() -> u32 {
    50
}

#[tauri::command]
pub async fn db_update_parameter_affinity(
    connection_id: String,
    parameters: Vec<LegacyParameterObservation>,
    store: State<'_, IntelligenceStore>,
) -> Result<(), String> {
    let mut grouped = std::collections::BTreeMap::<String, Vec<String>>::new();
    for parameter in parameters {
        if let Some(table_name) = parameter.table_name {
            grouped.entry(table_name).or_default().push(parameter.column_name);
        }
    }

    for (table_name, columns) in grouped {
        record_parameter_affinity(&connection_id, &table_name, &columns, store.inner()).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_save_benchmark(
    benchmark: LegacyBenchmarkInput,
    store: State<'_, IntelligenceStore>,
) -> Result<(), String> {
    let raw_context = benchmark.context_json.clone();
    let context = benchmark_context_from_legacy_json(raw_context, &benchmark.parameter_name);
    let notes = match context.notes {
        Some(existing) => Some(format!(
            "{} | metric {}={}",
            existing, benchmark.metric_type, benchmark.metric_value
        )),
        None => Some(format!(
            "metric {}={} | parameter {}",
            benchmark.metric_type, benchmark.metric_value, benchmark.parameter_name
        )),
    };

    let event = BenchmarkCapturedEvent {
        query_id: benchmark
            .query_id
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        context: BenchmarkContext { notes, ..context },
        captured_at: chrono::Utc::now().to_rfc3339(),
    };

    record_benchmark_event(event, store.inner()).await
}

#[tauri::command]
pub async fn record_visualization_viewed(
    event: VisualizationViewedEvent,
    store: State<'_, IntelligenceStore>,
) -> Result<(), String> {
    record_visualization_event(event, store.inner()).await
}

#[tauri::command]
pub async fn record_security_audit(
    input: SecurityAuditInput,
    store: State<'_, IntelligenceStore>,
) -> Result<(), String> {
    record_security_audit_event(
        SecurityAuditEvent {
            event_type: input.event_type,
            outcome: input.outcome,
            details_json: input.details_json,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        store.inner(),
    )
    .await
}

#[tauri::command]
pub async fn db_get_parameter_hotspots(
    input: HotspotQuery,
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<crate::intelligence::events::ParameterHotspotRecord>, String> {
    list_parameter_hotspots(
        input.connection_id.as_deref(),
        input.table_name.as_deref(),
        input.limit,
        store.inner(),
    )
    .await
}

#[tauri::command]
pub async fn db_get_recent_benchmarks(
    input: BenchmarkQuery,
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<crate::intelligence::events::BenchmarkRecord>, String> {
    list_recent_benchmarks(input.table_name.as_deref(), input.limit, store.inner()).await
}

#[tauri::command]
pub async fn db_get_query_history(
    input: QueryHistoryQuery,
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<crate::intelligence::events::QueryHistoryRecord>, String> {
    list_query_history_by_table(&input.table_name, input.limit, store.inner()).await
}

#[tauri::command]
pub async fn db_get_security_audit(
    input: SecurityAuditQuery,
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<SecurityAuditRecord>, String> {
    list_recent_security_audit_events(
        input.event_type.as_deref(),
        input.outcome.as_deref(),
        input.limit,
        store.inner(),
    )
    .await
}

#[tauri::command]
pub async fn db_get_security_audit_event_types(
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<String>, String> {
    list_security_audit_event_types(store.inner()).await
}

#[tauri::command]
pub async fn db_get_security_audit_outcomes(
    store: State<'_, IntelligenceStore>,
) -> Result<Vec<String>, String> {
    list_security_audit_outcomes(store.inner()).await
}

#[tauri::command]
pub async fn db_get_local_data_stats(
    store: State<'_, IntelligenceStore>,
) -> Result<LocalDataStats, String> {
    get_local_data_stats(store.inner()).await
}

#[tauri::command]
pub async fn db_clear_local_data(
    input: ClearLocalDataInput,
    store: State<'_, IntelligenceStore>,
) -> Result<(), String> {
    clear_local_data(&input.scope, store.inner()).await
}
