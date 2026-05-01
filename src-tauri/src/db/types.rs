use serde::{Deserialize, Serialize};

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub type_name: String,
    pub display_type: DisplayType,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DisplayType {
    Integer,
    Float,
    Text,
    Boolean,
    Timestamp,
    Date,
    Duration,
    Json,
    Bytes,
    SensorId,
    Unit { unit: String },
    Unknown,
}

impl DisplayType {
    pub fn from_pg_type(type_name: &str) -> Self {
        match type_name.to_lowercase().as_str() {
            "int2" | "int4" | "int8" | "integer" | "bigint" | "smallint" => Self::Integer,
            "float4" | "float8" | "numeric" | "decimal" | "real" | "double precision" => Self::Float,
            "bool" | "boolean" => Self::Boolean,
            "timestamp" | "timestamptz" | "timestamp with time zone" | "timestamp without time zone" => Self::Timestamp,
            "date" => Self::Date,
            "interval" => Self::Duration,
            "json" | "jsonb" => Self::Json,
            "bytea" => Self::Bytes,
            _ => Self::Text,
        }
    }

    pub fn from_mysql_type(type_name: &str) -> Self {
        let lower = type_name.to_lowercase();
        if lower.contains("int") { return Self::Integer; }
        if lower.contains("float") || lower.contains("double") || lower.contains("decimal") { return Self::Float; }
        if lower.contains("datetime") || lower.contains("timestamp") { return Self::Timestamp; }
        if lower.contains("date") { return Self::Date; }
        if lower.contains("bool") { return Self::Boolean; }
        if lower.contains("json") { return Self::Json; }
        if lower.contains("blob") || lower.contains("binary") { return Self::Bytes; }
        Self::Text
    }

    #[allow(dead_code)]
    pub fn from_mssql_type(type_name: &str) -> Self {
        let lower = type_name.to_lowercase();
        if ["bigint","int","smallint","tinyint"].iter().any(|t| lower == *t) { return Self::Integer; }
        if ["float","real","decimal","numeric","money","smallmoney"].iter().any(|t| lower == *t) { return Self::Float; }
        if lower.contains("datetime") || lower == "date" && lower.contains("time") { return Self::Timestamp; }
        if lower == "date" { return Self::Date; }
        if lower == "bit" { return Self::Boolean; }
        if lower.contains("binary") || lower == "image" { return Self::Bytes; }
        Self::Text
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    pub row_estimate: Option<i64>,
    pub size_bytes: Option<i64>,
    pub object_type: TableObjectType,
    #[serde(default)]
    pub is_hypertable: bool,
    #[serde(default)]
    pub hypertable_chunks: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableObjectType {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKey {
    pub constraint_name: String,
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMeta {
    pub index_name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

/// A stored function or procedure in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionMeta {
    pub schema: String,
    pub name: String,
    pub return_type: String,
    pub kind: FunctionKind,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FunctionKind {
    Function,
    Procedure,
    Aggregate,
    Trigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSchema {
    pub connection_id: String,
    pub driver: String,
    pub tables: Vec<TableMeta>,
    pub columns: std::collections::HashMap<String, Vec<ColumnMeta>>,
    pub foreign_keys: Vec<ForeignKey>,
    pub indexes: Vec<IndexMeta>,
    /// "schema.table" keys that are TimescaleDB hypertables (for sidebar badge)
    #[serde(default)]
    pub hypertable_tables: Vec<String>,
    /// Stored functions and procedures
    #[serde(default)]
    pub functions: Vec<FunctionMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryBatch {
    pub query_id: String,
    pub batch_index: u32,
    pub rows: Vec<serde_json::Value>,
    pub columns: Option<Vec<ColumnMeta>>,
    pub is_final: bool,
    pub total_elapsed_ms: u64,
    pub rows_so_far: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    Key { key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub display_name: String,
    pub driver: DbDriver,
    pub connection_string: String,
    pub pool_min: Option<u32>,
    pub pool_max: Option<u32>,
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub pi_config: Option<PIConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DbDriver {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Mariadb,
    Timescaledb,
    // Phase 6 NoSQL (connection returns error until tiberius/drivers added):
    #[serde(rename = "mongodb")]
    MongoDB,
    Redis,
    ClickHouse,
    PIHistorian,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PIConfig {
    pub base_url: String,
    pub username: String,
    pub password: String,
    #[serde(default = "default_true")]
    pub verify_ssl: bool,
}
