use tauri::State;

use crate::db::connection_manager::ActiveConnection;
use crate::db::types::ConnectionConfig;

use super::AppState;
use super::persistence::{load_connection_secret, sanitize_connection_config, store_connection_secret};

#[tauri::command]
pub async fn db_connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ConnectionConfig, String> {
    let mut effective_config = config.clone();
    if let Some(secret) = load_connection_secret(&config.id)? {
        if config.connection_string.contains("***") {
            effective_config.connection_string = secret.connection_string;
        }
        effective_config.ssh = match (config.ssh.as_ref(), secret.ssh.as_ref()) {
            (Some(incoming), Some(stored)) => {
                let mut merged = incoming.clone();
                merged.auth = match (&incoming.auth, &stored.auth) {
                    (
                        crate::db::types::SshAuth::Password { password },
                        crate::db::types::SshAuth::Password {
                            password: stored_password,
                        },
                    ) if password.is_empty() => crate::db::types::SshAuth::Password {
                        password: stored_password.clone(),
                    },
                    (
                        crate::db::types::SshAuth::Key { key_path, passphrase },
                        crate::db::types::SshAuth::Key {
                            passphrase: stored_passphrase,
                            ..
                        },
                    ) if passphrase.is_none() => crate::db::types::SshAuth::Key {
                        key_path: key_path.clone(),
                        passphrase: stored_passphrase.clone(),
                    },
                    _ => incoming.auth.clone(),
                };
                Some(merged)
            }
            (Some(incoming), None) => Some(incoming.clone()),
            (None, Some(stored)) => Some(stored.clone()),
            (None, None) => None,
        };
    }

    state
        .connections
        .connect(effective_config.clone())
        .await
        .map_err(|e| e.to_string())?;
    store_connection_secret(&effective_config)?;
    Ok(sanitize_connection_config(&effective_config))
}

#[tauri::command]
pub async fn db_disconnect(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.connections.disconnect(&connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn db_list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, String> {
    Ok(state
        .connections
        .list_configs()
        .await
        .into_iter()
        .map(|config| sanitize_connection_config(&config))
        .collect())
}

#[tauri::command]
pub async fn db_ping(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state
        .connections
        .get(&connection_id)
        .await
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    match conn.as_ref() {
        ActiveConnection::Postgres(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mysql(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Sqlite(pool) => {
            sqlx::query("SELECT 1").execute(pool).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mssql(client) => {
            let mut guard = client.lock().await;
            guard.query("SELECT 1", &[]).await.map_err(|e| e.to_string())?;
        }
        ActiveConnection::Mongodb(client, _) => {
            client
                .database("admin")
                .run_command(mongodb::bson::doc! { "ping": 1 })
                .await
                .map_err(|e| e.to_string())?;
        }
        ActiveConnection::Redis(mgr) => {
            let mut c = mgr.clone();
            redis::cmd("PING")
                .query_async::<String>(&mut c)
                .await
                .map_err(|e| e.to_string())?;
        }
        ActiveConnection::ClickHouse(client) => {
            client.query("SELECT 1").execute().await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
