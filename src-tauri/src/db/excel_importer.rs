//! Excel (XLSX/XLS) importer — reads a sheet via calamine and returns columnar data.
//! The caller is responsible for inserting into DuckDB or another target.
use calamine::{open_workbook_auto, Reader, DataType};
use serde_json::{Value, Map};

use crate::db::types::{ColumnMeta, DisplayType};
use crate::error::DbError;

pub struct ExcelImporter;

pub struct ImportResult {
    pub table_name: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Map<String, Value>>,
    pub row_count: usize,
}

impl ExcelImporter {
    /// Import the first sheet (or `sheet_name` if provided) from an Excel file.
    /// Returns structured rows suitable for bulk insert.
    pub fn import(path: &str, sheet_name: Option<&str>) -> Result<ImportResult, DbError> {
        let mut workbook = open_workbook_auto(path)
            .map_err(|e| DbError::Other(format!("Excel open: {e}")))?;

        // Determine sheet to read
        let target_sheet = if let Some(name) = sheet_name {
            name.to_string()
        } else {
            workbook.sheet_names().first()
                .cloned()
                .ok_or_else(|| DbError::Other("Excel file has no sheets".to_string()))?
        };

        let range = workbook.worksheet_range(&target_sheet)
            .map_err(|e| DbError::Other(format!("Excel sheet '{target_sheet}': {e}")))?;

        let mut rows_iter = range.rows();

        // First row = headers
        let headers: Vec<String> = rows_iter
            .next()
            .ok_or_else(|| DbError::Other("Excel sheet is empty".to_string()))?
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                let s = cell.to_string();
                if s.trim().is_empty() { format!("col_{i}") } else { s.trim().to_string() }
            })
            .collect();

        let col_count = headers.len();
        let mut all_rows: Vec<Map<String, Value>> = Vec::new();

        for row in rows_iter {
            let mut obj = Map::new();
            for (i, cell) in row.iter().enumerate() {
                if i >= col_count { break; }
                let val = excel_cell_to_json(cell);
                obj.insert(headers[i].clone(), val);
            }
            all_rows.push(obj);
        }

        let row_count = all_rows.len();
        let columns = infer_columns_from_rows(&headers, &all_rows);

        // Derive table name from file name
        let table_name = std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("imported")
            .to_string()
            .replace(' ', "_")
            .to_lowercase();

        Ok(ImportResult { table_name, columns, rows: all_rows, row_count })
    }
}

fn excel_cell_to_json(cell: &DataType) -> Value {
    match cell {
        DataType::Empty => Value::Null,
        DataType::String(s) => Value::String(s.clone()),
        DataType::Float(f) => {
            // Represent whole floats as integers for cleaner output
            if f.fract() == 0.0 && *f >= i64::MIN as f64 && *f <= i64::MAX as f64 {
                Value::from(*f as i64)
            } else {
                Value::from(*f)
            }
        }
        DataType::Int(n) => Value::from(*n),
        DataType::Bool(b) => Value::Bool(*b),
        DataType::DateTime(dt) => Value::String(format!("{dt}")),
        DataType::DateTimeIso(s) => Value::String(s.clone()),
        DataType::DurationIso(s) => Value::String(s.clone()),
        DataType::Error(e) => Value::String(format!("#ERR:{e:?}")),
    }
}

fn infer_columns_from_rows(headers: &[String], rows: &[Map<String, Value>]) -> Vec<ColumnMeta> {
    headers.iter().map(|name| {
        let display_type = rows.iter().take(100).find_map(|row| {
            match row.get(name)? {
                Value::Number(n) => Some(if n.is_f64() { DisplayType::Float } else { DisplayType::Integer }),
                Value::Bool(_) => Some(DisplayType::Boolean),
                Value::String(s) if chrono::DateTime::parse_from_rfc3339(s).is_ok() => Some(DisplayType::Timestamp),
                Value::String(_) => Some(DisplayType::Text),
                _ => None,
            }
        }).unwrap_or(DisplayType::Text);

        ColumnMeta {
            name: name.clone(),
            type_name: format!("{:?}", display_type).to_lowercase(),
            display_type,
            nullable: true,
            is_primary_key: false,
        }
    }).collect()
}
