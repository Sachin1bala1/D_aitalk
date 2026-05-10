use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures::StreamExt;
use futures::TryStreamExt;
use serde_json::{Map, Value};
use sqlx::Column;
use tauri::{AppHandle, Emitter};

use super::connection_manager::ActiveConnection;
use super::types::{ColumnMeta, DisplayType, QueryBatch};
use crate::error::DbError;

const BATCH_SIZE: usize = 500;

pub type CancelSet = Arc<Mutex<HashSet<String>>>;

/// Check if a query has been cancelled; remove it from the set if so.
fn is_cancelled(cancelled: &CancelSet, query_id: &str) -> bool {
    let mut lock = cancelled.lock().unwrap();
    if lock.contains(query_id) {
        lock.remove(query_id);
        true
    } else {
        false
    }
}

pub async fn execute_streaming(
    conn: Arc<ActiveConnection>,
    sql: String,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    match conn.as_ref() {
        ActiveConnection::Postgres(pool)           => stream_postgres(pool, &sql, query_id, app, cancelled).await,
        ActiveConnection::Mysql(pool)              => stream_mysql(pool, &sql, query_id, app, cancelled).await,
        ActiveConnection::Sqlite(pool)             => stream_sqlite(pool, &sql, query_id, app, cancelled).await,
        ActiveConnection::Mssql(client)            => stream_mssql(client, &sql, query_id, app, cancelled).await,
        ActiveConnection::Mongodb(client, db_name) => stream_mongodb(client, db_name, &sql, query_id, app, cancelled).await,
        ActiveConnection::Redis(mgr)               => stream_redis(mgr, &sql, query_id, app, cancelled).await,
        ActiveConnection::ClickHouse(client)       => stream_clickhouse(client, &sql, query_id, app, cancelled).await,
    }
}

async fn stream_postgres(
    pool: &sqlx::PgPool,
    sql: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    let start = Instant::now();
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut columns_sent = false;
    let mut columns: Vec<ColumnMeta> = Vec::new();

    while let Some(row_result) = stream.next().await {
        let row = row_result?;

        if !columns_sent {
            columns = extract_pg_columns(&row);
            emit_batch(
                &app, &query_id, 0, vec![], Some(columns.clone()), false,
                start.elapsed().as_millis() as u64, 0,
            )?;
            columns_sent = true;
        }

        batch.push(pg_row_to_json(&row, &columns));
        total_rows += 1;

        if batch.len() >= BATCH_SIZE {
            if is_cancelled(&cancelled, &query_id) {
                emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                    start.elapsed().as_millis() as u64, total_rows)?;
                return Ok(());
            }
            batch_index += 1;
            emit_batch(
                &app, &query_id, batch_index,
                std::mem::take(&mut batch), None, false,
                start.elapsed().as_millis() as u64, total_rows,
            )?;
        }
    }

    emit_batch(
        &app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows,
    )?;
    Ok(())
}

async fn stream_mysql(
    pool: &sqlx::MySqlPool,
    sql: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    use sqlx::Row;
    let start = Instant::now();
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut columns_sent = false;

    while let Some(row_result) = stream.next().await {
        let row = row_result?;
        let col_count = row.len();

        if !columns_sent {
            let cols = (0..col_count)
                .map(|i| {
                    let name = row.column(i).name().to_string();
                    let type_info = row.column(i).type_info().to_string();
                    let display_type = DisplayType::from_mysql_type(&type_info);
                    ColumnMeta { name, type_name: type_info, display_type, nullable: true, is_primary_key: false }
                })
                .collect::<Vec<_>>();
            emit_batch(&app, &query_id, 0, vec![], Some(cols), false, 0, 0)?;
            columns_sent = true;
        }

        let mut obj = Map::new();
        for i in 0..col_count {
            let name = row.column(i).name().to_string();
            let val: Value = row.try_get::<Value, _>(i).unwrap_or(Value::Null);
            obj.insert(name, val);
        }
        batch.push(Value::Object(obj));
        total_rows += 1;

        if batch.len() >= BATCH_SIZE {
            if is_cancelled(&cancelled, &query_id) {
                emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                    start.elapsed().as_millis() as u64, total_rows)?;
                return Ok(());
            }
            batch_index += 1;
            emit_batch(
                &app, &query_id, batch_index,
                std::mem::take(&mut batch), None, false,
                start.elapsed().as_millis() as u64, total_rows,
            )?;
        }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

async fn stream_sqlite(
    pool: &sqlx::SqlitePool,
    sql: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    use sqlx::Row;
    let start = Instant::now();
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut columns_sent = false;

    while let Some(row_result) = stream.next().await {
        let row = row_result?;
        let col_count = row.len();

        if !columns_sent {
            let cols = (0..col_count)
                .map(|i| ColumnMeta {
                    name: row.column(i).name().to_string(),
                    type_name: row.column(i).type_info().to_string(),
                    display_type: DisplayType::Text,
                    nullable: true,
                    is_primary_key: false,
                })
                .collect();
            emit_batch(&app, &query_id, 0, vec![], Some(cols), false, 0, 0)?;
            columns_sent = true;
        }

        let mut obj = Map::new();
        for i in 0..col_count {
            let name = row.column(i).name().to_string();
            let val: Value = row.try_get(i).unwrap_or(Value::Null);
            obj.insert(name, val);
        }
        batch.push(Value::Object(obj));
        total_rows += 1;

        if batch.len() >= BATCH_SIZE {
            if is_cancelled(&cancelled, &query_id) {
                emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                    start.elapsed().as_millis() as u64, total_rows)?;
                return Ok(());
            }
            batch_index += 1;
            emit_batch(
                &app, &query_id, batch_index,
                std::mem::take(&mut batch), None, false,
                start.elapsed().as_millis() as u64, total_rows,
            )?;
        }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

async fn stream_mssql(
    client_arc: &Arc<tokio::sync::Mutex<super::connection_manager::MssqlClient>>,
    sql: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    let start = Instant::now();
    let mut guard = client_arc.lock().await;

    // Get column metadata before row streaming
    let mut query_stream = guard
        .query(sql, &[])
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;

    // columns() reads ahead past any metadata frames
    let cols_opt = query_stream
        .columns()
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;

    let col_metas: Vec<ColumnMeta> = if let Some(cols) = cols_opt {
        cols.iter()
            .map(|c| {
                let type_name = format!("{:?}", c.column_type());
                let display_type = DisplayType::from_mssql_type(&type_name);
                let name = c.name().to_string();
                let display_type = if name.to_lowercase().contains("sensor_id")
                    || name.to_lowercase().contains("machine_id")
                    || name.to_lowercase().contains("tag_name")
                {
                    DisplayType::SensorId
                } else {
                    display_type
                };
                ColumnMeta { name, type_name, display_type, nullable: true, is_primary_key: false }
            })
            .collect()
    } else {
        vec![]
    };

    if !col_metas.is_empty() {
        emit_batch(&app, &query_id, 0, vec![], Some(col_metas.clone()), false, 0, 0)?;
    }

    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;

    while let Some(item) = query_stream
        .try_next()
        .await
        .map_err(|e| DbError::Other(e.to_string()))?
    {
        let row = match item {
            tiberius::QueryItem::Row(r) => r,
            tiberius::QueryItem::Metadata(_) => continue,
        };
        batch.push(mssql_row_to_json(&row));
        total_rows += 1;

        if batch.len() >= BATCH_SIZE {
            if is_cancelled(&cancelled, &query_id) {
                emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                    start.elapsed().as_millis() as u64, total_rows)?;
                return Ok(());
            }
            batch_index += 1;
            emit_batch(
                &app, &query_id, batch_index,
                std::mem::take(&mut batch), None, false,
                start.elapsed().as_millis() as u64, total_rows,
            )?;
        }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

/// ClickHouse streaming — appends FORMAT JSONEachRow and streams NDJSON lines.
async fn stream_clickhouse(
    client: &clickhouse::Client,
    sql: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    let start = Instant::now();

    // Append FORMAT JSONEachRow unless the query already specifies a format
    let sql_with_format = if sql.to_uppercase().contains("FORMAT") {
        sql.to_string()
    } else {
        format!("{} FORMAT JSONEachRow", sql.trim_end_matches(';'))
    };

    let mut cursor = client
        .query(&sql_with_format)
        .fetch_bytes("JSONEachRow")
        .map_err(|e| DbError::Other(format!("ClickHouse query error: {e}")))?;

    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut columns_sent = false;
    let mut leftover = String::new();

    loop {
        if is_cancelled(&cancelled, &query_id) {
            emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                start.elapsed().as_millis() as u64, total_rows)?;
            return Ok(());
        }

        let chunk = cursor.next().await
            .map_err(|e| DbError::Other(format!("ClickHouse stream error: {e}")))?;

        let chunk = match chunk {
            Some(b) => b,
            None => break,
        };

        leftover.push_str(&String::from_utf8_lossy(&chunk));

        // Parse complete NDJSON lines
        while let Some(nl) = leftover.find('\n') {
            let line = leftover[..nl].trim().to_string();
            leftover = leftover[nl + 1..].to_string();
            if line.is_empty() { continue; }

            if let Ok(row_val) = serde_json::from_str::<serde_json::Map<String, Value>>(&line) {
                // Emit column metadata from first row
                if !columns_sent {
                    columns_sent = true;
                    let cols: Vec<ColumnMeta> = row_val.keys().map(|k| ColumnMeta {
                        name: k.clone(),
                        type_name: "string".to_string(),
                        display_type: DisplayType::Text,
                        nullable: true,
                        is_primary_key: false,
                    }).collect();
                    emit_batch(&app, &query_id, 0, vec![], Some(cols), false, 0, 0)?;
                }
                batch.push(Value::Object(row_val));
                total_rows += 1;

                if batch.len() >= BATCH_SIZE {
                    batch_index += 1;
                    emit_batch(&app, &query_id, batch_index, std::mem::take(&mut batch), None, false,
                        start.elapsed().as_millis() as u64, total_rows)?;
                }
            }
        }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

/// Redis "query" — `sql` is interpreted as a key prefix (e.g. "session" scans "session:*").
/// Streams key/type/ttl/value rows in batches via query_batch events.
async fn stream_redis(
    mgr: &redis::aio::ConnectionManager,
    prefix: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    use redis::AsyncCommands;

    let start = Instant::now();
    let mut conn = mgr.clone();
    let pattern = if prefix.trim().is_empty() { "*".to_string() } else { format!("{}:*", prefix.trim()) };

    // SCAN with match pattern, iterate all cursor pages
    let columns = vec![
        ColumnMeta { name: "key".to_string(),   type_name: "string".to_string(),  display_type: DisplayType::Text,    nullable: false, is_primary_key: true },
        ColumnMeta { name: "type".to_string(),  type_name: "string".to_string(),  display_type: DisplayType::Text,    nullable: false, is_primary_key: false },
        ColumnMeta { name: "ttl".to_string(),   type_name: "integer".to_string(), display_type: DisplayType::Integer, nullable: true,  is_primary_key: false },
        ColumnMeta { name: "value".to_string(), type_name: "string".to_string(),  display_type: DisplayType::Text,    nullable: true,  is_primary_key: false },
    ];

    emit_batch(&app, &query_id, 0, vec![], Some(columns), false, 0, 0)?;

    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut cursor: i64 = 0;

    loop {
        if is_cancelled(&cancelled, &query_id) {
            emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                start.elapsed().as_millis() as u64, total_rows)?;
            return Ok(());
        }

        let (next_cursor, keys): (i64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(100i64)
            .query_async(&mut conn)
            .await
            .map_err(|e| DbError::Other(format!("Redis SCAN failed: {e}")))?;

        for key in keys {
            let key_type: String = redis::cmd("TYPE")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .unwrap_or_else(|_| "unknown".to_string());

            let ttl: i64 = redis::cmd("TTL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .unwrap_or(-1);

            // GET only works for string type; others show type hint
            let val_str: String = if key_type == "string" {
                conn.get::<_, Option<String>>(&key).await.unwrap_or(None).unwrap_or_default()
            } else {
                format!("<{}>", key_type)
            };

            let mut obj = Map::new();
            obj.insert("key".to_string(),   Value::from(key));
            obj.insert("type".to_string(),  Value::from(key_type));
            obj.insert("ttl".to_string(),   if ttl < 0 { Value::Null } else { Value::from(ttl) });
            obj.insert("value".to_string(), Value::from(val_str));
            batch.push(Value::Object(obj));
            total_rows += 1;

            if batch.len() >= BATCH_SIZE {
                batch_index += 1;
                emit_batch(&app, &query_id, batch_index, std::mem::take(&mut batch), None, false,
                    start.elapsed().as_millis() as u64, total_rows)?;
            }
        }

        cursor = next_cursor;
        if cursor == 0 { break; }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

/// MongoDB "query" — the `sql` parameter is interpreted as a collection name.
/// We do a full collection scan streamed in batches. Filtering/sorting via
/// the agent's `execute_sql` command passes the collection name; actual MQL
/// aggregation pipelines are a future enhancement.
async fn stream_mongodb(
    client: &mongodb::Client,
    db_name: &str,
    collection: &str,
    query_id: String,
    app: AppHandle,
    cancelled: CancelSet,
) -> Result<(), DbError> {
    use futures::TryStreamExt;
    use mongodb::bson::Document;

    let start = Instant::now();
    let coll = client.database(db_name).collection::<Document>(collection.trim());

    let mut cursor = coll
        .find(mongodb::bson::doc! {})
        .await
        .map_err(|e| DbError::Other(format!("MongoDB find failed: {e}")))?;

    let mut batch: Vec<Value> = Vec::with_capacity(BATCH_SIZE);
    let mut batch_index = 0u32;
    let mut total_rows = 0u64;
    let mut first_batch = true;

    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| DbError::Other(e.to_string()))?
    {
        if is_cancelled(&cancelled, &query_id) {
            emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
                start.elapsed().as_millis() as u64, total_rows)?;
            return Ok(());
        }

        let row = bson_doc_to_json(&doc);
        batch.push(row);
        total_rows += 1;

        if batch.len() >= BATCH_SIZE {
            batch_index += 1;
            // Emit column metadata derived from first document on first batch
            let cols = if first_batch {
                first_batch = false;
                Some(bson_doc_columns(&doc))
            } else {
                None
            };
            emit_batch(&app, &query_id, batch_index, std::mem::take(&mut batch), cols, false,
                start.elapsed().as_millis() as u64, total_rows)?;
        }
    }

    emit_batch(&app, &query_id, batch_index + 1, batch, None, true,
        start.elapsed().as_millis() as u64, total_rows)?;
    Ok(())
}

fn bson_doc_to_json(doc: &mongodb::bson::Document) -> Value {
    let mut obj = Map::new();
    for (key, val) in doc.iter() {
        obj.insert(key.clone(), bson_to_json(val));
    }
    Value::Object(obj)
}

fn bson_to_json(v: &mongodb::bson::Bson) -> Value {
    use mongodb::bson::Bson;
    match v {
        Bson::Double(f)     => Value::from(*f),
        Bson::String(s)     => Value::from(s.as_str()),
        Bson::Boolean(b)    => Value::from(*b),
        Bson::Int32(i)      => Value::from(*i),
        Bson::Int64(i)      => Value::from(*i),
        Bson::Null          => Value::Null,
        Bson::ObjectId(oid) => Value::from(oid.to_hex()),
        Bson::DateTime(dt)  => Value::from(dt.to_string()),
        Bson::Document(d)   => bson_doc_to_json(d),
        Bson::Array(arr)    => Value::Array(arr.iter().map(bson_to_json).collect()),
        other               => Value::from(other.to_string()),
    }
}

fn bson_doc_columns(doc: &mongodb::bson::Document) -> Vec<ColumnMeta> {
    use mongodb::bson::Bson;
    let mut cols: Vec<ColumnMeta> = doc.iter().map(|(key, val)| {
        let type_name = match val {
            Bson::Double(_) | Bson::Decimal128(_) => "double",
            Bson::Int32(_)                        => "int32",
            Bson::Int64(_)                        => "int64",
            Bson::Boolean(_)                      => "bool",
            Bson::DateTime(_) | Bson::Timestamp(_)=> "date",
            Bson::Document(_)                     => "object",
            Bson::Array(_)                        => "array",
            Bson::Binary(_)                       => "binary",
            Bson::ObjectId(_)                     => "objectId",
            _                                     => "string",
        };
        let display_type = match val {
            Bson::Double(_) | Bson::Decimal128(_) => DisplayType::Float,
            Bson::Int32(_) | Bson::Int64(_)        => DisplayType::Integer,
            Bson::Boolean(_)                       => DisplayType::Boolean,
            Bson::DateTime(_) | Bson::Timestamp(_) => DisplayType::Timestamp,
            Bson::Document(_) | Bson::Array(_)     => DisplayType::Json,
            Bson::Binary(_)                        => DisplayType::Bytes,
            _                                      => DisplayType::Text,
        };
        ColumnMeta {
            name: key.clone(),
            type_name: type_name.to_string(),
            display_type,
            nullable: true,
            is_primary_key: key == "_id",
        }
    }).collect();
    // _id first
    cols.sort_by(|a, b| {
        if a.name == "_id" { std::cmp::Ordering::Less }
        else if b.name == "_id" { std::cmp::Ordering::Greater }
        else { a.name.cmp(&b.name) }
    });
    cols
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn emit_batch(
    app: &AppHandle,
    query_id: &str,
    batch_index: u32,
    rows: Vec<Value>,
    columns: Option<Vec<ColumnMeta>>,
    is_final: bool,
    elapsed_ms: u64,
    rows_so_far: u64,
) -> Result<(), DbError> {
    app.emit(
        "query_batch",
        QueryBatch {
            query_id: query_id.to_string(),
            batch_index,
            rows,
            columns,
            is_final,
            total_elapsed_ms: elapsed_ms,
            rows_so_far,
            error: None,
        },
    )
    .map_err(|e| DbError::Other(e.to_string()))
}

fn extract_pg_columns(row: &sqlx::postgres::PgRow) -> Vec<ColumnMeta> {
    use sqlx::Row;
    (0..row.len())
        .map(|i| {
            let col = row.column(i);
            let type_str = col.type_info().to_string();
            let display_type = DisplayType::from_pg_type(&type_str);

            let name = col.name().to_string();
            let display_type = if name.to_lowercase().contains("sensor_id")
                || name.to_lowercase().contains("machine_id")
                || name.to_lowercase().contains("asset_tag")
                || name.to_lowercase().contains("tag_name")
            {
                DisplayType::SensorId
            } else {
                display_type
            };

            ColumnMeta {
                name,
                type_name: type_str,
                display_type,
                nullable: true,
                is_primary_key: false,
            }
        })
        .collect()
}

fn pg_row_to_json(row: &sqlx::postgres::PgRow, columns: &[ColumnMeta]) -> Value {
    use sqlx::Row;
    let mut obj = Map::new();
    for (i, col) in columns.iter().enumerate() {
        let val: Value = row.try_get(i).unwrap_or(Value::Null);
        obj.insert(col.name.clone(), val);
    }
    Value::Object(obj)
}

fn mssql_row_to_json(row: &tiberius::Row) -> Value {
    let mut obj = Map::new();
    for (col, data) in row.cells() {
        let val = mssql_cell_to_value(data);
        obj.insert(col.name().to_string(), val);
    }
    Value::Object(obj)
}

fn mssql_cell_to_value(data: &tiberius::ColumnData<'static>) -> Value {
    use tiberius::ColumnData;
    match data {
        ColumnData::U8(v) => v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
        ColumnData::I16(v) => v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
        ColumnData::I32(v) => v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
        ColumnData::I64(v) => v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
        ColumnData::F32(v) => v
            .and_then(|f| serde_json::Number::from_f64(f64::from(f)))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ColumnData::F64(v) => v
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ColumnData::Bit(v) => v.map(Value::Bool).unwrap_or(Value::Null),
        ColumnData::String(v) => v
            .as_ref()
            .map(|s| Value::String(s.as_ref().to_string()))
            .unwrap_or(Value::Null),
        ColumnData::Binary(v) => v
            .as_ref()
            .map(|b| Value::String(b.iter().map(|x| format!("{:02x}", x)).collect()))
            .unwrap_or(Value::Null),
        ColumnData::Guid(v) => v.map(|u| Value::String(u.to_string())).unwrap_or(Value::Null),
        ColumnData::Numeric(v) => v.map(|n| Value::String(n.to_string())).unwrap_or(Value::Null),
        ColumnData::Xml(v) => v
            .as_ref()
            .map(|x| Value::String(x.to_string()))
            .unwrap_or(Value::Null),
        // days since 1900-01-01; seconds_fragments = 1/300 second units
        ColumnData::DateTime(v) => v
            .map(|dt| {
                let base = chrono::NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
                let date = base + chrono::Duration::days(i64::from(dt.days()));
                let ns = i64::from(dt.seconds_fragments()) * 1_000_000_000 / 300;
                let time = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                    + chrono::Duration::nanoseconds(ns);
                Value::String(chrono::NaiveDateTime::new(date, time).to_string())
            })
            .unwrap_or(Value::Null),
        // days since 1900-01-01; seconds_fragments = minutes since midnight
        ColumnData::SmallDateTime(v) => v
            .map(|dt| {
                let base = chrono::NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
                let date = base + chrono::Duration::days(i64::from(dt.days()));
                let time = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                    + chrono::Duration::minutes(i64::from(dt.seconds_fragments()));
                Value::String(chrono::NaiveDateTime::new(date, time).to_string())
            })
            .unwrap_or(Value::Null),
        // TDS 7.3 types (SQL Server 2008+) — enabled via tds73 feature
        ColumnData::Date(v) => v
            .map(|d| {
                let base = chrono::NaiveDate::from_ymd_opt(1, 1, 1).unwrap();
                Value::String((base + chrono::Duration::days(i64::from(d.days()))).to_string())
            })
            .unwrap_or(Value::Null),
        ColumnData::Time(v) => v
            .map(|t| {
                let ns =
                    t.increments() as i64 * 10i64.pow(9u32.saturating_sub(u32::from(t.scale())));
                let time = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                    + chrono::Duration::nanoseconds(ns);
                Value::String(time.to_string())
            })
            .unwrap_or(Value::Null),
        ColumnData::DateTime2(v) => v
            .map(|dt| {
                let base = chrono::NaiveDate::from_ymd_opt(1, 1, 1).unwrap();
                let date = base + chrono::Duration::days(i64::from(dt.date().days()));
                let ns = dt.time().increments() as i64
                    * 10i64.pow(9u32.saturating_sub(u32::from(dt.time().scale())));
                let time = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                    + chrono::Duration::nanoseconds(ns);
                Value::String(chrono::NaiveDateTime::new(date, time).to_string())
            })
            .unwrap_or(Value::Null),
        ColumnData::DateTimeOffset(v) => v
            .map(|dto| {
                let base = chrono::NaiveDate::from_ymd_opt(1, 1, 1).unwrap();
                let date =
                    base + chrono::Duration::days(i64::from(dto.datetime2().date().days()));
                let ns = dto.datetime2().time().increments() as i64
                    * 10i64.pow(
                        9u32.saturating_sub(u32::from(dto.datetime2().time().scale())),
                    );
                let time = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                    + chrono::Duration::nanoseconds(ns);
                // subtract offset (minutes) to convert to UTC
                let naive = chrono::NaiveDateTime::new(date, time)
                    - chrono::Duration::minutes(i64::from(dto.offset()));
                Value::String(format!("{}+00:00", naive))
            })
            .unwrap_or(Value::Null),
    }
}

/// Execute a non-streaming statement (DDL, DML) and return affected rows.
pub async fn execute_ddl(
    conn: Arc<ActiveConnection>,
    sql: &str,
) -> Result<u64, DbError> {
    match conn.as_ref() {
        ActiveConnection::Postgres(pool) => {
            Ok(sqlx::query(sql).execute(pool).await?.rows_affected())
        }
        ActiveConnection::Mysql(pool) => {
            Ok(sqlx::query(sql).execute(pool).await?.rows_affected())
        }
        ActiveConnection::Sqlite(pool) => {
            Ok(sqlx::query(sql).execute(pool).await?.rows_affected())
        }
        ActiveConnection::Mssql(client) => {
            let mut guard = client.lock().await;
            let result = guard
                .execute(sql, &[])
                .await
                .map_err(|e| DbError::Other(e.to_string()))?;
            Ok(result.rows_affected().iter().sum())
        }
        ActiveConnection::Mongodb(_, _) => {
            Err(DbError::Other("DDL/DML execute not supported for MongoDB — use collection scan via db_execute_streaming.".to_string()))
        }
        ActiveConnection::Redis(_) => {
            Err(DbError::Other("DDL/DML execute not supported for Redis — use key scan via db_execute_streaming.".to_string()))
        }
        ActiveConnection::ClickHouse(client) => {
            client.query(sql).execute().await
                .map_err(|e| DbError::Other(e.to_string()))?;
            Ok(0)
        }
    }
}
