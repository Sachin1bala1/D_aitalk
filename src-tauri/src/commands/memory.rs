use chrono::Utc;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
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

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct OutcomeRecord {
    pub id: String,
    pub episode_id: String,
    pub session_id: String,
    pub title: String,
    pub status: String,
    pub notes: Option<String>,
    pub owner: Option<String>,
    pub due_at: Option<i64>,
    pub resolved_at: Option<i64>,
    pub confidence_delta: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UsageEventInput {
    pub event_type: String,
    pub feature: String,
    pub connection_id: Option<String>,
    pub driver: Option<String>,
    pub metadata_json: Option<Value>,
    pub created_at: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct CountBucket {
    pub key: String,
    pub count: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UsageSummary {
    pub total_events: u64,
    pub events_today: u64,
    pub top_features: Vec<CountBucket>,
    pub top_event_types: Vec<CountBucket>,
    pub top_drivers: Vec<CountBucket>,
    pub recent_errors: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct CustomerRecord {
    pub id: String,
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub stage: String,
    pub status: String,
    pub priority: String,
    pub notes: Option<String>,
    pub last_contact_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct CustomerInteractionRecord {
    pub id: String,
    pub customer_id: String,
    pub kind: String,
    pub summary: String,
    pub sentiment: Option<String>,
    pub action_items: Option<String>,
    pub created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PipelineSummary {
    pub total_customers: u64,
    pub high_priority_count: u64,
    pub by_stage: Vec<CountBucket>,
    pub recent_interactions: Vec<CustomerInteractionRecord>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct MonitoringRuleRecord {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub sql: String,
    pub cadence_minutes: i64,
    pub notify_on_nonzero: bool,
    pub is_active: bool,
    pub last_run_at: Option<i64>,
    pub last_status: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct MonitoringRunRecord {
    pub id: String,
    pub rule_id: String,
    pub connection_id: String,
    pub status: String,
    pub row_count: i64,
    pub message: Option<String>,
    pub started_at: i64,
    pub finished_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DailyBrief {
    pub generated_at: i64,
    pub pending_outcomes: u64,
    pub overdue_outcomes: u64,
    pub active_customers: u64,
    pub monitoring_alerts: u64,
    pub top_features: Vec<CountBucket>,
    pub summary_lines: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProactiveSuggestion {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub severity: String,
    pub source: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct CustomerBriefRecord {
    pub id: String,
    pub name: String,
    pub company: Option<String>,
    pub stage: String,
    pub priority: String,
    pub notes: Option<String>,
}

async fn get_pool(state: &State<'_, AppState>) -> Result<SqlitePool, String> {
    state
        .memory_db
        .lock()
        .await
        .as_ref()
        .ok_or("Memory DB not initialized")?
        .clone()
        .pipe(Ok)
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

fn parse_json_array(raw: &str) -> Vec<Value> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn parse_json_object(raw: &str) -> serde_json::Map<String, Value> {
    serde_json::from_str(raw).unwrap_or_default()
}

async fn apply_calibration_from_outcome(pool: &SqlitePool, outcome: &OutcomeRecord) -> Result<(), String> {
    let calibration = sqlx::query_as::<_, CalibrationProfile>(
        "SELECT id, expertise_level, parameter_priorities, preferred_chart_types,
         domain_focus, correction_history, implicit_interests, updated_at
         FROM user_calibration WHERE id = 'singleton'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut correction_history = parse_json_array(&calibration.correction_history);
    correction_history.push(json!({
        "episode_id": outcome.episode_id,
        "status": outcome.status,
        "title": outcome.title,
        "notes": outcome.notes,
        "resolved_at": outcome.resolved_at,
        "confidence_delta": outcome.confidence_delta,
        "updated_at": outcome.updated_at
    }));
    if correction_history.len() > 20 {
        let trim = correction_history.len() - 20;
        correction_history.drain(0..trim);
    }

    let mut implicit = parse_json_object(&calibration.implicit_interests);
    let bucket = match outcome.status.as_str() {
        "resolved" => "successful_outcomes",
        "blocked" => "blocked_outcomes",
        "in_progress" => "in_progress_outcomes",
        _ => "pending_outcomes",
    };
    let current = implicit.get(bucket).and_then(|v| v.as_u64()).unwrap_or(0);
    implicit.insert(bucket.to_string(), Value::from(current + 1));
    implicit.insert(
        "last_outcome_title".to_string(),
        Value::from(outcome.title.clone()),
    );

    sqlx::query(
        "UPDATE user_calibration
         SET correction_history = ?, implicit_interests = ?, updated_at = ?
         WHERE id = 'singleton'",
    )
    .bind(serde_json::to_string(&correction_history).map_err(|e| e.to_string())?)
    .bind(serde_json::to_string(&implicit).map_err(|e| e.to_string())?)
    .bind(Utc::now().timestamp_millis())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn count_buckets(rows: Vec<(String, i64)>) -> Vec<CountBucket> {
    rows.into_iter()
        .map(|(key, count)| CountBucket {
            key,
            count: count.max(0) as u64,
        })
        .collect()
}

#[tauri::command]
pub async fn init_memory_db(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
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
    let pool = get_pool(&state).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

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
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT OR IGNORE INTO outcome_tracking
         (id, episode_id, session_id, title, status, due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
    )
    .bind(format!("outcome-{}", episode.id))
    .bind(&episode.id)
    .bind(&episode.session_id)
    .bind(&episode.problem)
    .bind(episode.created_at + 3 * 24 * 60 * 60 * 1000)
    .bind(episode.created_at)
    .bind(episode.created_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_episodes(
    limit: Option<i64>,
    connection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<MemoryEpisode>, String> {
    let pool = get_pool(&state).await?;
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
pub async fn memory_get_calibration(state: State<'_, AppState>) -> Result<CalibrationProfile, String> {
    let pool = get_pool(&state).await?;
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
pub async fn memory_clear_episodes(state: State<'_, AppState>) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    sqlx::query("DELETE FROM memory_episodes")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM outcome_tracking")
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
    let pool = get_pool(&state).await?;
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
        .bind(Utc::now().timestamp_millis())
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_upsert_outcome(
    outcome: OutcomeRecord,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let updated_at = if outcome.updated_at == 0 {
        Utc::now().timestamp_millis()
    } else {
        outcome.updated_at
    };
    let resolved_at = if outcome.status == "resolved" && outcome.resolved_at.is_none() {
        Some(updated_at)
    } else {
        outcome.resolved_at
    };

    sqlx::query(
        "INSERT OR REPLACE INTO outcome_tracking
         (id, episode_id, session_id, title, status, notes, owner, due_at, resolved_at, confidence_delta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&outcome.id)
    .bind(&outcome.episode_id)
    .bind(&outcome.session_id)
    .bind(&outcome.title)
    .bind(&outcome.status)
    .bind(&outcome.notes)
    .bind(&outcome.owner)
    .bind(outcome.due_at)
    .bind(resolved_at)
    .bind(outcome.confidence_delta)
    .bind(if outcome.created_at == 0 { updated_at } else { outcome.created_at })
    .bind(updated_at)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let persisted = OutcomeRecord {
        resolved_at,
        updated_at,
        created_at: if outcome.created_at == 0 { updated_at } else { outcome.created_at },
        ..outcome
    };
    apply_calibration_from_outcome(&pool, &persisted).await?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_pending_outcomes(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<OutcomeRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, OutcomeRecord>(
        "SELECT id, episode_id, session_id, title, status, notes, owner, due_at, resolved_at, confidence_delta, created_at, updated_at
         FROM outcome_tracking
         WHERE status IN ('pending', 'in_progress', 'blocked')
         ORDER BY COALESCE(due_at, updated_at) ASC
         LIMIT ?",
    )
    .bind(limit.unwrap_or(50))
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_track_usage_event(
    event: UsageEventInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    sqlx::query(
        "INSERT INTO usage_events
         (id, event_type, feature, connection_id, driver, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(format!("usage-{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()))
    .bind(event.event_type)
    .bind(event.feature)
    .bind(event.connection_id)
    .bind(event.driver)
    .bind(
        serde_json::to_string(&event.metadata_json.unwrap_or_else(|| json!({})))
            .map_err(|e| e.to_string())?,
    )
    .bind(event.created_at.unwrap_or_else(|| Utc::now().timestamp_millis()))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_usage_summary(
    state: State<'_, AppState>,
) -> Result<UsageSummary, String> {
    let pool = get_pool(&state).await?;
    let total_events = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM usage_events")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?
        .max(0) as u64;
    let today_start = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or("Invalid day boundary")?
        .and_utc()
        .timestamp_millis();
    let events_today = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM usage_events WHERE created_at >= ?",
    )
    .bind(today_start)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;

    let top_features = count_buckets(
        sqlx::query_as::<_, (String, i64)>(
            "SELECT feature, COUNT(*) AS count
             FROM usage_events
             GROUP BY feature
             ORDER BY count DESC, feature ASC
             LIMIT 6",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?,
    );
    let top_event_types = count_buckets(
        sqlx::query_as::<_, (String, i64)>(
            "SELECT event_type, COUNT(*) AS count
             FROM usage_events
             GROUP BY event_type
             ORDER BY count DESC, event_type ASC
             LIMIT 6",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?,
    );
    let top_drivers = count_buckets(
        sqlx::query_as::<_, (String, i64)>(
            "SELECT COALESCE(driver, 'unknown') AS driver, COUNT(*) AS count
             FROM usage_events
             GROUP BY COALESCE(driver, 'unknown')
             ORDER BY count DESC, driver ASC
             LIMIT 6",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?,
    );
    let recent_errors = sqlx::query(
        "SELECT event_type, feature, metadata_json
         FROM usage_events
         WHERE event_type = 'error'
         ORDER BY created_at DESC
         LIMIT 5",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|row| {
        let event_type: String = row.get("event_type");
        let feature: String = row.get("feature");
        let metadata_json: String = row.get("metadata_json");
        format!("{event_type}:{feature} {metadata_json}")
    })
    .collect();

    Ok(UsageSummary {
        total_events,
        events_today,
        top_features,
        top_event_types,
        top_drivers,
        recent_errors,
    })
}

#[tauri::command]
pub async fn memory_upsert_customer(
    customer: CustomerRecord,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT OR REPLACE INTO customers
         (id, name, company, email, stage, status, priority, notes, last_contact_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&customer.id)
    .bind(&customer.name)
    .bind(&customer.company)
    .bind(&customer.email)
    .bind(&customer.stage)
    .bind(&customer.status)
    .bind(&customer.priority)
    .bind(&customer.notes)
    .bind(customer.last_contact_at)
    .bind(if customer.created_at == 0 { now } else { customer.created_at })
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_list_customers(
    state: State<'_, AppState>,
) -> Result<Vec<CustomerRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, CustomerRecord>(
        "SELECT id, name, company, email, stage, status, priority, notes, last_contact_at, created_at, updated_at
         FROM customers
         ORDER BY
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           updated_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_add_customer_interaction(
    interaction: CustomerInteractionRecord,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let now = if interaction.created_at == 0 {
        Utc::now().timestamp_millis()
    } else {
        interaction.created_at
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT OR REPLACE INTO customer_interactions
         (id, customer_id, kind, summary, sentiment, action_items, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&interaction.id)
    .bind(&interaction.customer_id)
    .bind(&interaction.kind)
    .bind(&interaction.summary)
    .bind(&interaction.sentiment)
    .bind(&interaction.action_items)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE customers SET last_contact_at = ?, updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(now)
        .bind(&interaction.customer_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_customer_interactions(
    customer_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CustomerInteractionRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, CustomerInteractionRecord>(
        "SELECT id, customer_id, kind, summary, sentiment, action_items, created_at
         FROM customer_interactions
         WHERE customer_id = ?
         ORDER BY created_at DESC",
    )
    .bind(customer_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_get_customer_pipeline_summary(
    state: State<'_, AppState>,
) -> Result<PipelineSummary, String> {
    let pool = get_pool(&state).await?;
    let total_customers = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM customers")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?
        .max(0) as u64;
    let high_priority_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM customers WHERE priority IN ('critical', 'high')",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;
    let by_stage = count_buckets(
        sqlx::query_as::<_, (String, i64)>(
            "SELECT stage, COUNT(*) AS count
             FROM customers
             GROUP BY stage
             ORDER BY count DESC, stage ASC",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?,
    );
    let recent_interactions = sqlx::query_as::<_, CustomerInteractionRecord>(
        "SELECT id, customer_id, kind, summary, sentiment, action_items, created_at
         FROM customer_interactions
         ORDER BY created_at DESC
         LIMIT 5",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(PipelineSummary {
        total_customers,
        high_priority_count,
        by_stage,
        recent_interactions,
    })
}

#[tauri::command]
pub async fn memory_upsert_monitoring_rule(
    rule: MonitoringRuleRecord,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT OR REPLACE INTO monitoring_rules
         (id, name, connection_id, sql, cadence_minutes, notify_on_nonzero, is_active, last_run_at, last_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&rule.id)
    .bind(&rule.name)
    .bind(&rule.connection_id)
    .bind(&rule.sql)
    .bind(rule.cadence_minutes)
    .bind(if rule.notify_on_nonzero { 1 } else { 0 })
    .bind(if rule.is_active { 1 } else { 0 })
    .bind(rule.last_run_at)
    .bind(&rule.last_status)
    .bind(if rule.created_at == 0 { now } else { rule.created_at })
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_list_monitoring_rules(
    state: State<'_, AppState>,
) -> Result<Vec<MonitoringRuleRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, MonitoringRuleRecord>(
        "SELECT id, name, connection_id, sql, cadence_minutes,
                notify_on_nonzero as \"notify_on_nonzero: bool\",
                is_active as \"is_active: bool\",
                last_run_at, last_status, created_at, updated_at
         FROM monitoring_rules
         ORDER BY is_active DESC, updated_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_record_monitoring_run(
    run: MonitoringRunRecord,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT OR REPLACE INTO monitoring_runs
         (id, rule_id, connection_id, status, row_count, message, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&run.id)
    .bind(&run.rule_id)
    .bind(&run.connection_id)
    .bind(&run.status)
    .bind(run.row_count)
    .bind(&run.message)
    .bind(run.started_at)
    .bind(run.finished_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE monitoring_rules
         SET last_run_at = ?, last_status = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(run.finished_at)
    .bind(&run.status)
    .bind(Utc::now().timestamp_millis())
    .bind(&run.rule_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn memory_get_recent_monitoring_runs(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<MonitoringRunRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, MonitoringRunRecord>(
        "SELECT id, rule_id, connection_id, status, row_count, message, started_at, finished_at
         FROM monitoring_runs
         ORDER BY finished_at DESC
         LIMIT ?",
    )
    .bind(limit.unwrap_or(20))
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_generate_daily_brief(
    state: State<'_, AppState>,
) -> Result<DailyBrief, String> {
    let pool = get_pool(&state).await?;
    let usage = memory_get_usage_summary(state).await?;
    let now = Utc::now().timestamp_millis();
    let pending_outcomes = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM outcome_tracking WHERE status IN ('pending', 'in_progress', 'blocked')",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;
    let overdue_outcomes = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM outcome_tracking
         WHERE status IN ('pending', 'in_progress', 'blocked')
           AND due_at IS NOT NULL
           AND due_at < ?",
    )
    .bind(now)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;
    let active_customers = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM customers")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?
        .max(0) as u64;
    let monitoring_alerts = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM monitoring_runs WHERE status = 'alert' AND finished_at >= ?",
    )
    .bind(now - 24 * 60 * 60 * 1000)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;

    let mut summary_lines = vec![
        format!("{pending_outcomes} outcome loops need follow-up."),
        format!("{overdue_outcomes} outcomes are overdue."),
        format!("{active_customers} customers are tracked in the local intelligence store."),
        format!("{monitoring_alerts} monitoring alerts fired in the last 24h."),
    ];
    if let Some(feature) = usage.top_features.first() {
        summary_lines.push(format!(
            "Most used feature: {} ({} events).",
            feature.key, feature.count
        ));
    }

    Ok(DailyBrief {
        generated_at: now,
        pending_outcomes,
        overdue_outcomes,
        active_customers,
        monitoring_alerts,
        top_features: usage.top_features,
        summary_lines,
    })
}

#[tauri::command]
pub async fn memory_get_proactive_suggestions(
    connection_id: Option<String>,
    sql: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProactiveSuggestion>, String> {
    let pool = get_pool(&state).await?;
    let sql_lower = sql.to_lowercase();
    let now = Utc::now().timestamp_millis();
    let mut suggestions = Vec::new();

    if sql_lower.contains("select *") {
        suggestions.push(ProactiveSuggestion {
            id: "select-star".to_string(),
            title: "Trim the projection".to_string(),
            detail: "This query uses SELECT *. Narrow the column list before the result set grows or feeds downstream analysis.".to_string(),
            severity: "medium".to_string(),
            source: "sql_heuristic".to_string(),
        });
    }
    if sql_lower.trim_start().starts_with("select")
        && !sql_lower.contains(" limit ")
        && !sql_lower.ends_with(" limit")
    {
        suggestions.push(ProactiveSuggestion {
            id: "missing-limit".to_string(),
            title: "Add a LIMIT for exploration".to_string(),
            detail: "Exploratory queries should usually cap rows to keep the loop fast and avoid accidental large scans.".to_string(),
            severity: "medium".to_string(),
            source: "sql_heuristic".to_string(),
        });
    }
    if sql_lower.contains(" from ") && !sql_lower.contains(" where ") && !sql_lower.contains("group by") {
        suggestions.push(ProactiveSuggestion {
            id: "missing-filter".to_string(),
            title: "Consider a filter".to_string(),
            detail: "The current query has no WHERE clause. If this is a time-series or wide operational table, add a targeted filter.".to_string(),
            severity: "low".to_string(),
            source: "sql_heuristic".to_string(),
        });
    }

    let pending = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM outcome_tracking WHERE status IN ('pending', 'in_progress', 'blocked')",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?
    .max(0) as u64;
    if pending > 0 {
        suggestions.push(ProactiveSuggestion {
            id: "pending-outcomes".to_string(),
            title: "Close open learning loops".to_string(),
            detail: format!("{pending} prior APEX recommendations still need outcome updates. Capture the result so calibration stays honest."),
            severity: "low".to_string(),
            source: "outcome_tracking".to_string(),
        });
    }

    let alert_count = if let Some(connection_id) = connection_id {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM monitoring_runs
             WHERE connection_id = ? AND status = 'alert' AND finished_at >= ?",
        )
        .bind(connection_id)
        .bind(now - 24 * 60 * 60 * 1000)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?
        .max(0) as u64
    } else {
        0
    };
    if alert_count > 0 {
        suggestions.push(ProactiveSuggestion {
            id: "recent-alerts".to_string(),
            title: "Investigate recent monitor alerts".to_string(),
            detail: format!("{alert_count} scheduled monitors triggered recently on this connection. Compare this query to the alert criteria."),
            severity: "high".to_string(),
            source: "monitoring".to_string(),
        });
    }

    Ok(suggestions)
}

#[tauri::command]
pub async fn memory_get_customer_brief(
    state: State<'_, AppState>,
) -> Result<Vec<CustomerBriefRecord>, String> {
    let pool = get_pool(&state).await?;
    sqlx::query_as::<_, CustomerBriefRecord>(
        "SELECT id, name, company, stage, priority, notes
         FROM customers
         ORDER BY
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           updated_at DESC
         LIMIT 8",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())
}
