//! REST API connector — fetches a JSON endpoint and maps the response to columnar rows.
use reqwest::Client;
use serde_json::{Value, Map};
use std::time::{Duration, Instant};
use std::sync::Mutex;

use crate::db::types::{ColumnMeta, DisplayType, RestConfig};
use crate::error::DbError;

pub struct RestConnector {
    config: RestConfig,
    client: Client,
    cache: Mutex<Option<(Instant, Vec<Map<String, Value>>)>>,
}

impl RestConnector {
    pub fn new(config: RestConfig) -> Result<Self, DbError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| DbError::Other(format!("HTTP client init: {e}")))?;
        Ok(Self { config, client, cache: Mutex::new(None) })
    }

    /// Fetch data and return (columns, rows). Uses cache if TTL not expired.
    pub async fn fetch(&self, url_params: Option<&str>) -> Result<(Vec<ColumnMeta>, Vec<Map<String, Value>>), DbError> {
        // Check cache
        if self.config.cache_ttl_secs > 0 {
            let cache = self.cache.lock().unwrap();
            if let Some((cached_at, rows)) = cache.as_ref() {
                if cached_at.elapsed() < Duration::from_secs(self.config.cache_ttl_secs) {
                    let cols = infer_columns(rows);
                    return Ok((cols, rows.clone()));
                }
            }
        }

        // Build URL
        let url = if let Some(params) = url_params {
            self.config.url.replace("{param}", params)
        } else {
            self.config.url.clone()
        };

        // Build request
        let method = self.config.method.to_uppercase();
        let mut req = if method == "POST" {
            self.client.post(&url)
        } else {
            self.client.get(&url)
        };

        // Apply auth
        match self.config.auth_type.as_str() {
            "bearer" => {
                req = req.header("Authorization", format!("Bearer {}", self.config.auth_value));
            }
            "api_key" => {
                let header = if self.config.auth_header.is_empty() {
                    "X-API-Key"
                } else {
                    &self.config.auth_header
                };
                req = req.header(header, &self.config.auth_value);
            }
            "basic" => {
                // auth_value format: "username:password"
                let parts: Vec<&str> = self.config.auth_value.splitn(2, ':').collect();
                let (user, pass) = (parts.first().unwrap_or(&""), parts.get(1).unwrap_or(&""));
                req = req.basic_auth(user, Some(pass));
            }
            _ => {} // "none" or unknown
        }

        let response = req.send().await
            .map_err(|e| DbError::Other(format!("REST request failed: {e}")))?;

        if !response.status().is_success() {
            return Err(DbError::Other(format!("REST API returned HTTP {}", response.status())));
        }

        let json: Value = response.json().await
            .map_err(|e| DbError::Other(format!("REST JSON parse: {e}")))?;

        // Navigate to the response array using response_path
        let array = extract_array(&json, &self.config.response_path)?;

        // Convert to rows
        let rows: Vec<Map<String, Value>> = array.into_iter()
            .filter_map(|v| v.as_object().cloned())
            .collect();

        // Update cache
        if self.config.cache_ttl_secs > 0 {
            *self.cache.lock().unwrap() = Some((Instant::now(), rows.clone()));
        }

        let cols = infer_columns(&rows);
        Ok((cols, rows))
    }

    /// Quick connectivity test — returns first 5 rows or an error string.
    pub async fn test(&self) -> Result<(Vec<ColumnMeta>, Vec<Map<String, Value>>), DbError> {
        let (cols, rows) = self.fetch(None).await?;
        Ok((cols, rows.into_iter().take(5).collect()))
    }
}

/// Extract a JSON array from `value` using a simple dot-path like "$.data.items" or "$".
fn extract_array(value: &Value, path: &str) -> Result<Vec<Value>, DbError> {
    let path = path.trim_start_matches("$.").trim_start_matches('$');
    let mut current = value;
    if !path.is_empty() {
        for key in path.split('.') {
            current = current.get(key).ok_or_else(|| {
                DbError::Other(format!("REST response has no field '{key}' (path: {path})"))
            })?;
        }
    }
    match current {
        Value::Array(arr) => Ok(arr.clone()),
        _ => Err(DbError::Other(format!(
            "REST response path did not point to an array (found {:?})",
            current
        ))),
    }
}

/// Infer column metadata from up to 100 sample rows.
fn infer_columns(rows: &[Map<String, Value>]) -> Vec<ColumnMeta> {
    let sample = rows.iter().take(100);
    let mut keys: Vec<String> = Vec::new();

    // Collect all unique keys preserving first-seen order
    for row in sample {
        for key in row.keys() {
            if !keys.contains(key) {
                keys.push(key.clone());
            }
        }
    }

    keys.into_iter().map(|name| {
        let display_type = infer_display_type(rows, &name);
        ColumnMeta {
            type_name: format!("{:?}", display_type).to_lowercase(),
            display_type,
            name,
            nullable: true,
            is_primary_key: false,
        }
    }).collect()
}

fn infer_display_type(rows: &[Map<String, Value>], key: &str) -> DisplayType {
    for row in rows.iter().take(100) {
        match row.get(key) {
            Some(Value::Number(n)) => {
                return if n.is_f64() { DisplayType::Float } else { DisplayType::Integer };
            }
            Some(Value::Bool(_)) => return DisplayType::Boolean,
            Some(Value::String(s)) => {
                // Quick timestamp heuristic
                if s.len() >= 10 && (s.contains('T') || s.contains('-')) {
                    if chrono::DateTime::parse_from_rfc3339(s).is_ok() {
                        return DisplayType::Timestamp;
                    }
                }
                return DisplayType::Text;
            }
            _ => {}
        }
    }
    DisplayType::Text
}
