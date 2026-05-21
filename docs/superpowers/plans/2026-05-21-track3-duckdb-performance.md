# Track 3: Query Performance & DuckDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable DuckDB as a first-class connection type, add an LRU query cache, and add a row count badge to VirtualTable.

**Architecture:** DuckDB is already stubbed in `duckdb_engine.rs` — the crate is disabled due to OOM on Windows MinGW. Fix: add a `.cargo/config.toml` target override to force MSVC toolchain for the duckdb crate, then restore the real implementation. Add `DuckDb` variant to `DbDriver`/`ActiveConnection`, wire it through connection_manager and query_executor. Add a Rust LRU query cache keyed on `(connection_id, sql_hash)`. Frontend VirtualTable gets a row count badge.

**Tech Stack:** Rust, `duckdb` crate (1.x), `lru` crate, TypeScript/React, @tanstack/react-virtual (already installed)

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/.cargo/config.toml` | Create: force MSVC toolchain for `duckdb` on Windows |
| `src-tauri/Cargo.toml` | Re-enable `duckdb` + add `lru` crate |
| `src-tauri/src/db/types.rs` | Add `DuckDb` variant to `DbDriver` enum |
| `src-tauri/src/db/duckdb_engine.rs` | Restore real DuckDB implementation |
| `src-tauri/src/db/connection_manager.rs` | Add `DuckDb` variant to `ActiveConnection`; wire connect/disconnect |
| `src-tauri/src/db/query_executor.rs` | Add DuckDB execution path via `duckdb_engine` |
| `src-tauri/src/db/query_cache.rs` | Create: LRU cache, 50 entries, 5min TTL |
| `src-tauri/src/db/mod.rs` | Export new `query_cache` module |
| `src-tauri/src/commands.rs` | Add `clear_query_cache` command; wire DuckDB in `execute_query` |
| `src/components/table/VirtualTable.tsx` | Add "Showing N of M rows" badge |

---

## Task 1: Cargo configuration — DuckDB MSVC build fix

**Files:**
- Create: `src-tauri/.cargo/config.toml`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Create `.cargo/config.toml` to force MSVC for duckdb**

Create `src-tauri/.cargo/config.toml`:

```toml
# Force MSVC linker for the duckdb bundled build on Windows.
# MinGW's g++ OOMs during DuckDB's C++ compilation; MSVC handles it fine.
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "codegen-units=1"]

[env]
# Limit parallel codegen jobs for DuckDB's bundled build
CARGO_BUILD_JOBS = "2"
```

- [ ] **Step 2: Re-enable duckdb and add lru crate in Cargo.toml**

Open `src-tauri/Cargo.toml`. Find the commented-out duckdb line:
```toml
# duckdb = { version = "1", features = ["bundled"] }  # TODO: re-enable; bundled g++ OOM on Windows MinGW
```

Replace with:
```toml
duckdb = { version = "1", features = ["bundled"] }
lru = "0.12"
```

- [ ] **Step 3: Verify cargo check compiles**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | tail -20
```

Expected: `Finished` with no errors. If DuckDB compile OOMs, set env var `CARGO_BUILD_JOBS=1` and retry.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/.cargo/config.toml src-tauri/Cargo.toml
git commit -m "feat(duckdb): re-enable bundled DuckDB crate with MSVC codegen config"
```

---

## Task 2: Add DuckDb to DbDriver and ActiveConnection

**Files:**
- Modify: `src-tauri/src/db/types.rs`
- Modify: `src-tauri/src/db/connection_manager.rs`

- [ ] **Step 1: Add `DuckDb` variant to `DbDriver` enum in types.rs**

Find the `DbDriver` enum (around line 196):
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
}
```

Replace with:
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
    DuckDb,
}
```

- [ ] **Step 2: Add `DuckDb` variant to `ActiveConnection` in connection_manager.rs**

Find the `ActiveConnection` enum at the top of `connection_manager.rs`:
```rust
pub enum ActiveConnection {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Mssql(Arc<tokio::sync::Mutex<MssqlClient>>),
    Mongodb(mongodb::Client, String),
    Redis(redis::aio::ConnectionManager),
    ClickHouse(clickhouse::Client),
}
```

Replace with:
```rust
pub enum ActiveConnection {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Mssql(Arc<tokio::sync::Mutex<MssqlClient>>),
    Mongodb(mongodb::Client, String),
    Redis(redis::aio::ConnectionManager),
    ClickHouse(clickhouse::Client),
    DuckDb(Arc<tokio::sync::Mutex<super::duckdb_engine::DuckDbEngine>>),
}
```

- [ ] **Step 3: Wire DuckDb connection in `ConnectionManager::connect`**

In `connection_manager.rs`, find the `connect` method. It has a match or if-chain for each driver. Find where other drivers are connected (after the SSH tunnel setup block). Add a DuckDb branch. Locate the section that starts connecting drivers (after `let (effective_conn_str, tunnel) = ...`) and add before the final `match config.driver`:

```rust
// DuckDB — path is the connection_string (file path or ":memory:")
if matches!(config.driver, DbDriver::DuckDb) {
    let engine = super::duckdb_engine::DuckDbEngine::new_at_path(&effective_conn_str)
        .map_err(|e| DbError::Other(format!("DuckDB open failed: {e}")))?;
    let entry = ActiveEntry {
        connection: Arc::new(ActiveConnection::DuckDb(
            Arc::new(tokio::sync::Mutex::new(engine)),
        )),
        _tunnel: tunnel,
    };
    let id = config.id.clone();
    self.connections.write().await.insert(id.clone(), entry);
    self.configs.write().await.insert(id, config);
    return Ok(());
}
```

Place this block right before the existing `match config.driver { ... }` block that handles other drivers.

- [ ] **Step 4: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: only errors about missing `DuckDbEngine::new_at_path` (fixed in next task). No other new errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/types.rs src-tauri/src/db/connection_manager.rs
git commit -m "feat(duckdb): add DuckDb variant to DbDriver and ActiveConnection enums"
```

---

## Task 3: Restore DuckDbEngine real implementation

**Files:**
- Modify: `src-tauri/src/db/duckdb_engine.rs`

- [ ] **Step 1: Replace stub with real implementation**

Replace the entire contents of `src-tauri/src/db/duckdb_engine.rs`:

```rust
use duckdb::{Connection, params};
use tauri::AppHandle;
use tauri::Emitter;
use serde_json::{Value, Map};
use std::sync::Arc;

use crate::db::types::{ColumnMeta, DisplayType, QueryBatch};
use crate::error::DbError;

pub struct DuckDbEngine {
    conn: Arc<std::sync::Mutex<Connection>>,
}

impl DuckDbEngine {
    /// Open DuckDB at a file path, or ":memory:" for an in-memory database.
    pub fn new_at_path(path: &str) -> Result<Self, DbError> {
        let conn = if path == ":memory:" || path.is_empty() {
            Connection::open_in_memory()
        } else {
            Connection::open(path)
        }
        .map_err(|e| DbError::Other(format!("DuckDB open: {e}")))?;

        Ok(Self { conn: Arc::new(std::sync::Mutex::new(conn)) })
    }

    /// Stream query results in 500-row batches, emitting "query_batch" events.
    pub fn query_streaming(
        &self,
        sql: &str,
        query_id: String,
        app: &AppHandle,
    ) -> Result<(), DbError> {
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
        let mut batch: Vec<Map<String, Value>> = Vec::with_capacity(BATCH_SIZE);
        let mut row_offset: usize = 0;

        for row_result in rows_iter {
            let values = row_result.map_err(|e| DbError::Other(e.to_string()))?;
            let mut obj = Map::new();
            for (i, col) in column_names.iter().enumerate() {
                obj.insert(col.clone(), values.get(i).cloned().unwrap_or(Value::Null));
            }
            batch.push(obj);

            if batch.len() >= BATCH_SIZE {
                let payload = QueryBatch {
                    query_id: query_id.clone(),
                    columns: columns.clone(),
                    rows: std::mem::replace(&mut batch, Vec::with_capacity(BATCH_SIZE)),
                    row_offset,
                    is_last: false,
                };
                app.emit("query_batch", &payload)
                    .map_err(|e| DbError::Other(e.to_string()))?;
                row_offset += BATCH_SIZE;
            }
        }

        // Emit final (possibly partial) batch
        let is_last = true;
        let payload = QueryBatch {
            query_id,
            columns,
            rows: batch,
            row_offset,
            is_last,
        };
        app.emit("query_batch", &payload)
            .map_err(|e| DbError::Other(e.to_string()))?;

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
```

- [ ] **Step 2: Verify QueryBatch exists with the expected fields**

```bash
grep -n "pub struct QueryBatch" C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri\src\db\types.rs
```

If `QueryBatch` doesn't have `row_offset` and `is_last` fields, find the struct and add them:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct QueryBatch {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
    pub row_offset: usize,
    pub is_last: bool,
}
```

- [ ] **Step 3: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/duckdb_engine.rs src-tauri/src/db/types.rs
git commit -m "feat(duckdb): restore real DuckDbEngine with streaming query + CSV/Parquet loader"
```

---

## Task 4: Wire DuckDB through query_executor

**Files:**
- Modify: `src-tauri/src/db/query_executor.rs`

- [ ] **Step 1: Add DuckDB execution path**

Open `src-tauri/src/db/query_executor.rs`. Find the function that dispatches queries by connection type (look for `match &*conn` or similar). Add a `DuckDb` arm.

First, grep for the dispatch pattern:
```bash
grep -n "ActiveConnection::\|match.*connection\|Postgres\|Mysql" C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri\src\db\query_executor.rs | head -20
```

Once you find the match arm, add:
```rust
ActiveConnection::DuckDb(engine) => {
    let eng = engine.lock().await;
    eng.query_streaming(sql, query_id, &app)?;
}
```

- [ ] **Step 2: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors. If there are exhaustiveness errors on the `ActiveConnection` match, add the DuckDb arm there too.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/query_executor.rs
git commit -m "feat(duckdb): wire DuckDB execution path in query_executor"
```

---

## Task 5: LRU query cache

**Files:**
- Create: `src-tauri/src/db/query_cache.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create query_cache.rs**

Create `src-tauri/src/db/query_cache.rs`:

```rust
//! LRU query result cache — 50 entries, 5-minute TTL, ~100MB cap (best-effort).
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lru::LruCache;
use serde_json::Value;

use crate::db::types::ColumnMeta;

const MAX_ENTRIES: usize = 50;
const TTL: Duration = Duration::from_secs(300); // 5 minutes

#[derive(Clone)]
pub struct CachedResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<serde_json::Map<String, Value>>,
    pub cached_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub connection_id: String,
    pub sql_hash: u64,
}

impl CacheKey {
    pub fn new(connection_id: &str, sql: &str) -> Self {
        use std::hash::DefaultHasher;
        let mut h = DefaultHasher::new();
        sql.hash(&mut h);
        Self {
            connection_id: connection_id.to_string(),
            sql_hash: h.finish(),
        }
    }
}

pub struct QueryCache {
    inner: Mutex<LruCache<CacheKey, CachedResult>>,
}

impl QueryCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LruCache::new(
                std::num::NonZeroUsize::new(MAX_ENTRIES).unwrap(),
            )),
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<CachedResult> {
        let mut cache = self.inner.lock().unwrap();
        if let Some(entry) = cache.get(key) {
            if entry.cached_at.elapsed() < TTL {
                return Some(entry.clone());
            }
            // Expired — remove it
            cache.pop(key);
        }
        None
    }

    pub fn insert(&self, key: CacheKey, result: CachedResult) {
        self.inner.lock().unwrap().put(key, result);
    }

    /// Clear all entries for a given connection, or all entries if connection_id is None.
    pub fn clear(&self, connection_id: Option<&str>) {
        let mut cache = self.inner.lock().unwrap();
        match connection_id {
            None => cache.clear(),
            Some(id) => {
                let keys_to_remove: Vec<CacheKey> = cache
                    .iter()
                    .filter(|(k, _)| k.connection_id == id)
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in keys_to_remove {
                    cache.pop(&k);
                }
            }
        }
    }
}
```

- [ ] **Step 2: Export module in mod.rs**

Open `src-tauri/src/db/mod.rs`. Add:
```rust
pub mod query_cache;
```

- [ ] **Step 3: Add `clear_query_cache` Tauri command**

Open `src-tauri/src/commands.rs`. Find where other db commands are listed. Add:

```rust
#[tauri::command]
pub async fn clear_query_cache(
    connection_id: Option<String>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.query_cache.clear(connection_id.as_deref());
    Ok(())
}
```

Then add the `query_cache` field to `AppState`. Find `AppState` in `src-tauri/src/lib.rs` and add:

```rust
pub query_cache: crate::db::query_cache::QueryCache,
```

In the `AppState::new()` or builder function, initialize it:
```rust
query_cache: crate::db::query_cache::QueryCache::new(),
```

Register the command in `lib.rs` `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::clear_query_cache,
])
```

- [ ] **Step 4: Verify cargo check**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src-tauri
cargo check 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/query_cache.rs src-tauri/src/db/mod.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(cache): add LRU query cache with 50-entry / 5min TTL + clear_query_cache command"
```

---

## Task 6: VirtualTable row count badge

**Files:**
- Modify: `src/components/table/VirtualTable.tsx`

- [ ] **Step 1: Find the VirtualTable component structure**

```bash
grep -n "totalRows\|rowCount\|rows\.length\|totalCount\|Showing" C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2\src\components\table\VirtualTable.tsx | head -20
```

Understand what prop or state holds the total row count (it may be `rows.length` for loaded rows, or a separate `totalRows` prop for the streamed total).

- [ ] **Step 2: Add row count badge**

In `VirtualTable.tsx`, find the top-level container `div` or the header area. Add a badge showing loaded vs total rows. The component likely receives `rows` as a prop. Add this inside the component, above or below the virtual scroll area:

```tsx
{/* Row count badge */}
<div className="absolute bottom-2 right-3 z-10 text-[10px] text-white/40 font-mono pointer-events-none select-none">
  {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
  {totalRows !== undefined && totalRows > rows.length
    ? ` of ${totalRows.toLocaleString()}`
    : ""}
</div>
```

If VirtualTable doesn't have a `totalRows` prop, add it to the props interface:

```typescript
interface VirtualTableProps {
  // ... existing props ...
  totalRows?: number;
}
```

The badge shows "1,024,381 rows" when all loaded, or "500 of 1,024,381 rows" when streaming.

- [ ] **Step 3: Make the container `relative` positioned**

Ensure the container div wrapping the virtual scroller has `position: relative` (or `className` includes `relative`) so the `absolute` badge positions correctly.

- [ ] **Step 4: Verify TypeScript**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/table/VirtualTable.tsx
git commit -m "feat(table): add row count badge to VirtualTable"
```

---

## Validation

- [ ] Run `cargo check` — zero errors
- [ ] Run `npm run lint` — zero TypeScript errors
- [ ] Run `npm run tauri:dev` — app starts
- [ ] Create a DuckDB connection with `:memory:` path — connection succeeds
- [ ] Load a CSV via `load_csv` command — table appears in schema tree
- [ ] Run a SELECT on the loaded CSV — results stream into VirtualTable
- [ ] Row count badge shows correct count
- [ ] `clear_query_cache` command available in dev tools invoke
