# Cursor-Like Agent Runtime Planning Memo

## Current Gap

The repository already has the right top-level nouns:

- `src/lib/agent/AgentLoop.ts`
- `src/lib/agent/TaskEngine.ts`
- `src/lib/agent/CommandBus.ts`
- `src/lib/agent/registerHandlers.ts`
- `src/components/ai/PlanQueue.tsx`
- `src/components/ai/TaskProgressPanel.tsx`

But the runtime is still closer to a single-turn tool caller than a Cursor-like agent workflow:

- `TaskEngine.ts` is a thin status wrapper around `runAgentLoop()`, not a real orchestrator.
- `TaskProgressPanel.tsx` only shows `userGoal` plus a string status; it does not reflect subtasks, verification, retries, or waiting states.
- `CommandBus.ts` executes commands directly and returns a basic `CommandResult`; it does not emit structured execution events, policy metadata, or resumable operation IDs.
- `AgentLoop.ts` handles destructive-command queuing in-line, but it does not separate planning, execution, verification, and retry into explicit phases.
- `PlanQueue.tsx` is usable as an approval surface, but only for immediate command approval, not for retry proposals or task checkpoints.

The migration should preserve the existing `AgentLoop -> CommandBus -> handler` path and add orchestration around it, not replace it.

## 1) Target Architecture

### Core principle

Keep `AgentLoop` as the provider-facing single LLM turn. Build a task runtime above it and an execution contract below it.

### Proposed layers

1. `AgentSessionRuntime`
   Owns one user request from start to finish. Decides whether the request is single-turn or task-oriented. Replaces the current thin `TaskEngine` behavior.

2. `TaskEngine`
   Owns the state machine for a task:
   `plan -> execute -> verify -> retry | ask_user -> complete | failed`

3. `PlanCompiler`
   Converts an LLM-produced plan into typed `TaskStep`s with:
   - `goal`
   - `kind` (`read`, `mutation`, `schema`, `analysis`, `ui`)
   - `risk`
   - `preconditions`
   - `successCriteria`
   - `retryPolicy`

4. `ExecutionCoordinator`
   Runs one step at a time against the existing `CommandBus`. It is responsible for:
   - command dispatch
   - step-scoped logging
   - cancellation
   - idempotency keys
   - resume points

5. `VerificationEngine`
   Verifies actual outcomes, not just tool-call success. It should support:
   - result-shape checks for `SELECT`
   - mutation assertions for `INSERT/UPDATE/DELETE`
   - schema assertions for DDL
   - user-visible diagnosis on failure

6. `RetryPolicy`
   Makes deterministic decisions from structured signals:
   - tool execution error
   - verification failure
   - timeout
   - policy violation
   - ambiguous result

7. `ApprovalGateway`
   Reuses `WorkspaceStore.planQueue` and `PlanQueue.tsx`, but upgrades them from “queue a destructive command” to “pause the task on a resumable approval checkpoint.”

### Command bus contract

Do not replace `AgentCommand`. Extend execution metadata around it.

Add an envelope such as:

```ts
interface RuntimeCommandEnvelope {
  taskId?: string;
  stepId?: string;
  commandId: string;
  command: AgentCommand;
  idempotencyKey?: string;
  expectation?: VerificationExpectation;
  policy?: {
    requiresApproval: boolean;
    allowAutoRetry: boolean;
    sideEffectLevel: "none" | "reversible" | "persistent" | "destructive";
  };
}
```

And a richer result:

```ts
interface RuntimeCommandResult {
  success: boolean;
  commandId: string;
  startedAt: number;
  completedAt: number;
  result?: unknown;
  error?: string;
  effectSummary?: {
    rowsRead?: number;
    rowsWritten?: number;
    schemaChanged?: boolean;
  };
  resumable?: boolean;
}
```

This preserves existing handlers while enabling orchestration, auditing, and retry safety.

### State model

Upgrade `currentTask` in `WorkspaceStore` from:

- `{ userGoal, status }`

to a real runtime object:

- task summary
- ordered steps
- current step index
- per-step status
- execution log
- pending approval checkpoint
- retry count
- verification status
- final outcome

That state should drive `TaskProgressPanel`, not be derived from chat text.

### Safety model

Safety should move from ad hoc command gating to policy-driven execution:

- `read`: execute immediately
- `reversible write`: execute in auto mode, verify, expose undo where possible
- `persistent mutation`: require preflight and post-verify
- `destructive mutation`: always checkpoint for approval

Preflight should include:

- active connection present
- target object exists
- SQL shape matches intent
- row-count estimate when available
- transaction capability known

Verification should be mandatory for writes and DDL. “Tool succeeded” is not enough.

### Plan / execute / verify / retry loop

A Cursor-like workflow in this app should be:

1. `Plan`
   Agent emits a step plan only when the request crosses a complexity threshold.

2. `Execute`
   One step at a time through `CommandBus`.

3. `Verify`
   Compare actual database/UI state against declared success criteria.

4. `Retry`
   Retry only if:
   - the step is idempotent, or
   - the prior attempt is proven not to have committed side effects, or
   - the retry path is an alternate safe read/verify path

5. `Escalate`
   Ask the user for approval or clarification when the failure mode is risky or ambiguous.

## 2) Phases

### Phase 0: Stabilize the runtime seam

Goal: make the current runtime observable without changing behavior.

- Add task/step/execution types beside current `TaskState.ts`.
- Introduce command/result envelopes without breaking existing handlers.
- Add event hooks around `CommandBus.dispatch()`.
- Keep `AIChat -> runTaskEngine()` intact.
- Keep `runTaskEngine()` in pass-through mode by default.

Exit criteria:

- existing chat behavior unchanged
- tool execution emits structured runtime events
- `TaskProgressPanel` can render off store state rather than a string

### Phase 1: Real task engine for multi-step safe reads

Goal: support non-mutating multi-step investigations.

- Add a `PlanCompiler` for read-only plans.
- Introduce `TaskEngine` states: `planning`, `executing`, `verifying`, `complete`, `failed`.
- Use result-shape verification for `execute_sql`.
- Add retry for transient failures only.
- Keep all writes on the old immediate path for now.

Exit criteria:

- agent can break a “find root cause” request into multiple safe read steps
- step progress is visible
- transient query/listener/provider failures can retry safely

### Phase 2: Write safety and approval checkpoints

Goal: move mutations onto the new engine.

- Add verification expectations for `insert_row`, `update_cell`, `bulk_transform`, `add_column`, `create_index`, `drop_column`, `rename_table`, `delete_rows`.
- Add `ApprovalGateway` integration with `PlanQueue`.
- Convert queue entries into resumable task checkpoints rather than isolated commands.
- Add row-count preflight for destructive commands where possible.

Exit criteria:

- every mutation step has preflight + verify
- retry policy distinguishes safe retry from ask-user
- user approval resumes the same task step instead of starting a separate action

### Phase 3: Resumability, cancellation, and recovery

Goal: make the runtime durable and trustworthy.

- Persist in-flight task state in memory/store with resume tokens.
- Add cancellation semantics at task and step levels.
- Track listener/query IDs for streaming cleanup.
- Add crash-safe “unknown outcome” handling for write steps.

Exit criteria:

- app can recover or clearly mark interrupted tasks
- no duplicate replays after uncertain write outcomes
- task cancellation leaves query/runtime state consistent

### Phase 4: Parallel sub-steps and richer agent workflows

Goal: reach a more Cursor-like operator experience.

- Allow planner to mark independent read-only steps as parallelizable.
- Add verification-backed subplans.
- Add explicit clarify/blocked states.
- Add task-scoped memory and artifact outputs.

Exit criteria:

- parallel reads are supported without compromising safety
- agent can pause for clarification and continue from the same task

## 3) Risks

### Architectural risks

- The current `AgentLoop.ts` mixes prompt policy, tool translation, execution, and plan gating. If expanded in place, it will become the wrong orchestration layer.
- `WorkspaceStore.currentTask` is too narrow for real task orchestration and can turn into an ad hoc mirror of internal state unless replaced cleanly.
- `PlanQueue.tsx` currently executes commands directly. If left unchanged, approval will fork control away from `TaskEngine` and break resumability.

### Safety risks

- Retrying a mutation after a partial failure can duplicate writes if idempotency is not explicit.
- Streaming query success does not imply semantic success; verification must check the target state.
- Some drivers may not support safe preflight or transactional rollback consistently.

### Product risks

- Over-planning simple requests will make the agent feel slower than the current chat path.
- Showing too much state noise in the UI will make the workflow look more complex than it is.
- Auto mode can become misleading if “auto” still pauses frequently because policy boundaries are not clearly explained.

### Migration risks

- Touching handler behavior too early will break existing charting, Pyodide stats, and UI-only commands that already depend on `CommandResult`.
- Replacing `runAgentLoop()` outright would force provider and prompt changes before the runtime contract is stable.

## 4) First Implementation Slice

The first slice should not attempt mutation retries. It should prove the orchestration seam on safe reads only.

### Scope

- Real task state in `WorkspaceStore`
- `TaskProgressPanel` shows steps
- `TaskEngine` supports:
  - pass-through single-step mode
  - multi-step read-only mode
  - result-shape verification for `execute_sql`
  - transient retry for provider/query failures
- `CommandBus` emits structured execution events but still calls existing handlers

### Concrete files

- `src/lib/agent/TaskRuntime.ts`
  Add runtime types for `Task`, `TaskStep`, `VerificationExpectation`, `RetryDecision`, `ApprovalCheckpoint`.

- `src/lib/agent/TaskEngine.ts`
  Replace the thin wrapper with a real orchestrator, but only for read-only plans.

- `src/lib/agent/VerificationEngine.ts`
  Start with `SELECT` result-shape verification:
  - min rows
  - required columns
  - empty-result diagnosis

- `src/lib/agent/CommandBus.ts`
  Add optional dispatch envelope and lifecycle hooks while keeping `dispatch(cmd)` working.

- `src/lib/stores/WorkspaceStore.ts`
  Replace `currentTask: { userGoal; status }` with a typed runtime task object.

- `src/components/ai/TaskProgressPanel.tsx`
  Render current step, per-step status, retry count, and verification state.

### Why this slice first

- It upgrades architecture without increasing mutation risk.
- It proves the value of plan/execute/verify/retry on workflows users already want, like multi-query investigations.
- It keeps the current command handlers, provider integrations, and Tauri IPC intact.
- It creates the seam needed for safe mutation support in the next phase.

### Definition of done for slice 1

- A simple question still behaves exactly like today.
- A multi-step read-only question creates visible steps and advances through them.
- Failed read steps can retry automatically when failure is transient.
- Verification failures are surfaced as explicit step failures, not buried in assistant prose.
- No existing `AgentCommand` handlers need to be rewritten.

## Recommended Migration Strategy

Use a strangler pattern, not a rewrite.

- Keep `runAgentLoop()` as the stable single-turn executor.
- Move policy and orchestration up into `TaskEngine`.
- Move execution metadata down into `CommandBus`.
- Reuse `PlanQueue` as the approval UI, but stop letting it become an alternate executor.
- Gate rollout by step type:
  - safe reads first
  - reversible writes next
  - destructive writes last

This preserves today’s working surfaces while closing the main gap: the app currently has agent UI affordances, but not yet a reliable agent runtime.
