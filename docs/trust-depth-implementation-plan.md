# Trust Depth Implementation Plan

Last updated: 2026-05-17
Status: Completed
Owner: Codex / product engineering

## Goal

Close the two remaining product-trust gaps blocking a production-grade "Cursor for data" experience:

1. broader deterministic verification for remaining mutation paths
2. deeper report section binding with partial refresh instead of whole-report rebuild by default

This file is the execution source of truth for this final hardening track.

## Scope

In scope:

- approved-write verification coverage and diagnostics
- deterministic verification helpers for mutation commands that currently fall back to `best_effort`
- clearer trust semantics for unverifiable mutations
- report artifact section identity and source binding
- stale-section detection
- partial report refresh for only stale or selected sections
- targeted regression coverage for both areas

Out of scope:

- major new user-facing features unrelated to trust depth
- redesigning the full report authoring UX
- adding new database mutation command types

## Current Gaps

### Mutation Verification

Current state:

- deterministic verification exists for:
  - `add_column`
  - `drop_column`
  - `rename_table`
  - `delete_rows`
  - `update_cell`
  - `create_index`
- `insert_row` is deterministic when primary-key metadata and primary-key values are available
- `bulk_transform` is deterministic for parseable single-statement delete, insert, and simple update patterns

Intentional boundary:

- broad or ambiguous `bulk_transform` SQL remains `best_effort` unless the command carries enough structure to prove a deterministic postcondition

### Report Refresh Precision

Current state:

- reports persist linked source artifact ids and revision ids
- health can detect `fresh`, `stale`, `missing`
- reports persist explicit section bindings
- refresh can rebuild only stale bound sections or all sections on demand
- the UI exposes stale and missing section binding status

## Multi-Phase Plan

### Phase 1: Mutation Verification Expansion

Objective:
Increase deterministic post-mutation verification without over-claiming certainty.

Action items:

1. Add reusable table/schema helpers inside `VerificationEngine`.
2. Make `insert_row` deterministic when:
   - the table has a primary key
   - all primary-key columns are present in `values`
   - the inserted row can be read back by that key
3. Add deterministic `bulk_transform` verification for simple, parseable SQL patterns:
   - `DELETE FROM schema.table WHERE ...`
   - `UPDATE schema.table SET column = literal WHERE pk = literal`
   - `INSERT INTO schema.table (...) VALUES (...)` for single-row inserts with primary-key coverage
4. Keep ambiguous cases as `best_effort` with explicit diagnosis.
5. Ensure approval/task UI continues to distinguish `deterministic` vs `best_effort`.

Exit criteria:

- `insert_row` is deterministic when a stable row identity exists
- a meaningful subset of `bulk_transform` is deterministically verifiable
- unsupported cases remain explicit, never implied as proven

### Phase 2: Report Section Binding Model

Objective:
Make report sections first-class bound outputs rather than positional byproducts.

Action items:

1. Add `ReportSectionBinding` to report artifacts.
2. Give each refreshable report section a stable section key.
3. Persist which artifact/revision produced each refreshable section.
4. Keep recommendations and title page outside bound refresh rules.
5. Generate bindings both for new report artifacts and refreshed drafts.

Exit criteria:

- every refreshable report section has an explicit binding record
- reports can identify which sections depend on which source artifacts

### Phase 3: Partial Refresh Runtime

Objective:
Refresh only the stale or requested sections of a report.

Action items:

1. Build helpers to compute section-level staleness from source revision changes.
2. Replace whole-report-only refresh with:
   - `refresh stale sections`
   - `refresh all sections`
3. Preserve untouched sections and recommendations during partial refresh.
4. Update report artifact revision baselines only for sections that were actually rebuilt.

Exit criteria:

- a stale source can refresh only the affected report sections
- users can still force a full rebuild when needed

### Phase 4: UX And Regression Coverage

Objective:
Make the trust model visible and keep it from regressing.

Action items:

1. Show stale section counts and affected section labels in report viewers.
2. Add tests for:
   - deterministic `insert_row`
   - parseable deterministic `bulk_transform`
   - ambiguous mutation fallback
   - section-binding generation
   - partial refresh touching only stale sections
3. Keep `npm run lint` and targeted tests green while iterating.

Exit criteria:

- stale-section behavior is visible in the UI
- both trust-depth tracks have direct automated regression coverage

## Execution Order

1. Implement Phase 1.
2. Implement Phase 2.
3. Implement Phase 3.
4. Add/expand tests for both tracks.
5. Re-run validation and update this file with completion notes.

## Completion Notes

- Implemented on 2026-05-17:
  - deterministic `insert_row` verification when table metadata exposes a primary key and the command provides all primary-key values
  - deterministic `bulk_transform` verification for parseable single-statement delete, insert, and simple update patterns
  - explicit `best_effort` fallback for ambiguous mutation SQL
  - report `sectionBindings` persisted on report artifacts
  - stale-section computation and partial report refresh
  - targeted regression coverage for both tracks
- Remaining intentional boundary:
  - broad/ambiguous `bulk_transform` SQL still remains `best_effort` by design unless the command carries enough structure to prove a deterministic postcondition
- Validation completed:
  - `npm run lint`
  - `npm test`
  - `cargo test --lib`
