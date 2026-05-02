use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryExecutedEvent {
    pub query_id: String,
    pub sql: String,
    pub source_table: Option<String>,
    pub source_tables: Vec<String>,
    pub row_count: u64,
    pub duration_ms: u64,
    pub success: bool,
    pub error_message: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisualizationViewedEvent {
    pub query_id: String,
    pub chart_type: String,
    pub column_count: u64,
    pub viewed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkCapturedEvent {
    pub query_id: String,
    pub context: BenchmarkContext,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkContext {
    pub version: u8,
    pub db_path: String,
    pub row_count: u64,
    pub column_count: u64,
    pub table_name: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterHotspotRecord {
    pub connection_id: String,
    pub table_name: String,
    pub column_name: String,
    pub hit_count: u64,
    pub last_observed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkRecord {
    pub query_id: String,
    pub context: BenchmarkContext,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryRecord {
    pub query_id: String,
    pub sql: String,
    pub source_table: Option<String>,
    pub source_tables: Vec<String>,
    pub row_count: u64,
    pub duration_ms: u64,
    pub success: bool,
    pub error_message: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAuditEvent {
    pub event_type: String,
    pub outcome: String,
    pub details_json: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAuditRecord {
    pub id: i64,
    pub event_type: String,
    pub outcome: String,
    pub details_json: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDataStats {
    pub query_history_count: u64,
    pub visualization_count: u64,
    pub benchmark_count: u64,
    pub hotspot_count: u64,
    pub security_audit_count: u64,
}
