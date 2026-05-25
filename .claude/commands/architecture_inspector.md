# Architecture Inspector (v2)

Perform a full health check of the daitalk-v2 Tauri architecture — Rust backend, TypeScript DbClient, AI provider layer, and CommandBus wiring. Work through every layer below in order. Never skip a layer. Print a ✅/❌ verdict after each check. End with a single summary table.

---

## Baked-In Architecture (do NOT ask the user for this)

**Project root:** `C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2`

### Stack Overview

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 |
| Desktop shell | Tauri 2 (Rust + Chromium/WebKit webview) |
| Rust backend | sqlx, mongodb, redis, clickhouse, keyring crates |
| State management | Zustand + Immer |
| AI providers | @anthropic-ai/sdk, @google/genai, openai (also covers NVIDIA NIM + Ollama) |
| Statistical compute | Pyodide 0.29.3 (Python WASM, numpy + scipy) |
| SQL editor | Monaco Editor |
| Charts | Recharts |
| Streaming tables | @tanstack/react-table + @tanstack/react-virtual |

### Rust Commands (20 total)
health_check, db_connect, db_disconnect, db_list_connections, db_ping,
db_execute_streaming, db_execute, db_cancel_query, db_get_schema, db_get_table_ddl, db_add_column,
duckdb_query, duckdb_load_parquet, duckdb_load_csv, duckdb_list_views,
save_connections, load_connections, store_api_key, get_api_key, delete_api_key

### Known Stubs (non-blocking)
- **DuckDB:** `duckdb_engine.rs` returns error — disabled due to Windows MinGW bundled-crate OOM. All other DB drivers work.
- **SSH Tunnels:** `ssh_tunnel.rs` returns error — architecture ready, implementation deferred.

### Database Drivers (7 active, 1 stubbed)
postgres, mysql, sqlite, mssql, mongodb, redis, clickhouse, timescaledb (auto-detected as postgres variant).
DuckDB = stubbed.

### AI Providers (5)
claude (Anthropic SDK), gemini (Google GenAI), openai (OpenAI SDK), nvidia (OpenAI SDK + custom baseURL), ollama (OpenAI SDK + local baseURL).

### Security Rules
- API keys MUST NOT appear in `src/` (client bundle). They live in OS keychain via Rust `keyring` crate.
- Connection configs saved to Tauri app local data dir (not localStorage).
- Only non-sensitive settings (provider selection, model prefs) in localStorage.

### CommandBus
Singleton in `src/lib/agent/CommandBus.ts`. 23 command types. `CommandResult { success: boolean, result?: unknown, error?: string }`.

---

## Inspection Procedure

---

### Layer 1 — Type Safety

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2 && npx tsc --noEmit 2>&1
```

Any `error TS` line is a failure.

Verdict: ✅ silent / ❌ list each error with file:line.

---

### Layer 2 — File Existence

**Tauri config:**
- `src-tauri/tauri.conf.json` (or `tauri.conf.json5`)
- `src-tauri/Cargo.toml`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`

**Rust DB layer:**
- `src-tauri/src/db/connection_manager.rs`
- `src-tauri/src/db/query_executor.rs`
- `src-tauri/src/db/introspection.rs`
- `src-tauri/src/db/ssh_tunnel.rs`
- `src-tauri/src/db/duckdb_engine.rs`
- `src-tauri/src/db/types.rs`

**TypeScript DB + AI:**
- `src/lib/db/DbClient.ts`
- `src/lib/ai/ProviderRegistry.ts`
- `src/lib/ai/resilience.ts`
- `src/lib/agent/CommandBus.ts`
- `src/lib/stores/WorkspaceStore.ts`

**Vite + build:**
- `vite.config.ts`
- `package.json`

Verdict: ✅ all 18 present. ❌ list missing.

---

### Layer 3 — Tauri Config Checks

Read `src-tauri/tauri.conf.json` and verify:
- `identifier` contains `daitalk` (e.g. `com.daitalk.app`)
- Window title is `"Daitalk"` (or similar)
- Window minimum size is set (prevents unusable tiny window)

Verdict per item.

---

### Layer 4 — Vite Config Checks

- Pattern: `exclude.*pyodide` in `vite.config.ts` — REQUIRED for WASM imports to work
- Pattern: `1420` in `vite.config.ts` — fixed port required by Tauri dev server

Verdict: ✅ both found / ❌ list missing with impact.

---

### Layer 5 — Rust Backend Checks

**All 20 commands registered in lib.rs:**
- Pattern: `health_check` in `src-tauri/src/lib.rs`
- Pattern: `store_api_key` in `src-tauri/src/lib.rs`
- Pattern: `db_execute_streaming` in `src-tauri/src/lib.rs`
- Pattern: `duckdb_query` in `src-tauri/src/lib.rs`

**Keychain commands implemented:**
- Pattern: `keyring` in `src-tauri/src/commands.rs`
- Pattern: `store_api_key` in `src-tauri/src/commands.rs`
- Pattern: `get_api_key` in `src-tauri/src/commands.rs`

**Query streaming implemented:**
- Pattern: `query_batch` in `src-tauri/src/db/query_executor.rs` — event name for streaming batches
- Pattern: `500` in `src-tauri/src/db/query_executor.rs` — batch size

**DuckDB stub acknowledged (not a failure):**
- Pattern: `not available` or `disabled` or `Err` in `src-tauri/src/db/duckdb_engine.rs`
- Note as ⚠️ stubbed (expected behaviour)

**SSH tunnel stub acknowledged:**
- Pattern: `not yet available` or `Err` in `src-tauri/src/db/ssh_tunnel.rs`
- Note as ⚠️ stubbed (expected behaviour)

Verdict per item. DuckDB + SSH stubs are ⚠️ not ❌.

---

### Layer 6 — DbClient.ts Checks

**All 3 keychain methods present:**
- Pattern: `storeApiKey` in `src/lib/db/DbClient.ts`
- Pattern: `getApiKey` in `src/lib/db/DbClient.ts`
- Pattern: `deleteApiKey` in `src/lib/db/DbClient.ts`

**Streaming architecture:**
- Pattern: `db_execute_streaming` in `src/lib/db/DbClient.ts`
- Pattern: `query_batch` in `src/lib/db/DbClient.ts`
- Pattern: `listen` or `appWindow.listen` or `event.listen` in `src/lib/db/DbClient.ts`

**Schema method:**
- Pattern: `db_get_schema` in `src/lib/db/DbClient.ts`

Verdict per item. Roll up to Layer 6 verdict.

---

### Layer 7 — AI Provider Layer Checks

**ProviderRegistry factory:**
- Pattern: `getProvider` in `src/lib/ai/ProviderRegistry.ts`
- Pattern: `ollama` in `src/lib/ai/ProviderRegistry.ts`
- Pattern: `claude` in `src/lib/ai/ProviderRegistry.ts`

**Provider files exist (Glob src/lib/ai/*.ts):**
All 5 must be present: ClaudeProvider.ts, GeminiProvider.ts, OpenAIProvider.ts, OllamaProvider.ts, ProviderRegistry.ts.

**Retry logic:**
- Pattern: `withRetry` in `src/lib/ai/resilience.ts`
- Pattern: `429` in `src/lib/ai/resilience.ts` — rate limit handling

**dangerouslyAllowBrowser is acceptable for desktop:**
- Pattern: `dangerouslyAllowBrowser` in `src/lib/ai/` (any file)
- Note as ℹ️ expected for Tauri (not a web app)

Verdict per item. Roll up to Layer 7 verdict.

---

### Layer 8 — CommandBus Checks

- Pattern: `register` in `src/lib/agent/CommandBus.ts`
- Pattern: `dispatch` in `src/lib/agent/CommandBus.ts`
- Pattern: `CommandResult` in `src/lib/agent/CommandBus.ts`
- Pattern: `commandBus` (singleton export) in `src/lib/agent/CommandBus.ts`

Verdict: ✅ all 4 found / ❌ list missing.

---

### Layer 9 — Security Checks

These are HIGH severity if failed.

**API keys must NOT be in client source:**
- Grep `GEMINI_API_KEY` in `src/` — must find ZERO matches
- Grep `ANTHROPIC_API_KEY` in `src/` — must find ZERO matches
- Grep `OPENAI_API_KEY` in `src/` — must find ZERO matches
- Grep `nvapi-` in `src/` — must find ZERO matches (would be a hardcoded NVIDIA key)

**Keys come from keychain only:**
- Pattern: `getApiKey` in `src/lib/ai/types.ts` or `src/components/ai/AIChat.tsx` — confirms runtime keychain fetch

**localStorage does NOT store keys:**
- Grep `localStorage.*key` in `src/lib/ai/types.ts` — must NOT store keys (only prefs)
- Verify `saveSettings` in `src/lib/ai/types.ts` strips keys before saving

Verdict: ✅ no keys in client bundle / ❌ HIGH SEVERITY if any key found.

---

### Layer 10 — Package Dependencies

Read `package.json` and verify these are present as dependencies or devDependencies:

| Package | Expected purpose |
|---------|----------------|
| `react` | UI framework |
| `@tauri-apps/api` | Tauri IPC |
| `@anthropic-ai/sdk` | Claude provider |
| `@google/genai` | Gemini provider |
| `openai` | OpenAI + NVIDIA + Ollama |
| `pyodide` | Python WASM runtime |
| `zustand` | State management |
| `react-markdown` | Chat markdown rendering |
| `lucide-react` | Icons |
| `vitest` | Test runner |

Verdict: ✅ all 10 present / ❌ list missing with impact.

---

## Final Report

```
╔══════════════════════════════════════════════╤════════╗
║ Layer                                        │ Status ║
╠══════════════════════════════════════════════╪════════╣
║ L1 — Type Safety (tsc --noEmit)              │  ✅/❌  ║
║ L2 — File Existence (18 files)               │  ✅/❌  ║
║ L3 — Tauri Config                            │  ✅/❌  ║
║ L4 — Vite Config (pyodide + port)            │  ✅/❌  ║
║ L5 — Rust Backend (commands + stubs)         │  ✅/⚠️/❌ ║
║ L6 — DbClient.ts (keychain + streaming)      │  ✅/❌  ║
║ L7 — AI Provider Layer (5 providers + retry) │  ✅/❌  ║
║ L8 — CommandBus                              │  ✅/❌  ║
║ L9 — Security (no keys in client bundle)     │  ✅/❌  ║
║ L10 — Package Dependencies (10 packages)     │  ✅/❌  ║
╠══════════════════════════════════════════════╪════════╣
║ OVERALL                                      │  ✅/❌  ║
╚══════════════════════════════════════════════╧════════╝
```

⚠️ = Known stub (DuckDB, SSH) — expected, not a failure.
❌ = Real gap requiring a fix.

For all green (minus expected stubs): **"daitalk-v2 architecture is healthy. 0 TypeScript errors, all 20 Rust commands registered, DbClient fully wired, 5 AI providers configured, API keys secured in OS keychain."**
