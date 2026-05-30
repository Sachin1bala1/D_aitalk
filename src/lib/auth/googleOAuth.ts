/**
 * Google OAuth 2.0 PKCE helpers for desktop apps.
 * No client secret needed — PKCE flow only.
 */

export const GOOGLE_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? "YOUR_GOOGLE_CLIENT_ID_HERE";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "email",
  "profile",
].join(" ");

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/** Generate a PKCE code_verifier + SHA-256 code_challenge. */
export async function generatePKCE(): Promise<PKCEPair> {
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
  expiresAt: number;
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

// ── Keychain keys for OAuth tokens ────────────────────────────────────────────

export const GEMINI_ACCESS_TOKEN_KEY = "gemini_access_token";
export const GEMINI_REFRESH_TOKEN_KEY = "gemini_refresh_token";
export const GEMINI_TOKEN_EXPIRY_KEY = "gemini_token_expiry";
const OAUTH_EXPIRY_BUFFER_MS = 60_000;

// Keys are stored under "daitalk_<key>" in the OS keychain, matching the prefix
// used by the rest of the app, but bypassing the ProviderID-typed saveApiKeyToKeychain.
const KEYCHAIN_PREFIX = "daitalk_";
const LS_PREFIX = "daitalk_apikey_";

async function storeOAuthValue(key: string, value: string): Promise<void> {
  const { DbClient } = await import("../db/DbClient");
  if (typeof window !== "undefined") {
    if (value) {
      localStorage.setItem(LS_PREFIX + key, value);
    } else {
      localStorage.removeItem(LS_PREFIX + key);
    }
  }
  try {
    await DbClient.storeApiKey(KEYCHAIN_PREFIX + key, value);
  } catch {
    // localStorage backup is sufficient
  }
}

async function loadOAuthValue(key: string): Promise<string> {
  const { DbClient } = await import("../db/DbClient");
  try {
    const val = await DbClient.getApiKey(KEYCHAIN_PREFIX + key);
    if (val) return val;
  } catch {
    // keychain unavailable — fall through to localStorage
  }
  if (typeof window !== "undefined") {
    return localStorage.getItem(LS_PREFIX + key) ?? "";
  }
  return "";
}

// ── Full OAuth flow ───────────────────────────────────────────────────────────

/**
 * Run the full PKCE Google OAuth flow.
 * Starts Rust callback server, opens browser, waits for redirect,
 * exchanges code for tokens, stores in keychain.
 */
export async function startGoogleOAuthFlow(): Promise<TokenResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-shell");
  const { listen } = await import("@tauri-apps/api/event");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  // Use crypto.randomUUID for state — full 128-bit entropy, no stripping needed
  const state = crypto.randomUUID().replace(/-/g, "");

  let resolvePort!: (port: number) => void;
  let rejectPort!: (err: Error) => void;
  const portPromise = new Promise<number>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });

  const unlisten = await listen<{ port: number }>("oauth_server_ready", (event) => {
    resolvePort(event.payload.port);
    unlisten();
  });

  const portTimeout = setTimeout(() => {
    unlisten();
    rejectPort(new Error("OAuth server did not start within 5 seconds"));
  }, 5000);

  const callbackPromise = invoke<{ code: string; state: string; port: number }>(
    "start_oauth_server",
    { stateParam: state }
  ).catch((err) => {
    clearTimeout(portTimeout);
    unlisten();
    throw err;
  });

  let port: number;
  try {
    port = await portPromise;
  } finally {
    clearTimeout(portTimeout);
  }

  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = buildAuthUrl({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    codeChallenge,
    state,
  });

  await open(authUrl);

  const { code } = await callbackPromise;

  const tokens = await exchangeCodeForTokens({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    code,
    codeVerifier,
  });

  await storeOAuthValue(GEMINI_ACCESS_TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) {
    await storeOAuthValue(GEMINI_REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
  await storeOAuthValue(GEMINI_TOKEN_EXPIRY_KEY, String(tokens.expiresAt));

  return tokens;
}

/**
 * Load and auto-refresh the stored Gemini OAuth access token.
 * Returns null if no token is stored.
 */
export async function loadGeminiOAuthToken(): Promise<string | null> {
  const accessToken = await loadOAuthValue(GEMINI_ACCESS_TOKEN_KEY);
  if (!accessToken) return null;

  const refreshToken = await loadOAuthValue(GEMINI_REFRESH_TOKEN_KEY);
  const expiryStr = await loadOAuthValue(GEMINI_TOKEN_EXPIRY_KEY);

  const expiry = Number(expiryStr || 0);
  const nearExpiry = expiry > 0 && Date.now() >= expiry - OAUTH_EXPIRY_BUFFER_MS;

  if (nearExpiry && refreshToken) {
    try {
      const refreshed = await refreshAccessToken({
        clientId: GOOGLE_CLIENT_ID,
        refreshToken,
      });
      await storeOAuthValue(GEMINI_ACCESS_TOKEN_KEY, refreshed.accessToken);
      await storeOAuthValue(GEMINI_TOKEN_EXPIRY_KEY, String(refreshed.expiresAt));
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  return accessToken;
}

/** Disconnect Google account — removes all OAuth tokens from keychain. */
export async function disconnectGoogleAccount(): Promise<void> {
  await storeOAuthValue(GEMINI_ACCESS_TOKEN_KEY, "");
  await storeOAuthValue(GEMINI_REFRESH_TOKEN_KEY, "");
  await storeOAuthValue(GEMINI_TOKEN_EXPIRY_KEY, "");
}
