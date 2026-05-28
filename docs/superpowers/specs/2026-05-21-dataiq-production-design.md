# DataIQ Production Design Spec
**Date:** 2026-05-21  
**Status:** Approved  
**Branch:** integration/harness-merge  

---

## Vision

DataIQ is a natural-language-first desktop database IDE for engineering analysts. The user types a question — "why did line 3 output drop Tuesday night?" — and DataIQ runs SQL, finds the answer, builds an editable chart, and explains it. No drag-drop, no pivot table setup, no waiting.

**Core identity:** Talk to your data. One question → full answer in one shot.  
**Primary user:** Engineering analyst (process engineer, quality engineer, data analyst, IoT/manufacturing ops).  
**Competitive position:** Beats Cursor (not data-native), Tableau/PowerBI (no autonomous agent), JMP (no NL, scripting-heavy) on the combination of AI depth + query speed + editable viz.

---

## Architecture Overview

Four parallel tracks, all merging into `integration/harness-merge`:

```
Track 1 (AI Speed)     ─┐
Track 2 (Viz Editor)   ─┤ merge day 4-5 → frontend integration test
Track 3 (DuckDB Perf)  ─┤
Track 4 (Connectors)   ─┘ merge day 5-7 → full smoke test → production
```

Tracks 1+2 are frontend-only (TypeScript/React). Tracks 3+4 touch the Rust backend. Both pairs run in parallel git worktrees.

---

## Track 1 — AI Speed & Intelligence

### Goal
Sub-1.5s first token. Simple query+chart end-to-end in <5s. Complex 8-tool analysis in <25s. Zero infinite hangs.

### Changes

**`src/lib/agent/AgentLoop.ts`**
- Parallel tool dispatch: when the agent calls multiple independent tools in one round (e.g. `execute_sql` + `declare_hypotheses`), dispatch them concurrently with `Promise.all` instead of sequentially
- Fast-path: if the agent's first response contains exactly one tool call that is `execute_sql` or `create_chart`, skip the full loop scaffolding and dispatch directly — saves ~500ms per simple query
- Context compression: trim `updatedHistory` to last 20 turns (already partially done); add a `summarizeOldTurns()` pass that condenses turns 1–10 into a single summary turn when history exceeds 20
- Approval timeout: any plan step awaiting approval for >30s gets auto-rejected with a user-visible message; agent unblocks

**`src/lib/ai/resilience.ts`**
- Tool-level timeout: 8s hard cap per individual tool call (currently unbounded)
- Round-level timeout: 22s per agent round (already exists via `withTimeout`, verify it fires correctly)
- Retry budget: max 2 retries per tool, exponential backoff 500ms/1000ms

**`src/lib/agent/harness/ContextEngine.ts`**
- Schema injection: only inject schema sections relevant to tables mentioned in user query (keyword match against schema keys) — reduces system prompt size by ~60% for targeted questions
- Token budget enforcement: if estimated prompt > 80k tokens, drop oldest episodic memories first, then compact schema to table names only

**`src/components/ai/AIChat.tsx`**
- Streaming progress indicator: show "Running tool 3 of 6..." in the assistant bubble while agent is mid-loop
- First-token latency display: subtle ms counter next to the streaming cursor (dev mode only)

### Success Criteria
- First token visible: <1.5s from user hitting send
- `SELECT + create_chart` flow: <5s total
- 8-tool deep analysis: <25s
- Approval timeout: triggers at exactly 30s, never hangs
- Streaming indicator visible within 500ms of agent starting

---

## Track 2 — Visualization & Chart Editor

### Goal
8 chart types. Inline toolbar edits with <100ms re-render (no AI round-trip). Control charts with SPC overlays. "Explain this" button on every chart.

### New Component: `ChartEditor.tsx`

A compact toolbar that renders below any chart artifact. Contains:

| Control | Options | Re-render? |
|---------|---------|-----------|
| Chart type | Line, Bar, Scatter, Histogram, Box Plot, Heatmap, Waterfall, Control Chart | Instant |
| X axis | Column picker dropdown | Instant |
| Y axis | Column picker (multi-select for overlay) | Instant |
| Group by | Column picker (optional) | Instant |
| Color | Preset palette (8 colors) | Instant |
| SPC overlays | 3σ upper/lower, center line, spec limits (UCL/LCL inputs) | Instant |
| Export | PNG, SVG, Copy data CSV | No re-render |
| "Explain this" button | Sends chart + data context to AI | AI round-trip |

All edits mutate a local `ChartConfig` state object. Re-render is driven by Recharts (already in use) responding to prop changes — no network call.

### Chart Types to Add

Current: line, bar, area, pie, scatter (basic).  
Add: histogram (bin auto-calc), box plot (quartile calc client-side), heatmap (2D color grid), waterfall (cumulative delta), control chart (time-series + 3σ bands + violations highlighted red).

Control chart is highest priority — direct engineering value, not available in any competitor.

### Changes

**`src/components/artifacts/ArtifactChartViewer.tsx`**
- Mount `<ChartEditor>` below every rendered chart
- Lift `chartConfig` state up; ChartEditor mutates it; viewer re-renders

**`src/components/dashboard/ChartPanel.tsx`**
- Same ChartEditor integration for inline query results

**`src/lib/agent/toolDefinitions.ts`**
- Add `chart_type` parameter to `create_chart` tool: agent can now specify `control_chart` with `ucl`/`lcl`/`center_line` params
- Add `explain_chart` tool: takes artifact ID, returns natural-language explanation of visible patterns

**New file: `src/components/charts/ControlChart.tsx`**
- Recharts ComposedChart with ReferenceLine for 3σ bounds
- Dots colored red when outside control limits
- Violation count badge

### Success Criteria
- Chart type change: <100ms
- Axis swap: <50ms
- Control chart with 3σ limits renders on time-series data
- "Explain this" returns AI response in <5s
- PNG export produces correct image
- 8 chart types selectable from toolbar

---

## Track 3 — Query Performance & DuckDB

### Goal
1M row CSV query in <2s. Cached query replay in <50ms. No OOM. VirtualTable at 60fps on 1M rows.

### DuckDB Integration

DuckDB is already importable via the "Import CSV / Parquet" button. The gap is it's not a first-class connection — it's treated as a one-shot import. 

**Changes to Rust backend:**

**`src-tauri/src/db/connection_manager.rs`**
- Add `DuckDB` variant to the `Driver` enum (alongside PostgreSQL, MySQL, SQLite, etc.)
- DuckDB connection: opens an in-process database at a user-specified path or `:memory:`
- Register files via `ATTACH` — a dropped CSV/Parquet immediately queryable as a table

**`src-tauri/Cargo.toml`**
- Re-enable `duckdb = { version = "1", features = ["bundled"] }` (currently commented out — OOM on MinGW)
- Fix: build DuckDB with MSVC toolchain (`stable-x86_64-pc-windows-msvc`), not MinGW; add `.cargo/config.toml` target override for the duckdb crate compilation
- CI: add `CARGO_BUILD_JOBS=1` + `RUSTFLAGS="-C codegen-units=1"` for DuckDB compilation step only

**`src-tauri/src/db/query_executor.rs`**
- DuckDB execution path uses `duckdb` Rust crate directly
- Streaming: same 500-row batch emit pattern as existing SQL execution
- Memory guard: before executing any unbounded SELECT, prepend `SELECT * FROM ({{sql}}) LIMIT 100000` unless user has explicitly added a LIMIT. Emit a warning event to frontend when guard fires.

**New: `src-tauri/src/db/query_cache.rs`**
- LRU cache keyed on `(connection_id, sql_hash, params_hash)`
- Max 50 entries, max 100MB total
- TTL: 5 minutes
- Cache hit: return immediately, emit `query_batch` events from cache
- Tauri command: `clear_query_cache(connection_id?)`

**New: `src-tauri/src/db/explain.rs`**
- `explain_query(connection_id, sql)` → returns structured plan tree
- Frontend renders as collapsible tree with cost annotations

**File watcher:**
- `src-tauri/src/db/file_watcher.rs` — watches a user-configured directory
- On new CSV/Parquet/JSON file: auto-register with DuckDB, emit `schema_updated` event
- Frontend `SchemaTree` refreshes on this event

**`src/components/table/VirtualTable.tsx`** (already 1784 LOC — no rewrite)
- Verify `@tanstack/react-virtual` is correctly windowing at 1M rows
- Fix: ensure `estimateSize` uses measured row heights, not fixed 35px (causes jank on variable-height rows)
- Add: row count badge showing "Showing 500 of 1,024,381 rows"

### Success Criteria
- DuckDB connection type appears in ConnectionDialog
- Drop CSV → queryable in <3s
- 1M row query result: first batch in <2s
- Cache hit: <50ms
- Explain plan: renders for any SELECT
- Memory guard fires on unbounded queries, warning shown
- VirtualTable: no jank scrolling 1M rows

---

## Track 4 — Data Connectors

### Goal
REST API queryable within 30s setup. Drop CSV → auto-loads. Excel import <1s per 10k rows. SSH tunnel in 1 config step. Auto-reconnect on drop.

### New Connector: REST API

**`src-tauri/src/db/rest_connector.rs`**
- Config: URL (with `{param}` interpolation), method (GET/POST), auth (Bearer token / API key header / Basic), response path (JSONPath to array, e.g. `$.data.items`)
- Maps JSON array → columnar table: infers column types from first 100 rows
- Pagination: supports `?page={{page}}&limit=100` pattern with auto-advance
- Caching: responses cached for configurable TTL (default 60s)
- Tauri commands: `test_rest_connection`, `execute_rest_query`

**`src/components/dialogs/ConnectionDialog.tsx`**
- Add "REST API" to driver dropdown
- REST-specific form: URL field, auth type selector, response path field, test button
- Preview: shows first 5 rows on test

### Excel Import

**`src-tauri/Cargo.toml`**
- Add `calamine = "0.24"` for native XLSX/XLS parsing (no external dependency)

**`src-tauri/src/db/excel_importer.rs`**
- `import_excel(path, sheet_name?) → table_name` — loads sheet into DuckDB
- Auto-detects header row
- Type inference: numeric strings → DOUBLE, date strings → DATE, rest → VARCHAR
- Tauri command: `import_excel_file`

**`src/components/dialogs/FileImportDialog.tsx`** (the existing "Import CSV/Parquet" dialog)
- Extend to also accept `.xlsx`, `.xls`
- On Excel: calls `import_excel_file`, then refreshes schema

### SSH Tunnel

**`src-tauri/src/db/ssh_tunnel.rs`**
- Uses `ssh2` crate (already in Cargo.toml)
- Config: SSH host/port/user/key-path (or password), target host/port
- Opens local port forward, returns local port
- Connection manager uses local port for actual DB connection
- Tunnel stays alive as long as connection is active

**`src/components/dialogs/ConnectionDialog.tsx`**
- "SSH Tunnel" collapsible section on PostgreSQL/MySQL forms
- Fields: SSH host, port, user, auth method (key / password)

### Connection Health Monitor

**`src-tauri/src/db/health_monitor.rs`**
- Pings each active connection every 30s with `SELECT 1`
- On failure: emits `connection_dropped` event, attempts reconnect up to 3 times
- Frontend: connection dot in sidebar turns red on drop, green on reconnect

### Schema Refresh

**`src-tauri/src/db/introspection.rs`**
- `refresh_schema(connection_id)` — already exists, needs to be called on schedule
- Auto-refresh: every 5 minutes per active connection
- On refresh: compute diff vs cached schema, emit `schema_changed` event with added/removed tables/columns

### Success Criteria
- REST connector: test → preview → query flow works end-to-end
- Drop CSV/Parquet → queryable in DuckDB within 3s
- Excel 10k rows: imports in <1s
- SSH tunnel: connects to remote PostgreSQL through tunnel
- Connection drop → auto-reconnect within 10s
- Schema refresh: diff shown when tables added/removed

---

## Merge Plan

### Day 1–3: Tracks 1 & 2 (frontend worktrees)
- Both run against current Rust backend
- No Cargo changes needed
- Risk: low — TypeScript only

### Day 1–4: Tracks 3 & 4 (Rust worktrees)  
- Cargo.toml additions: `duckdb`, `calamine` (Track 3+4)
- Must not break existing PostgreSQL/MySQL/SQLite paths
- Risk: medium — Rust compile time, new crates

### Day 4–5: Merge Tracks 1+2
- Merge into `integration/harness-merge`
- Run `npm run lint` + smoke test
- Validate: AI streaming, chart toolbar, no TS errors

### Day 5–7: Merge Tracks 3+4
- Merge Rust changes
- Run `cargo check` + integration tests
- Validate: DuckDB connection, CSV drop, REST connector, SSH tunnel

---

## Non-Goals (explicitly out of scope)
- Cloud deployment / server mode — desktop only for now
- User authentication / multi-user — single user desktop app
- S3/GCS/Azure Blob — deferred to next sprint
- Dashboard builder (drag-drop layout) — chart editor covers 80% of the value
- OnboardingTour wiring — deferred (not in top 4 priorities)
- React error boundaries — deferred (not in top 4 priorities)
