//! One-shot localhost OAuth callback server.
//!
//! Binds to a random port, fires a "oauth_server_ready" event with the port,
//! then waits for Google's redirect to /callback?code=...&state=...
//! Returns { code, state, port } or an error.

use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

const TIMEOUT_SECS: u64 = 300; // 5 minutes

#[derive(serde::Serialize, serde::Deserialize)]
pub struct OAuthCallbackResult {
    pub code: String,
    pub state: String,
    pub port: u16,
}

#[derive(serde::Serialize, Clone)]
struct OAuthServerReady {
    port: u16,
}

/// Start a one-shot localhost HTTP server that captures the OAuth callback.
/// Emits "oauth_server_ready" with { port } before waiting.
/// Returns { code, state, port } or an error string.
#[tauri::command]
pub async fn start_oauth_server(
    state_param: String,
    app: AppHandle,
) -> Result<OAuthCallbackResult, String> {
    // Bind to port 0 — OS assigns a free port
    let listener = bind_random_port().await?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    // Tell the frontend which port to use BEFORE waiting for the callback
    app.emit("oauth_server_ready", OAuthServerReady { port })
        .map_err(|e| e.to_string())?;

    let result = timeout(
        Duration::from_secs(TIMEOUT_SECS),
        wait_for_callback(listener, &state_param),
    )
    .await;

    match result {
        Ok(Ok((code, state))) => Ok(OAuthCallbackResult { code, state, port }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("OAuth sign-in timed out after 5 minutes".to_string()),
    }
}

async fn bind_random_port() -> Result<TcpListener, String> {
    for _ in 0..5u8 {
        if let Ok(listener) = TcpListener::bind("127.0.0.1:0").await {
            return Ok(listener);
        }
    }
    Err("Could not bind to a local port for OAuth callback".to_string())
}

async fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<(String, String), String> {
    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse "GET /callback?code=...&state=... HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.splitn(2, '?').nth(1).unwrap_or("");

    let params: std::collections::HashMap<&str, &str> = query
        .split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            Some((it.next()?, it.next()?))
        })
        .collect();

    // Check for OAuth error
    if let Some(error) = params.get("error") {
        let _ = send_html_response(
            &mut stream,
            "Sign-in cancelled",
            "You can close this tab.",
        ).await;
        return Err(format!("OAuth error: {error}"));
    }

    let decode = |s: &&str| -> String {
        urlencoding::decode(s)
            .unwrap_or(std::borrow::Cow::Borrowed(s))
            .into_owned()
    };

    let code = params
        .get("code")
        .map(decode)
        .ok_or_else(|| "Missing code in OAuth callback".to_string())?;

    let state = params.get("state").map(decode).unwrap_or_default();

    if state != expected_state {
        let _ = send_html_response(
            &mut stream,
            "Sign-in failed",
            "State mismatch — possible CSRF. Close this tab.",
        ).await;
        return Err("OAuth state mismatch".to_string());
    }

    let _ = send_html_response(
        &mut stream,
        "Signed in to Daitalk!",
        "You can close this tab and return to Daitalk.",
    ).await;

    Ok((code, state))
}

async fn send_html_response(
    stream: &mut tokio::net::TcpStream,
    title: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = format!(
        "<!DOCTYPE html><html><head><title>{title}</title>\
        <style>body{{font-family:sans-serif;display:flex;align-items:center;\
        justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}}\
        .card{{text-align:center;padding:2rem;border:1px solid #2a2a2a;\
        border-radius:12px}}h1{{color:#00d2ff;font-size:1.5rem}}p{{color:#888}}\
        </style></head><body><div class=\"card\">\
        <h1>{title}</h1><p>{message}</p></div></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
        Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}
