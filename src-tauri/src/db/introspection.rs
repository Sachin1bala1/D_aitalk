use std::collections::HashMap;
use std::sync::Arc;

use redis::AsyncCommands;
use sqlx::Row;

use super::connection_manager::{ActiveConnection, MssqlClient};
use super::types::{ColumnMeta, DisplayType, FullSchema, FunctionMeta, FunctionKind, TableMeta, TableObjectType};
use crate::error::DbError;

pub async fn introspect(conn: &ActiveConnection, connection_id: &str) -> Result<FullSchema, DbError> {
    match conn {
        ActiveConnection::Postgres(pool)           => introspect_postgres(pool, connection_id).await,
        ActiveConnection::Mysql(pool)              => introspect_mysql(pool, connection_id).await,
        ActiveConnection::Sqlite(pool)             => introspect_sqlite(pool, connection_id).await,
        ActiveConnection::Mssql(client)            => introspect_mssql(client, connection_id).await,
        ActiveConnection::Mongodb(client, db_name) => introspect_mongodb(client, db_name, connection_id).await,
        ActiveConnection::Redis(mgr)               => introspect_redis(mgr, connection_id).await,
        ActiveConnection::ClickHouse(client)       => introspect_clickhouse(client, connection_id).await,
    }
}

async fn introspect_postgres(pool: &sqlx::PgPool, connection_id: &str) -> Result<FullSchema, DbError> {
    // Tables with fast row estimates (no COUNT(*))
    let tables_raw = sqlx::query(
        r#"
        SELECT
            t.table_schema,
            t.table_name,
            t.table_type,
            COALESCE(s.n_live_tup, 0) AS row_estimate,
            COALESCE(
                pg_total_relation_size(
                    (SELECT c.oid FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relname = t.table_name AND n.nspname = t.table_schema
                     LIMIT 1)
                ), 0
            ) AS size_bytes
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s
            ON s.relname = t.table_name AND s.schemaname = t.table_schema
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY t.table_schema, t.table_name
        "#,
    )
    .fetch_all(pool)
    .await?;

    let tables: Vec<TableMeta> = tables_raw
        .iter()
        .map(|r| {
            let schema: String = r.try_get("table_schema").unwrap_or_default();
            let name: String = r.try_get("table_name").unwrap_or_default();
            let table_type: String = r.try_get("table_type").unwrap_or_default();
            let row_estimate: i64 = r.try_get("row_estimate").unwrap_or(0);
            let size_bytes: i64 = r.try_get("size_bytes").unwrap_or(0);

            TableMeta {
                schema,
                name,
                row_estimate: Some(row_estimate),
                size_bytes: Some(size_bytes),
                object_type: if table_type == "VIEW" {
                    TableObjectType::View
                } else {
                    TableObjectType::Table
                },
            }
        })
        .collect();

    // Columns with PK detection
    let cols_raw = sqlx::query(
        r#"
        SELECT
            c.table_schema,
            c.table_name,
            c.column_name,
            c.data_type,
            c.is_nullable,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT ku.column_name, ku.table_name, ku.table_schema
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
                ON ku.constraint_name = tc.constraint_name
               AND ku.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON pk.column_name = c.column_name
              AND pk.table_name = c.table_name
              AND pk.table_schema = c.table_schema
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();
    for row in &cols_raw {
        let table_schema: String = row.try_get("table_schema").unwrap_or_default();
        let table_name: String = row.try_get("table_name").unwrap_or_default();
        let col_name: String = row.try_get("column_name").unwrap_or_default();
        let type_name: String = row.try_get("data_type").unwrap_or_default();
        let is_nullable: String = row.try_get("is_nullable").unwrap_or_default();
        let is_pk: bool = row.try_get("is_pk").unwrap_or(false);

        let display_type = if col_name.to_lowercase().contains("sensor_id")
            || col_name.to_lowercase().contains("machine_id")
            || col_name.to_lowercase().contains("tag_name")
        {
            DisplayType::SensorId
        } else {
            DisplayType::from_pg_type(&type_name)
        };

        let key = format!("{}.{}", table_schema, table_name);
        columns.entry(key).or_default().push(ColumnMeta {
            name: col_name,
            type_name,
            display_type,
            nullable: is_nullable == "YES",
            is_primary_key: is_pk,
        });
    }

    // Functions and procedures
    let funcs_raw = sqlx::query(
        r#"
        SELECT
            n.nspname AS schema,
            p.proname AS name,
            pg_get_function_result(p.oid) AS return_type,
            CASE p.prokind
                WHEN 'f' THEN 'function'
                WHEN 'p' THEN 'procedure'
                WHEN 'a' THEN 'aggregate'
                WHEN 'w' THEN 'function'
                ELSE 'function'
            END AS kind,
            l.lanname AS language
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND p.proname NOT LIKE 'pg_%'
        ORDER BY n.nspname, p.proname
        LIMIT 500
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let functions: Vec<FunctionMeta> = funcs_raw
        .iter()
        .map(|r| {
            let kind_str: String = r.try_get("kind").unwrap_or_default();
            let kind = match kind_str.as_str() {
                "procedure" => FunctionKind::Procedure,
                "aggregate" => FunctionKind::Aggregate,
                "trigger" => FunctionKind::Trigger,
                _ => FunctionKind::Function,
            };
            FunctionMeta {
                schema: r.try_get("schema").unwrap_or_default(),
                name: r.try_get("name").unwrap_or_default(),
                return_type: r.try_get("return_type").unwrap_or_default(),
                kind,
                language: r.try_get("language").unwrap_or_default(),
            }
        })
        .collect();

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "postgres".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions,
    })
}

async fn introspect_mysql(pool: &sqlx::MySqlPool, connection_id: &str) -> Result<FullSchema, DbError> {
    let tables_raw = sqlx::query(
        r#"
        SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE,
               COALESCE(TABLE_ROWS, 0) AS row_estimate,
               COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) AS size_bytes
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        "#,
    )
    .fetch_all(pool)
    .await?;

    let tables: Vec<TableMeta> = tables_raw
        .iter()
        .map(|r| {
            let schema: String = r.try_get("TABLE_SCHEMA").unwrap_or_default();
            let name: String = r.try_get("TABLE_NAME").unwrap_or_default();
            let table_type: String = r.try_get("TABLE_TYPE").unwrap_or_default();
            let row_estimate: i64 = r.try_get::<i64, _>("row_estimate").unwrap_or(0);
            let size_bytes: i64 = r.try_get::<i64, _>("size_bytes").unwrap_or(0);
            TableMeta {
                schema,
                name,
                row_estimate: Some(row_estimate),
                size_bytes: Some(size_bytes),
                object_type: if table_type == "VIEW" { TableObjectType::View } else { TableObjectType::Table },
            }
        })
        .collect();

    // Fetch columns for all tables
    let cols_raw = sqlx::query(
        r#"
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
               IS_NULLABLE, COLUMN_KEY
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();
    for row in &cols_raw {
        let schema: String = row.try_get("TABLE_SCHEMA").unwrap_or_default();
        let table: String  = row.try_get("TABLE_NAME").unwrap_or_default();
        let name: String   = row.try_get("COLUMN_NAME").unwrap_or_default();
        let type_name: String = row.try_get("DATA_TYPE").unwrap_or_default();
        let nullable: String  = row.try_get("IS_NULLABLE").unwrap_or_default();
        let key: String       = row.try_get("COLUMN_KEY").unwrap_or_default();
        let display_type = DisplayType::from_mysql_type(&type_name);
        columns.entry(format!("{}.{}", schema, table)).or_default().push(ColumnMeta {
            name,
            type_name,
            display_type,
            nullable: nullable == "YES",
            is_primary_key: key == "PRI",
        });
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "mysql".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

async fn introspect_sqlite(pool: &sqlx::SqlitePool, connection_id: &str) -> Result<FullSchema, DbError> {
    let tables_raw = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await?;

    let mut tables = Vec::new();
    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();

    for row in &tables_raw {
        let name: String = row.try_get("name").unwrap_or_default();
        tables.push(TableMeta {
            schema: "main".to_string(),
            name: name.clone(),
            row_estimate: None,
            size_bytes: None,
            object_type: TableObjectType::Table,
        });

        let pragma_rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", name))
            .fetch_all(pool)
            .await?;

        let cols: Vec<ColumnMeta> = pragma_rows
            .iter()
            .map(|r| {
                let col_name: String = r.try_get("name").unwrap_or_default();
                let type_name: String = r.try_get("type").unwrap_or_default();
                let not_null: i32 = r.try_get("notnull").unwrap_or(0);
                let pk: i32 = r.try_get("pk").unwrap_or(0);
                ColumnMeta {
                    name: col_name,
                    type_name,
                    display_type: DisplayType::Text,
                    nullable: not_null == 0,
                    is_primary_key: pk > 0,
                }
            })
            .collect();

        columns.insert(format!("main.{}", name), cols);
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "sqlite".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

async fn introspect_mssql(
    client_arc: &Arc<tokio::sync::Mutex<MssqlClient>>,
    connection_id: &str,
) -> Result<FullSchema, DbError> {
    let mut guard = client_arc.lock().await;

    // ── Tables + views ────────────────────────────────────────────────────────
    let tables_sql = r#"
        SELECT
            s.name          AS table_schema,
            t.name          AS table_name,
            'TABLE'         AS table_type,
            ISNULL(p.rows, 0)                             AS row_estimate,
            ISNULL(SUM(a.total_pages) * 8192, 0)          AS size_bytes
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.indexes i
            ON t.object_id = i.object_id AND i.index_id IN (0, 1)
        LEFT JOIN sys.partitions p
            ON i.object_id = p.object_id AND i.index_id = p.index_id
        LEFT JOIN sys.allocation_units a
            ON p.partition_id = a.container_id
        WHERE t.is_ms_shipped = 0
        GROUP BY s.name, t.name, p.rows
        UNION ALL
        SELECT s.name, v.name, 'VIEW', 0, 0
        FROM sys.views v
        JOIN sys.schemas s ON v.schema_id = s.schema_id
        WHERE v.is_ms_shipped = 0
        ORDER BY table_schema, table_name
    "#;

    let table_rows = guard
        .query(tables_sql, &[])
        .await
        .map_err(|e| DbError::Other(e.to_string()))?
        .into_first_result()
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;

    let tables: Vec<TableMeta> = table_rows
        .iter()
        .map(|r| {
            let schema: &str = r.get("table_schema").unwrap_or("");
            let name: &str = r.get("table_name").unwrap_or("");
            let table_type: &str = r.get("table_type").unwrap_or("TABLE");
            let row_estimate: i64 = r.get::<i64, _>("row_estimate").unwrap_or(0);
            let size_bytes: i64 = r.get::<i64, _>("size_bytes").unwrap_or(0);
            TableMeta {
                schema: schema.to_string(),
                name: name.to_string(),
                row_estimate: Some(row_estimate),
                size_bytes: Some(size_bytes),
                object_type: if table_type == "VIEW" { TableObjectType::View } else { TableObjectType::Table },
            }
        })
        .collect();

    // ── Columns ───────────────────────────────────────────────────────────────
    let cols_sql = r#"
        SELECT
            s.name          AS table_schema,
            t.name          AS table_name,
            c.name          AS column_name,
            tp.name         AS data_type,
            c.is_nullable   AS is_nullable,
            CASE WHEN pk.column_id IS NOT NULL THEN CAST(1 AS BIT)
                 ELSE CAST(0 AS BIT) END AS is_pk
        FROM sys.columns c
        JOIN sys.tables t  ON c.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id  = s.schema_id
        JOIN sys.types tp  ON c.user_type_id = tp.user_type_id
        LEFT JOIN (
            SELECT ic.object_id, ic.column_id
            FROM sys.index_columns ic
            JOIN sys.indexes i
                ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            WHERE i.is_primary_key = 1
        ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
        WHERE t.is_ms_shipped = 0
        ORDER BY s.name, t.name, c.column_id
    "#;

    let col_rows = guard
        .query(cols_sql, &[])
        .await
        .map_err(|e| DbError::Other(e.to_string()))?
        .into_first_result()
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;

    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();
    for row in &col_rows {
        let schema: &str = row.get("table_schema").unwrap_or("");
        let table: &str  = row.get("table_name").unwrap_or("");
        let col_name: &str = row.get("column_name").unwrap_or("");
        let type_name: &str = row.get("data_type").unwrap_or("");
        let is_nullable: bool = row.get::<bool, _>("is_nullable").unwrap_or(true);
        let is_pk: bool = row.get::<bool, _>("is_pk").unwrap_or(false);

        let display_type = if col_name.to_lowercase().contains("sensor_id")
            || col_name.to_lowercase().contains("machine_id")
            || col_name.to_lowercase().contains("tag_name")
        {
            DisplayType::SensorId
        } else {
            DisplayType::from_mssql_type(type_name)
        };

        columns
            .entry(format!("{}.{}", schema, table))
            .or_default()
            .push(ColumnMeta {
                name: col_name.to_string(),
                type_name: type_name.to_string(),
                display_type,
                nullable: is_nullable,
                is_primary_key: is_pk,
            });
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "mssql".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

async fn introspect_mongodb(
    client: &mongodb::Client,
    db_name: &str,
    connection_id: &str,
) -> Result<FullSchema, DbError> {
    use futures::TryStreamExt;
    use mongodb::bson::{Bson, Document};

    let db = client.database(db_name);

    // List all collections in the default database
    let collection_names: Vec<String> = db
        .list_collection_names()
        .await
        .map_err(|e| DbError::Other(format!("MongoDB list_collections failed: {e}")))?;

    let mut tables = Vec::new();
    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();

    for coll_name in &collection_names {
        // Estimated document count (fast, uses collection metadata)
        let count = db
            .collection::<Document>(coll_name)
            .estimated_document_count()
            .await
            .unwrap_or(0);

        tables.push(TableMeta {
            schema: db_name.to_string(),
            name: coll_name.clone(),
            row_estimate: Some(count as i64),
            size_bytes: None,
            object_type: TableObjectType::Table,
        });

        // Sample up to 20 documents to infer field names + types
        let sample_docs: Vec<Document> = db
            .collection::<Document>(coll_name)
            .find(mongodb::bson::doc! {})
            .limit(20)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?
            .try_collect()
            .await
            .unwrap_or_default();

        // Merge all top-level keys seen across sampled docs
        let mut seen: HashMap<String, ColumnMeta> = HashMap::new();
        for doc in &sample_docs {
            for (key, value) in doc.iter() {
                seen.entry(key.clone()).or_insert_with(|| {
                    let type_name = bson_type_name(value);
                    let display_type = bson_display_type(value, key);
                    ColumnMeta {
                        name: key.clone(),
                        type_name,
                        display_type,
                        nullable: true,
                        is_primary_key: key == "_id",
                    }
                });
            }
        }

        // Stable column order: _id first, then alphabetical
        let mut col_list: Vec<ColumnMeta> = seen.into_values().collect();
        col_list.sort_by(|a, b| {
            if a.name == "_id" { std::cmp::Ordering::Less }
            else if b.name == "_id" { std::cmp::Ordering::Greater }
            else { a.name.cmp(&b.name) }
        });

        columns.insert(format!("{}.{}", db_name, coll_name), col_list);
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "mongodb".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

fn bson_type_name(v: &mongodb::bson::Bson) -> String {
    use mongodb::bson::Bson;
    match v {
        Bson::Double(_)      => "double".to_string(),
        Bson::String(_)      => "string".to_string(),
        Bson::Document(_)    => "object".to_string(),
        Bson::Array(_)       => "array".to_string(),
        Bson::Binary(_)      => "binary".to_string(),
        Bson::ObjectId(_)    => "objectId".to_string(),
        Bson::Boolean(_)     => "bool".to_string(),
        Bson::DateTime(_)    => "date".to_string(),
        Bson::Null           => "null".to_string(),
        Bson::Int32(_)       => "int32".to_string(),
        Bson::Int64(_)       => "int64".to_string(),
        Bson::Decimal128(_)  => "decimal128".to_string(),
        Bson::Timestamp(_)   => "timestamp".to_string(),
        _                    => "unknown".to_string(),
    }
}

fn bson_display_type(v: &mongodb::bson::Bson, key: &str) -> DisplayType {
    use mongodb::bson::Bson;
    if key.to_lowercase().contains("sensor_id")
        || key.to_lowercase().contains("machine_id")
        || key.to_lowercase().contains("tag_name")
    {
        return DisplayType::SensorId;
    }
    match v {
        Bson::Double(_) | Bson::Decimal128(_)    => DisplayType::Float,
        Bson::Int32(_) | Bson::Int64(_)           => DisplayType::Integer,
        Bson::Boolean(_)                          => DisplayType::Boolean,
        Bson::DateTime(_) | Bson::Timestamp(_)   => DisplayType::Timestamp,
        Bson::Document(_)                         => DisplayType::Json,
        Bson::Array(_)                            => DisplayType::Json,
        Bson::Binary(_)                           => DisplayType::Bytes,
        _                                         => DisplayType::Text,
    }
}

/// Redis introspection — scans up to 500 keys, groups them by key-name prefix
/// (the part before the first ':'), shows type + TTL as pseudo-columns.
async fn introspect_redis(
    mgr: &redis::aio::ConnectionManager,
    connection_id: &str,
) -> Result<FullSchema, DbError> {
    let mut conn = mgr.clone();

    // SCAN 0 COUNT 500 — non-blocking, returns up to ~500 keys
    let keys: Vec<String> = redis::cmd("SCAN")
        .arg(0i64)
        .arg("COUNT")
        .arg(500i64)
        .query_async::<(i64, Vec<String>)>(&mut conn)
        .await
        .map(|(_, keys)| keys)
        .map_err(|e| DbError::Other(format!("Redis SCAN failed: {e}")))?;

    // Group keys by prefix (before first ':'), treat each prefix as a "table"
    let mut prefix_map: HashMap<String, Vec<String>> = HashMap::new();
    for key in &keys {
        let prefix = key.split(':').next().unwrap_or(key).to_string();
        prefix_map.entry(prefix).or_default().push(key.clone());
    }

    // If no prefixes found, put everything under "keys"
    if prefix_map.is_empty() {
        prefix_map.insert("keys".to_string(), keys.clone());
    }

    let mut tables = Vec::new();
    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();

    // Standard pseudo-columns for every Redis "table"
    let pseudo_cols = vec![
        ColumnMeta { name: "key".to_string(),   type_name: "string".to_string(), display_type: DisplayType::Text,    nullable: false, is_primary_key: true },
        ColumnMeta { name: "type".to_string(),  type_name: "string".to_string(), display_type: DisplayType::Text,    nullable: false, is_primary_key: false },
        ColumnMeta { name: "ttl".to_string(),   type_name: "integer".to_string(), display_type: DisplayType::Integer, nullable: true,  is_primary_key: false },
        ColumnMeta { name: "value".to_string(), type_name: "string".to_string(), display_type: DisplayType::Text,    nullable: true,  is_primary_key: false },
    ];

    for (prefix, prefix_keys) in &prefix_map {
        tables.push(TableMeta {
            schema: "redis".to_string(),
            name: prefix.clone(),
            row_estimate: Some(prefix_keys.len() as i64),
            size_bytes: None,
            object_type: TableObjectType::Table,
        });
        columns.insert(format!("redis.{}", prefix), pseudo_cols.clone());
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "redis".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

/// ClickHouse introspection — queries system.tables + system.columns.
async fn introspect_clickhouse(
    client: &clickhouse::Client,
    connection_id: &str,
) -> Result<FullSchema, DbError> {
    use serde::Deserialize;

    #[derive(clickhouse::Row, Deserialize)]
    struct ChTable {
        database: String,
        name: String,
        engine: String,
        total_rows: u64,
        total_bytes: u64,
    }

    #[derive(clickhouse::Row, Deserialize)]
    struct ChColumn {
        database: String,
        table: String,
        name: String,
        #[serde(rename = "type")]
        type_name: String,
        is_in_primary_key: u8,
    }

    let table_rows: Vec<ChTable> = client
        .query("SELECT database, name, engine, toUInt64(total_rows) AS total_rows, toUInt64(total_bytes) AS total_bytes FROM system.tables WHERE database NOT IN ('system','information_schema','INFORMATION_SCHEMA') ORDER BY database, name")
        .fetch_all::<ChTable>()
        .await
        .map_err(|e| DbError::Other(format!("ClickHouse system.tables query failed: {e}")))?;

    let tables: Vec<TableMeta> = table_rows.iter().map(|r| {
        let object_type = if r.engine.contains("View") { TableObjectType::View } else { TableObjectType::Table };
        TableMeta {
            schema: r.database.clone(),
            name: r.name.clone(),
            row_estimate: Some(r.total_rows as i64),
            size_bytes: Some(r.total_bytes as i64),
            object_type,
        }
    }).collect();

    let col_rows: Vec<ChColumn> = client
        .query("SELECT database, table, name, type, is_in_primary_key FROM system.columns WHERE database NOT IN ('system','information_schema','INFORMATION_SCHEMA') ORDER BY database, table, position")
        .fetch_all::<ChColumn>()
        .await
        .map_err(|e| DbError::Other(format!("ClickHouse system.columns query failed: {e}")))?;

    let mut columns: HashMap<String, Vec<ColumnMeta>> = HashMap::new();
    for row in &col_rows {
        let display_type = ch_type_to_display(&row.type_name);
        let key = format!("{}.{}", row.database, row.table);
        columns.entry(key).or_default().push(ColumnMeta {
            name: row.name.clone(),
            type_name: row.type_name.clone(),
            display_type,
            nullable: row.type_name.starts_with("Nullable("),
            is_primary_key: row.is_in_primary_key == 1,
        });
    }

    Ok(FullSchema {
        connection_id: connection_id.to_string(),
        driver: "clickhouse".to_string(),
        tables,
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        hypertable_tables: vec![],
        functions: vec![],
    })
}

fn ch_type_to_display(t: &str) -> DisplayType {
    let inner = if t.starts_with("Nullable(") && t.ends_with(')') { &t[9..t.len()-1] } else { t };
    let lower = inner.to_lowercase();
    if lower.starts_with("int") || lower.starts_with("uint") || lower == "bool" { return DisplayType::Integer; }
    if lower.starts_with("float") || lower.starts_with("decimal") { return DisplayType::Float; }
    if lower.starts_with("datetime") { return DisplayType::Timestamp; }
    if lower == "date" || lower == "date32" { return DisplayType::Date; }
    if lower.starts_with("json") || lower.starts_with("tuple") || lower.starts_with("array") || lower.starts_with("map") { return DisplayType::Json; }
    DisplayType::Text
}
