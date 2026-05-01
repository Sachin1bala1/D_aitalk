/**
 * DuckDB embedded engine — STUB (bundled build disabled on Windows MinGW due to OOM).
 * Re-enable by uncommenting `duckdb` in Cargo.toml and restoring this file from git.
 *
 * All methods return DbError::Other so the app compiles and runs; DuckDB Tauri
 * commands will respond with an error message to the frontend.
 */
use tauri::AppHandle;

use crate::error::DbError;

pub struct DuckDbEngine;

impl DuckDbEngine {
    pub fn new() -> Result<Self, DbError> {
        Ok(Self)
    }

    pub fn query_streaming(
        &self,
        _sql: &str,
        _query_id: String,
        _app: &AppHandle,
    ) -> Result<(), DbError> {
        Err(DbError::Other(
            "DuckDB is not available in this build (bundled compile disabled on Windows MinGW). \
             Reconnect using a standard SQL driver."
                .to_string(),
        ))
    }

    pub fn load_parquet(&self, _path: &str, _table_name: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available in this build.".to_string()))
    }

    pub fn load_csv(&self, _path: &str, _table_name: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available in this build.".to_string()))
    }

    pub fn list_views(&self) -> Result<Vec<String>, DbError> {
        Ok(vec![])
    }
}
