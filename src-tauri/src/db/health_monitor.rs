//! Connection health monitor — pings each active connection every 30s.
//! Emits `connection_dropped` and `connection_restored` Tauri events.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use futures::FutureExt;
use tokio::time;
use tauri::{AppHandle, Emitter};

use crate::db::connection_manager::ConnectionManager;

const PING_INTERVAL: Duration = Duration::from_secs(30);
const PING_TIMEOUT: Duration = Duration::from_secs(5);
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
            // Ping with a hard timeout so slow servers don't starve the connection pool
            let ping_future = std::panic::AssertUnwindSafe(manager.ping(&id)).catch_unwind();
            let alive = match tokio::time::timeout(PING_TIMEOUT, ping_future).await {
                Ok(Ok(result)) => result,
                _ => false, // timed out or panicked → treat as failure
            };

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
