# Graph Builder Drag-and-Drop Hardening Plan

Goal: Graph Builder field assignment must be reliable for every user. If native HTML5 drag-and-drop is flaky in a desktop webview, the builder still needs a deterministic fallback that feels intentional and keeps the chart-building workflow moving.

## Phase 1: Audit and Failure Isolation

- [x] Trace current field assignment flow in `GraphBuilderPanel`.
- [x] Confirm current implementation depends primarily on HTML5 drag/drop event payloads.
- [x] Identify missing fallback path when drag payloads are dropped or unsupported.

## Phase 2: Robust Field Assignment Model

- [x] Introduce an internal drag payload state so drop zones can resolve assignments even if `dataTransfer` is unreliable.
- [x] Add a click-to-select field interaction as a first-class fallback.
- [x] Allow clicking a selected field and then clicking a target zone to assign it.
- [x] Allow reassigning an already assigned field to a different zone using the same fallback path.
- [x] Replace browser-native drag dependence with a pointer-driven drag model that works consistently inside the desktop webview.

## Phase 3: UX Guardrails

- [x] Show visual selection state for the currently staged field.
- [x] Show helper copy that the user can drag or click a selected field into a zone.
- [x] Preserve zone-swap behavior when moving a field from one zone to another.

## Phase 4: Regression Coverage

- [x] Add tests for click-to-select plus click-a-zone assignment.
- [x] Add tests for reassigning an existing zone field into a different zone.
- [x] Run focused tests and typecheck.

## Done Criteria

- [x] Users can drag fields from the column list into graph zones.
- [x] If drag/drop is flaky, users can still assign fields by clicking the field and then the target zone.
- [x] Moving a field from one zone to another preserves sane swap/clear behavior.
- [x] Clicking a field never auto-assigns it into the next empty slot without the user choosing the target zone.
