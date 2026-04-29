use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};

pub async fn open_memory_db(path: &str) -> Result<SqlitePool, String> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&format!("sqlite:{}?mode=rwc", path))
        .await
        .map_err(|e| e.to_string())?;

    // Create tables if not exists
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS memory_episodes (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            connection_id TEXT,
            problem TEXT NOT NULL,
            tools_used TEXT NOT NULL,
            findings TEXT NOT NULL,
            outcome TEXT,
            embedding TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_episodes_conn ON memory_episodes(connection_id)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_episodes_time ON memory_episodes(created_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS user_calibration (
            id TEXT PRIMARY KEY DEFAULT 'singleton',
            expertise_level TEXT DEFAULT 'engineer',
            parameter_priorities TEXT DEFAULT '[]',
            preferred_chart_types TEXT DEFAULT '[]',
            domain_focus TEXT DEFAULT '[]',
            correction_history TEXT DEFAULT '[]',
            implicit_interests TEXT DEFAULT '{}',
            updated_at INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    // Insert default calibration row if not exists
    sqlx::query(
        "INSERT OR IGNORE INTO user_calibration (id, updated_at) VALUES ('singleton', 0)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(pool)
}
