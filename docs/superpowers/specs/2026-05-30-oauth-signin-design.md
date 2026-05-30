# OAuth / Sign-In Design

**Date:** 2026-05-30
**Status:** Approved

---

## Goal

Let users authenticate with AI providers without manually managing API keys. Google Sign-In covers Gemini; a guided clipboard wizard covers Claude and OpenAI. First-run onboarding screen ensures new users land in a working state immediately.

---

## Architecture

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ConnectScreen` | `src/components/onboarding/ConnectScreen.tsx` | First-run screen shown when no provider is configured |
| `KeySetupWizard` | `src/components/ai/KeySetupWizard.tsx` | 3-step clipboard wizard for Claude / OpenAI key entry |
| OAuth module (TS) | `src/lib/auth/googleOAuth.ts` | PKCE code generation, token exchange, token refresh |
| OAuth server (Rust) | `src-tauri/src/auth/oauth_server.rs` | One-shot localhost HTTP server to capture OAuth callback |
| Tauri command | `src-tauri/src/commands.rs` | `start_oauth_server` command exposed to frontend |
| `GeminiProvider` | `src/lib/ai/providers/GeminiProvider.ts` | Extended to accept either `apiKey` or `accessToken` |
| `ProviderSettingsDialog` | `src/components/ai/ProviderSettingsDialog.tsx` | Add "Sign in with Google" + "Set up →" wizard triggers |

### First-Run Gate

`App.tsx` checks on mount: if `loadSettings().activeProvider` has no key AND no OAuth token in keychain → renders `ConnectScreen` instead of main UI. Once a provider is configured, `ConnectScreen` calls `onComplete()` which sets a flag and renders the normal app.

### Three Entry Paths in ConnectScreen

1. **Google Sign-In** → triggers OAuth flow → configures Gemini → enters app
2. **Guided Wizard** → `KeySetupWizard` for Claude or OpenAI → enters app
3. **Skip** → enters app without any provider (banner shown in chat until configured)

---

## Data Flow

### Google OAuth (PKCE + localhost)

```
User clicks "Sign in with Google"
  → TypeScript: generatePKCE() → { code_verifier, code_challenge }
  → invoke("start_oauth_server") → Rust starts HTTP server on random port (127.0.0.1:PORT)
  → open browser: accounts.google.com/o/oauth2/v2/auth
      ?scope=https://www.googleapis.com/auth/generative-language.retriever%20email%20profile
      &response_type=code&code_challenge_method=S256
      &redirect_uri=http://127.0.0.1:PORT/callback
  → User approves in browser
  → Google redirects to http://127.0.0.1:PORT/callback?code=AUTH_CODE
  → Rust captures code, shuts down server, returns { code } to TypeScript
  → TypeScript: POST https://oauth2.googleapis.com/token with { code, code_verifier }
  → Receives { access_token, refresh_token, expires_in }
  → saveApiKeyToKeychain("gemini_access_token", access_token)
  → saveApiKeyToKeychain("gemini_refresh_token", refresh_token)
  → saveApiKeyToKeychain("gemini_token_expiry", String(Date.now() + expires_in * 1000))
  → GeminiProvider constructed with { accessToken } instead of { apiKey }
```

### Token Refresh

`loadApiKeysFromKeychain()` checks `gemini_token_expiry`. If within 60 seconds of expiry:
- POST `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`
- Store new access token + expiry
- Return refreshed token as the Gemini key

### Guided Key Wizard (Claude / OpenAI)

```
User clicks "Set up →" on Claude or OpenAI tab
  → KeySetupWizard opens
  → Step 1: "Open key page" button → shell.open(PROVIDER_DOCS[id])
  → Step 2: Clipboard polling every 500ms via navigator.clipboard.readText()
     → If text starts with key prefix → ring glows green, key preview shown
     → If clipboard permission denied → text input appears instead
  → Step 3: User clicks "Confirm" → saveApiKeyToKeychain(id, key) → onSave called → wizard closes
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| User never approves OAuth (5 min timeout) | Rust server times out → UI shows "Sign-in cancelled" toast, back to provider tabs |
| Token exchange network failure | Catch block → "Google sign-in failed — try again" with retry button |
| Refresh token revoked | Falls back to showing re-sign-in prompt: "Your Google session expired" |
| Clipboard permission denied | Wizard degrades: hides clipboard ring, shows manual paste input |
| Port conflict for OAuth server | Rust retries up to 5 random ports before returning error |
| Running in web context (non-Tauri) | `start_oauth_server` unavailable → "Sign in with Google" button hidden, manual key only |

---

## UI Details

### ConnectScreen

- Full-screen dark panel, centered card
- Daitalk logo + tagline
- Three buttons stacked: "Sign in with Google" (primary), "Enter API key →" (secondary), "Skip for now" (text link)
- "Sign in with Google" uses official Google branding (G logo + "Sign in with Google" text per Google guidelines)
- After success: 1s "Connected!" state → `onComplete()` called

### KeySetupWizard

- Modal overlay (same style as ProviderSettingsDialog)
- Step indicator (1 → 2 → 3) at top
- Step 1: Provider name + "Open [Provider] Console →" button
- Step 2: Animated ring around clipboard area — grey idle, pulses cyan when detecting, fills green when valid key found; shows last 4 chars of detected key
- Step 3: Confirm button — enabled once key is detected or manually entered

### ProviderSettingsDialog upgrades

- Gemini tab: "Sign in with Google" button at top of config section; shows connected Google account email if signed in; "Disconnect" link to revoke token
- Claude / OpenAI tabs: "Set up with wizard →" link below API key input

---

## Testing Strategy

### Unit Tests

- `generatePKCE()`: verify `code_challenge = BASE64URL(SHA256(code_verifier))`
- Token refresh logic: mock `fetch`, verify POST body contains `grant_type=refresh_token`
- `GeminiProvider` with `accessToken` branch: verify `GoogleGenAI` constructed with auth token

### Integration Tests

- Mock OAuth server returning a known `code` → verify token exchange called with correct `code_verifier`
- `loadApiKeysFromKeychain` with near-expiry token → verify refresh called before returning

### Component Tests

- `ConnectScreen`: three paths render correctly; "Skip" calls `onComplete()`
- `KeySetupWizard`: clipboard polling mock returning valid key after 2 polls → ring turns green → Confirm enabled

### E2E

- Google OAuth flow skipped (requires real Google account) — covered by existing provider integration tests
- Wizard flow: can be tested with a mock clipboard value

---

## Prerequisites

- **Google OAuth Client ID:** Register a "Desktop app" OAuth client in Google Cloud Console → Credentials. Set redirect URI to `http://127.0.0.1` (wildcard port). Store client ID as a build-time constant (not secret — desktop app PKCE flow does not use client secret).
- **Google Cloud project:** Enable "Generative Language API" for the project.

---

## Out of Scope

- Anthropic OAuth (no public third-party OAuth program)
- OpenAI OAuth (API keys only for third-party apps)
- Multi-account Google sign-in
- Token revocation UI for Claude/OpenAI (keys deleted from keychain is sufficient)
