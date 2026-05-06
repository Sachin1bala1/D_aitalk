# Tauri Command Inventory For Production And Store Review

Last updated: 2026-05-01

## Purpose

This document is the release-facing command surface inventory for the Tauri backend. It is intended to support:

- Microsoft Store readiness review
- internal production security review
- final command-surface regression checks before release

Scope:

- commands registered in `src-tauri/src/lib.rs`
- command implementations under `src-tauri/src/commands/`

Excluded:

- internal helper functions that are not exposed through Tauri invoke
- frontend-only TypeScript agent commands

## Sensitivity Classes

- `Low`: health, connectivity checks, read-only metadata, or local telemetry reads with limited impact
- `Medium`: local persistence, non-secret configuration, or observability operations that can alter local state
- `High`: query execution, schema mutation helpers, local file import, or any command that can materially change user data
- `Critical`: secret-management or commands that can expose privileged local capabilities if policy is weak

## Policy/Audit Legend

- `Policy-gated`
  - `Yes`: explicit Rust-side security or connection policy enforcement is visible in the command path
  - `Partial`: command is indirectly constrained or sanitized, but does not have a dedicated release-policy guard
  - `No`: no explicit policy gate is visible in the command entrypoint
- `Audit`
  - `Yes`: command emits or persists audit/security-relevant events directly
  - `Partial`: command is indirectly represented in query/intelligence telemetry, but not explicitly audited as a command action
  - `No`: no explicit audit path is visible in the command entrypoint

## Registered Command Inventory

| Command | Module | Sensitivity | Policy-gated | Audit | Store / Release Notes |
|---|---|---:|---|---|---|
| `health_check` | `commands/utility.rs` | Low | No | No | Safe diagnostic command. Keep for support/version checks. |
| `db_connect` | `commands/connection.rs` | High | Partial | No | Rehydrates secrets from keyring and opens a live DB session. Returns sanitized config, but should be treated as privileged connection-establishment capability. |
| `db_disconnect` | `commands/connection.rs` | Low | No | No | Low risk. Pure session teardown. |
| `db_list_connections` | `commands/connection.rs` | Medium | Partial | No | Returns sanitized stored configs. Ensure release docs state that connection metadata is stored locally. |
| `db_ping` | `commands/connection.rs` | Low | No | No | Low-risk liveness probe, but still exercises active connections. |
| `db_get_schema` | `commands/schema.rs` | Medium | No | No | Read-only metadata introspection. Can surface large schema details; acceptable for desktop DB tooling but should remain clearly desktop-only. |
| `db_build_effective_sql` | `commands/schema.rs` | Low | No | No | Pure transformation helper. No native side effects. |
| `db_execute_streaming` | `commands/query.rs` | High | Yes | Partial | Explicitly uses SQL classification, read-only enforcement, and query concurrency guard. Success/failure is captured in query history; policy blocks and rate-limit blocks are audited. High-priority command for final Store review. |
| `db_execute` | `commands/query.rs` | High | Yes | Yes | Explicitly policy-gated and rate-limited. Mutating execution paths emit audit events for executed/failed operations. This is one of the highest-risk release commands. |
| `db_cancel_query` | `commands/query.rs` | Medium | No | No | Cancels in-flight work by query id. Operationally safe, but not currently audited. |
| `db_add_column` | `commands/schema.rs` | High | Yes | Yes | Schema mutation helper that routes through `db_execute`, so it inherits policy checks and mutation audit behavior. |
| `duckdb_query` | `commands/duckdb.rs` | High | Yes | Partial | Uses concurrency guard and audits rate-limit blocks, but successful query execution is not explicitly audited as a DuckDB action. Review local-file and embedded-engine implications before release. |
| `duckdb_load_parquet` | `commands/duckdb.rs` | High | Yes | Partial | Local-file import is extension/path validated and blocked attempts are audited. Successful imports are not explicitly audited. Store review should call out user-initiated local file access only. |
| `duckdb_load_csv` | `commands/duckdb.rs` | High | Yes | Partial | Same posture as `duckdb_load_parquet`. |
| `duckdb_list_views` | `commands/duckdb.rs` | Low | No | No | Local metadata read from DuckDB engine. |
| `db_get_table_ddl` | `commands/schema.rs` | Medium | No | No | Read-only DDL introspection. Some SQL is constructed per engine; keep under identifier-safety regression testing. |
| `db_update_parameter_affinity` | `commands/intelligence.rs` | Medium | No | Partial | Writes local intelligence state only. Not security-sensitive by itself, but changes local telemetry. Consider whether this should remain renderer-callable in production. |
| `db_save_benchmark` | `commands/intelligence.rs` | Medium | No | Partial | Writes local benchmark telemetry. Ensure privacy/local-data docs describe it clearly. |
| `record_visualization_viewed` | `commands/intelligence.rs` | Medium | No | Partial | Local telemetry write. Useful for UX analytics, but should remain clearly local and resettable. |
| `record_security_audit` | `commands/intelligence.rs` | Medium | No | Yes | Explicit audit write command. Acceptable for local observability, but because renderer can invoke it directly, support teams should not rely on it as a tamper-proof audit source. |
| `db_get_parameter_hotspots` | `commands/intelligence.rs` | Low | No | No | Local intelligence read. Low risk. |
| `db_get_recent_benchmarks` | `commands/intelligence.rs` | Low | No | No | Local intelligence read. |
| `db_get_query_history` | `commands/intelligence.rs` | Medium | No | No | Local history read. Query text is redacted before storage, but this remains privacy-sensitive and should be covered by disclosure/reset UX. |
| `db_get_security_audit` | `commands/intelligence.rs` | Medium | No | No | Local audit read. Needed for support/review UX. |
| `db_get_local_data_stats` | `commands/intelligence.rs` | Low | No | No | Low-risk local stats read. |
| `db_clear_local_data` | `commands/intelligence.rs` | Medium | No | No | Clears local privacy/audit/history state. Important for release trust, but should ideally be user-initiated from explicit settings UX only. |
| `save_connections` | `commands/persistence.rs` | High | Partial | No | Persists sanitized configs to disk and full secrets to keyring. Important production command; safe design is improved, but not explicitly policy-gated or audited today. |
| `load_connections` | `commands/persistence.rs` | Medium | Partial | No | Loads sanitized metadata only. Good release posture, but still exposes local saved-connection inventory to renderer. |
| `store_api_key` | `commands/persistence.rs` | Critical | Yes | Partial | Secret-management command validated by allowed service prefix. Blocked invalid service access is audited. Successful secret writes are not explicitly audited. |
| `has_api_key` | `commands/persistence.rs` | Critical | Yes | Partial | Presence-check only, not plaintext secret readback. This is acceptable for release, but still a privileged secret-surface command. |
| `delete_api_key` | `commands/persistence.rs` | Critical | Yes | Partial | Secret delete path with service validation; blocked invalid access is audited. |

## Module-Level Release Notes

### `commands/query.rs`

Highest-value security module for release:

- already uses SQL classification
- already enforces per-connection `read_only`
- already applies concurrency guardrails
- already audits policy blocks and mutating `db_execute` outcomes

Remaining release questions:

- whether `db_cancel_query` should be audited
- whether successful non-mutating `db_execute_streaming` should emit a command-level audit record in addition to query-history telemetry

### `commands/persistence.rs`

This module is materially safer than a typical prototype because:

- saved connection secrets stay in the OS keyring
- connection configs returned to the renderer are sanitized
- plaintext API key readback is absent

Remaining release gaps:

- successful secret writes/deletes are not explicitly audited
- no dedicated policy layer distinguishes normal user flows from any compromised renderer invoking these commands

### `commands/duckdb.rs`

This module is acceptable for desktop analytics workflows, but it is one of the most important release review areas because it combines:

- embedded engine execution
- local file access
- import semantics

Current safeguards:

- path existence/type validation
- extension allowlist
- blocked local-file access audit
- concurrency guardrails for DuckDB query execution

Remaining release gaps:

- successful imports are not explicitly audited
- production documentation should state that file imports are user-initiated local actions only

### `commands/intelligence.rs`

This module is primarily local observability and UX telemetry. It is not the highest security risk, but it matters for Store trust because it determines what local data is stored and how users can inspect/clear it.

Release focus:

- privacy disclosure must describe these records clearly
- `db_clear_local_data` must remain stable and discoverable in the UI
- local audit records should not be marketed as tamper-proof forensic logs

## Commands Requiring The Strictest Release Review

These should be treated as the primary Store-review command set:

1. `db_execute_streaming`
2. `db_execute`
3. `db_add_column`
4. `duckdb_query`
5. `duckdb_load_parquet`
6. `duckdb_load_csv`
7. `save_connections`
8. `store_api_key`
9. `has_api_key`
10. `delete_api_key`
11. `db_connect`

## Store Submission Checklist Tied To This Inventory

Before Store submission, confirm:

1. Every `High` and `Critical` command still has the same policy/audit posture documented here.
2. Production CSP in `tauri.conf.json` no longer includes dev-only localhost allowances.
3. Local-data disclosure text matches the behavior of:
   - `db_get_query_history`
   - `db_get_security_audit`
   - `db_get_local_data_stats`
   - `db_clear_local_data`
   - telemetry write commands in `commands/intelligence.rs`
4. Secret-management commands remain limited to:
   - `store_api_key`
   - `has_api_key`
   - `delete_api_key`
   and no plaintext secret retrieval command is reintroduced.
5. File-import commands remain restricted to explicit user-driven local file workflows.
6. Destructive AI paths continue to require approval before they can drive any command that resolves to `db_execute` or `db_execute_streaming`.

## Recommended Follow-Up Documentation

- Keep [store-readiness-audit.md](./store-readiness-audit.md) as the high-level roadmap.
- Use this file as the release-review source of truth for the command surface.
- If the command set changes, update both:
  - `src-tauri/src/lib.rs`
  - this inventory
