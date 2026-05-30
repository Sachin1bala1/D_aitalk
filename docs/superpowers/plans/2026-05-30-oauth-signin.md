# OAuth / Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sign-In for Gemini, a clipboard-based guided wizard for Claude/OpenAI, and a first-run ConnectScreen so users never need to manually handle API keys.

**Architecture:** PKCE OAuth flow runs as TypeScript (code generation, token exchange) + a Rust one-shot localhost HTTP server that captures the browser redirect. GeminiProvider gains a dual constructor. A ConnectScreen gates first launch, and KeySetupWizard handles Claude/OpenAI via clipboard polling.

**Tech Stack:** TypeScript (Web Crypto API for PKCE), Rust (tokio HTTP server), `@tauri-apps/api/core` (invoke), `@tauri-apps/plugin-shell` (open browser), Vitest for tests.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/auth/googleOAuth.ts` | Create | PKCE generation, token exchange, refresh, keychain helpers |
| `src/lib/auth/googleOAuth.test.ts` | Create | Unit tests for PKCE and token refresh |
| `src-tauri/src/commands/oauth.rs` | Create | `start_oauth_server` Tauri command |
| `src-tauri/src/commands/mod.rs` | Modify | pub use oauth::* |
| `src-tauri/src/lib.rs` | Modify | Register `start_oauth_server` in invoke_handler |
| `src/lib/ai/providers/GeminiProvider.ts` | Modify | Accept `{ apiKey }` OR `{ accessToken }` |
| `src/lib/ai/ProviderRegistry.ts` | Modify | Pass access token to GeminiProvider when present |
| `src/lib/ai/types.ts` | Modify | Add `gemini_access_token` to keychain key list |
| `src/components/ai/KeySetupWizard.tsx` | Create | 3-step clipboard wizard for Claude/OpenAI |
| `src/components/onboarding/ConnectScreen.tsx` | Create | First-run screen with 3 provider paths |
| `src/components/ai/ProviderSettingsDialog.tsx` | Modify | Google Sign-In button + wizard trigger links |
| `src/App.tsx` | Modify | First-run gate: show ConnectScreen if no provider configured |

---

## Task 1: PKCE Cryptographic Module

**Files:**
- Create: `src/lib/auth/googleOAuth.ts`
- Create: `src/lib/auth/googleOAuth.test.ts`

### Step 1.1: Write failing tests for PKCE

- [ ] Create `src/lib/auth/googleOAuth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generatePKCE, buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./googleOAuth";

describe("generatePKCE", () => {
  it("produces a code_verifier of 43–128 chars, URL-safe base64", async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge.length).toBeGreaterThan(0);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("code_challenge is BASE64URL(SHA-256(code_verifier))", async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    // Re-derive manually
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(codeChallenge).toBe(expected);
  });

  it("each call produces a unique verifier", async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("buildAuthUrl", () => {
  it("includes all required OAuth params", () => {
    const url = buildAuthUrl({
      clientId: "test-client-id",
      redirectUri: "http://127.0.0.1:8888/callback",
      codeChallenge: "abc123",
      state: "xyz",
    });
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain("redirect_uri=http");
    expect(url).toContain("code_challenge=abc123");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=xyz");
    expect(url).toContain("scope=");
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts refresh_token grant and returns new access_token", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new_access_token",
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshAccessToken({
      clientId: "test-client-id",
      refreshToken: "my-refresh-token",
    });

    expect(result.accessToken).toBe("new_access_token");
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const callArgs = mockFetch.mock.calls[0];
    const body = new URLSearchParams(callArgs[1]?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("my-refresh-token");
    expect(body.get("client_id")).toBe("test-client-id");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    } as Response);

    await expect(
      refreshAccessToken({ clientId: "test-client-id", refreshToken: "bad-token" })
    ).rejects.toThrow("Token refresh failed");
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```
npx vitest run src/lib/auth/googleOAuth.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 1.3: Implement `src/lib/auth/googleOAuth.ts`**

```typescript
/**
 * Google OAuth 2.0 PKCE helpers for desktop apps.
 * No client secret needed — PKCE flow only.
 */

export const GOOGLE_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? "YOUR_GOOGLE_CLIENT_ID_HERE";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/generative-language.retriever",
  "email",
  "profile",
].join(" ");

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/** Generate a PKCE code_verifier + SHA-256 code_challenge. */
export async function generatePKCE(): Promise<PKCEPair> {
  // 32 random bytes → 43-char URL-safe base64
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/** Build the Google OAuth authorization URL. */
export function buildAuthUrl(params: AuthUrlParams): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: SCOPES,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${p.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Date.now() + expires_in * 1000
}

/** Exchange authorization code for tokens. */
export async function exchangeCodeForTokens(params: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Refresh an expired access token using a stored refresh token. */
export async function refreshAccessToken(params: {
  clientId: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```
npx vitest run src/lib/auth/googleOAuth.test.ts
```
Expected: PASS (all 6 tests)

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/auth/googleOAuth.ts src/lib/auth/googleOAuth.test.ts
git commit -m "feat(auth): PKCE module — generatePKCE, buildAuthUrl, exchangeCodeForTokens, refreshAccessToken"
```

---

## Task 2: Rust OAuth Server Command

**Files:**
- Create: `src-tauri/src/commands/oauth.rs`
- Modify: `src-tauri/src/commands/mod.rs` (line 11 — add `mod oauth; pub use oauth::*;`)
- Modify: `src-tauri/src/lib.rs` (line 49 — add `commands::start_oauth_server` to invoke_handler)

> **Note:** No unit tests for Rust in this plan — the Rust server is a thin async wrapper. Integration testing happens via the TypeScript OAuth flow tests.

- [ ] **Step 2.1: Create `src-tauri/src/commands/oauth.rs`**

```rust
//! One-shot localhost OAuth callback server.
//!
//! Starts a TCP listener on a random port, waits for Google to
//! redirect to /callback?code=...&state=..., returns the code,
//! then shuts down.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

const TIMEOUT_SECS: u64 = 300; // 5 minutes
const MAX_ATTEMPTS: u16 = 5;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct OAuthCallbackResult {
    pub code: String,
    pub state: String,
    pub port: u16,
}

/// Start a one-shot localhost HTTP server that captures the OAuth callback.
/// Returns `{ code, state, port }` or an error string.
#[tauri::command]
pub async fn start_oauth_server(state_param: String) -> Result<OAuthCallbackResult, String> {
    // Try up to MAX_ATTEMPTS random ports
    let listener = bind_random_port().await?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

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
    for _ in 0..MAX_ATTEMPTS {
        // Port 0 lets the OS assign a free port
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

    // Parse the first line: "GET /callback?code=...&state=... HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("");

    let query = path.splitn(2, '?').nth(1).unwrap_or("");
    let params: std::collections::HashMap<_, _> = query
        .split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            Some((it.next()?, it.next()?))
        })
        .collect();

    // Check for OAuth error
    if let Some(error) = params.get("error") {
        let _ = send_html_response(&mut stream, "Sign-in cancelled", "You can close this tab.").await;
        return Err(format!("OAuth error: {error}"));
    }

    let code = params
        .get("code")
        .map(|s| urlencoding::decode(s).unwrap_or(std::borrow::Cow::Borrowed(s)).into_owned())
        .ok_or("Missing code in OAuth callback")?;

    let state = params
        .get("state")
        .map(|s| urlencoding::decode(s).unwrap_or(std::borrow::Cow::Borrowed(s)).into_owned())
        .unwrap_or_default();

    if state != expected_state {
        let _ = send_html_response(&mut stream, "Sign-in failed", "State mismatch — possible CSRF. Close this tab.").await;
        return Err("OAuth state mismatch".to_string());
    }

    let _ = send_html_response(
        &mut stream,
        "Signed in to Daitalk!",
        "You can close this tab and return to Daitalk.",
    )
    .await;

    Ok((code, state))
}

async fn send_html_response(
    stream: &mut tokio::net::TcpStream,
    title: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = format!(
        "<!DOCTYPE html><html><head><title>{title}</title>\
        <style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;\
        height:100vh;margin:0;background:#0a0a0a;color:#fff}}\
        .card{{text-align:center;padding:2rem;border:1px solid #2a2a2a;border-radius:12px}}\
        h1{{color:#00d2ff;font-size:1.5rem}}p{{color:#888}}</style></head>\
        <body><div class=\"card\"><h1>{title}</h1><p>{message}</p></div></body></html>"
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
```

- [ ] **Step 2.2: Add `urlencoding` to Cargo.toml if not present**

Check `src-tauri/Cargo.toml` — `urlencoding = "2.1"` is already present (added in Track 4). No change needed.

- [ ] **Step 2.3: Register the module in `src-tauri/src/commands/mod.rs`**

Add after line 11 (`mod utility;`):

```rust
mod oauth;
```

Add after line 23 (`pub use utility::*;`):

```rust
pub use oauth::*;
```

- [ ] **Step 2.4: Register the command in `src-tauri/src/lib.rs`**

In the `invoke_handler!` macro (around line 136, before the closing `]`), add:

```rust
commands::start_oauth_server,
```

- [ ] **Step 2.5: Build to verify compilation**

```
cd src-tauri && cargo check 2>&1 | tail -20
```
Expected: no errors

- [ ] **Step 2.6: Commit**

```bash
git add src-tauri/src/commands/oauth.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust/oauth): start_oauth_server — one-shot localhost callback capture"
```

---

## Task 3: Full OAuth Flow (TypeScript side)

**Files:**
- Modify: `src/lib/auth/googleOAuth.ts` (add `startGoogleOAuthFlow`, `loadGeminiOAuthToken`)
- Modify: `src/lib/auth/googleOAuth.test.ts` (add integration tests)

- [ ] **Step 3.1: Write failing tests for `startGoogleOAuthFlow` and `loadGeminiOAuthToken`**

Append to `src/lib/auth/googleOAuth.test.ts`:

```typescript
import { startGoogleOAuthFlow, loadGeminiOAuthToken } from "./googleOAuth";
import { saveApiKeyToKeychain } from "../ai/types";

// Mock Tauri invoke + shell open
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));
vi.mock("../ai/types", () => ({
  saveApiKeyToKeychain: vi.fn().mockResolvedValue(undefined),
  loadApiKeysFromKeychain: vi.fn().mockResolvedValue({}),
}));

describe("startGoogleOAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns tokens after successful OAuth round-trip", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      code: "auth_code_123",
      state: expect.any(String),
      port: 54321,
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "ya29.access",
        refresh_token: "1//refresh",
        expires_in: 3600,
      }),
    } as Response);

    const result = await startGoogleOAuthFlow();
    expect(result.accessToken).toBe("ya29.access");
    expect(result.refreshToken).toBe("1//refresh");
    expect(saveApiKeyToKeychain).toHaveBeenCalledWith("gemini_access_token", "ya29.access");
    expect(saveApiKeyToKeychain).toHaveBeenCalledWith("gemini_refresh_token", "1//refresh");
  });
});

describe("loadGeminiOAuthToken", () => {
  it("returns null when no token stored", async () => {
    const { loadApiKeysFromKeychain } = await import("../ai/types");
    vi.mocked(loadApiKeysFromKeychain).mockResolvedValueOnce({} as any);
    const token = await loadGeminiOAuthToken();
    expect(token).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```
npx vitest run src/lib/auth/googleOAuth.test.ts
```
Expected: FAIL — startGoogleOAuthFlow not exported

- [ ] **Step 3.3: Add flow functions to `src/lib/auth/googleOAuth.ts`**

Append to the bottom of `src/lib/auth/googleOAuth.ts`:

```typescript
// ── Keychain keys for OAuth tokens ────────────────────────────────────────────

export const GEMINI_ACCESS_TOKEN_KEY = "gemini_access_token";
export const GEMINI_REFRESH_TOKEN_KEY = "gemini_refresh_token";
export const GEMINI_TOKEN_EXPIRY_KEY = "gemini_token_expiry";
const OAUTH_EXPIRY_BUFFER_MS = 60_000; // refresh 60s before expiry

// ── Full OAuth flow ───────────────────────────────────────────────────────────

/**
 * Run the full PKCE Google OAuth flow.
 * Starts Rust callback server, opens browser, waits for redirect,
 * exchanges code for tokens, stores in keychain.
 */
export async function startGoogleOAuthFlow(): Promise<TokenResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-shell");
  const { saveApiKeyToKeychain } = await import("../ai/types");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 16);

  // Start Rust callback server — returns once browser hits /callback
  const serverPromise = invoke<{ code: string; state: string; port: number }>(
    "start_oauth_server",
    { stateParam: state }
  );

  // We need the port before opening the browser, but start_oauth_server
  // is blocking until the callback arrives. Solution: get port from a
  // preliminary invoke or use a fixed redirect URI pattern.
  // Workaround: use port 0 binding — Rust returns port in result.
  // We open the browser with a pre-agreed redirect URI after binding.
  // Since start_oauth_server blocks, we need to open the browser concurrently.

  // Fire browser open with a predictable redirect URI.
  // We can't know the port ahead of time so we run a two-step:
  // 1. Call start_oauth_server_port to just bind and return the port
  // 2. Open browser with that port
  // 3. Call start_oauth_server_wait to block until callback
  // Instead, simpler: invoke returns { code, port } after callback arrives;
  // we open the browser using a small workaround — get_oauth_port first.

  // Use invoke("get_oauth_port") pattern: split into two commands.
  // OR: use a fixed port range. The simplest approach for a desktop app:
  // use two separate Tauri commands: get_oauth_port + wait_oauth_callback.
  // For now: use the combined approach — start server + open browser in parallel
  // by invoking start_oauth_server_with_port which returns the port immediately
  // via a side-channel (Tauri event), then waits.

  // ── Pragmatic approach: pre-bind port, open browser, wait ────────────────
  // Use get_oauth_redirect_port first (a separate lightweight command),
  // then open browser, then invoke start_oauth_server.
  //
  // Since we only have start_oauth_server (combined), we open a browser
  // to a known URI and let the server wait. The user approves, Google
  // redirects to 127.0.0.1, and start_oauth_server resolves.
  //
  // The catch: we don't know the port before binding. Solution:
  // use a TWO-PHASE approach already baked into Rust — the server
  // binds immediately (before awaiting accept), so we read the port
  // from a Tauri event fired during setup.
  //
  // Simplest workaround that avoids changing the Rust command:
  // use a FIXED redirect port (e.g. 54321) for desktop. If occupied,
  // try next ports. This is what many desktop OAuth implementations do.

  // For this implementation we use port determined by Rust (random),
  // communicated via a Tauri event "oauth_server_ready" before blocking.
  // See Task 2 Step 2.1 note: the Rust command fires a tauri event with
  // the port before waiting for accept.

  // ── Updated approach: listen for event then open browser ─────────────────
  const { listen } = await import("@tauri-apps/api/event");

  let unlisten: (() => void) | null = null;
  let resolvePort: (port: number) => void;
  const portPromise = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });

  unlisten = await listen<{ port: number }>("oauth_server_ready", (event) => {
    resolvePort(event.payload.port);
    unlisten?.();
  });

  // Start server in background — it fires "oauth_server_ready" then blocks
  const callbackPromise = invoke<{ code: string; state: string; port: number }>(
    "start_oauth_server",
    { stateParam: state }
  );

  // Wait for port from event (typically <10ms)
  const port = await Promise.race([
    portPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OAuth server did not start")), 5000)
    ),
  ]);

  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = buildAuthUrl({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    codeChallenge,
    state,
  });

  await open(authUrl);

  // Wait for callback
  const { code } = await callbackPromise;

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    code,
    codeVerifier,
  });

  // Persist to keychain
  await saveApiKeyToKeychain(GEMINI_ACCESS_TOKEN_KEY as any, tokens.accessToken);
  if (tokens.refreshToken) {
    await saveApiKeyToKeychain(GEMINI_REFRESH_TOKEN_KEY as any, tokens.refreshToken);
  }
  await saveApiKeyToKeychain(GEMINI_TOKEN_EXPIRY_KEY as any, String(tokens.expiresAt));

  return tokens;
}

/**
 * Load and auto-refresh the stored Gemini OAuth access token.
 * Returns null if no token is stored.
 */
export async function loadGeminiOAuthToken(): Promise<string | null> {
  const { loadApiKeysFromKeychain, saveApiKeyToKeychain } = await import("../ai/types");
  const keys = await loadApiKeysFromKeychain();

  const accessToken = (keys as any)[GEMINI_ACCESS_TOKEN_KEY];
  const refreshToken = (keys as any)[GEMINI_REFRESH_TOKEN_KEY];
  const expiryStr = (keys as any)[GEMINI_TOKEN_EXPIRY_KEY];

  if (!accessToken) return null;

  const expiry = Number(expiryStr ?? 0);
  const nearExpiry = expiry > 0 && Date.now() >= expiry - OAUTH_EXPIRY_BUFFER_MS;

  if (nearExpiry && refreshToken) {
    try {
      const refreshed = await refreshAccessToken({
        clientId: GOOGLE_CLIENT_ID,
        refreshToken,
      });
      await saveApiKeyToKeychain(GEMINI_ACCESS_TOKEN_KEY as any, refreshed.accessToken);
      await saveApiKeyToKeychain(GEMINI_TOKEN_EXPIRY_KEY as any, String(refreshed.expiresAt));
      return refreshed.accessToken;
    } catch {
      // Refresh failed — fall through to returning stale token or null
      return null;
    }
  }

  return accessToken;
}

/** Disconnect Google account — removes all OAuth tokens from keychain. */
export async function disconnectGoogleAccount(): Promise<void> {
  const { saveApiKeyToKeychain } = await import("../ai/types");
  await saveApiKeyToKeychain(GEMINI_ACCESS_TOKEN_KEY as any, "");
  await saveApiKeyToKeychain(GEMINI_REFRESH_TOKEN_KEY as any, "");
  await saveApiKeyToKeychain(GEMINI_TOKEN_EXPIRY_KEY as any, "");
}
```

> **Note on `start_oauth_server` Rust command:** The Rust command needs to fire a `tauri::Emitter::emit` event called `"oauth_server_ready"` with the port _before_ awaiting the browser callback. Update `oauth.rs` `start_oauth_server` signature to accept `app: tauri::AppHandle` and emit the event.

- [ ] **Step 3.4: Update Rust `start_oauth_server` to emit port via event**

Replace the signature and beginning of `start_oauth_server` in `src-tauri/src/commands/oauth.rs`:

```rust
use tauri::AppHandle;
use tauri::Emitter; // at top of file

#[derive(serde::Serialize, Clone)]
struct OAuthServerReady {
    port: u16,
}

#[tauri::command]
pub async fn start_oauth_server(
    state_param: String,
    app: AppHandle,
) -> Result<OAuthCallbackResult, String> {
    let listener = bind_random_port().await?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    // Emit port to frontend BEFORE waiting for callback
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
```

- [ ] **Step 3.5: Build Rust to verify**

```
cd src-tauri && cargo check 2>&1 | tail -20
```
Expected: no errors

- [ ] **Step 3.6: Run TypeScript tests**

```
npx vitest run src/lib/auth/googleOAuth.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 3.7: Commit**

```bash
git add src/lib/auth/googleOAuth.ts src/lib/auth/googleOAuth.test.ts src-tauri/src/commands/oauth.rs
git commit -m "feat(auth): complete Google OAuth flow — PKCE, port event, token exchange, keychain storage"
```

---

## Task 4: GeminiProvider Dual Constructor

**Files:**
- Modify: `src/lib/ai/providers/GeminiProvider.ts`
- Modify: `src/lib/ai/ProviderRegistry.ts`
- Modify: `src/lib/ai/providers/GeminiProvider.test.ts` (add accessToken test)

- [ ] **Step 4.1: Write failing test for accessToken constructor**

Append to `src/lib/ai/providers/GeminiProvider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { GeminiProvider } from "./GeminiProvider";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContentStream: vi.fn() },
  })),
}));

describe("GeminiProvider constructor", () => {
  it("accepts apiKey string", () => {
    const { GoogleGenAI } = require("@google/genai");
    new GeminiProvider({ apiKey: "AIzaSytest" });
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: "AIzaSytest" });
  });

  it("accepts accessToken string", () => {
    const { GoogleGenAI } = require("@google/genai");
    vi.clearAllMocks();
    new GeminiProvider({ accessToken: "ya29.test" });
    // GoogleGenAI is constructed — auth field set
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "ya29.test" })
    );
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```
npx vitest run src/lib/ai/providers/GeminiProvider.test.ts
```
Expected: FAIL — constructor doesn't accept accessToken

- [ ] **Step 4.3: Update `GeminiProvider.ts` constructor**

Replace the constructor in `src/lib/ai/providers/GeminiProvider.ts`:

```typescript
// Change the class declaration and constructor:

export type GeminiInit = { apiKey: string } | { accessToken: string };

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly name = "Gemini";

  private client: GoogleGenAI;

  constructor(init: GeminiInit | string) {
    // Accept legacy string (apiKey) for backwards compatibility
    if (typeof init === "string") {
      this.client = new GoogleGenAI({ apiKey: init });
    } else if ("apiKey" in init) {
      this.client = new GoogleGenAI({ apiKey: init.apiKey });
    } else {
      // OAuth access token — GoogleGenAI supports { accessToken } directly
      this.client = new GoogleGenAI({ accessToken: init.accessToken });
    }
  }
  // ... rest unchanged
```

- [ ] **Step 4.4: Update `ProviderRegistry.ts` to use OAuth token for Gemini**

Replace `getProvider` in `src/lib/ai/ProviderRegistry.ts`:

```typescript
import { ClaudeProvider } from "./providers/ClaudeProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { OllamaProvider } from "./providers/OllamaProvider";
import type { AIProvider, ProviderSettings } from "./types";
import { PROVIDER_CATALOG } from "./types";

export function getProvider(settings: ProviderSettings): AIProvider | null {
  const { activeProvider, keys } = settings;

  if (activeProvider === "ollama") return new OllamaProvider();

  const apiKey = keys[activeProvider] ?? "";

  // For Gemini: prefer OAuth access token over API key
  if (activeProvider === "gemini") {
    const accessToken = (keys as any)["gemini_access_token"] as string | undefined;
    if (accessToken) return new GeminiProvider({ accessToken });
    if (apiKey) return new GeminiProvider({ apiKey });
    return null;
  }

  if (!apiKey) return null;

  const meta = PROVIDER_CATALOG.find((p) => p.id === activeProvider);

  switch (activeProvider) {
    case "claude":
      return new ClaudeProvider(apiKey);
    case "openai":
      return new OpenAIProvider(apiKey, "openai");
    case "nvidia":
      return new OpenAIProvider(apiKey, "nvidia", meta?.baseURL);
    default:
      return null;
  }
}
```

- [ ] **Step 4.5: Run tests**

```
npx vitest run src/lib/ai/providers/GeminiProvider.test.ts
```
Expected: PASS

- [ ] **Step 4.6: Run full test suite to check no regressions**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 4.7: Commit**

```bash
git add src/lib/ai/providers/GeminiProvider.ts src/lib/ai/ProviderRegistry.ts src/lib/ai/providers/GeminiProvider.test.ts
git commit -m "feat(gemini): dual-constructor — accepts apiKey or OAuth accessToken"
```

---

## Task 5: KeySetupWizard Component

**Files:**
- Create: `src/components/ai/KeySetupWizard.tsx`
- Create: `src/components/ai/KeySetupWizard.test.tsx`

- [ ] **Step 5.1: Write failing component test**

Create `src/components/ai/KeySetupWizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeySetupWizard } from "./KeySetupWizard";

// Mock clipboard
const mockReadText = vi.fn();
Object.defineProperty(navigator, "clipboard", {
  value: { readText: mockReadText },
  writable: true,
});

// Mock shell open
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// Mock saveApiKeyToKeychain
vi.mock("../../lib/ai/types", () => ({
  saveApiKeyToKeychain: vi.fn().mockResolvedValue(undefined),
  PROVIDER_CATALOG: [
    {
      id: "claude",
      name: "Claude (Anthropic)",
      keyPrefix: "sk-ant",
      keyPlaceholder: "sk-ant-api03-...",
    },
  ],
}));

describe("KeySetupWizard", () => {
  const onSave = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReadText.mockResolvedValue("");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders step 1 with provider name and open console button", () => {
    render(
      <KeySetupWizard
        open={true}
        providerId="claude"
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(screen.getByText(/Claude/i)).toBeDefined();
    expect(screen.getByText(/Open.*Console/i)).toBeDefined();
  });

  it("Confirm is disabled when no key detected", () => {
    render(
      <KeySetupWizard open={true} providerId="claude" onSave={onSave} onClose={onClose} />
    );
    const confirm = screen.getByRole("button", { name: /confirm/i });
    expect(confirm).toBeDisabled();
  });

  it("Confirm enabled after clipboard returns valid key", async () => {
    mockReadText.mockResolvedValue("sk-ant-api03-validkey123");
    render(
      <KeySetupWizard open={true} providerId="claude" onSave={onSave} onClose={onClose} />
    );
    // advance clipboard polling interval
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    const confirm = screen.getByRole("button", { name: /confirm/i });
    expect(confirm).not.toBeDisabled();
  });

  it("calls onSave and onClose when Confirm clicked", async () => {
    const { saveApiKeyToKeychain } = await import("../../lib/ai/types");
    mockReadText.mockResolvedValue("sk-ant-api03-validkey123");
    render(
      <KeySetupWizard open={true} providerId="claude" onSave={onSave} onClose={onClose} />
    );
    await act(async () => { vi.advanceTimersByTime(600); });
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(saveApiKeyToKeychain).toHaveBeenCalledWith("claude", "sk-ant-api03-validkey123");
    expect(onSave).toHaveBeenCalledWith("claude", "sk-ant-api03-validkey123");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows manual paste input when clipboard permission denied", async () => {
    mockReadText.mockRejectedValue(new Error("Permission denied"));
    render(
      <KeySetupWizard open={true} providerId="claude" onSave={onSave} onClose={onClose} />
    );
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByPlaceholderText(/paste/i)).toBeDefined();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```
npx vitest run src/components/ai/KeySetupWizard.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 5.3: Implement `KeySetupWizard.tsx`**

Create `src/components/ai/KeySetupWizard.tsx`:

```tsx
/**
 * KeySetupWizard — 3-step guided wizard for entering API keys.
 * Step 1: Open provider console.
 * Step 2: Clipboard auto-detects valid key (ring turns green).
 * Step 3: Confirm saves to keychain.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, ExternalLink, CheckCircle2 } from "lucide-react";
import { PROVIDER_CATALOG, saveApiKeyToKeychain, type ProviderID } from "../../lib/ai/types";

const PROVIDER_DOCS: Record<string, string> = {
  claude: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

interface Props {
  open: boolean;
  providerId: ProviderID;
  onSave: (providerId: ProviderID, key: string) => void;
  onClose: () => void;
}

export function KeySetupWizard({ open, providerId, onSave, onClose }: Props) {
  const meta = PROVIDER_CATALOG.find((p) => p.id === providerId);
  const [detectedKey, setDetectedKey] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [clipboardDenied, setClipboardDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<number | null>(null);

  const activeKey = detectedKey || manualKey;
  const prefixes = meta?.keyPrefix
    ? Array.isArray(meta.keyPrefix) ? meta.keyPrefix : [meta.keyPrefix]
    : [];
  const isValidKey = prefixes.length === 0 || prefixes.some((p) => activeKey.startsWith(p));

  const pollClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const valid = text.trim().length > 10 &&
        (prefixes.length === 0 || prefixes.some((p) => text.trim().startsWith(p)));
      if (valid) setDetectedKey(text.trim());
    } catch {
      setClipboardDenied(true);
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [prefixes]);

  useEffect(() => {
    if (!open) {
      setDetectedKey("");
      setManualKey("");
      setClipboardDenied(false);
      return;
    }
    pollClipboard();
    pollRef.current = window.setInterval(pollClipboard, 500);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [open, pollClipboard]);

  if (!open || !meta) return null;

  const openConsole = async () => {
    const url = PROVIDER_DOCS[providerId];
    if (!url) return;
    try {
      const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
      await shellOpen(url);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const handleConfirm = async () => {
    if (!activeKey || !isValidKey) return;
    setSaving(true);
    await saveApiKeyToKeychain(providerId, activeKey);
    setSaving(false);
    onSave(providerId, activeKey);
    onClose();
  };

  const ringColor = detectedKey
    ? "border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
    : "border-white/10";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-[460px] bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <div>
            <h2 className="text-sm font-bold text-white">Set up {meta.name}</h2>
            <p className="text-xs text-white/30 mt-0.5">3-step guided setup</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Step 1 */}
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[#00d2ff]/10 text-[#00d2ff] text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Open API key page</p>
              <button
                onClick={openConsole}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white text-xs transition-colors"
              >
                Open {meta.name} Console <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[#00d2ff]/10 text-[#00d2ff] text-xs font-bold flex items-center justify-center shrink-0">2</span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Copy your API key</p>
              {clipboardDenied ? (
                <div>
                  <p className="text-xs text-white/40 mb-2">Clipboard access denied — paste your key below:</p>
                  <input
                    type="password"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value)}
                    placeholder={`Paste ${meta.keyPlaceholder}`}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00d2ff] font-mono"
                  />
                </div>
              ) : (
                <div className={`rounded-lg border-2 px-4 py-3 transition-all ${ringColor}`}>
                  {detectedKey ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs text-emerald-400 font-medium">Key detected</span>
                      <span className="text-xs text-white/40 font-mono ml-auto">···{detectedKey.slice(-4)}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-white/30 text-center">
                      Watching clipboard for {prefixes.map((p) => `"${p}"`).join(" or ")} key…
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${activeKey && isValidKey ? "bg-[#00d2ff]/10 text-[#00d2ff]" : "bg-white/5 text-white/20"}`}>3</span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Confirm</p>
              <button
                onClick={handleConfirm}
                disabled={!activeKey || !isValidKey || saving}
                className="w-full py-2 rounded-lg bg-[#00d2ff] text-black font-bold text-sm hover:opacity-90 disabled:opacity-30 transition-opacity"
              >
                {saving ? "Saving…" : "Save & Use"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.4: Run tests**

```
npx vitest run src/components/ai/KeySetupWizard.test.tsx
```
Expected: PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/components/ai/KeySetupWizard.tsx src/components/ai/KeySetupWizard.test.tsx
git commit -m "feat(ui): KeySetupWizard — clipboard-polling 3-step API key setup wizard"
```

---

## Task 6: ConnectScreen Component

**Files:**
- Create: `src/components/onboarding/ConnectScreen.tsx`
- Create: `src/components/onboarding/ConnectScreen.test.tsx`

- [ ] **Step 6.1: Write failing tests**

Create `src/components/onboarding/ConnectScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectScreen } from "./ConnectScreen";

vi.mock("../../lib/auth/googleOAuth", () => ({
  startGoogleOAuthFlow: vi.fn().mockResolvedValue({
    accessToken: "ya29.test",
    refreshToken: "1//test",
    expiresAt: Date.now() + 3600000,
  }),
}));

vi.mock("../../lib/ai/types", () => ({
  saveApiKeyToKeychain: vi.fn().mockResolvedValue(undefined),
  loadSettings: vi.fn().mockReturnValue({ activeProvider: "claude", keys: {}, models: {} }),
  saveSettings: vi.fn(),
}));

describe("ConnectScreen", () => {
  const onComplete = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders three entry paths", () => {
    render(<ConnectScreen onComplete={onComplete} />);
    expect(screen.getByText(/Sign in with Google/i)).toBeDefined();
    expect(screen.getByText(/Enter API key/i)).toBeDefined();
    expect(screen.getByText(/Skip/i)).toBeDefined();
  });

  it("Skip calls onComplete immediately", async () => {
    render(<ConnectScreen onComplete={onComplete} />);
    await userEvent.click(screen.getByText(/Skip/i));
    expect(onComplete).toHaveBeenCalled();
  });

  it("Google Sign-In triggers OAuth flow and calls onComplete", async () => {
    const { startGoogleOAuthFlow } = await import("../../lib/auth/googleOAuth");
    render(<ConnectScreen onComplete={onComplete} />);
    await userEvent.click(screen.getByText(/Sign in with Google/i));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(startGoogleOAuthFlow).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```
npx vitest run src/components/onboarding/ConnectScreen.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 6.3: Implement `ConnectScreen.tsx`**

Create `src/components/onboarding/ConnectScreen.tsx`:

```tsx
/**
 * ConnectScreen — first-run AI provider setup.
 * Shown when no AI provider is configured.
 * Three paths: Google Sign-In (Gemini), API Key Wizard (Claude/OpenAI), Skip.
 */
import React, { useState } from "react";
import { CheckCircle2, Key } from "lucide-react";
import { startGoogleOAuthFlow } from "../../lib/auth/googleOAuth";
import { saveSettings, loadSettings } from "../../lib/ai/types";
import { KeySetupWizard } from "../ai/KeySetupWizard";
import type { ProviderID } from "../../lib/ai/types";

interface Props {
  onComplete: () => void;
}

type Status = "idle" | "google_loading" | "google_done" | "google_error" | "wizard";

export function ConnectScreen({ onComplete }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [googleError, setGoogleError] = useState("");
  const [wizardProvider, setWizardProvider] = useState<ProviderID>("claude");
  const [wizardOpen, setWizardOpen] = useState(false);

  const isTauri =
    typeof window !== "undefined" && typeof (window as any).__TAURI__ !== "undefined";

  const handleGoogleSignIn = async () => {
    setStatus("google_loading");
    setGoogleError("");
    try {
      await startGoogleOAuthFlow();
      setStatus("google_done");
      // Update active provider to Gemini
      const settings = loadSettings();
      saveSettings({ ...settings, activeProvider: "gemini" });
      setTimeout(onComplete, 1000);
    } catch (e: any) {
      setGoogleError(e?.message ?? "Sign-in failed");
      setStatus("google_error");
    }
  };

  const openWizard = (id: ProviderID) => {
    setWizardProvider(id);
    setWizardOpen(true);
  };

  const handleWizardSave = (id: ProviderID, _key: string) => {
    const settings = loadSettings();
    saveSettings({ ...settings, activeProvider: id });
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-[#080808] z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 bg-[#00d2ff] rounded-xl flex items-center justify-center mb-1">
            <span className="text-black font-black text-xl">D</span>
          </div>
          <span className="text-2xl font-bold text-white">Welcome to Daitalk</span>
          <span className="text-white/40 text-sm text-center">
            Connect an AI provider to get started.
            <br />Your keys are stored locally — never sent to our servers.
          </span>
        </div>

        {/* Google Sign-In */}
        <div className="w-full flex flex-col gap-3">
          {isTauri ? (
            <button
              onClick={handleGoogleSignIn}
              disabled={status === "google_loading" || status === "google_done"}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-gray-900 font-semibold text-sm hover:bg-gray-100 disabled:opacity-60 transition-all shadow-lg"
            >
              {status === "google_loading" ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
              ) : status === "google_done" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {status === "google_done" ? "Connected!" : "Sign in with Google"}
              <span className="ml-auto text-xs text-gray-400 font-normal">Gemini</span>
            </button>
          ) : (
            <div className="w-full px-4 py-3 rounded-xl border border-[#2a2a2a] text-white/30 text-sm text-center">
              Google Sign-In requires the desktop app
            </div>
          )}

          {googleError && (
            <p className="text-xs text-red-400/80 text-center">{googleError}</p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#262626]" />
            <span className="text-xs text-white/20">or</span>
            <div className="flex-1 h-px bg-[#262626]" />
          </div>

          {/* API Key Wizard buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => openWizard("claude")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Claude key
            </button>
            <button
              onClick={() => openWizard("openai")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              OpenAI key
            </button>
            <button
              onClick={() => openWizard("gemini")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Gemini key
            </button>
          </div>
        </div>
      </div>

      {/* Skip */}
      <button
        onClick={onComplete}
        className="absolute bottom-6 right-6 text-xs text-white/25 hover:text-white/50 transition-colors"
      >
        Skip for now →
      </button>

      <KeySetupWizard
        open={wizardOpen}
        providerId={wizardProvider}
        onSave={handleWizardSave}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 6.4: Run tests**

```
npx vitest run src/components/onboarding/ConnectScreen.test.tsx
```
Expected: PASS

- [ ] **Step 6.5: Run full suite**

```
npx vitest run
```
Expected: all pass

- [ ] **Step 6.6: Commit**

```bash
git add src/components/onboarding/ConnectScreen.tsx src/components/onboarding/ConnectScreen.test.tsx
git commit -m "feat(ui): ConnectScreen — first-run AI provider setup with Google Sign-In + key wizard"
```

---

## Task 7: ProviderSettingsDialog Upgrades

**Files:**
- Modify: `src/components/ai/ProviderSettingsDialog.tsx`

- [ ] **Step 7.1: Add Google Sign-In button to Gemini tab and wizard triggers to Claude/OpenAI tabs**

In `src/components/ai/ProviderSettingsDialog.tsx`, make these changes:

**a) Add imports at top of file (after existing imports):**

```typescript
import { startGoogleOAuthFlow, loadGeminiOAuthToken, disconnectGoogleAccount } from "../../lib/auth/googleOAuth";
import { KeySetupWizard } from "./KeySetupWizard";
```

**b) Add state variables inside the component (after `const [saving, setSaving] = useState(false)`):**

```typescript
const [googleSigningIn, setGoogleSigningIn] = useState(false);
const [googleConnected, setGoogleConnected] = useState(false);
const [wizardOpen, setWizardOpen] = useState(false);
```

**c) Add effect to check OAuth token status when dialog opens (after the existing `useEffect`):**

```typescript
useEffect(() => {
  if (!open) return;
  loadGeminiOAuthToken().then((token) => {
    setGoogleConnected(!!token);
  }).catch(() => {});
}, [open]);
```

**d) Add handler for Google Sign-In (before `handleSave`):**

```typescript
const handleGoogleSignIn = async () => {
  setGoogleSigningIn(true);
  try {
    await startGoogleOAuthFlow();
    setGoogleConnected(true);
    setActiveProvider("gemini");
  } catch (e: any) {
    // Show error inline — toast not available here
    console.error("Google Sign-In failed:", e);
  } finally {
    setGoogleSigningIn(false);
  }
};

const handleGoogleDisconnect = async () => {
  await disconnectGoogleAccount();
  setGoogleConnected(false);
};
```

**e) Replace the Gemini tab API key section** — find the block inside `{isOllama ? ... : (` that renders the API key input, and add a Google Sign-In button above the key input for Gemini. Replace the entire `{isOllama ? (...) : (...)}` block with:

```tsx
{isOllama ? (
  /* Ollama: no API key — show status / instructions instead */
  <div className="bg-[#1a1a1a] rounded-lg px-4 py-3 border border-[#2a2a2a]">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
        Local Inference (No Key Required)
      </span>
      <a
        href={PROVIDER_DOCS.ollama}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-[10px] text-[#00d2ff]/70 hover:text-[#00d2ff] transition-colors"
      >
        Download Ollama <ExternalLink className="w-2.5 h-2.5" />
      </a>
    </div>
    <p className="text-xs text-white/40 leading-relaxed">
      Ollama must be running locally at{" "}
      <code className="text-white/70 font-mono text-[11px]">http://127.0.0.1:11434</code>.
      Pull a model with:{" "}
      <code className="text-white/70 font-mono text-[11px]">ollama pull qwen2.5:7b</code>
    </p>
  </div>
) : (
  <div className="flex flex-col gap-3">
    {/* Google Sign-In — Gemini tab only */}
    {settings.activeProvider === "gemini" && (
      <div>
        {googleConnected ? (
          <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-lg px-4 py-3 border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs text-emerald-400 flex-1">Signed in with Google</span>
            <button
              onClick={handleGoogleDisconnect}
              className="text-[10px] text-white/30 hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={handleGoogleSignIn}
            disabled={googleSigningIn}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white text-gray-900 font-semibold text-xs hover:bg-gray-100 disabled:opacity-60 transition-all"
          >
            {googleSigningIn ? (
              <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Sign in with Google
          </button>
        )}
        <div className="flex items-center gap-2 my-1">
          <div className="flex-1 h-px bg-[#2a2a2a]" />
          <span className="text-[10px] text-white/20">or enter API key</span>
          <div className="flex-1 h-px bg-[#2a2a2a]" />
        </div>
      </div>
    )}

    {/* API Key input */}
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
          {activeMeta.name} API Key
        </label>
        <a
          href={PROVIDER_DOCS[settings.activeProvider]}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[10px] text-[#00d2ff]/70 hover:text-[#00d2ff] transition-colors"
        >
          {PROVIDER_LINK_LABEL[settings.activeProvider] ?? "Get key"}{" "}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
      <div className="relative">
        <input
          type={showKeys[settings.activeProvider] ? "text" : "password"}
          value={activeKey}
          onChange={(e) => setKey(settings.activeProvider, e.target.value)}
          placeholder={activeMeta.keyPlaceholder}
          className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 pr-10 py-2.5 text-sm text-white focus:outline-none focus:border-[#00d2ff] font-mono"
        />
        <button
          type="button"
          onClick={() =>
            setShowKeys((s) => ({ ...s, [settings.activeProvider]: !s[settings.activeProvider] }))
          }
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
        >
          {showKeys[settings.activeProvider] ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
      </div>
      {activeKey && activeMeta.keyPrefix && (() => {
        const prefixes = Array.isArray(activeMeta.keyPrefix)
          ? activeMeta.keyPrefix
          : [activeMeta.keyPrefix];
        const valid = prefixes.length === 0 || prefixes.some((p) => activeKey.startsWith(p));
        if (valid) return null;
        return (
          <p className="mt-1 text-xs text-amber-400/70">
            Key should start with {prefixes.map((p) => `"${p}"`).join(" or ")}
          </p>
        );
      })()}
      {/* Wizard shortcut for Claude / OpenAI */}
      {(settings.activeProvider === "claude" || settings.activeProvider === "openai") && !activeKey && (
        <button
          onClick={() => setWizardOpen(true)}
          className="mt-1 text-[11px] text-[#00d2ff]/60 hover:text-[#00d2ff] transition-colors"
        >
          Set up with wizard →
        </button>
      )}
    </div>
  </div>
)}
```

**f) Add `<KeySetupWizard>` at the end of the dialog, just before the closing `</div>` of the outer container:**

```tsx
<KeySetupWizard
  open={wizardOpen}
  providerId={settings.activeProvider}
  onSave={(id, key) => {
    setKey(id, key);
    setWizardOpen(false);
  }}
  onClose={() => setWizardOpen(false)}
/>
```

- [ ] **Step 7.2: Run type check**

```
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 7.3: Commit**

```bash
git add src/components/ai/ProviderSettingsDialog.tsx
git commit -m "feat(ui): ProviderSettingsDialog — Google Sign-In button, wizard shortcut for Claude/OpenAI"
```

---

## Task 8: App.tsx First-Run Gate

**Files:**
- Modify: `src/App.tsx`

The gate logic: on mount, check if any AI provider key (or OAuth token) is stored. If not, show `ConnectScreen` instead of normal app.

- [ ] **Step 8.1: Add import and state to App.tsx**

After the existing `import { WelcomeScreen }` line, add:

```typescript
import { ConnectScreen } from "./components/onboarding/ConnectScreen";
```

After `const [showWelcome, setShowWelcome] = useState(...)` state declaration (around line 113), add:

```typescript
const [showConnectScreen, setShowConnectScreen] = useState(false);
```

- [ ] **Step 8.2: Add check in the main `useEffect` (around line 139)**

At the top of the non-smoke-mode `useEffect` block (after `registerHandlers()` call, before the `listen` calls), add:

```typescript
// Check if an AI provider is configured — show ConnectScreen if not
void (async () => {
  const { loadApiKeysFromKeychain } = await import("./lib/ai/types");
  const { loadGeminiOAuthToken } = await import("./lib/auth/googleOAuth");
  try {
    const [keys, oauthToken] = await Promise.all([
      loadApiKeysFromKeychain(),
      loadGeminiOAuthToken().catch(() => null),
    ]);
    const hasAnyProvider =
      oauthToken ||
      Object.values(keys).some((v) => typeof v === "string" && v.length > 0);
    if (!hasAnyProvider) {
      setShowConnectScreen(true);
    }
  } catch {
    // keychain unavailable — don't block the user
  }
})();
```

- [ ] **Step 8.3: Add ConnectScreen render at the bottom of the JSX (just before the closing `</div>`)**

Find the `{showWelcome && (` block at the end of the JSX (around line 1422), and add _before_ it:

```tsx
{showConnectScreen && (
  <ConnectScreen
    onComplete={() => setShowConnectScreen(false)}
  />
)}
```

- [ ] **Step 8.4: Run type check**

```
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 8.5: Run full test suite**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 8.6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): first-run ConnectScreen gate — shown when no AI provider configured"
```

---

## Task 9: Final Integration Check + Push

- [ ] **Step 9.1: Run full test suite one last time**

```
npx vitest run
```
Expected: all tests pass

- [ ] **Step 9.2: Run type check**

```
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 9.3: Push to main**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ ConnectScreen with 3 paths (Task 6)
- ✅ Google OAuth module — PKCE, server, exchange, refresh (Tasks 1-3)
- ✅ Rust one-shot localhost server (Task 2)
- ✅ GeminiProvider dual constructor (Task 4)
- ✅ KeySetupWizard with clipboard polling (Task 5)
- ✅ ProviderSettingsDialog — Google Sign-In + wizard trigger (Task 7)
- ✅ App.tsx first-run gate (Task 8)
- ✅ Unit tests for PKCE, refresh, wizard, connect screen (Tasks 1, 5, 6)
- ✅ Clipboard denial fallback (Task 5)
- ✅ OAuth state mismatch error handling (Task 2)
- ✅ 5-minute OAuth timeout (Task 2)
- ✅ Non-Tauri context: Google Sign-In button hidden (Task 6 uses `isTauri` check)

**Prerequisite reminder:** Before the OAuth flow will work end-to-end, set `VITE_GOOGLE_CLIENT_ID` in `.env.local` with a real Google OAuth Client ID registered for Desktop app type at Google Cloud Console → Credentials, with redirect URI `http://127.0.0.1`.
