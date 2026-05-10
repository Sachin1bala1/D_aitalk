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

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS outcome_tracking (
            id TEXT PRIMARY KEY,
            episode_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            notes TEXT,
            owner TEXT,
            due_at INTEGER,
            resolved_at INTEGER,
            confidence_delta REAL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_outcomes_status_due ON outcome_tracking(status, due_at)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS usage_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            feature TEXT NOT NULL,
            connection_id TEXT,
            driver TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_usage_events_feature ON usage_events(feature, created_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            company TEXT,
            email TEXT,
            stage TEXT NOT NULL DEFAULT 'discovery',
            status TEXT NOT NULL DEFAULT 'active',
            priority TEXT NOT NULL DEFAULT 'medium',
            notes TEXT,
            last_contact_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS customer_interactions (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            summary TEXT NOT NULL,
            sentiment TEXT,
            action_items TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(customer_id) REFERENCES customers(id)
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_time
         ON customer_interactions(customer_id, created_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS monitoring_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            sql TEXT NOT NULL,
            cadence_minutes INTEGER NOT NULL DEFAULT 60,
            notify_on_nonzero INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_run_at INTEGER,
            last_status TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_monitoring_rules_active
         ON monitoring_rules(is_active, updated_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS monitoring_runs (
            id TEXT PRIMARY KEY,
            rule_id TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            status TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            message TEXT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER NOT NULL,
            FOREIGN KEY(rule_id) REFERENCES monitoring_rules(id)
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_monitoring_runs_rule_time
         ON monitoring_runs(rule_id, finished_at DESC)",
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
