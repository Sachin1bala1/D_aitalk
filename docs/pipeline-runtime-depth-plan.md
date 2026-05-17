# Pipeline Runtime Depth Plan

Last updated: 2026-05-17
Status: Complete
Owner: Codex / product engineering

## Goal

Close the remaining pipeline-depth gap by upgrading Daitalk pipelines from a single-step materialization MVP into a real saved workflow runtime.

The current system already supports:

- persisted pipeline definitions
- manual execution
- target-table materialization
- run history
- review gating before manual execution
- output query artifacts

What is still missing for a stronger Cursor-for-data analog is workflow depth:

- multi-step pipeline definitions
- validation/assertion steps
- durable per-step run evidence
- schedule metadata and due-run scanning
- richer operator visibility than a flat run list

## Product Definition

For Daitalk, a pipeline should become a saved data workflow made of ordered steps.

The first production-ready step set is:

1. `query`
   - read from a connection using SQL
2. `assert_row_count`
   - validate row volume before writing
3. `materialize`
   - write a prior step’s dataset to a target table

This keeps the runtime deterministic and trustworthy while materially expanding capability.

## Multi-Phase Plan

### Phase 1: Domain Model Upgrade

Upgrade pipeline persistence with:

1. richer pipeline metadata
   - description
   - cadenceMinutes
   - isEnabled

2. ordered step definitions
   - `query`
   - `assert_row_count`
   - `materialize`

3. richer run model
   - trigger (`manual`, `scheduled`, `retry`)
   - per-step run records
   - run event log

4. migration from legacy single-query pipelines into a default two-step workflow:
   - query -> materialize

Exit criteria:

- old saved pipelines still load and run
- new pipeline definitions can hold explicit steps

### Phase 2: Workflow Execution Runtime

Upgrade execution with:

1. sequential step execution
2. step output handoff by `sourceStepId`
3. assertion failure handling
4. per-step artifact linkage where appropriate
5. clearer run summaries and error boundaries

Exit criteria:

- a pipeline run captures what each step did
- assertion failures stop the workflow before writes

### Phase 3: Scheduling And Operator Surface

Add workflow operations depth:

1. cadence metadata on pipelines
2. due-run scanning while the app is open
3. enable/disable scheduled pipelines
4. UI step list and per-run step evidence

Exit criteria:

- pipelines can run on cadence
- operators can inspect step-level activity

### Phase 4: Review, Search, And Validation

Fold the richer model into existing systems:

1. step-aware pipeline review dossiers
2. search documents that index step metadata and schedule state
3. regression coverage for migration, assertions, and scheduled runs

Validation:

- `npm run lint`
- targeted `npm test`
- broader `npm test`

Exit criteria:

- the pipeline runtime is no longer a flat materialization primitive
- the workflow model is searchable, reviewable, and regression-covered

## Scope Boundary

This plan does **not** implement:

- arbitrary DAG branching
- external connectors or webhook steps
- unattended destructive mutations outside explicit materialize steps

It fully closes the next practical depth gap:

- step-based pipelines
- validations
- scheduled runs
- step-level evidence
- stronger operator trust

## Completion Notes

Completed on 2026-05-17.

Implemented:

- versioned step-based pipeline definitions with legacy migration
- sequential query / assertion / materialize execution
- per-step run evidence and run summaries
- cadence-based due-run scanning while the app is open
- step-aware pipeline operator UI
- step-aware review dossiers
- richer search indexing for pipeline definitions and runs
- regression coverage for normalization, assertion failure, scheduled runs, and search/review compatibility

Validation completed:

- `npm run lint`
- `npm test`
