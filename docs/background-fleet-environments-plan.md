# Background Fleet Environments Plan

Last updated: 2026-05-17
Status: Completed
Owner: Codex / product engineering

## Goal

Close the remaining background-autonomy gap after detached run hardening by adding governed multi-environment orchestration for background agents.

The current system already supports:

- persisted detached background agents
- detached investigation runs with event logs
- bounded retry
- approval queueing
- operator takeover into AI chat

What is still missing for a stronger Cursor-style analog is a fleet model:

- named execution environments instead of a single implicit local lane
- per-environment concurrency and queueing
- explicit run routing and dispatch state per environment
- operator visibility into environment health and backlog

## Product Definition

For Daitalk, an environment is a governed execution lane for detached data-analysis jobs:

- one or more database connections are associated with an environment
- agents run in an assigned environment
- each environment enforces concurrency and enable/disable state
- queued runs wait for capacity instead of silently racing
- operators can see where work is running and what is waiting

This is the correct data-native analog to “background agents across environments” without pretending the app has remote code sandboxes.

## Multi-Phase Plan

### Phase 1: Environment Domain Model

Add persisted execution environments with:

1. `BackgroundAgentEnvironment`
   - id
   - name
   - description
   - connectionIds
   - concurrencyLimit
   - isEnabled
   - status (`idle`, `active`, `paused`)
   - createdAt / updatedAt
   - lastDispatchAt / lastHeartbeatAt

2. assign each background agent to an `environmentId`

3. stamp each run with `environmentId`

4. migrate existing data to a default local environment

Exit criteria:

- all existing agents/runs load under a default environment
- new agents can target explicit environments

### Phase 2: Queue And Dispatch Runtime

Add environment-aware orchestration with:

1. queue-first run creation
2. per-environment concurrency enforcement
3. queue drain / dispatch logic
4. scheduled runs enqueue instead of starting blindly
5. de-duplication for already queued/running agents

Exit criteria:

- environments can throttle and queue background work safely
- due scans and manual runs respect environment capacity

### Phase 3: Operator Environment Surface

Upgrade the background agent panel with:

1. environment cards and status
2. create/edit/delete environment flows
3. assign agents to environments
4. queue-depth and active-run visibility
5. environment-aware run summaries

Exit criteria:

- operators can manage environments without touching store code

### Phase 4: Search And Validation

Fold environments into the wider workspace:

1. add environment search documents
2. expand background-agent tests for migration and queueing
3. validate with:
   - `npm run lint`
   - targeted `npm test`
   - broader `npm test`

Exit criteria:

- environment fleet state is searchable and regression-covered

## Scope Boundary

This plan still does **not** implement:

- remote cloud execution sandboxes
- cross-machine handoff
- unattended destructive mutations

It fully closes the governed local-product analog:

- multiple named execution environments
- queueing and concurrency per environment
- operator environment visibility
- routed detached investigations across a managed fleet

## Completion Notes

- Implemented on 2026-05-17:
  - persisted execution environments with migration-safe default environment assignment for existing agents and runs
  - environment-aware run routing, queueing, de-duplication, and concurrency enforcement in the detached runner
  - environment management and assignment in the background agent panel
  - workspace search coverage for execution environments and environment-aware run metadata
- Validation completed:
  - `npm run lint`
  - `npm test -- src/lib/backgroundAgents/BackgroundAgentStore.test.ts src/lib/search/workspaceSemanticIndex.test.ts`
- Intentional boundary remains:
  - this is still the governed local-product analog, not a remote cloud sandbox or cross-machine handoff system
