/**
 * DuckDB embedded engine — STUB (bundled build disabled on Windows MinGW due to vtable linker errors).
 * To enable: install the MSVC Rust toolchain (`rustup target add x86_64-pc-windows-msvc`),
 * uncomment `duckdb` in Cargo.toml, and restore the full implementation from git history.
 *
 * All methods return DbError::Other so the app compiles and runs; DuckDB connections
 * will respond with a clear error message to the frontend.
 */
use tauri::AppHandle;
use crate::error::DbError;

pub struct DuckDbEngine;

impl DuckDbEngine {
    pub fn new_in_memory() -> Self {
        DuckDbEngine
    }

    pub fn new_at_path(_path: &str) -> Result<Self, DbError> {
        Err(DbError::Other(
            "DuckDB is not available in this build (bundled compile requires MSVC toolchain on Windows). \
             To enable: run `rustup target add x86_64-pc-windows-msvc`, uncomment duckdb in Cargo.toml, \
             and restore the full engine from git history."
                .to_string(),
        ))
    }

    pub fn query_streaming(
        &self,
        _sql: &str,
        _query_id: String,
        _app: &AppHandle,
    ) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available in this build.".to_string()))
    }

    pub fn execute_batch(&self, _sql: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available in this build.".to_string()))
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
