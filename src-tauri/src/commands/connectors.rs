use crate::db::types::RestConfig;

#[tauri::command]
pub async fn test_rest_connection(
    config: RestConfig,
) -> Result<serde_json::Value, String> {
    let connector = crate::db::rest_connector::RestConnector::new(config)
        .map_err(|e| e.to_string())?;
    let (cols, rows) = connector.test().await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "columns": cols, "rows": rows }))
}

#[tauri::command]
pub async fn import_excel_file(
    path: String,
    sheet_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let result = crate::db::excel_importer::ExcelImporter::import(
        &path,
        sheet_name.as_deref(),
    ).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "table_name": result.table_name,
        "columns": result.columns,
        "row_count": result.row_count,
        "preview": result.rows.iter().take(5).collect::<Vec<_>>(),
    }))
}
