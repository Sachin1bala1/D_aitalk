# Background Investigation Runtime Plan

Last updated: 2026-05-17
Status: Completed
Owner: Codex / product engineering

## Goal

Close the remaining background-autonomy gap beyond the existing scheduled analysis agent MVP.

The system already supports:

- detached read-only analysis runs
- native persistence for agents, runs, approvals
- scheduled execution while the app is open
- durable query/report artifacts
- operator-facing background agent UI

What is still missing for a stronger Cursor-style data analog is deeper investigation-runtime behavior:

- richer run lifecycle and operator-visible evidence
- bounded retries and clearer scheduling trust
- durable run logs instead of only a summary/error string
- operator takeover into the foreground AI flow with preserved investigation context

## Product Definition

For Daitalk, the next step is not “remote VM agents.” It is a production-ready detached investigation runtime:

- scheduled or manual agents create durable investigation runs
- each run keeps a structured event log and execution evidence
- transient failures retry safely within bounded limits
- operators can inspect what happened without reading raw code
- operators can take a detached run back into the AI panel with run context preloaded

Detached execution remains read-only. Risky follow-up actions continue to queue for review instead of executing unattended.

## Multi-Phase Plan

### Phase 1: Domain Model Upgrade

Extend persisted run state with:

1. richer lifecycle fields
   - trigger (`manual`, `scheduled`, `retry`)
   - `attemptCount`
   - `maxAttempts`
   - `lastHeartbeatAt`
   - `retryOfRunId`
   - `takeoverRequestedAt`

2. structured run event log
   - queued
   - started
   - sql executed
   - approval queued
   - report created
   - retrying
   - completed
   - failed
   - takeover requested

3. migration-safe normalization for existing saved run records

Exit criteria:

- old saved runs still load
- new runs persist structured lifecycle and event-log data

### Phase 2: Runner Hardening

Upgrade detached execution with:

1. explicit queued -> running lifecycle
2. structured event appends during execution
3. bounded retry for retryable provider/query failures
4. heartbeat updates while a run is active
5. clearer success/failure/approval summaries

Exit criteria:

- each run records meaningful evidence, not only a final summary
- transient failures retry safely and visibly
- the run store reflects real detached execution lifecycle

### Phase 3: Operator Takeover

Add first-class takeover from a detached run into the foreground AI panel:

1. build a run-context takeover prompt from:
   - agent definition
   - run summary/error
   - recent run events
   - queued approvals
   - linked report artifact

2. wire takeover into the existing AI chat entry seam
   - no separate AI runtime
   - prefill the AI panel with contextual follow-up prompt

3. persist takeover request metadata on the run

Exit criteria:

- operator can take over a detached run from the background agent panel
- AI chat resumes from run evidence rather than a blank prompt

### Phase 4: UI And Workflow Surface

Upgrade the background agent panel to show:

1. run trigger and attempts
2. event timeline / evidence log
3. retry and takeover actions
4. clearer approval-required / failed state handling
5. report-artifact open action alongside investigation takeover

Exit criteria:

- operators can inspect, retry, and continue detached investigations from the UI

### Phase 5: Search And Validation

Fold the richer runtime into the rest of the product:

1. include new run evidence in workspace search documents
2. expand targeted tests for:
   - run normalization/migration
   - event logging
   - takeover persistence
   - bounded retry metadata

3. validate with:
   - `npm run lint`
   - targeted `npm test`

Exit criteria:

- detached investigation runs are searchable and regression-covered

## Scope Boundary

This plan does **not** attempt to implement:

- unattended destructive mutations
- remote cloud execution sandboxes
- cross-machine session handoff

Those are distinct product layers. This plan fully closes the local-product analog:

- durable detached investigations
- retries
- evidence logs
- operator takeover
- stronger operator trust

## Completion Notes

- Implemented on 2026-05-17:
  - richer persisted run lifecycle with trigger, attempts, heartbeat, takeover metadata, and durable event logs
  - bounded retry behavior for retryable detached-run failures
  - event-level evidence capture for read-only SQL execution, approval queueing, report creation, completion, and takeover
  - operator retry and AI-takeover actions in the background agent panel
  - AI-panel takeover through the existing foreground chat seam instead of a second runtime
  - richer background-agent search indexing for run evidence
- Validation completed:
  - `npm run lint`
  - `npm test -- src/lib/backgroundAgents/BackgroundAgentStore.test.ts src/lib/search/workspaceSemanticIndex.test.ts`
- Intentional boundary remains:
  - detached agents stay read-only during unattended execution; takeover moves the investigation into the supervised AI/chat path before any write action is proposed or approved
