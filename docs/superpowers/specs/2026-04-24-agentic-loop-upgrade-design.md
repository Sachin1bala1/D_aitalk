# Agentic Loop Upgrade — Design Spec

**Date:** 2026-04-24  
**Status:** Approved  
**Scope:** Two subsystems — A (Plan→Execute→Verify→Retry loop) and B (Task decomposition with inline UI). Implemented together using a shared state-machine foundation.

---

## Goal

Upgrade Daitalk's AI agent from a basic tool-calling loop to a Claude Code–quality agentic workflow: the agent plans a multi-step goal, executes each step, verifies correctness against the actual database state, and retries intelligently when verification fails — all with a live inline progress view in the chat panel.

---

## Architecture

Two layers above the existing `AgentLoop`:

```
User message
     │
     ▼
┌─────────────────────────────────────┐
│           TaskEngine                │  owns state machine, drives subtasks
│  Planning → Executing → Verifying   │
│       → [Complete | Retry | Ask]    │
└─────────────┬───────────────────────┘
              │ one subtask at a time
              ▼
┌─────────────────────────────────────┐
│           AgentLoop                 │  unchanged interface — one LLM turn
│  (provider-agnostic, tool dispatch) │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│        VerificationEngine           │  runs assertion queries after mutations
│  Mutation check + result-shape      │  result-shape checks after SELECTs
│  reasoning → pass/fail + diagnosis  │
└─────────────────────────────────────┘
```

**Key design principle:** `AgentLoop.ts` interface is unchanged. `TaskEngine` is a new caller, not a replacement. Simple single-turn messages bypass TaskEngine entirely and go directly to AgentLoop — zero behavior change for existing features.

---

## Files

### New Files
| File | Responsibility |
|---|---|
| `src/lib/agent/TaskState.ts` | All types: SubTask, Task, AuditEntry, VerificationResult, RetryDecision |
| `src/lib/agent/TaskEngine.ts` | State machine runner — drives subtasks through states |
| `src/lib/agent/VerificationEngine.ts` | Runs assertion queries and result-shape checks |
| `src/lib/agent/RetryPolicy.ts` | Decides safe auto-retry vs ask-user per Claude Code rules |

### Modified Files
| File | Change |
|---|---|
| `src/lib/agent/AgentLoop.ts` | Accept optional `taskContext`, report state transitions via callback |
| `src/lib/agent/toolDefinitions.ts` | Add 3 new LLM tools: `create_task_plan`, `verify_result`, `request_clarification` |
| `src/lib/stores/WorkspaceStore.ts` | Add `currentTask: Task | null` and `setTask` / `clearTask` actions |
| `src/components/ai/AIChat.tsx` | Render inline `TaskProgressPanel` component above agent text |

### Unchanged Files (must not break)
- `src/lib/agent/CommandBus.ts` — no changes
- `src/lib/agent/commands.ts` — no changes
- `src/lib/agent/registerHandlers.ts` — no changes
- All provider files (`ClaudeProvider.ts`, `OpenAIProvider.ts`, etc.) — no changes
- `src/lib/db/DbClient.ts` — no changes
- `src/components/schema/Sidebar.tsx`, `SQLEditor.tsx`, all dialogs — no changes

---

## Section A: State Machine

### States

```
Planning → Executing → Verifying → Complete
                ↑           │
                │    [fail] ├→ RetryRequested  (safe fix)  → auto-retry → Executing
                │           └→ AwaitingApproval (risky fix) → user approves → Executing
                │                                            → user rejects  → Failed
                └─────────────────────── (loop until maxRetries) ──────────────────────┘
```

Five terminal/loop states per subtask:
- `complete` — verified success, move to next subtask
- `failed` — max retries reached or user rejected, surface error to user
- `retry_requested` — safe fix detected, auto-retry after streaming diagnosis
- `awaiting_approval` — risky fix, routed through existing Plan Mode queue
- `pending` — not yet started

### Types (`TaskState.ts`)

```typescript
export type SubTaskStatus =
  | "pending" | "planning" | "executing"
  | "verifying" | "complete" | "failed"
  | "retry_requested" | "awaiting_approval";

export interface AuditEntry {
  state: SubTaskStatus;
  timestamp: number;
  sql?: string;
  verificationPassed?: boolean;
  retryAttempt?: number;
  note?: string;
}

export interface SubTask {
  id: string;
  goal: string;
  status: SubTaskStatus;
  sql?: string;                // last executed SQL
  result?: unknown;            // last tool result
  verificationPassed?: boolean;
  diagnosis?: string;          // why verification failed
  retryCount: number;
  maxRetries: 3;               // hard cap
  isRisky: boolean;            // true for mutations on existing data
  auditLog: AuditEntry[];
}

export interface Task {
  id: string;
  userGoal: string;
  subtasks: SubTask[];
  currentIndex: number;
  status: "running" | "complete" | "failed" | "awaiting_input";
}

export interface VerificationResult {
  passed: boolean;
  actual: unknown;
  diagnosis: string;
}

export type RetryDecision =
  | { action: "auto_retry"; streamDiagnosis: boolean }
  | { action: "ask_user"; proposal: string }
  | { action: "fail"; reason: string };
```

---

## Section B: Task Decomposition

### How TaskEngine decides when to activate

TaskEngine inspects the user message before calling AgentLoop. If the LLM calls `create_task_plan` in round 0, TaskEngine activates and manages subsequent subtasks. If the LLM does not call `create_task_plan` (simple question, single query), TaskEngine passes through to AgentLoop directly — no overhead.

### TaskEngine flow (`TaskEngine.ts`)

```
runTask(userMessage, history, options):
  1. Call AgentLoop with planning prompt → LLM calls create_task_plan({subtasks})
  2. If no create_task_plan call → fall through, return AgentLoop result directly
  3. Initialise Task with SubTask[] all in "pending" state → setTask() in WorkspaceStore
  4. For each subtask in order:
     a. Set subtask.status = "executing"
     b. Call AgentLoop with subtask goal as focused prompt
     c. AgentLoop executes tools, returns result
     d. VerificationEngine.verify(subtask, result) → VerificationResult
     e. If passed → subtask.status = "complete", advance index
     f. If failed → RetryPolicy.decide(subtask, result) → RetryDecision
        - auto_retry → stream diagnosis, increment retryCount, go to (b)
        - ask_user → addPlanStep() in WorkspaceStore, pause until user approves/rejects
        - fail → subtask.status = "failed", surface to user, stop task
  5. All subtasks complete → Task.status = "complete", clearTask()
```

### Idempotency guarantee

A subtask that reaches `executing` state writes its SQL to `subtask.sql` before dispatch. On retry, if the previous execution succeeded but verification failed (e.g. network drop during verify), VerificationEngine re-runs the check query without re-running the mutation. This prevents double-INSERT on retry.

Implementation: TaskEngine checks if `subtask.sql` is set AND `subtask.result` is set before dispatching — if so, skips straight to re-verification.

---

## Section C: Verification Engine

### Mutation verification (`VerificationEngine.ts`)

Called after: INSERT, UPDATE, DELETE, ALTER TABLE, CREATE INDEX, DROP COLUMN.

The LLM declares expected outcome when calling `verify_result`:
```typescript
interface MutationExpectation {
  type: "row_exists" | "column_exists" | "row_count" | "index_exists";
  sql: string;          // verification SELECT to run
  expectedMinRows?: number;
  expectedValue?: unknown;
}
```

VerificationEngine runs the `sql` against the active connection and checks the result. Returns `VerificationResult` with diagnosis if failed.

### Result-shape verification

Called after: SELECT queries where the agent declared an expected shape.

```typescript
interface ShapeExpectation {
  type: "result_shape";
  minRows?: number;
  maxRows?: number;
  requiredColumns?: string[];
}
```

Checks actual QueryBatch result matches declared shape. Common failure: column renamed in schema, returning "Expected column 'sensor_id' but got 'device_id' — schema may have changed."

### Verification timeout

All verification queries run with a 10-second timeout. If they time out, result is `{ passed: false, diagnosis: "Verification query timed out" }` → RetryPolicy treats this as a safe retry.

---

## Section D: Retry Policy

Mirrors Claude Code behaviour exactly:

```typescript
// RetryPolicy.ts
export function decide(subtask: SubTask, vr: VerificationResult): RetryDecision {
  if (subtask.retryCount >= 3) {
    return { action: "fail", reason: `Max retries (3) reached. Last diagnosis: ${vr.diagnosis}` };
  }
  if (subtask.isRisky) {
    // risky = any mutation on existing rows (UPDATE, DELETE, DROP)
    return { action: "ask_user", proposal: vr.diagnosis };
  }
  return { action: "auto_retry", streamDiagnosis: true };
}
```

**`isRisky` detection:** set to `true` when the subtask's tool call was `delete_rows`, `drop_column`, `bulk_transform`, or `update_cell` on a table with >0 rows. All other tools (INSERT into empty table, CREATE INDEX, ALTER TABLE ADD COLUMN, SELECT) are `isRisky: false`.

**Auto-retry streaming:** before retrying, TaskEngine calls `onToken()` with the diagnosis text so the user sees: *"Verification failed: Expected 1 row with status='active', got 0. Adjusting WHERE clause and retrying…"*

**Ask-user flow:** TaskEngine calls existing `addPlanStep()` with the retry proposal as the human-readable description. User sees it in Plan Mode queue. On approval → resume. On rejection → subtask.status = "failed".

---

## Section E: New LLM Tools

Three tools added to `toolDefinitions.ts`:

### `create_task_plan`
```typescript
{
  name: "create_task_plan",
  description: "Declare a multi-step plan before starting execution. Call this first for any goal requiring more than one database operation. Each subtask is a focused goal string.",
  parameters: {
    type: "object",
    properties: {
      subtasks: {
        type: "array",
        items: { type: "string" },
        description: "Ordered list of subtask goals, each a single focused action"
      }
    },
    required: ["subtasks"]
  }
}
```

### `verify_result`
```typescript
{
  name: "verify_result",
  description: "After a mutation, declare what you expect to see in the database. The system will run this check and retry if it fails.",
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "SELECT query that should return rows if the mutation succeeded" },
      expectedMinRows: { type: "number", description: "Minimum rows expected (default: 1)" },
      description: { type: "string", description: "Human-readable description of what you're verifying" }
    },
    required: ["sql", "description"]
  }
}
```

### `request_clarification`
```typescript
{
  name: "request_clarification",
  description: "Ask the user a question when you need input to proceed. Pauses the task until the user responds.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
      context: { type: "string", description: "Why you need this information" }
    },
    required: ["question"]
  }
}
```

---

## Section F: Inline Chat UI

`TaskProgressPanel` component renders inside the chat message list, above the streaming text response. Appears only when `WorkspaceStore.currentTask` is non-null.

### Visual structure

```
┌─────────────────────────────────────────────┐
│ ▸ [task goal — truncated to 60 chars]  [×]  │
│   ✓ Explore schema structure                │
│   ✓ Identify tables with no indexes         │
│   ⟳ Verify "orders" table   [retrying 2/3] │
│   ○ Generate CREATE INDEX statements        │
│   ○ Execute and verify indexes              │
└─────────────────────────────────────────────┘
```

### Icons and colours

| Icon | State | Colour |
|---|---|---|
| `○` | pending | white/20 |
| `⟳` | executing / verifying | cyan, spinning |
| `✓` | complete | emerald-400 |
| `✗` | failed | red-400 |
| `⚠` | awaiting_approval | amber-400 |

### Retry counter

Shown inline next to the subtask label when `retryCount > 0`: `[retrying 2/3]` in amber.

### Dismiss

`[×]` button top-right clears `currentTask` from WorkspaceStore. Does not cancel in-flight execution — only hides the panel.

---

## Section G: Audit Log

Every state transition appends an `AuditEntry` to `subtask.auditLog`. The full task audit log is:
1. Stored in `WorkspaceStore.currentTask` while the task runs
2. Written to `localStorage` key `daitalk_task_audit` (last 10 tasks, capped at 500 entries total) on task completion
3. Displayed in the existing **History** tab alongside query history — each task entry is expandable to show all subtask transitions

Audit entries contain: state, timestamp, sql (if any), verificationPassed (if verified), retryAttempt, and a human-readable note.

---

## Section H: Existing Feature Compatibility

**Non-regression guarantees:**

1. **Simple messages** (no `create_task_plan` call from LLM) → `TaskEngine.run()` detects no task plan → returns `AgentLoop` result directly. Identical behaviour to today.
2. **Plan Mode** — risky retry decisions call existing `addPlanStep()`. Plan Mode queue UI unchanged.
3. **Undo stack** — successful subtask tool calls push to `undoStack` exactly as today (in `AgentLoop`).
4. **All providers** — `TaskEngine` only calls `provider.stream()` via `AgentLoop`. No provider-specific code.
5. **Connection/schema** — `VerificationEngine` uses `DbClient.execute()` which uses the active connection. No new connection management.
6. **DB drivers** — verification queries are standard SQL SELECTs. For MongoDB/Redis, `verify_result` is skipped (isRisky stays false, verification passes trivially) to avoid dialect issues.

---

## Testing Strategy

### Unit tests (new files only)
- `TaskState.ts` — type guards and state transition validity
- `RetryPolicy.ts` — all decision branches: safe retry, risky ask, max retries fail
- `VerificationEngine.ts` — mock DbClient, test pass/fail for each verification type

### Integration tests
- `TaskEngine.ts` — mock AgentLoop + mock VerificationEngine, drive full subtask lifecycle
- Test idempotency: subtask with sql+result already set skips re-execution on retry

### Regression tests (existing behaviour)
- Single-turn message with no `create_task_plan` → same output as before
- Plan Mode queue still receives destructive commands
- Undo stack still populated after tool execution

### Manual test scenarios
1. Ask agent: "Find all tables with no primary key and report them" → observe subtask checklist, verify completion
2. Ask agent: "Add a column 'archived' boolean to the users table" → observe verify_result call, check column appears in schema
3. Force verification failure (wrong table name) → observe retry with diagnosis streamed
4. Ask agent to DELETE rows → verify Plan Mode intercepts retry as risky
5. Send "what tables do I have?" → verify no task panel appears, response identical to current behaviour

---

## Out of Scope (for this spec)

- Cross-session memory / schema knowledge persistence
- Parallel subtask execution (subtasks are sequential)
- Task cancellation mid-execution (dismiss button only hides panel)
- Task decomposition for B subsystem beyond what LLM generates via `create_task_plan`
