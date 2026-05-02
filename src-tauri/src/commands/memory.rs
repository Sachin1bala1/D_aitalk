use tauri::{AppHandle, Manager, State};

use super::AppState;

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct MemoryEpisode {
    pub id: String,
    pub session_id: String,
    pub connection_id: Option<String>,
    pub problem: String,
    pub tools_used: String,
    pub findings: String,
    pub outcome: Option<String>,
    pub embedding: String,
    pub created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct CalibrationProfile {
    pub id: String,
    pub expertise_level: String,
    pub parameter_priorities: String,
    pub preferred_chart_types: String,
    pub domain_focus: String,
    pub correction_history: String,
    pub implicit_interests: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn init_memory_db(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let db_path = app_data.join("daitalk_memory.db");
    let path_str = db_path.to_str().ok_or("Invalid path")?;
    let path_url = path_str.replace('\\', "/");
    let pool = crate::db::memory::open_memory_db(&path_url).await?;
    let mut guard = state.memory_db.lock().await;
    *guard = Some(pool);
    Ok(())
}

#[tauri::command]
pub async fn memory_insert_episode(
    episode: MemoryEpisode,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = {
        state
            .memory_db
            .lock()
            .await
            .as_ref()
            .ok_or("Memory DB not initialized")?
            .clone()
    };
    sqlx::query(
        "INSERT OR REPLACE INTO memory_episodes
         (id, session_id, connection_id, problem, tools_used, findings, outcome, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&episode.id)
    .bind(&episode.session_id)
    .bind(&episode.connection_id)
    .bind(&episode.problem)
    .bind(&episode.tools_used)
    .bind(&episode.findings)
    .bind(&episode.outcome)
    .bind(&episode.embedding)
    .bind(episode.created_at)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_episodes(
    limit: Option<i64>,
    connection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<MemoryEpisode>, String> {
    let pool = {
        state
            .memory_db
            .lock()
            .await
            .as_ref()
            .ok_or("Memory DB not initialized")?
            .clone()
    };
    let lim = limit.unwrap_or(200);
    let rows = if let Some(cid) = connection_id {
        sqlx::query_as::<_, MemoryEpisode>(
            "SELECT id, session_id, connection_id, problem, tools_used, findings, outcome, embedding, created_at
             FROM memory_episodes WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(cid)
        .bind(lim)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, MemoryEpisode>(
            "SELECT id, session_id, connection_id, problem, tools_used, findings, outcome, embedding, created_at
             FROM memory_episodes ORDER BY created_at DESC LIMIT ?",
        )
        .bind(lim)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?
    };
    Ok(rows)
}

#[tauri::command]
pub async fn memory_get_calibration(
    state: State<'_, AppState>,
) -> Result<CalibrationProfile, String> {
    let pool = {
        state
            .memory_db
            .lock()
            .await
            .as_ref()
            .ok_or("Memory DB not initialized")?
            .clone()
    };
    sqlx::query_as::<_, CalibrationProfile>(
        "SELECT id, expertise_level, parameter_priorities, preferred_chart_types,
         domain_focus, correction_history, implicit_interests, updated_at
         FROM user_calibration WHERE id = 'singleton'",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_clear_episodes(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = {
        state
            .memory_db
            .lock()
            .await
            .as_ref()
            .ok_or("Memory DB not initialized")?
            .clone()
    };
    sqlx::query("DELETE FROM memory_episodes")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_update_calibration(
    field: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = {
        state
            .memory_db
            .lock()
            .await
            .as_ref()
            .ok_or("Memory DB not initialized")?
            .clone()
    };
    let allowed = [
        "expertise_level",
        "parameter_priorities",
        "preferred_chart_types",
        "domain_focus",
        "correction_history",
        "implicit_interests",
    ];
    if !allowed.contains(&field.as_str()) {
        return Err(format!("Field '{}' is not updatable", field));
    }
    let sql = format!(
        "UPDATE user_calibration SET {} = ?, updated_at = ? WHERE id = 'singleton'",
        field
    );
    sqlx::query(&sql)
        .bind(&value)
        .bind(chrono::Utc::now().timestamp())
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
