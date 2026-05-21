use duckdb::params;
use tauri::AppHandle;
use tauri::Emitter;
use serde_json::{Value, Map};
use std::sync::Arc;
use std::time::Instant;

use crate::db::types::{ColumnMeta, DisplayType, QueryBatch};
use crate::error::DbError;

pub struct DuckDbEngine {
    conn: Arc<std::sync::Mutex<duckdb::Connection>>,
}

impl DuckDbEngine {
    /// Open DuckDB at a file path, or ":memory:" for an in-memory database.
    pub fn new_at_path(path: &str) -> Result<Self, DbError> {
        let conn = if path == ":memory:" || path.is_empty() {
            duckdb::Connection::open_in_memory()
        } else {
            duckdb::Connection::open(path)
        }
        .map_err(|e| DbError::Other(format!("DuckDB open: {e}")))?;

        Ok(Self { conn: Arc::new(std::sync::Mutex::new(conn)) })
    }

    /// Legacy constructor — opens an in-memory database.
    pub fn new() -> Result<Self, DbError> {
        Self::new_at_path(":memory:")
    }

    /// Stream query results in 500-row batches, emitting "query_batch" events.
    pub fn query_streaming(
        &self,
        sql: &str,
        query_id: String,
        app: &AppHandle,
    ) -> Result<(), DbError> {
        let start = Instant::now();
        let conn = self.conn.lock().map_err(|e| DbError::Other(e.to_string()))?;
        let mut stmt = conn.prepare(sql)
            .map_err(|e| DbError::Other(format!("DuckDB prepare: {e}")))?;

        let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let column_count = column_names.len();

        let columns: Vec<ColumnMeta> = column_names.iter().map(|name| ColumnMeta {
            name: name.clone(),
            type_name: "text".to_string(),
            display_type: DisplayType::Text,
            nullable: true,
            is_primary_key: false,
        }).collect();

        // Emit column metadata first
        app.emit("query_batch", QueryBatch {
            query_id: query_id.clone(),
            batch_index: 0,
            rows: vec![],
            columns: Some(columns.clone()),
            is_final: false,
            total_elapsed_ms: 0,
            rows_so_far: 0,
            error: None,
        }).map_err(|e| DbError::Other(e.to_string()))?;

        let rows_iter = stmt.query_map(params![], |row| {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let v: Value = row.get::<_, duckdb::types::Value>(i)
                    .map(duck_to_json)
                    .unwrap_or(Value::Null);
                values.push(v);
            }
            Ok(values)
        }).map_err(|e| DbError::Other(format!("DuckDB query: {e}")))?;

        const BATCH_SIZE: usize = 500;
        let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
        let mut batch_index: u32 = 0;
        let mut total_rows: u64 = 0;

        for row_result in rows_iter {
            let values = row_result.map_err(|e| DbError::Other(e.to_string()))?;
            let mut obj = Map::new();
            for (i, col) in column_names.iter().enumerate() {
                obj.insert(col.clone(), values.get(i).cloned().unwrap_or(Value::Null));
            }
            batch.push(Value::Object(obj));
            total_rows += 1;

            if batch.len() >= BATCH_SIZE {
                batch_index += 1;
                app.emit("query_batch", QueryBatch {
                    query_id: query_id.clone(),
                    batch_index,
                    rows: std::mem::replace(&mut batch, Vec::with_capacity(BATCH_SIZE)),
                    columns: None,
                    is_final: false,
                    total_elapsed_ms: start.elapsed().as_millis() as u64,
                    rows_so_far: total_rows,
                    error: None,
                }).map_err(|e| DbError::Other(e.to_string()))?;
            }
        }

        // Emit final (possibly partial) batch
        batch_index += 1;
        app.emit("query_batch", QueryBatch {
            query_id,
            batch_index,
            rows: batch,
            columns: None,
            is_final: true,
            total_elapsed_ms: start.elapsed().as_millis() as u64,
            rows_so_far: total_rows,
            error: None,
        }).map_err(|e| DbError::Other(e.to_string()))?;

        Ok(())
    }

    /// Load a CSV file as a virtual table named `table_name`.
    pub fn load_csv(&self, path: &str, table_name: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|e| DbError::Other(e.to_string()))?;
        let sql = format!(
            "CREATE OR REPLACE VIEW \"{table_name}\" AS SELECT * FROM read_csv_auto('{path}')"
        );
        conn.execute_batch(&sql)
            .map_err(|e| DbError::Other(format!("DuckDB load_csv: {e}")))?;
        Ok(())
    }

    /// Load a Parquet file as a virtual table named `table_name`.
    pub fn load_parquet(&self, path: &str, table_name: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|e| DbError::Other(e.to_string()))?;
        let sql = format!(
            "CREATE OR REPLACE VIEW \"{table_name}\" AS SELECT * FROM read_parquet('{path}')"
        );
        conn.execute_batch(&sql)
            .map_err(|e| DbError::Other(format!("DuckDB load_parquet: {e}")))?;
        Ok(())
    }

    /// List all views (virtual tables from loaded files).
    pub fn list_views(&self) -> Result<Vec<String>, DbError> {
        let conn = self.conn.lock().map_err(|e| DbError::Other(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT table_name FROM information_schema.tables WHERE table_type = 'VIEW'"
        ).map_err(|e| DbError::Other(e.to_string()))?;
        let names = stmt.query_map(params![], |row| row.get::<_, String>(0))
            .map_err(|e| DbError::Other(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(names)
    }

    /// Execute a SQL batch statement (DDL/DML). Returns Ok(()) on success.
    pub fn execute_batch(&self, sql: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|e| DbError::Other(e.to_string()))?;
        conn.execute_batch(sql)
            .map_err(|e| DbError::Other(format!("DuckDB execute_batch: {e}")))?;
        Ok(())
    }
}

fn duck_to_json(v: duckdb::types::Value) -> Value {
    use duckdb::types::Value::*;
    match v {
        Null => Value::Null,
        Boolean(b) => Value::Bool(b),
        TinyInt(n) => Value::from(n),
        SmallInt(n) => Value::from(n),
        Int(n) => Value::from(n),
        BigInt(n) => Value::from(n),
        HugeInt(n) => Value::String(n.to_string()),
        UTinyInt(n) => Value::from(n),
        USmallInt(n) => Value::from(n),
        UInt(n) => Value::from(n),
        UBigInt(n) => Value::from(n),
        Float(f) => Value::from(f as f64),
        Double(f) => Value::from(f),
        Text(s) => Value::String(s),
        Blob(b) => Value::String(format!("<{} bytes>", b.len())),
        Date32(d) => Value::String(format!("{d}")),
        Time64(_, t) => Value::String(format!("{t}")),
        Timestamp(_, t) => Value::String(format!("{t}")),
        _ => Value::String(format!("{v:?}")),
    }
}
