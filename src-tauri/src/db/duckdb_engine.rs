use tauri::AppHandle;
use crate::error::DbError;
use tauri::Emitter;
use super::types::{QueryBatch, ColumnMeta};

/// DuckDB engine — full implementation ready; requires MSVC toolchain + VS Build Tools.
/// To enable:
///   1. Install VS Build Tools 2022 (with C++ workload and Windows SDK).
///   2. Switch .cargo/config.toml target to x86_64-pc-windows-msvc.
///   3. Uncomment `duckdb = ...` in Cargo.toml.
///   4. Replace this file with the full implementation from git history.
pub struct DuckDbEngine;

impl DuckDbEngine {
    pub fn new_in_memory() -> Self {
        Self
    }

    pub fn new_at_path(_path: &str) -> Result<Self, DbError> {
        Err(DbError::Other(
            "DuckDB not available: install VS Build Tools 2022 and enable MSVC toolchain".to_string(),
        ))
    }

    /// Load a CSV or Parquet file as a DuckDB view named after the file stem.
    pub fn register_file(&self, _file_path: &str) -> Result<String, DbError> {
        Err(DbError::Other(
            "DuckDB not available: install VS Build Tools 2022 and enable MSVC toolchain".to_string(),
        ))
    }

    pub fn query_streaming(
        &self,
        _sql: &str,
        query_id: String,
        app: &AppHandle,
    ) -> Result<(), DbError> {
        let batch = QueryBatch {
            query_id: query_id.clone(),
            batch_index: 0,
            columns: None,
            rows: vec![],
            rows_so_far: 0,
            is_final: true,
            error: Some(
                "DuckDB not available: install VS Build Tools 2022 and enable MSVC toolchain"
                    .to_string(),
            ),
            total_elapsed_ms: 0,
        };
        let _ = app.emit("query_batch", &batch);
        Ok(())
    }

    pub fn execute_batch(&self, _sql: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available".to_string()))
    }

    pub fn load_parquet(&self, _path: &str, _table_name: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available".to_string()))
    }

    pub fn load_csv(&self, _path: &str, _table_name: &str) -> Result<(), DbError> {
        Err(DbError::Other("DuckDB not available".to_string()))
    }

    pub fn list_views(&self) -> Result<Vec<String>, DbError> {
        Ok(vec![])
    }
}

// Suppress unused-import warning — ColumnMeta is used in the full implementation
// and must stay importable when this stub is active.
#[allow(dead_code)]
fn _assert_column_meta_importable(_: ColumnMeta) {}
