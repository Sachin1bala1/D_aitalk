use std::collections::HashSet;

use tauri::{AppHandle, Manager};

use crate::db::types::{ConnectionConfig, SshAuth, SshConfig};
use crate::intelligence::events::SecurityAuditEvent;
use crate::intelligence::store::{record_security_audit_event, IntelligenceStore};
use crate::security::validate_secret_service;

const CONNECTIONS_FILE: &str = "connections.json";
const WORKSPACE_SESSION_FILE: &str = "workspace_session.json";
const APP_DOCS_DIR: &str = "app_docs";
const CONNECTION_SECRET_PREFIX: &str = "connection_config:";
const LEGACY_PASSWORD_PREFIX: &str = "conn_";
const LEGACY_PASSWORD_SUFFIX: &str = "_password";
const KEYRING_SERVICE: &str = "daitalk";

fn connections_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(CONNECTIONS_FILE)
}

fn workspace_session_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(WORKSPACE_SESSION_FILE)
}

fn app_document_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(APP_DOCS_DIR)
}

fn sanitize_document_key(key: &str) -> Result<String, String> {
    if key.is_empty() {
        return Err("document key is required".to_string());
    }

    if !key
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
    {
        return Err("document key contains invalid characters".to_string());
    }

    Ok(key.to_string())
}

fn app_document_path(app: &AppHandle, key: &str) -> Result<std::path::PathBuf, String> {
    let sanitized = sanitize_document_key(key)?;
    Ok(app_document_dir(app).join(format!("{sanitized}.json")))
}

fn connection_secret_service(connection_id: &str) -> String {
    format!("{}{}", CONNECTION_SECRET_PREFIX, connection_id)
}

fn legacy_password_service(connection_id: &str) -> String {
    format!("{}{}{}", LEGACY_PASSWORD_PREFIX, connection_id, LEGACY_PASSWORD_SUFFIX)
}

fn keyring_entry(service: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, service).map_err(|e| e.to_string())
}

pub(crate) fn store_connection_secret(config: &ConnectionConfig) -> Result<(), String> {
    let entry = keyring_entry(&connection_secret_service(&config.id))?;
    let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())?;

    if let Some(password) = extract_connection_password(config) {
        let legacy_entry = keyring_entry(&legacy_password_service(&config.id))?;
        legacy_entry
            .set_password(&password)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub(crate) fn load_connection_secret(
    connection_id: &str,
) -> Result<Option<ConnectionConfig>, String> {
    let entry = keyring_entry(&connection_secret_service(connection_id))?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_connection_secret(connection_id: &str) -> Result<(), String> {
    let entry = keyring_entry(&connection_secret_service(connection_id))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }

    let legacy_entry = keyring_entry(&legacy_password_service(connection_id))?;
    match legacy_entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn extract_connection_password(config: &ConnectionConfig) -> Option<String> {
    if let Some(pi) = &config.pi_config {
        if !pi.password.is_empty() {
            return Some(pi.password.clone());
        }
    }

    if let Ok(url) = url::Url::parse(&config.connection_string) {
        if let Some(password) = url.password() {
            if !password.is_empty() && password != "***" {
                return Some(password.to_string());
            }
        }
    }

    None
}

fn merge_with_legacy_password_credential(config: &ConnectionConfig) -> Result<ConnectionConfig, String> {
    let entry = keyring_entry(&legacy_password_service(&config.id))?;
    let password = match entry.get_password() {
        Ok(password) if !password.is_empty() => password,
        Ok(_) | Err(keyring::Error::NoEntry) => return Ok(config.clone()),
        Err(e) => return Err(e.to_string()),
    };

    let mut merged = config.clone();
    if let Some(pi) = &merged.pi_config {
        let mut pi = pi.clone();
        if pi.password.is_empty() {
            pi.password = password.clone();
        }
        merged.pi_config = Some(pi);
    } else if let Ok(mut url) = url::Url::parse(&merged.connection_string) {
        if url.password().is_none() || url.password().is_some_and(|value| value.is_empty()) {
            let _ = url.set_password(Some(&password));
            merged.connection_string = url.to_string();
        }
    }

    Ok(merged)
}

fn redact_connection_string(raw: &str) -> String {
    match url::Url::parse(raw) {
        Ok(mut url) => {
            if url.password().is_some() {
                let _ = url.set_password(Some("***"));
            }
            url.to_string()
        }
        Err(_) => redact_semicolon_connection_string(raw),
    }
}

fn redact_semicolon_connection_string(raw: &str) -> String {
    raw.split(';')
        .map(|segment| {
            let trimmed = segment.trim();
            let lower = trimmed.to_ascii_lowercase();
            if lower.starts_with("password=") || lower.starts_with("pwd=") {
                let key = trimmed.split('=').next().unwrap_or("password");
                format!("{key}=***")
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub(crate) fn sanitize_connection_config(config: &ConnectionConfig) -> ConnectionConfig {
    let mut sanitized = config.clone();
    sanitized.connection_string = redact_connection_string(&config.connection_string);
    sanitized.ssh = config.ssh.as_ref().map(|ssh| {
        let mut sanitized_ssh = ssh.clone();
        sanitized_ssh.auth = match &ssh.auth {
            SshAuth::Password { .. } => SshAuth::Password {
                password: String::new(),
            },
            SshAuth::Key { key_path, .. } => SshAuth::Key {
                key_path: key_path.clone(),
                passphrase: None,
            },
        };
        sanitized_ssh
    });
    sanitized
}

async fn audit_secret_event(
    app: &AppHandle,
    event_type: &str,
    outcome: &str,
    details_json: serde_json::Value,
) {
    let store = app.state::<IntelligenceStore>();
    if let Err(error) = record_security_audit_event(
        SecurityAuditEvent {
            event_type: event_type.to_string(),
            outcome: outcome.to_string(),
            details_json,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        store.inner(),
    )
    .await
    {
        tracing::warn!("failed to record secret audit event: {}", error);
    }
}

fn config_contains_secret(config: &ConnectionConfig) -> bool {
    if config
        .pi_config
        .as_ref()
        .is_some_and(|pi| !pi.password.is_empty())
    {
        return true;
    }

    if connection_string_contains_secret(&config.connection_string) {
        return true;
    }

    config.ssh.as_ref().is_some_and(|ssh| match &ssh.auth {
        SshAuth::Password { password } => !password.is_empty(),
        SshAuth::Key { passphrase, .. } => passphrase.is_some(),
    })
}

fn connection_string_contains_secret(raw: &str) -> bool {
    if raw.contains("***") {
        return false;
    }

    if let Ok(url) = url::Url::parse(raw) {
        return url.password().is_some_and(|password| !password.is_empty());
    }

    raw.split(';').any(|segment| {
        let trimmed = segment.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("password=") || lower.starts_with("pwd=") {
            trimmed
                .split_once('=')
                .map(|(_, value)| {
                    let secret = value.trim();
                    !secret.is_empty() && secret != "***"
                })
                .unwrap_or(false)
        } else {
            false
        }
    })
}

pub(crate) fn merge_with_stored_secret(config: &ConnectionConfig) -> Result<ConnectionConfig, String> {
    if config_contains_secret(config) {
        return Ok(config.clone());
    }

    if let Some(secret) = load_connection_secret(&config.id)? {
        let mut merged = config.clone();
        merged.connection_string = secret.connection_string;
        merged.ssh = merge_ssh_secret(config.ssh.as_ref(), secret.ssh.as_ref());
        return Ok(merged);
    }

    merge_with_legacy_password_credential(config)
}

fn merge_ssh_secret(
    incoming: Option<&SshConfig>,
    stored: Option<&SshConfig>,
) -> Option<SshConfig> {
    match (incoming, stored) {
        (Some(incoming), Some(stored)) => {
            let mut merged = incoming.clone();
            merged.auth = match (&incoming.auth, &stored.auth) {
                (SshAuth::Password { password }, SshAuth::Password { password: stored_password }) => {
                    if password.is_empty() {
                        SshAuth::Password {
                            password: stored_password.clone(),
                        }
                    } else {
                        SshAuth::Password {
                            password: password.clone(),
                        }
                    }
                }
                (
                    SshAuth::Key { key_path, passphrase },
                    SshAuth::Key {
                        passphrase: stored_passphrase,
                        ..
                    },
                ) => SshAuth::Key {
                    key_path: key_path.clone(),
                    passphrase: passphrase.clone().or_else(|| stored_passphrase.clone()),
                },
                _ => incoming.auth.clone(),
            };
            Some(merged)
        }
        (Some(incoming), None) => Some(incoming.clone()),
        (None, Some(stored)) => Some(stored.clone()),
        (None, None) => None,
    }
}

#[tauri::command]
pub fn save_connections(
    configs: Vec<ConnectionConfig>,
    app: AppHandle,
) -> Result<(), String> {
    let path = connections_path(&app);
    let previous_ids: HashSet<String> = if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let previous: Vec<ConnectionConfig> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        previous.into_iter().map(|c| c.id).collect()
    } else {
        HashSet::new()
    };

    for config in &configs {
        let secret_config = merge_with_stored_secret(config)?;
        if config_contains_secret(&secret_config) {
            store_connection_secret(&secret_config)?;
        }
    }

    let current_ids: HashSet<String> = configs.iter().map(|c| c.id.clone()).collect();
    for removed_id in previous_ids.difference(&current_ids) {
        delete_connection_secret(removed_id)?;
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let sanitized: Vec<_> = configs.iter().map(sanitize_connection_config).collect();
    let json = serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_connections(app: AppHandle) -> Result<Vec<crate::db::types::ConnectionConfig>, String> {
    let path = connections_path(&app);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let sanitized: Vec<ConnectionConfig> =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(sanitized)
}

#[tauri::command]
pub fn save_workspace_session(session_json: String, app: AppHandle) -> Result<(), String> {
    let path = workspace_session_path(&app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, session_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_workspace_session(app: AppHandle) -> Result<Option<String>, String> {
    let path = workspace_session_path(&app);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(raw))
}

#[tauri::command]
pub fn clear_workspace_session(app: AppHandle) -> Result<(), String> {
    let path = workspace_session_path(&app);
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_document(key: String, json: String, app: AppHandle) -> Result<(), String> {
    let path = app_document_path(&app, &key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_app_document(key: String, app: AppHandle) -> Result<Option<String>, String> {
    let path = app_document_path(&app, &key)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(raw))
}

#[tauri::command]
pub fn delete_app_document(key: String, app: AppHandle) -> Result<(), String> {
    let path = app_document_path(&app, &key)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn store_api_key(service: String, key: String, app: AppHandle) -> Result<(), String> {
    if let Err(error) = validate_secret_service(&service) {
        audit_secret_event(
            &app,
            "secret_access",
            "blocked",
            serde_json::json!({
                "service": service,
                "action": "store",
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let entry = keyring_entry(&service)?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn has_api_key(service: String, app: AppHandle) -> Result<bool, String> {
    if let Err(error) = validate_secret_service(&service) {
        audit_secret_event(
            &app,
            "secret_access",
            "blocked",
            serde_json::json!({
                "service": service,
                "action": "check_presence",
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let entry = keyring_entry(&service)?;
    match entry.get_password() {
        Ok(pw) => Ok(!pw.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_api_key(service: String, app: AppHandle) -> Result<String, String> {
    if let Err(error) = validate_secret_service(&service) {
        audit_secret_event(
            &app,
            "secret_access",
            "blocked",
            serde_json::json!({
                "service": service,
                "action": "read",
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let entry = keyring_entry(&service)?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn delete_api_key(service: String, app: AppHandle) -> Result<(), String> {
    if let Err(error) = validate_secret_service(&service) {
        audit_secret_event(
            &app,
            "secret_access",
            "blocked",
            serde_json::json!({
                "service": service,
                "action": "delete",
                "reason": error,
            }),
        )
        .await;
        return Err(error);
    }
    let entry = keyring_entry(&service)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_credential(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_credential(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_credential(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
