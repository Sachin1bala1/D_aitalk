pub mod commands;
pub mod db;
pub mod error;
pub mod intelligence;
pub mod security;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use commands::AppState;
use db::connection_manager::ConnectionManager;
use db::duckdb_engine::DuckDbEngine;
use intelligence::store::IntelligenceStore;
use tauri::Manager;

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
            query_guards: Arc::new(Mutex::new(security::QueryGuardState::default())),
            memory_db: Arc::new(tokio::sync::Mutex::new(None)),
        })
        .setup(|app| {
            let store =
                tauri::async_runtime::block_on(IntelligenceStore::initialize(&app.handle()))?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::db_connect,
            commands::db_disconnect,
            commands::db_list_connections,
            commands::db_ping,
            commands::db_get_schema,
            commands::db_build_effective_sql,
            commands::db_execute_streaming,
            commands::db_execute,
            commands::db_cancel_query,
            commands::get_query_concurrency_status,
            commands::db_add_column,
            commands::duckdb_query,
            commands::duckdb_load_parquet,
            commands::duckdb_load_csv,
            commands::duckdb_list_views,
            commands::db_get_table_ddl,
            commands::db_update_parameter_affinity,
            commands::db_save_benchmark,
            commands::record_visualization_viewed,
            commands::record_security_audit,
            commands::db_get_parameter_hotspots,
            commands::db_get_recent_benchmarks,
            commands::db_get_query_history,
            commands::db_get_security_audit,
            commands::db_get_security_audit_event_types,
            commands::db_get_security_audit_outcomes,
            commands::db_get_local_data_stats,
            commands::db_clear_local_data,
            commands::save_connections,
            commands::load_connections,
            commands::store_api_key,
            commands::get_api_key,
            commands::delete_api_key,
            commands::save_credential,
            commands::get_credential,
            commands::delete_credential,
            commands::init_memory_db,
            commands::memory_insert_episode,
            commands::memory_get_episodes,
            commands::memory_get_calibration,
            commands::memory_update_calibration,
            commands::memory_clear_episodes,
            commands::pi_search_tags,
            commands::pi_get_history,
            commands::pi_get_current,
            commands::pi_test_connection,
            commands::activate_license,
            commands::check_license,
            commands::remove_license,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
