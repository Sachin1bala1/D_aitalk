# Background Analysis Agents Plan

Last updated: 2026-05-17
Status: Completed
Owner: Codex / product engineering

## Goal

Close the remaining "no true background-agent equivalent" gap by introducing detached, persisted background analysis agents for Daitalk.

This subsystem should give Daitalk a data-native analog to Cursor background agents:

- detached analysis jobs that continue independently of the chat surface
- scheduled or manual execution against governed connections
- native persistence for definitions, runs, and approval items
- durable lineage into query/report artifacts
- notifications and operator-visible status

## Product Definition

For Daitalk, a background agent is:

- a saved analysis definition with a prompt and target connection
- executable manually or on a cadence
- limited to read-only SQL analysis during detached execution
- allowed to queue human review items instead of performing mutations
- required to produce durable outputs and run logs

This closes the product gap for "background agents" in the data-analysis domain without taking on unsafe unattended mutation execution.

## Multi-Phase Plan

### Phase 1: Domain Model And Persistence

Add a native-persisted background agent store with:

1. `BackgroundAgentDefinition`
   - id
   - name
   - prompt
   - connectionId
   - cadenceMinutes
   - isEnabled
   - createdAt / updatedAt
   - lastRunAt / lastRunStatus / lastRunArtifactId

2. `BackgroundAgentRun`
   - id
   - agentId
   - status (`queued`, `running`, `success`, `failed`, `approval_required`)
   - startedAt / finishedAt
   - summary / error
   - reportArtifactId
   - queryArtifactIds
   - approvalIds

3. `BackgroundAgentApprovalItem`
   - id
   - agentId / runId
   - title
   - rationale
   - risk
   - suggestedSql
   - status
   - createdAt / resolvedAt

Exit criteria:

- agents, runs, and approval items persist natively
- a store API exists for CRUD, run recording, and subscriptions

### Phase 2: Detached Runner

Implement a detached background runner that:

1. loads provider settings and keys outside the chat surface
2. loads target schema for prompt context
3. runs a restricted background-agent loop using only background-safe tools:
   - `background_execute_sql`
   - `queue_followup_action`
4. blocks or avoids mutation execution during detached runs
5. records query artifacts for executed analyses
6. produces a durable report artifact at the end of successful runs
7. records approval items when the agent recommends risky follow-up actions

Exit criteria:

- agents can run manually without the AI chat being open
- each successful run produces durable artifacts and logs
- risky follow-ups are queued for review instead of executed

### Phase 3: Scheduling, Status, Notifications

Add app-level scheduling and operator visibility:

1. due-agent scanning on an interval while the app is open
2. run de-duplication so the same agent does not run concurrently
3. success/failure/approval toasts
4. persisted `lastRun*` status on the agent definition

Exit criteria:

- enabled agents run automatically on cadence
- status survives app restarts
- operators get visible notifications

### Phase 4: UI And Workflow Surface

Add a first-class UI panel for background agents:

1. list agents
2. create/edit/delete agents
3. run-now action
4. enable/disable scheduled execution
5. recent run log view
6. approval queue view
7. open produced report artifacts

Exit criteria:

- the subsystem is usable without touching internal store code
- operators can inspect detached runs and follow-up approvals

### Phase 5: Validation

Add targeted regression coverage for:

1. persistence CRUD
2. due-run scheduling logic
3. restricted read-only runner behavior
4. approval item creation
5. run-to-artifact lineage

Also re-run:

- `npm run lint`
- targeted `vitest` coverage for the new subsystem

## Scope Boundary

This phase does **not** implement:

- unattended destructive mutations by detached agents
- remote cloud sandboxes like Cursor's code VMs
- cross-machine takeover sessions

Instead, it fully closes the **data-product analog**:

- detached analysis agents
- scheduled runs
- durable outputs
- reviewable follow-up actions
- logs, lineage, and notifications

## Completion Notes

- Implemented on 2026-05-17:
  - native-persisted background analysis agent definitions, runs, and approval items
  - detached read-only background runner using provider settings outside the chat surface
  - scheduled cadence scanning while the app is open
  - durable query/report artifact lineage for successful runs
  - notification toasts for success, failure, and queued follow-up reviews
  - first-class operator UI for create/edit/delete/run, recent runs, and approval review
  - targeted regression coverage for scheduling and approval lifecycle
- Validation completed:
  - `npm run lint`
  - `npm test`
  - `cargo test --lib`
- Intentional boundary:
  - detached agents are read-only during unattended execution; risky follow-up actions are queued for operator review rather than auto-executed
