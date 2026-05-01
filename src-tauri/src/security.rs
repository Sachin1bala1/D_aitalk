use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::db::types::ConnectionConfig;
use crate::intelligence::sql_analyzer::{analyze_query, StatementType};

const API_KEY_PREFIX: &str = "daitalk_";
const MAX_GLOBAL_IN_FLIGHT_QUERIES: usize = 6;
const MAX_PER_CONNECTION_IN_FLIGHT_QUERIES: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationKind {
    ReadQuery,
    DataMutation,
    SchemaMutation,
    SecretAccess,
    LocalFileAccess,
}

#[derive(Default)]
pub struct QueryGuardState {
    total_in_flight: usize,
    per_connection: HashMap<String, usize>,
}

pub type SharedQueryGuardState = Arc<Mutex<QueryGuardState>>;

pub struct QueryPermit {
    state: SharedQueryGuardState,
    connection_id: String,
}

impl Drop for QueryPermit {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.state.lock() {
            guard.total_in_flight = guard.total_in_flight.saturating_sub(1);
            if let Some(count) = guard.per_connection.get_mut(&self.connection_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    guard.per_connection.remove(&self.connection_id);
                }
            }
        }
    }
}

pub fn acquire_query_permit(
    state: &SharedQueryGuardState,
    connection_id: &str,
) -> Result<QueryPermit, String> {
    let mut guard = state.lock().map_err(|_| "query guard lock poisoned".to_string())?;
    let per_connection = *guard.per_connection.get(connection_id).unwrap_or(&0);

    if guard.total_in_flight >= MAX_GLOBAL_IN_FLIGHT_QUERIES {
        return Err("Too many concurrent queries. Wait for running queries to finish.".to_string());
    }
    if per_connection >= MAX_PER_CONNECTION_IN_FLIGHT_QUERIES {
        return Err(format!(
            "Connection {connection_id} already has too many concurrent queries."
        ));
    }

    guard.total_in_flight += 1;
    *guard
        .per_connection
        .entry(connection_id.to_string())
        .or_insert(0) += 1;

    Ok(QueryPermit {
        state: Arc::clone(state),
        connection_id: connection_id.to_string(),
    })
}

pub fn classify_sql_operation(sql: &str) -> OperationKind {
    let analysis = analyze_query(sql);
    match analysis.statement_type {
        StatementType::Select => OperationKind::ReadQuery,
        StatementType::Insert | StatementType::Update | StatementType::Delete => {
            OperationKind::DataMutation
        }
        StatementType::Ddl => OperationKind::SchemaMutation,
        StatementType::Other => fallback_operation_kind(sql),
    }
}

fn fallback_operation_kind(sql: &str) -> OperationKind {
    let first_token = sql
        .trim_start()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|c: char| c == '(' || c == ';')
        .to_ascii_uppercase();

    match first_token.as_str() {
        "SELECT" | "WITH" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "PRAGMA" => {
            OperationKind::ReadQuery
        }
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE" | "TRUNCATE" => {
            OperationKind::DataMutation
        }
        "ALTER" | "DROP" | "CREATE" | "RENAME" => OperationKind::SchemaMutation,
        _ => OperationKind::ReadQuery,
    }
}

pub fn enforce_connection_policy(
    config: &ConnectionConfig,
    operation: OperationKind,
) -> Result<(), String> {
    if config.read_only && matches!(operation, OperationKind::DataMutation | OperationKind::SchemaMutation) {
        return Err(format!(
            "Connection {} is read-only. Mutating operations are blocked.",
            config.display_name
        ));
    }
    Ok(())
}

pub fn validate_secret_service(service: &str) -> Result<(), String> {
    if service.starts_with(API_KEY_PREFIX) {
        Ok(())
    } else {
        Err("Secret access denied for unsupported service name".to_string())
    }
}

pub fn validate_local_import_path(path: &str, allowed_extensions: &[&str]) -> Result<(), String> {
    let resolved = Path::new(path);
    if !resolved.exists() {
        return Err(format!("Local file not found: {path}"));
    }
    if !resolved.is_file() {
        return Err(format!("Local path is not a file: {path}"));
    }

    let extension = resolved
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();

    if allowed_extensions
        .iter()
        .any(|allowed| extension == allowed.trim_start_matches('.').to_ascii_lowercase())
    {
        Ok(())
    } else {
        Err(format!(
            "Local file type .{} is not allowed for this operation",
            extension
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_query_permit, classify_sql_operation, enforce_connection_policy, OperationKind,
        QueryGuardState,
    };
    use crate::db::types::{ConnectionConfig, DbDriver};
    use std::sync::{Arc, Mutex};

    fn make_config(read_only: bool) -> ConnectionConfig {
        ConnectionConfig {
            id: "conn-1".to_string(),
            display_name: "Demo".to_string(),
            driver: DbDriver::Postgres,
            connection_string: "postgresql://user:pass@localhost/demo".to_string(),
            pool_min: Some(1),
            pool_max: Some(4),
            ssh: None,
            read_only,
        }
    }

    #[test]
    fn classifies_common_sql_operations() {
        assert_eq!(classify_sql_operation("SELECT * FROM demo"), OperationKind::ReadQuery);
        assert_eq!(classify_sql_operation("UPDATE demo SET value = 1"), OperationKind::DataMutation);
        assert_eq!(classify_sql_operation("ALTER TABLE demo ADD COLUMN x int"), OperationKind::SchemaMutation);
        assert_eq!(classify_sql_operation("EXPLAIN SELECT 1"), OperationKind::ReadQuery);
    }

    #[test]
    fn blocks_mutations_on_read_only_connections() {
        let config = make_config(true);
        assert!(enforce_connection_policy(&config, OperationKind::ReadQuery).is_ok());
        assert!(enforce_connection_policy(&config, OperationKind::DataMutation).is_err());
        assert!(enforce_connection_policy(&config, OperationKind::SchemaMutation).is_err());
    }

    #[test]
    fn enforces_query_guard_limits() {
        let state = Arc::new(Mutex::new(QueryGuardState::default()));
        let mut permits = Vec::new();
        for _ in 0..2 {
            permits.push(acquire_query_permit(&state, "conn-1").expect("permit"));
        }
        assert!(acquire_query_permit(&state, "conn-1").is_err());
        drop(permits);
        assert!(acquire_query_permit(&state, "conn-1").is_ok());
    }
}
