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
  const { listen } = await import("@tauri-apps/api/event");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 16);

  let resolvePort!: (port: number) => void;
  const portPromise = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });

  const unlisten = await listen<{ port: number }>("oauth_server_ready", (event) => {
    resolvePort(event.payload.port);
    unlisten();
  });

  const callbackPromise = invoke<{ code: string; state: string; port: number }>(
    "start_oauth_server",
    { stateParam: state }
  );

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

  const { code } = await callbackPromise;

  const tokens = await exchangeCodeForTokens({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    code,
    codeVerifier,
  });

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
