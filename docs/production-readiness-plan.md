# Daitalk v2 Production Readiness Plan

Last updated: 2026-05-17
Owner: Codex / product engineering
Status: Active execution plan

## Goal

Make Daitalk v2 production-grade as a "Cursor for data analysis" desktop product:

- trustworthy AI-assisted querying and mutation
- durable analysis artifacts and workspace continuity
- repeatable pipeline/workflow execution
- measurable regression safety
- operationally safe desktop release behavior

This file is the source of truth for implementation order, exit criteria, and parallel work.

## Current Position

The product already has strong foundations:

- Tauri-native query execution, schema introspection, and persistence commands
- agent runtime with `plan -> execute -> verify -> retry` for read-only work
- approval-gated write commands with post-mutation verification for a subset of commands
- artifact-backed query/chart/report workflows with revisions and restore
- workspace and AI session restore with interrupted-task checkpoints

The largest remaining production blockers are:

1. mutation verification/provenance is still incomplete for some write paths
2. artifact/report depth still needs section-level refresh/binding polish
3. Rust-side automated test execution still needs to be made practical/reliable in CI and local verification

## Audit-Critical Findings

These findings came from parallel repo audits and should override any softer prioritization:

1. `P0` Destructive-action approval is not truly enforced in Auto Mode.
   - Current behavior in `src/lib/agent/AgentLoop.ts` can allow destructive commands to run immediately outside Plan Mode.
   - Fixing this is the first trust-critical task.

2. `P0` Release workflow is currently at risk.
   - `.github/workflows/windows-release.yml` references `npm run tauri:build:ci`, but `package.json` does not define that script.
   - Tagged releases can fail before packaging validation.

3. `P0` CI does not enforce tests.
   - `.github/workflows/validate.yml` currently checks compile/build paths but does not run `npm test`, `cargo test`, or a packaged smoke path.

4. Persistence is still split between native session state and user-facing `localStorage` paths.
   - Especially query history, snippets, and chart preset/config behavior.

5. Pipeline capability is now implemented as a saved single-step workflow runtime.
   - Output lineage, native persistence, approval-gated runs, and diagnostics are in place.

6. CI/release hardening has been implemented for the current repo path.
   - `validate.yml` now runs frontend tests and proven Rust library tests.
   - release scripts/workflows are aligned to real commands.
   - support-bundle export and support collection docs now exist.

## Definition Of Done

The product should be considered production-ready only when all of the following are true:

1. Core journeys are covered by automated tests:
   - connect
   - run query
   - stream/cancel query
   - sort/filter rerun
   - AI read-only analysis task
   - approval-gated mutation
   - restore session after restart
   - reopen artifacts and revisions
   - resume interrupted AI work

2. Every mutation path is either:
   - deterministically verified after execution, or
   - explicitly labeled as non-deterministically verifiable and blocked from auto-resume/auto-retry where trust would be ambiguous

3. Pipelines are first-class persisted objects with:
   - create/edit/run surfaces
   - task-engine integration
   - run history/status
   - artifact lineage

4. Workspace continuity is consistent:
   - native persistence for core product state
   - explicit trust signals for stale/restored/offline data
   - no business-critical behavior depends on ad hoc browser-only local state

5. Release hardening is in place:
   - test gates
   - failure telemetry/logging
   - release checklist
   - documented rollback/support flows

## Workstreams

### Workstream A: Runtime Trust And Safety

Objective:
Make the AI/task runtime safe, explicit, and resumable for real data work.

Primary files:

- `src/lib/agent/TaskEngine.ts`
- `src/lib/agent/AgentLoop.ts`
- `src/lib/agent/CommandBus.ts`
- `src/lib/agent/VerificationEngine.ts`
- `src/lib/agent/registerHandlers.ts`
- `src/components/ai/PlanQueue.tsx`
- `src/components/ai/TaskProgressPanel.tsx`
- `src/lib/agent/TaskState.ts`

Action items:

1. Normalize task lifecycle semantics.
   - Separate `running`, `awaiting_input`, `interrupted`, `abandoned`, and terminal failure cleanly.
   - Ensure task UI, checkpoints, and approvals all reflect the same state machine.

2. Expand post-mutation verification coverage.
   - Add deterministic verifiers for safe write commands where possible.
   - Identify commands that cannot be verified deterministically with current context.
   - Mark unverifiable commands explicitly in task state and UI.

3. Tighten retry policy.
   - Allow bounded auto-retry only for safe/read-only failures.
   - Block auto-retry for risky mutations unless an explicit deterministic postcondition exists.
   - Record retry reason and outcome in audit history.

4. Strengthen approval-resume policy.
   - Keep approval handling inside the task engine path.
   - Resume from approved steps using a dedicated runtime path and fresh verification.
   - Prevent ambiguous resumed state after partially verified mutations.

5. Add task-scoped provenance.
   - Record which connection, SQL, command, query id, and artifact ids each subtask used.
   - Surface that provenance in AI/task UI and persisted checkpoints.

Exit criteria:

- Every task and approval path produces consistent state transitions.
- No mutation is silently resumed or retried after ambiguous execution.
- Users can inspect what a task actually touched and what was verified.

### Workstream B: Pipelines And Repeatable Workflows

Objective:
Replace the current pipeline stub with a real saved workflow system.

Status:
Wave 3 completed on 2026-05-16 for the production-safe MVP scope:

- native-persisted pipeline definitions and run history
- AI `create_pipeline`, `list_pipelines`, and approval-gated `run_pipeline`
- manual pipeline inspection and execution UI
- output query artifacts for downstream lineage

Primary files:

- `src/lib/agent/registerHandlers.ts`
- `src/lib/agent/commands.ts`
- `src/lib/agent/toolDefinitions.ts`
- `src/lib/stores/WorkspaceStore.ts`
- `src/components/ai/UserToolsPanel.tsx`
- new `src/components/pipelines/*`
- new `src/lib/pipelines/*`
- relevant Tauri persistence commands

Action items:

1. Define the pipeline domain model.
   - pipeline id, name, description
   - source definition
   - steps
   - output target/artifacts
   - schedule/run metadata
   - lineage and last run status

2. Implement pipeline persistence.
   - native Tauri-backed storage
   - CRUD operations
   - migration/versioning support

3. Build pipeline execution runtime.
   - execute via task engine, not as a disconnected subsystem
   - record run status, audit log, and outputs
   - integrate with artifact graph

4. Add pipeline UI.
   - list/detail/create/edit/run views
   - run history and failure diagnostics
   - open downstream artifacts from a run

5. Add AI integration.
   - `create_pipeline` should create real pipeline entities
   - AI should be able to inspect, run, and summarize pipeline outcomes

Exit criteria:

- `create_pipeline` is no longer a stub.
- Pipelines are saved, runnable, inspectable, and lineage-aware.

### Workstream C: Persistence Unification And Session Trust

Objective:
Remove remaining persistence fragmentation and make restore behavior fully trustworthy.

Status:
- native persistence now covers workspace state, AI session state, query history, snippets, chart presets, pipelines, and user-defined tools
- legacy `localStorage` is now limited to migration/fallback paths plus device-local UX preferences
- degraded native persistence now surfaces warnings instead of failing silently

Primary files:

- `src/lib/workspace/WorkspaceSessionStore.ts`
- `src/lib/stores/WorkspaceStore.ts`
- `src/lib/db/ConnectionStore.ts`
- `src/components/history/QueryHistory.tsx`
- `src/lib/snippets/SnippetStore.ts`
- `src/components/charts/GraphBuilderPanel.tsx`
- `src/App.tsx`
- `src-tauri/src/commands/persistence.rs`

Action items:

1. Inventory and classify all `localStorage` usage.
   - keep only clearly non-critical browser preferences if truly needed
   - migrate product-critical state to native persistence

2. Move query history and snippets to native-backed persistence.
   - preserve migration path from existing local storage data
   - add corruption-safe read behavior

3. Decide chart-config persistence policy.
   - artifact-backed draft state should remain canonical
   - any local convenience cache must not conflict with artifact state

4. Consolidate onboarding/preferences where appropriate.
   - separate throwaway device preferences from product state
   - document the boundary clearly

5. Deepen restore diagnostics.
   - indicate stale, missing, offline, and partially restorable entities
   - provide user actions to repair or rerun

Exit criteria:

- Product-critical state no longer depends on scattered `localStorage`.
- Restore behavior is explicit and repairable.

### Workstream D: Artifact Graph, Reports, And Workspace UX

Objective:
Make analysis outputs navigable, refreshable, and understandable at production depth.

Status:
- downstream report bulk-open and stale-refresh actions are now implemented for query/chart artifacts
- revision compare and draft/revision flows are in place
- remaining gap is deeper report section binding / partial refresh precision

Primary files:

- `src/lib/artifacts/*`
- `src/components/artifacts/*`
- `src/components/charts/GraphBuilderPanel.tsx`
- `src/components/reports/ReportPanel.tsx`
- `src/App.tsx`

Action items:

1. Add downstream bulk actions.
   - refresh stale descendants
   - duplicate/open in context
   - jump through upstream/downstream relationships

2. Improve revision UX.
   - preview before restoring a revision as draft
   - stronger compare surfaces
   - explicit revision intent for queries/charts/reports

3. Tighten report-source binding.
   - bind report sections to specific artifact/revision refs where useful
   - support partial refresh for stale sections

4. Finish obvious chart/report polish seams.
   - export completeness
   - remove or clearly gate unsupported chart interactions
   - eliminate confusing stale local chart config behavior

Exit criteria:

- Artifact graph actions are practical, not just informational.
- Query/chart/report flows feel durable and predictable.

### Workstream E: Testing, Observability, And Release Hardening

Objective:
Introduce the engineering discipline required for safe releases.

Status:
- frontend validation now includes `npm test`
- release workflows and scripts now align to real commands
- support-bundle export and support collection docs are in place
- Rust library tests are now the practical enforced CI gate; remaining gaps are deeper mutation verification and report refresh depth rather than missing validation wiring

Primary files:

- `package.json`
- `vitest.config.ts`
- `src/test-setup.ts`
- new `src/**/*.test.ts(x)` and integration harness files
- relevant Tauri Rust tests
- release/support docs under `docs/`

Action items:

1. Establish a test matrix.
   - unit tests for critical stores and pure runtime logic
   - integration tests for query runtime and task transitions
   - end-to-end smoke coverage for the desktop app’s core journeys

2. Add regression coverage for the highest-risk flows.
   - approval queue and post-mutation verification
   - interrupted/resumed tasks
   - workspace restore
   - artifact revision save/restore/discard

3. Add runtime observability.
   - structured logs for task failures, retries, approvals, resume events, restore problems
   - lightweight support diagnostics export

4. Build release gates.
   - `lint`
   - unit/integration tests
   - smoke run checklist
   - documented release checklist

5. Add failure handling and support docs.
   - what happens on corrupted session files
   - connection restore failures
   - pipeline run failures
   - support collection workflow

Exit criteria:

- Shipping is blocked on meaningful automated checks.
- The team can diagnose failures without guesswork.

## Implementation Waves

### Wave 1: Trust-Critical Runtime Hardening

Priority: highest

Scope:

- Workstream A items 1-5
- Workstream C item 5
- Workstream E item 2 for runtime flows

Reason:
Before expanding product surface, we need airtight task/approval/verification semantics.

Deliverables:

- hard enforcement that destructive actions require approval regardless of UI mode
- normalized task state machine
- broader mutation verification coverage
- explicit unverifiable-mutation handling
- richer task provenance
- tests for approval/resume/verification flows

### Wave 2: Persistence Unification

Priority: highest

Scope:

- Workstream C items 1-4
- Workstream E item 2 for restore/persistence flows

Reason:
The product should not feel half native and half browser-local.

Deliverables:

- native-backed query history and snippets
- resolved chart persistence policy
- migration path from existing local storage data
- restore diagnostics and tests

### Wave 3: Real Pipelines

Priority: highest

Scope:

- Workstream B items 1-5

Reason:
This is the biggest remaining product gap versus a true Cursor-for-data workflow.

Deliverables:

- pipeline data model
- persistence
- execution runtime
- UI surfaces
- AI integration

### Wave 4: Artifact/Product Depth

Priority: medium-high

Scope:

- Workstream D items 1-4

Reason:
Turns the artifact system from durable storage into a production-grade analysis workspace.

Deliverables:

- better graph actions
- revision previews
- tighter report refresh behavior
- chart/report polish

### Wave 5: Release Hardening

Priority: highest before launch

Scope:

- Workstream E items 1, 3, 4, 5

Reason:
No launch without meaningful release discipline.

Deliverables:

- fixed release workflow scripts and paths
- test matrix implemented
- observability hooks
- release checklist
- support diagnostics

## Parallel Execution Plan

These lanes can run in parallel once interfaces are agreed:

Lane 1:
- runtime trust and safety

Lane 2:
- persistence unification and restore diagnostics

Lane 3:
- test harness, regression suite, release gates

Lane 4:
- pipeline domain model and storage

Lane 5:
- artifact graph and report/chart UX polish

Critical sequencing constraints:

1. Do not finalize pipeline runtime before task-engine trust semantics are stable.
2. Do not migrate local storage data without defining native schema/versioning.
3. Do not widen artifact UX before persistence semantics are clear.
4. Add tests alongside each wave, not after all implementation.

## Immediate Next Actions

1. Convert this plan into tracked execution tickets by wave.
2. Start Wave 1:
   - fix destructive approval enforcement in Auto Mode first
   - finish mutation verification policy coverage
   - enrich task provenance
   - add regression tests for approval/resume/verification
3. Start Wave 2 in parallel:
   - inventory remaining `localStorage` usage
   - design migrations for query history and snippets
4. Start Wave 3 design in parallel:
   - define pipeline types and persistence schema
5. Start Wave 5 setup in parallel:
   - fix `tauri:build:ci` workflow mismatch
   - add `npm test` and `cargo test` to validation workflow

## Tracking

During implementation, update this file by:

- marking completed items
- linking new supporting docs and test files
- noting any scope changes or newly discovered blockers

## Wave Progress

### Wave 1

- Completed
- Destructive approvals now gate in all modes.
- Verification is shared across read-result and approved-write paths.
- Task provenance and approval audit logging are in place.
- Regression coverage exists for approval gating, task pause semantics, verification modes, and queue persistence.

### Wave 2

- Completed
- Product-critical persistence moved to the native app document store for:
  - query history
  - snippets
  - chart presets
- Legacy `localStorage` values for those features now act as migration/fallback sources rather than the canonical store.
- Remaining `localStorage` usage is intentionally limited to non-critical/device-local UX preferences until a later cleanup wave.
