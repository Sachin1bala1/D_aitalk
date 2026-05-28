use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::db::connection_manager::ConnectionManager;
use crate::db::duckdb_engine::DuckDbEngine;
use crate::security::SharedQueryGuardState;

pub type CancelSet = Arc<Mutex<HashSet<String>>>;

pub struct AppState {
    pub connections: Arc<ConnectionManager>,
    pub duckdb: Arc<DuckDbEngine>,
    pub cancelled_queries: CancelSet,
    pub query_guards: SharedQueryGuardState,
    pub memory_db: Arc<tokio::sync::Mutex<Option<sqlx::SqlitePool>>>,
    pub query_cache: crate::db::query_cache::QueryCache,
}
