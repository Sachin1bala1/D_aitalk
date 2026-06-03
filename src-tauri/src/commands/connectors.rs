use crate::db::types::RestConfig;
use crate::db::pi_client::PIClient;

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

#[tauri::command]
pub async fn pi_test_connection_direct(
    base_url: String,
    username: String,
    password: String,
    verify_ssl: bool,
) -> Result<String, String> {
    let client = PIClient::new(&base_url, &username, &password, verify_ssl)
        .map_err(|e| e.to_string())?;
    client.test_connection().await
}

#[tauri::command]
pub async fn pi_search_tags_direct(
    base_url: String,
    username: String,
    password: String,
    query: String,
    max_count: u32,
) -> Result<Vec<crate::db::pi_client::PITag>, String> {
    let client = PIClient::new(&base_url, &username, &password, true)
        .map_err(|e| e.to_string())?;
    client.search_tags(&query, max_count).await
}

#[tauri::command]
pub async fn pi_get_tag_history(
    base_url: String,
    username: String,
    password: String,
    web_ids: Vec<String>,
    start_time: String,
    end_time: String,
    interval: String,
) -> Result<Vec<crate::db::pi_client::TagData>, String> {
    let client = PIClient::new(&base_url, &username, &password, true)
        .map_err(|e| e.to_string())?;
    client.get_tag_history(&web_ids, &start_time, &end_time, &interval).await
}

#[tauri::command]
pub async fn pi_get_current_values(
    base_url: String,
    username: String,
    password: String,
    web_ids: Vec<String>,
) -> Result<Vec<crate::db::pi_client::CurrentValue>, String> {
    let client = PIClient::new(&base_url, &username, &password, true)
        .map_err(|e| e.to_string())?;
    client.get_current_values(&web_ids).await
}
