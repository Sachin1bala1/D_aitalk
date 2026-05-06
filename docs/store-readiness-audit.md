# Daitalk Store Readiness Audit

Last updated: 2026-05-01

## Current posture

The app is materially safer than the earlier prototype:

- Rust-side command policy exists
- per-connection `read_only` exists
- mutating AI actions now require explicit approval even in auto mode
- local security audit events are persisted
- local data can now be inspected and cleared from the UI
- query history storage redacts string literals before persistence

This is a strong desktop safety baseline, but it is not yet Microsoft Store ready.

## Estimated gap

Approximate production readiness for Windows trust and Store submission:

- Application safety architecture: `75%`
- Microsoft Store operational readiness: `55%`
- Outside-Store Windows trust/signing readiness: `35%`

The biggest remaining gap is no longer day-to-day app logic. It is release hardening:

- command exposure review
- production CSP tightening
- packaging/signing pipeline
- privacy disclosure and clean-install validation

## Must-fix before Microsoft Store submission

### 1. Production CSP hardening

Current state:

- production and development CSP are now split in `src-tauri/tauri.conf.json`
- dev-only Vite server allowances remain in `app.security.devCsp`
- production `app.security.csp` no longer allows the Vite dev server
- production still allows:
  - `http://127.0.0.1:11434`
  - `http://localhost:11434`
  - `http://ipc.localhost`
  - `https://ipc.localhost`
  - `https:`

Risk:

- this is broader than necessary for a production desktop build
- dev-only localhost entries should not ship in release CSP

Required action:

- production CSP should allow only:
  - app resources
  - required remote provider endpoints
  - Ollama only if local-model support is intentionally enabled in production

Status:

- dev vs production CSP split is complete
- remaining work is narrowing `https:` to the exact hosted provider domains you choose to support in production

### 2. Command surface review

Current high-risk Tauri command classes:

- query execution:
  - `db_execute_streaming`
  - `db_execute`
  - `db_cancel_query`
- mutation helpers:
  - `db_add_column`
- file/import:
  - `duckdb_load_parquet`
  - `duckdb_load_csv`
- secret management:
  - `store_api_key`
  - `has_api_key`
  - `delete_api_key`
- persistence:
  - `save_connections`
  - `load_connections`

Required action:

- produce a final command inventory with:
  - command name
  - sensitivity class
  - policy enforcement status
  - audit logging status
  - Store justification

Status:

- initial production inventory now exists in [tauri-command-inventory.md](./tauri-command-inventory.md)
- release review should treat that file as the command-surface source of truth

### 3. Privacy disclosure

Current local data now stored:

- query history
- visualization telemetry
- parameter hotspot observations
- benchmarks
- security audit events
- saved connection metadata

Required action:

- document what is stored locally
- document what is redacted
- document how to clear/reset local data
- align this wording with Store listing privacy text

### 4. Packaging and signing

Required action:

- MSIX packaging path
- Partner Center metadata
- installer/update identity review
- clean install/update/uninstall tests on a fresh Windows machine

## Recommended before beta

### 1. Audit viewer filters/export

Current state:

- audit dialog exists
- no filters/export yet

Recommended:

- filter by event type and outcome
- export audit data as JSON for support/debug workflows

### 2. Retention policy

Current state:

- user can clear local data manually
- no automatic retention policy yet

Recommended:

- default retention windows, for example:
  - query history: 30–90 days
  - security audit: 30–180 days
  - telemetry/benchmarks: configurable

### 3. Desktop-only feature labeling

Current state:

- browser mode already blocks DB access with a clear message

Recommended:

- keep desktop-only features explicitly labeled in user-facing docs and support copy

## Command sensitivity map

### Read / low risk

- `health_check`
- `db_ping`
- `db_list_connections`
- `db_get_schema`
- `db_get_table_ddl`
- `duckdb_list_views`
- intelligence read commands

### Mutation / controlled risk

- `db_execute`
- `db_execute_streaming` when SQL is mutating
- `db_add_column`
- DuckDB import commands

### Secret / sensitive

- `store_api_key`
- `has_api_key`
- `delete_api_key`

### Local file / sensitive

- `duckdb_load_parquet`
- `duckdb_load_csv`

## What changed in the recent safety work

### Already done

- mutating AI actions queue for approval in all modes
- destructive and policy-relevant events are audited
- local data is visible and resettable in the app

### Expected runtime impact

- negligible CPU impact for normal use
- small additional SQLite writes for audit events
- no meaningful query-performance regression expected
- local-data dialog only loads data on demand

## Release acceptance checklist

Before calling the app Windows-friendly for general users:

1. release build works on a clean Windows machine
2. MSIX package installs without policy surprises
3. production CSP no longer includes dev localhost allowances
4. privacy disclosure text matches real local-storage behavior
5. all high-risk commands are policy-gated and auditable
6. destructive AI actions never bypass approval
7. local data can be cleared without breaking the app

## Next recommended implementation slice

1. narrow production `connect-src` from broad `https:` to explicit provider endpoints
2. test MSIX packaging path
3. add audit filters/export if support workflows matter before beta
4. verify clean install/update/uninstall on a fresh Windows machine
