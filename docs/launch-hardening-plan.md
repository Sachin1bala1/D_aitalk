# Launch Hardening Plan

Last updated: 2026-05-17
Status: Completed
Owner: Codex / product engineering

## Goal

Close the highest-priority remaining production-readiness gaps other than remote/cloud execution:

1. automated desktop smoke automation
2. real updater behavior instead of a stub
3. visible chart UX TODO cleanup
4. explicit persistence-boundary cleanup/documentation
5. production-readiness source-of-truth refresh

## Scope

This plan intentionally skips the remote execution / hosted background-fleet gap for now.

## Phase 1: Smoke Automation

Status: Completed

Build an automated smoke lane that proves the highest-signal product journeys without relying on a fully packaged installer run.

Action items:

1. Add a smoke harness mode for the app.
   - deterministic seed data
   - no real database requirement
   - stable selectors

2. Add browser-driven smoke coverage for:
   - app launch
   - workspace search open
   - pipeline panel open
   - background agents panel open
   - artifact surface open
   - AI panel availability

3. Add CI entrypoint for smoke validation.
   - separate from unit tests
   - fail the validate workflow when smoke fails

Exit criteria:

- a repeatable automated smoke command exists locally and in CI
- the smoke lane covers the app shell and key production surfaces

## Phase 2: Update Flow

Status: Completed

Replace the fake “Check for updates” button with real production-safe behavior.

Action items:

1. Wire Tauri updater support where available.
2. Detect when updater is unavailable or unconfigured.
3. Surface honest states:
   - checking
   - update available
   - no update
   - updater unavailable in this build
4. Keep packaged-release compatibility with future updater endpoints.

Exit criteria:

- the UI no longer lies about update status
- packaged builds can use a real updater path once configured
- non-updater builds degrade clearly

## Phase 3: Chart Polish

Status: Completed

Remove the most visible unfinished chart seams.

Action items:

1. Implement PNG export from Graph Builder.
2. Replace unsupported faceting with a clear gated state instead of a dead affordance.
3. Remove or soften lasso-selection TODO exposure so the user does not see unfinished interaction promises.
4. Add targeted tests for chart export/visibility behavior where practical.

Exit criteria:

- no obvious chart TODO is still exposed as a fake production feature

## Phase 4: Persistence Boundary Cleanup

Status: Completed

Make the remaining `localStorage` usage explicit, narrow, and documented.

Action items:

1. Move user-visible preferences that should survive desktop sessions into a shared preference store where appropriate.
2. Keep `localStorage` only for clearly device-local, non-critical UX state if still justified.
3. Document the final persistence boundary in repo docs.
4. Align comments/source docs with actual behavior.

Exit criteria:

- persistence boundaries are intentional and documented
- no critical product workflow depends on ad hoc browser-only state

## Phase 5: Production Plan Refresh

Status: Completed

Refresh repo source-of-truth docs to match reality.

Action items:

1. Update `production-readiness-plan.md`
2. mark completed waves accurately
3. replace stale statements about pipelines, tests, and remaining blockers
4. link smoke automation and updater behavior

Exit criteria:

- repo docs reflect the current real state of the product

## Validation

- `npm run lint`
- `npm test`
- `cargo test --lib`
- new smoke command

## Completion Notes

Completed on 2026-05-17.

Implemented outcomes:

- `npm run test:smoke` validates the core workspace shell and key panel switching path.
- the update button now reports honest runtime states and uses the Tauri updater path when it is configured.
- Graph Builder PNG export is live, and visible chart TODO affordances were removed or softened.
- remaining preference/state persistence boundaries are now documented and narrowed.
- repo production-readiness docs were refreshed to match the live codebase.
