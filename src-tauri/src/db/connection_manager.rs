use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::types::{ConnectionConfig, DbDriver};
use super::ssh_tunnel::SshTunnel;
use crate::error::DbError;

pub type MssqlClient = tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>;

pub enum ActiveConnection {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Mssql(Arc<tokio::sync::Mutex<MssqlClient>>),
    Mongodb(mongodb::Client, String), // (client, default_db_name)
    Redis(redis::aio::ConnectionManager),
    ClickHouse(clickhouse::Client),
}

/// Wraps an active connection together with its optional SSH tunnel.
/// The tunnel is kept alive as long as this entry exists.
pub struct ActiveEntry {
    pub connection: Arc<ActiveConnection>,
    pub _tunnel: Option<SshTunnel>,
}

pub struct ConnectionManager {
    connections: RwLock<HashMap<String, ActiveEntry>>,
    configs: RwLock<HashMap<String, ConnectionConfig>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            configs: RwLock::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, config: ConnectionConfig) -> Result<(), DbError> {
        // PI Historian uses HTTP — no connection pool needed; just store the config.
        if matches!(config.driver, DbDriver::PIHistorian) {
            let id = config.id.clone();
            self.configs.write().await.insert(id, config);
            return Ok(());
        }

        // Open SSH tunnel if configured, rewriting the connection string to use local port
        let (effective_conn_str, tunnel) = if let Some(ref ssh) = config.ssh {
            let url = url::Url::parse(&config.connection_string)
                .map_err(|e| DbError::Other(format!("Invalid connection URL for SSH tunnel: {e}")))?;
            let remote_host = url.host_str().unwrap_or("localhost").to_string();
            let default_port = match &config.driver {
                DbDriver::Postgres | DbDriver::Timescaledb => 5432,
                DbDriver::Mysql | DbDriver::Mariadb => 3306,
                DbDriver::Mssql => 1433,
                DbDriver::MongoDB => 27017,
                DbDriver::Redis => 6379,
                DbDriver::ClickHouse => 8123,
                DbDriver::Sqlite | DbDriver::PIHistorian => 0,
            };
            let remote_port = url.port().unwrap_or(default_port);

            let tun = SshTunnel::open(ssh, &remote_host, remote_port)
                .map_err(|e| DbError::Other(e))?;

            // Rewrite connection string: replace host:port with 127.0.0.1:local_port
            let original = format!(
                "{}:{}",
                remote_host,
                remote_port
            );
            let replacement = format!("127.0.0.1:{}", tun.local_port);
            let new_str = config.connection_string.replacen(&original, &replacement, 1);
            (new_str, Some(tun))
        } else {
            (config.connection_string.clone(), None)
        };

        let conn = match &config.driver {
            DbDriver::Postgres | DbDriver::Timescaledb => {
                use std::str::FromStr;
                use sqlx::postgres::{PgConnectOptions, PgSslMode};

                let mut opts = PgConnectOptions::from_str(&effective_conn_str)
                    .map_err(|e| DbError::Other(format!("Invalid Postgres URL: {e}")))?;

                // For non-local hosts (Supabase, RDS, Cloud SQL, etc.):
                // 1. Require SSL — Supavisor/PgBouncer rejects unencrypted connections.
                // 2. Disable statement cache — PgBouncer/Supavisor transaction mode does
                //    not support server-side prepared statements; sqlx's default caching
                //    causes "prepared statement does not exist" errors.
                let host = opts.get_host().to_string();
                let is_local = host == "localhost" || host == "127.0.0.1" || host == "::1";
                if !is_local {
                    // Only set SSL mode if the URL didn't already specify one
                    let already_has_ssl = effective_conn_str.contains("sslmode=")
                        || effective_conn_str.contains("sslrootcert=");
                    if !already_has_ssl {
                        opts = opts.ssl_mode(PgSslMode::Require);
                    }
                    // Disable prepared-statement caching for pooler compatibility
                    opts = opts.statement_cache_capacity(0);
                }

                let pool = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(config.pool_max.unwrap_or(10))
                    .min_connections(config.pool_min.unwrap_or(1))
                    .connect_with(opts)
                    .await?;
                ActiveConnection::Postgres(pool)
            }
            DbDriver::Mysql | DbDriver::Mariadb => {
                let pool = sqlx::mysql::MySqlPoolOptions::new()
                    .max_connections(config.pool_max.unwrap_or(10))
                    .connect(&effective_conn_str)
                    .await?;
                ActiveConnection::Mysql(pool)
            }
            DbDriver::Sqlite => {
                let pool = sqlx::sqlite::SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(&effective_conn_str)
                    .await?;
                ActiveConnection::Sqlite(pool)
            }
            DbDriver::Mssql => {
                use tokio_util::compat::TokioAsyncWriteCompatExt;

                let mssql_config = tiberius::Config::from_ado_string(&effective_conn_str)
                    .map_err(|e| DbError::Other(format!("Invalid MSSQL connection string: {}", e)))?;

                let tcp = tokio::net::TcpStream::connect(mssql_config.get_addr())
                    .await
                    .map_err(|e| DbError::Other(format!("MSSQL TCP connect failed: {}", e)))?;

                tcp.set_nodelay(true)
                    .map_err(|e| DbError::Other(format!("set_nodelay failed: {}", e)))?;

                let client = tiberius::Client::connect(mssql_config, tcp.compat_write())
                    .await
                    .map_err(|e| DbError::Other(format!("MSSQL handshake failed: {}", e)))?;

                ActiveConnection::Mssql(Arc::new(tokio::sync::Mutex::new(client)))
            }
            DbDriver::MongoDB => {
                let client_options = mongodb::options::ClientOptions::parse(&effective_conn_str)
                    .await
                    .map_err(|e| DbError::Other(format!("MongoDB connection string parse failed: {e}")))?;
                let client = mongodb::Client::with_options(client_options)
                    .map_err(|e| DbError::Other(format!("MongoDB client init failed: {e}")))?;
                // Ping to verify connectivity
                client
                    .database("admin")
                    .run_command(mongodb::bson::doc! { "ping": 1 })
                    .await
                    .map_err(|e| DbError::Other(format!("MongoDB ping failed: {e}")))?;
                // Extract default db from connection string (path component after last '/')
                let default_db = effective_conn_str
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .and_then(|s| s.split('?').next())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("test")
                    .to_string();
                ActiveConnection::Mongodb(client, default_db)
            }
            DbDriver::Redis => {
                let client = redis::Client::open(effective_conn_str.as_str())
                    .map_err(|e| DbError::Other(format!("Redis URL invalid: {e}")))?;
                let mgr = redis::aio::ConnectionManager::new(client)
                    .await
                    .map_err(|e| DbError::Other(format!("Redis connect failed: {e}")))?;
                ActiveConnection::Redis(mgr)
            }
            DbDriver::ClickHouse => {
                // Parse "http://user:pass@host:8123/database" connection string
                let url = url::Url::parse(&effective_conn_str)
                    .map_err(|e| DbError::Other(format!("ClickHouse URL invalid: {e}")))?;
                let mut client = clickhouse::Client::default()
                    .with_url(format!("{}://{}:{}", url.scheme(), url.host_str().unwrap_or("localhost"), url.port().unwrap_or(8123)));
                if !url.username().is_empty() {
                    client = client.with_user(url.username());
                }
                if let Some(pw) = url.password() {
                    client = client.with_password(pw);
                }
                let db = url.path().trim_start_matches('/');
                if !db.is_empty() {
                    client = client.with_database(db);
                }
                // Ping to verify connectivity
                client.query("SELECT 1").execute().await
                    .map_err(|e| DbError::Other(format!("ClickHouse ping failed: {e}")))?;
                ActiveConnection::ClickHouse(client)
            }
            // PIHistorian is handled above before this match — unreachable here.
            DbDriver::PIHistorian => {
                return Err(DbError::Other("PI Historian connections are HTTP-only and handled separately".to_string()));
            }
        };

        let id = config.id.clone();
        self.connections
            .write()
            .await
            .insert(id.clone(), ActiveEntry { connection: Arc::new(conn), _tunnel: tunnel });
        self.configs.write().await.insert(id, config);
        Ok(())
    }

    pub async fn get(&self, id: &str) -> Option<Arc<ActiveConnection>> {
        self.connections.read().await.get(id).map(|e| e.connection.clone())
    }

    pub async fn disconnect(&self, id: &str) {
        self.connections.write().await.remove(id);
        self.configs.write().await.remove(id);
    }

    pub async fn list_configs(&self) -> Vec<ConnectionConfig> {
        self.configs.read().await.values().cloned().collect()
    }

    pub async fn get_config(&self, id: &str) -> Option<ConnectionConfig> {
        self.configs.read().await.get(id).cloned()
    }
}

