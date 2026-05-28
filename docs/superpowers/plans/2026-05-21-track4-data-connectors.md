# Track 4: Data Connectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add REST API connector, Excel import, and connection health monitoring with auto-reconnect.

**Architecture:** Three independent additions to the Rust backend: (1) `rest_connector.rs` — fetches JSON APIs and maps them to columnar tables, (2) `excel_importer.rs` — uses `calamine` crate to parse XLSX/XLS into DuckDB tables, (3) `health_monitor.rs` — pings active connections every 30s and emits frontend events on drop/reconnect. Frontend updates: `ConnectionDialog.tsx` gets a REST driver form, `FileImportDialog.tsx` accepts `.xlsx`/`.xls`.

**Tech Stack:** Rust, `reqwest` (HTTP), `calamine` (Excel), `serde_json`, TypeScript/React, Tauri IPC, existing `invoke()` + `listen()` patterns

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `reqwest`, `calamine` crates |
| `src-tauri/src/db/types.rs` | Add `RestApi` to `DbDriver`; add `RestConfig` struct |
| `src-tauri/src/db/rest_connector.rs` | Create: fetch JSON API → columnar rows |
| `src-tauri/src/db/excel_importer.rs` | Create: parse XLSX/XLS via calamine → DuckDB tables |
| `src-tauri/src/db/health_monitor.rs` | Create: background pinger, emits `connection_dropped`/`connection_restored` |
| `src-tauri/src/db/connection_manager.rs` | Add REST connection variant; wire `RestApi` driver |
| `src-tauri/src/db/mod.rs` | Export new modules |
| `src-tauri/src/commands.rs` | Add `test_rest_connection`, `import_excel_file`, `start_health_monitor` commands |
| `src-tauri/src/lib.rs` | Mount health monitor on app startup; register new commands |
| `src/components/dialogs/ConnectionDialog.tsx` | Add REST API driver form |
| `src/components/dialogs/FileImportDialog.tsx` | Accept `.xlsx`/`.xls`, call `import_excel_file` |

---

## Task 1: Add new crates to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add reqwest and calamine**

Open `src-tauri/Cargo.toml`. After the existing dependencies (before `[features]` if present), add:

```toml
# Track 4 — Data Connectors
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
calamine = "0.24"
```

- [ ] **Step 2: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | tail -10
```

Expected: `Finished` with no errors (reqwest and calamine download and compile).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(connectors): add reqwest and calamine crates for REST + Excel support"
```

---

## Task 2: Add RestApi to DbDriver and types

**Files:**
- Modify: `src-tauri/src/db/types.rs`

- [ ] **Step 1: Add `RestApi` to `DbDriver` enum**

Find the `DbDriver` enum in `types.rs` and add `RestApi`:

```rust
pub enum DbDriver {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Mariadb,
    Timescaledb,
    #[serde(rename = "mongodb")]
    MongoDB,
    Redis,
    ClickHouse,
    PIHistorian,
    DuckDb,        // added in Track 3 — ensure this is present
    RestApi,
}
```

- [ ] **Step 2: Add `RestConfig` struct**

At the bottom of `types.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestConfig {
    /// Base URL — may contain `{param}` placeholders
    pub url: String,
    /// HTTP method: "GET" or "POST"
    #[serde(default = "default_get")]
    pub method: String,
    /// Auth type: "none", "bearer", "api_key", "basic"
    #[serde(default)]
    pub auth_type: String,
    /// Token / API key value
    #[serde(default)]
    pub auth_value: String,
    /// Header name for API key auth (e.g. "X-API-Key")
    #[serde(default)]
    pub auth_header: String,
    /// JSONPath to the array of records, e.g. "$.data.items" or "$" for root array
    #[serde(default = "default_root")]
    pub response_path: String,
    /// Cache response for N seconds (0 = no cache)
    #[serde(default)]
    pub cache_ttl_secs: u64,
}

fn default_get() -> String { "GET".to_string() }
fn default_root() -> String { "$".to_string() }
```

Also update `ConnectionConfig` to include an optional `rest_config` field. Find the `ConnectionConfig` struct and add:

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub rest_config: Option<RestConfig>,
```

- [ ] **Step 3: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/types.rs
git commit -m "feat(connectors): add RestApi driver variant and RestConfig struct"
```

---

## Task 3: REST connector implementation

**Files:**
- Create: `src-tauri/src/db/rest_connector.rs`

- [ ] **Step 1: Create rest_connector.rs**

Create `src-tauri/src/db/rest_connector.rs`:

```rust
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
                let (user, pass) = (parts.get(0).unwrap_or(&""), parts.get(1).unwrap_or(&""));
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
```

- [ ] **Step 2: Export in mod.rs**

Open `src-tauri/src/db/mod.rs` and add:
```rust
pub mod rest_connector;
```

- [ ] **Step 3: Add REST to ActiveConnection in connection_manager.rs**

Find the `ActiveConnection` enum and add:
```rust
RestApi(Arc<tokio::sync::Mutex<super::rest_connector::RestConnector>>),
```

Then add the REST connection branch in `ConnectionManager::connect`. Find the DuckDb branch added in Track 3 and add after it:

```rust
if matches!(config.driver, DbDriver::RestApi) {
    let rest_cfg = config.rest_config.clone().ok_or_else(|| {
        DbError::Other("REST API connection requires rest_config".to_string())
    })?;
    let connector = super::rest_connector::RestConnector::new(rest_cfg)
        .map_err(|e| DbError::Other(format!("REST connector init: {e}")))?;
    let entry = ActiveEntry {
        connection: Arc::new(ActiveConnection::RestApi(
            Arc::new(tokio::sync::Mutex::new(connector)),
        )),
        _tunnel: None,
    };
    let id = config.id.clone();
    self.connections.write().await.insert(id.clone(), entry);
    self.configs.write().await.insert(id, config);
    return Ok(());
}
```

- [ ] **Step 4: Add Tauri commands for REST**

In `src-tauri/src/commands.rs`, add:

```rust
#[tauri::command]
pub async fn test_rest_connection(
    config: crate::db::types::RestConfig,
) -> Result<serde_json::Value, String> {
    let connector = crate::db::rest_connector::RestConnector::new(config)
        .map_err(|e| e.to_string())?;
    let (cols, rows) = connector.test().await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "columns": cols, "rows": rows }))
}
```

Register in `lib.rs` `invoke_handler`:
```rust
commands::test_rest_connection,
```

- [ ] **Step 5: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/rest_connector.rs src-tauri/src/db/mod.rs src-tauri/src/db/connection_manager.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(connectors): add REST API connector with JSON-path array extraction and bearer/apikey/basic auth"
```

---

## Task 4: Excel import via calamine

**Files:**
- Create: `src-tauri/src/db/excel_importer.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create excel_importer.rs**

Create `src-tauri/src/db/excel_importer.rs`:

```rust
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
```

- [ ] **Step 2: Export in mod.rs**

```rust
pub mod excel_importer;
```

- [ ] **Step 3: Add `import_excel_file` Tauri command**

In `commands.rs`, add:

```rust
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
```

Register in `lib.rs` invoke_handler:
```rust
commands::import_excel_file,
```

- [ ] **Step 4: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/excel_importer.rs src-tauri/src/db/mod.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(connectors): Excel/XLSX import via calamine with type inference"
```

---

## Task 5: Connection health monitor

**Files:**
- Create: `src-tauri/src/db/health_monitor.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create health_monitor.rs**

Create `src-tauri/src/db/health_monitor.rs`:

```rust
//! Connection health monitor — pings each active connection every 30s.
//! Emits `connection_dropped` and `connection_restored` Tauri events.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use tauri::{AppHandle, Emitter};

use crate::db::connection_manager::ConnectionManager;

const PING_INTERVAL: Duration = Duration::from_secs(30);
const MAX_RECONNECT_ATTEMPTS: u32 = 3;

#[derive(serde::Serialize, Clone)]
struct ConnectionEvent {
    connection_id: String,
    message: String,
}

pub async fn run(app: AppHandle, manager: Arc<ConnectionManager>) {
    let mut interval = time::interval(PING_INTERVAL);
    let mut failure_counts: HashMap<String, u32> = HashMap::new();

    loop {
        interval.tick().await;

        let connection_ids: Vec<String> = manager.list_connection_ids().await;

        for id in connection_ids {
            let alive = manager.ping(&id).await;

            if alive {
                // Reset failure count; if was failed, emit restored
                if let Some(count) = failure_counts.get(&id) {
                    if *count > 0 {
                        failure_counts.insert(id.clone(), 0);
                        let _ = app.emit("connection_restored", ConnectionEvent {
                            connection_id: id.clone(),
                            message: "Connection restored".to_string(),
                        });
                    }
                }
                failure_counts.entry(id).or_insert(0);
            } else {
                let count = failure_counts.entry(id.clone()).or_insert(0);
                *count += 1;

                if *count == 1 {
                    // First failure — emit dropped event
                    let _ = app.emit("connection_dropped", ConnectionEvent {
                        connection_id: id.clone(),
                        message: format!("Connection lost (attempt {}/{})", *count, MAX_RECONNECT_ATTEMPTS),
                    });
                }

                if *count <= MAX_RECONNECT_ATTEMPTS {
                    // Attempt reconnect
                    if let Some(config) = manager.get_config(&id).await {
                        match manager.connect(config).await {
                            Ok(()) => {
                                failure_counts.insert(id.clone(), 0);
                                let _ = app.emit("connection_restored", ConnectionEvent {
                                    connection_id: id.clone(),
                                    message: "Reconnected successfully".to_string(),
                                });
                            }
                            Err(_) => {
                                // Will retry on next tick
                            }
                        }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add `list_connection_ids`, `ping`, and `get_config` to ConnectionManager**

Open `connection_manager.rs` and add these methods to `impl ConnectionManager`:

```rust
/// Returns the IDs of all currently registered connections.
pub async fn list_connection_ids(&self) -> Vec<String> {
    self.connections.read().await.keys().cloned().collect()
}

/// Returns the stored config for a connection (for reconnect).
pub async fn get_config(&self, id: &str) -> Option<ConnectionConfig> {
    self.configs.read().await.get(id).cloned()
}

/// Sends a trivial query to verify the connection is alive.
/// Returns true if the connection responds, false on error.
pub async fn ping(&self, id: &str) -> bool {
    use super::types::ActiveConnection;
    let conns = self.connections.read().await;
    let Some(entry) = conns.get(id) else { return false; };
    match &*entry.connection {
        ActiveConnection::Postgres(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.is_ok()
        }
        ActiveConnection::Mysql(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.is_ok()
        }
        ActiveConnection::Sqlite(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.is_ok()
        }
        // For drivers without a trivial ping, report alive
        _ => true,
    }
}
```

- [ ] **Step 3: Export in mod.rs**

```rust
pub mod health_monitor;
```

- [ ] **Step 4: Start health monitor on app startup in lib.rs**

Open `src-tauri/src/lib.rs`. Find where the Tauri app is built (the `tauri::Builder::default()` chain). After `.setup(|app| { ... })` (or inside the setup closure), spawn the health monitor:

```rust
.setup(|app| {
    // ... existing setup code ...
    let app_handle = app.handle().clone();
    let manager = app.state::<crate::AppState>().connection_manager.clone();
    tokio::spawn(async move {
        crate::db::health_monitor::run(app_handle, manager).await;
    });
    Ok(())
})
```

If `connection_manager` is not an `Arc<ConnectionManager>`, wrap it: change `AppState` to hold `Arc<ConnectionManager>` instead of `ConnectionManager`.

- [ ] **Step 5: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/health_monitor.rs src-tauri/src/db/mod.rs src-tauri/src/db/connection_manager.rs src-tauri/src/lib.rs
git commit -m "feat(connectors): connection health monitor — ping every 30s, auto-reconnect x3"
```

---

## Task 6: Frontend — REST API form in ConnectionDialog

**Files:**
- Modify: `src/components/dialogs/ConnectionDialog.tsx`

- [ ] **Step 1: Find the driver selector in ConnectionDialog**

```bash
grep -n "driver\|Driver\|select\|options" C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src\components\dialogs\ConnectionDialog.tsx | head -30
```

Locate the dropdown or list where database drivers are selected.

- [ ] **Step 2: Add "REST API" to the driver options**

Find the driver options array/enum (likely something like `DRIVERS` or a `select` element). Add:

```tsx
{ value: "rest_api", label: "REST API" }
```

- [ ] **Step 3: Add REST-specific form fields**

Find where driver-specific fields render (likely a conditional block like `{driver === 'postgres' && <PostgresFields />}`). Add:

```tsx
{driver === "rest_api" && (
  <div className="space-y-3">
    <div>
      <label className="text-xs text-white/60 mb-1 block">API URL</label>
      <input
        type="text"
        className="w-full bg-[#1a1a1a] border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
        placeholder="https://api.example.com/data"
        value={restUrl}
        onChange={(e) => setRestUrl(e.target.value)}
      />
    </div>
    <div>
      <label className="text-xs text-white/60 mb-1 block">Auth Type</label>
      <select
        className="w-full bg-[#1a1a1a] border border-white/10 rounded px-3 py-2 text-sm text-white"
        value={restAuthType}
        onChange={(e) => setRestAuthType(e.target.value)}
      >
        <option value="none">None</option>
        <option value="bearer">Bearer Token</option>
        <option value="api_key">API Key</option>
        <option value="basic">Basic Auth</option>
      </select>
    </div>
    {restAuthType !== "none" && (
      <div>
        <label className="text-xs text-white/60 mb-1 block">
          {restAuthType === "api_key" ? "API Key" : restAuthType === "basic" ? "username:password" : "Token"}
        </label>
        <input
          type="password"
          className="w-full bg-[#1a1a1a] border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          value={restAuthValue}
          onChange={(e) => setRestAuthValue(e.target.value)}
        />
      </div>
    )}
    {restAuthType === "api_key" && (
      <div>
        <label className="text-xs text-white/60 mb-1 block">Header Name</label>
        <input
          type="text"
          className="w-full bg-[#1a1a1a] border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          placeholder="X-API-Key"
          value={restAuthHeader}
          onChange={(e) => setRestAuthHeader(e.target.value)}
        />
      </div>
    )}
    <div>
      <label className="text-xs text-white/60 mb-1 block">Response Path (JSONPath)</label>
      <input
        type="text"
        className="w-full bg-[#1a1a1a] border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
        placeholder="$ (root array) or $.data.items"
        value={restResponsePath}
        onChange={(e) => setRestResponsePath(e.target.value)}
      />
    </div>
    <button
      type="button"
      onClick={handleTestRest}
      className="w-full py-2 rounded bg-white/10 hover:bg-white/15 text-sm text-white/70 transition-colors"
    >
      Test Connection
    </button>
    {restTestResult && (
      <div className="text-xs font-mono bg-[#0d0d0d] border border-white/10 rounded p-2 text-white/60 max-h-32 overflow-auto">
        {restTestResult}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Add state variables and test handler**

At the top of the `ConnectionDialog` component, add:

```tsx
const [restUrl, setRestUrl] = useState("");
const [restAuthType, setRestAuthType] = useState("none");
const [restAuthValue, setRestAuthValue] = useState("");
const [restAuthHeader, setRestAuthHeader] = useState("");
const [restResponsePath, setRestResponsePath] = useState("$");
const [restTestResult, setRestTestResult] = useState<string | null>(null);
```

Add the test handler:

```tsx
const handleTestRest = async () => {
  setRestTestResult("Testing...");
  try {
    const result = await invoke<{ columns: unknown[]; rows: unknown[] }>("test_rest_connection", {
      config: {
        url: restUrl,
        method: "GET",
        auth_type: restAuthType,
        auth_value: restAuthValue,
        auth_header: restAuthHeader,
        response_path: restResponsePath,
        cache_ttl_secs: 0,
      },
    });
    setRestTestResult(`✓ Connected — ${result.rows.length} preview rows, ${result.columns.length} columns`);
  } catch (err) {
    setRestTestResult(`✗ ${err}`);
  }
};
```

- [ ] **Step 5: Wire REST config into the connection submit**

Find where the connection config is built for submission. When `driver === "rest_api"`, include:

```tsx
const config = {
  // ... base fields ...
  driver: "rest_api",
  connection_string: restUrl, // used as display
  rest_config: {
    url: restUrl,
    method: "GET",
    auth_type: restAuthType,
    auth_value: restAuthValue,
    auth_header: restAuthHeader,
    response_path: restResponsePath,
    cache_ttl_secs: 60,
  },
};
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/dialogs/ConnectionDialog.tsx
git commit -m "feat(connectors): add REST API driver form to ConnectionDialog with test button"
```

---

## Task 7: Frontend — Excel support in FileImportDialog

**Files:**
- Modify: `src/components/dialogs/FileImportDialog.tsx`

- [ ] **Step 1: Find the file picker accept attribute**

```bash
grep -n "accept\|\.csv\|\.parquet\|file\|import" C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src\components\dialogs\FileImportDialog.tsx | head -20
```

Locate where file types are filtered.

- [ ] **Step 2: Extend accept to include Excel files**

Find the file input `accept` attribute. It likely reads `.csv,.parquet` or similar. Change to:

```tsx
accept=".csv,.parquet,.json,.xlsx,.xls"
```

- [ ] **Step 3: Add Excel import branch**

Find where the import is dispatched based on file extension. Add an Excel branch:

```tsx
const ext = file.name.split(".").pop()?.toLowerCase();

if (ext === "xlsx" || ext === "xls") {
  const result = await invoke<{ table_name: string; row_count: number; preview: unknown[] }>(
    "import_excel_file",
    { path: filePath, sheetName: null }
  );
  setImportStatus(`✓ Imported "${result.table_name}" — ${result.row_count.toLocaleString()} rows`);
  onImportComplete?.(result.table_name);
} else {
  // existing CSV/Parquet logic
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dialogs/FileImportDialog.tsx
git commit -m "feat(connectors): extend FileImportDialog to accept .xlsx/.xls and call import_excel_file"
```

---

## Task 8: Listen for health monitor events in frontend

**Files:**
- Modify: `src/lib/stores/WorkspaceStore.ts`

- [ ] **Step 1: Add connection health state to WorkspaceStore**

Find the `WorkspaceStore` state interface. Add:

```typescript
connectionHealth: Record<string, "connected" | "dropped" | "reconnecting">;
setConnectionHealth: (id: string, status: "connected" | "dropped" | "reconnecting") => void;
```

In the store's `create(...)` initial state:
```typescript
connectionHealth: {},
```

Add the action:
```typescript
setConnectionHealth: (id, status) =>
  set((state) => ({
    connectionHealth: { ...state.connectionHealth, [id]: status },
  })),
```

- [ ] **Step 2: Listen for health events on app init**

Find where Tauri event listeners are set up (likely in `App.tsx` or a `useEffect` in a top-level component). Add:

```typescript
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "./lib/stores/WorkspaceStore";

// In useEffect or app init:
const unsubDrop = await listen<{ connection_id: string }>("connection_dropped", (event) => {
  useWorkspaceStore.getState().setConnectionHealth(event.payload.connection_id, "dropped");
});

const unsubRestore = await listen<{ connection_id: string }>("connection_restored", (event) => {
  useWorkspaceStore.getState().setConnectionHealth(event.payload.connection_id, "connected");
});

// Cleanup on unmount:
return () => {
  unsubDrop();
  unsubRestore();
};
```

- [ ] **Step 3: Show connection status indicator**

Find the connections list in the sidebar (likely `ConnectionSidebar.tsx` or `SchemaTree.tsx`). For each connection entry, read `connectionHealth[conn.id]` and show a colored dot:

```tsx
const health = connectionHealth[conn.id] ?? "connected";
<span
  className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
    health === "dropped" ? "bg-red-500" : "bg-green-500"
  }`}
/>
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/WorkspaceStore.ts src/App.tsx
git commit -m "feat(connectors): wire connection_dropped/restored events to sidebar health dots"
```

---

## Validation

- [ ] Run `cargo check` — zero errors
- [ ] Run `npm run lint` — zero TypeScript errors
- [ ] Run `npm run tauri:dev` — app starts
- [ ] ConnectionDialog shows "REST API" driver option
- [ ] REST test button fetches a public API (e.g. `https://jsonplaceholder.typicode.com/posts`) and shows row count
- [ ] FileImportDialog accepts `.xlsx` files
- [ ] Excel import returns table name and row count preview
- [ ] Health monitor: disconnect from a DB while app is running → red dot appears in sidebar within 35s
