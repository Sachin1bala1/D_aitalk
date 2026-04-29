pub mod commands;
pub mod db;
pub mod error;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use commands::AppState;
use db::connection_manager::ConnectionManager;
use db::duckdb_engine::DuckDbEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let duckdb = DuckDbEngine::new().expect("DuckDB init failed");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            connections: Arc::new(ConnectionManager::new()),
            duckdb: Arc::new(duckdb),
            cancelled_queries: Arc::new(Mutex::new(HashSet::new())),
            memory_db: Arc::new(tokio::sync::Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::db_connect,
            commands::db_disconnect,
            commands::db_list_connections,
            commands::db_ping,
            commands::db_get_schema,
            commands::db_execute_streaming,
            commands::db_execute,
            commands::db_cancel_query,
            commands::db_add_column,
            commands::duckdb_query,
            commands::duckdb_load_parquet,
            commands::duckdb_load_csv,
            commands::duckdb_list_views,
            commands::db_get_table_ddl,
            commands::save_connections,
            commands::load_connections,
            commands::store_api_key,
            commands::get_api_key,
            commands::delete_api_key,
            commands::init_memory_db,
            commands::memory_insert_episode,
            commands::memory_get_episodes,
            commands::memory_get_calibration,
            commands::memory_update_calibration,
            commands::memory_clear_episodes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
