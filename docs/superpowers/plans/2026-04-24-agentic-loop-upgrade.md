# Agentic Loop Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Daitalk's AI agent from a basic tool-calling loop to a Claude Code–quality agentic workflow: plan → execute → verify → retry state machine, with inline task progress UI in the chat panel.

**Architecture:** `TaskEngine` wraps the existing `AgentLoop` — `AIChat.tsx` calls `runTaskEngine()` instead of `runAgentLoop()`; TaskEngine falls through for simple (non-plan) messages with zero overhead. `VerificationEngine` runs assertion SQL after mutations via the new `verify_result` LLM tool; `RetryPolicy` mirrors Claude Code's safe-auto-retry / risky-ask behavior. `TaskProgressPanel` renders inline in the chat message list.

**Tech Stack:** TypeScript, React 19, Zustand with immer, Vitest (newly added), Tauri `invoke()` for DB queries.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `vitest.config.ts` | Create | Vitest config with jsdom + Tauri mocks |
| `src/test-setup.ts` | Create | Global mocks for `@tauri-apps/api` |
| `src/lib/agent/TaskState.ts` | Create | All shared types: SubTask, Task, VerificationResult, RetryDecision, AuditEntry |
| `src/lib/agent/RetryPolicy.ts` | Create | Pure function: decide(subtask, vr) → RetryDecision |
| `src/lib/agent/RetryPolicy.test.ts` | Create | Unit tests for all decision branches |
| `src/lib/agent/VerificationEngine.ts` | Create | verify(connectionId, expectation, actualResult) → VerificationResult |
| `src/lib/agent/VerificationEngine.test.ts` | Create | Unit tests with mocked DbClient |
| `src/lib/agent/toolDefinitions.ts` | Modify | Add `create_task_plan`, `verify_result`, `request_clarification` |
| `src/lib/stores/WorkspaceStore.ts` | Modify | Add `currentTask: Task \| null`, `setTask`, `updateCurrentTask`, `clearTask` |
| `src/lib/agent/AgentLoop.ts` | Modify | Accept optional `taskContext`; intercept 3 special tool calls |
| `src/lib/agent/TaskEngine.ts` | Create | State machine runner wrapping AgentLoop |
| `src/lib/agent/TaskEngine.test.ts` | Create | Integration tests with mocked AgentLoop + VerificationEngine |
| `src/components/ai/TaskProgressPanel.tsx` | Create | Inline subtask progress UI |
| `src/components/ai/AIChat.tsx` | Modify | Call `runTaskEngine`; render `TaskProgressPanel` |

---

## Task 1: Install Vitest and Create Test Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`
- Modify: `package.json` (scripts only)

- [ ] **Step 1: Install vitest and jsdom**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm install -D vitest jsdom
```

Expected: `vitest` added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 3: Create `src/test-setup.ts`**

```typescript
// src/test-setup.ts
import { vi } from "vitest";

// Mock Tauri APIs — not available in jsdom/Node
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
```

- [ ] **Step 4: Add test script to `package.json`**

Open `package.json`. In the `"scripts"` section, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

So the scripts section becomes:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "lint": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Write a smoke test to verify setup**

Create `src/test-setup.test.ts`:

```typescript
// src/test-setup.test.ts
import { describe, it, expect } from "vitest";

describe("test infrastructure", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the smoke test**

```bash
npm test
```

Expected output:
```
✓ src/test-setup.test.ts (1)
  ✓ test infrastructure > runs

Test Files  1 passed (1)
Tests       1 passed (1)
```

- [ ] **Step 7: Delete the smoke test**

```bash
rm src/test-setup.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/test-setup.ts package.json
git commit -m "chore: add vitest test infrastructure with Tauri API mocks"
```

---

## Task 2: Create `TaskState.ts` (All Shared Types)

**Files:**
- Create: `src/lib/agent/TaskState.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/agent/TaskState.ts

export type SubTaskStatus =
  | "pending"
  | "planning"
  | "executing"
  | "verifying"
  | "complete"
  | "failed"
  | "retry_requested"
  | "awaiting_approval";

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
  /** Last SQL executed by this subtask (for idempotency checks) */
  sql?: string;
  /** Last tool result from AgentLoop (for idempotency checks) */
  result?: unknown;
  verificationPassed?: boolean;
  /** Why verification failed (streamed to user on auto-retry) */
  diagnosis?: string;
  retryCount: number;
  maxRetries: 3;
  /** True for mutations on existing data (UPDATE, DELETE, DROP) */
  isRisky: boolean;
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

/** Parameters the LLM passes when calling verify_result tool */
export interface VerifyResultParams {
  sql: string;
  expectedMinRows?: number;
  description: string;
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/TaskState.ts
git commit -m "feat: add TaskState types (SubTask, Task, VerificationResult, RetryDecision)"
```

---

## Task 3: Create `RetryPolicy.ts` with Unit Tests

**Files:**
- Create: `src/lib/agent/RetryPolicy.ts`
- Create: `src/lib/agent/RetryPolicy.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// src/lib/agent/RetryPolicy.test.ts
import { describe, it, expect } from "vitest";
import { decide } from "./RetryPolicy";
import type { SubTask, VerificationResult } from "./TaskState";

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: "st-1",
    goal: "test goal",
    status: "verifying",
    retryCount: 0,
    maxRetries: 3,
    isRisky: false,
    auditLog: [],
    ...overrides,
  };
}

const failedVR: VerificationResult = {
  passed: false,
  actual: [],
  diagnosis: "Expected 1 row, got 0",
};

describe("RetryPolicy.decide", () => {
  it("returns auto_retry for safe subtask under max retries", () => {
    const subtask = makeSubTask({ isRisky: false, retryCount: 0 });
    const decision = decide(subtask, failedVR);
    expect(decision).toEqual({ action: "auto_retry", streamDiagnosis: true });
  });

  it("returns auto_retry for safe subtask at retry 2 of 3", () => {
    const subtask = makeSubTask({ isRisky: false, retryCount: 2 });
    const decision = decide(subtask, failedVR);
    expect(decision).toEqual({ action: "auto_retry", streamDiagnosis: true });
  });

  it("returns fail when retryCount reaches 3", () => {
    const subtask = makeSubTask({ isRisky: false, retryCount: 3 });
    const decision = decide(subtask, failedVR);
    expect(decision.action).toBe("fail");
    expect((decision as { action: "fail"; reason: string }).reason).toContain("Max retries (3) reached");
    expect((decision as { action: "fail"; reason: string }).reason).toContain("Expected 1 row, got 0");
  });

  it("returns ask_user for risky subtask", () => {
    const subtask = makeSubTask({ isRisky: true, retryCount: 0 });
    const decision = decide(subtask, failedVR);
    expect(decision).toEqual({ action: "ask_user", proposal: "Expected 1 row, got 0" });
  });

  it("max retries check takes priority over isRisky", () => {
    const subtask = makeSubTask({ isRisky: true, retryCount: 3 });
    const decision = decide(subtask, failedVR);
    expect(decision.action).toBe("fail");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test src/lib/agent/RetryPolicy.test.ts
```

Expected: FAIL with "Cannot find module './RetryPolicy'"

- [ ] **Step 3: Implement `RetryPolicy.ts`**

```typescript
// src/lib/agent/RetryPolicy.ts
import type { SubTask, VerificationResult, RetryDecision } from "./TaskState";

export function decide(subtask: SubTask, vr: VerificationResult): RetryDecision {
  if (subtask.retryCount >= 3) {
    return {
      action: "fail",
      reason: `Max retries (3) reached. Last diagnosis: ${vr.diagnosis}`,
    };
  }
  if (subtask.isRisky) {
    return { action: "ask_user", proposal: vr.diagnosis };
  }
  return { action: "auto_retry", streamDiagnosis: true };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npm test src/lib/agent/RetryPolicy.test.ts
```

Expected:
```
✓ src/lib/agent/RetryPolicy.test.ts (5)
Tests  5 passed (5)
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/RetryPolicy.ts src/lib/agent/RetryPolicy.test.ts
git commit -m "feat: add RetryPolicy with unit tests (safe auto-retry, risky ask-user, max-retries fail)"
```

---

## Task 4: Create `VerificationEngine.ts` with Unit Tests

**Files:**
- Create: `src/lib/agent/VerificationEngine.ts`
- Create: `src/lib/agent/VerificationEngine.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// src/lib/agent/VerificationEngine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyMutation, verifyShape } from "./VerificationEngine";

// Mock DbClient at the module level
vi.mock("../db/DbClient", () => ({
  DbClient: {
    query: vi.fn(),
  },
}));

import { DbClient } from "../db/DbClient";

const mockQuery = vi.mocked(DbClient.query);

describe("verifyMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when query returns expected rows", async () => {
    mockQuery.mockResolvedValue([{ id: 1 }]);
    const result = await verifyMutation("conn-1", {
      sql: "SELECT * FROM users WHERE id = 1",
      expectedMinRows: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.diagnosis).toBe("OK");
  });

  it("fails when query returns fewer rows than expected", async () => {
    mockQuery.mockResolvedValue([]);
    const result = await verifyMutation("conn-1", {
      sql: "SELECT * FROM users WHERE id = 1",
      expectedMinRows: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toContain("Expected at least 1 row(s), got 0");
  });

  it("defaults expectedMinRows to 1 when not specified", async () => {
    mockQuery.mockResolvedValue([]);
    const result = await verifyMutation("conn-1", {
      sql: "SELECT 1",
    });
    expect(result.passed).toBe(false);
  });

  it("fails with timeout diagnosis when query exceeds 10s", async () => {
    vi.useFakeTimers();
    mockQuery.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ id: 1 }]), 15_000))
    );
    const resultPromise = verifyMutation("conn-1", { sql: "SELECT 1" });
    vi.advanceTimersByTime(10_001);
    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toBe("Verification query timed out");
    vi.useRealTimers();
  });

  it("fails with error diagnosis when query throws", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const result = await verifyMutation("conn-1", { sql: "SELECT 1" });
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toContain("connection refused");
  });
});

describe("verifyShape", () => {
  it("passes when result has required columns and enough rows", () => {
    const rows = [{ sensor_id: 1, value: 42 }, { sensor_id: 2, value: 99 }];
    const result = verifyShape(rows, {
      minRows: 1,
      requiredColumns: ["sensor_id", "value"],
    });
    expect(result.passed).toBe(true);
  });

  it("fails when result has too few rows", () => {
    const result = verifyShape([], { minRows: 1 });
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toContain("Expected at least 1 row");
  });

  it("fails when result has too many rows", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = verifyShape(rows, { maxRows: 2 });
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toContain("Expected at most 2 row");
  });

  it("fails when required column is missing", () => {
    const rows = [{ device_id: 1 }];
    const result = verifyShape(rows, { requiredColumns: ["sensor_id"] });
    expect(result.passed).toBe(false);
    expect(result.diagnosis).toContain("sensor_id");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test src/lib/agent/VerificationEngine.test.ts
```

Expected: FAIL with "Cannot find module './VerificationEngine'"

- [ ] **Step 3: Implement `VerificationEngine.ts`**

```typescript
// src/lib/agent/VerificationEngine.ts
import { DbClient } from "../db/DbClient";
import type { VerificationResult } from "./TaskState";

const VERIFICATION_TIMEOUT_MS = 10_000;

// ── Mutation verification ───────────────────────────────────────────────────

export interface MutationExpectation {
  sql: string;
  expectedMinRows?: number;
}

export async function verifyMutation(
  connectionId: string,
  expectation: MutationExpectation
): Promise<VerificationResult> {
  const minRows = expectation.expectedMinRows ?? 1;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("__timeout__")), VERIFICATION_TIMEOUT_MS)
    );
    const queryPromise = DbClient.query(connectionId, expectation.sql);
    const rows = await Promise.race([queryPromise, timeoutPromise]);

    if (rows.length < minRows) {
      return {
        passed: false,
        actual: rows,
        diagnosis: `Expected at least ${minRows} row(s), got ${rows.length}`,
      };
    }
    return { passed: true, actual: rows, diagnosis: "OK" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "__timeout__") {
      return { passed: false, actual: null, diagnosis: "Verification query timed out" };
    }
    return { passed: false, actual: null, diagnosis: `Verification query error: ${msg}` };
  }
}

// ── Result-shape verification ───────────────────────────────────────────────

export interface ShapeExpectation {
  minRows?: number;
  maxRows?: number;
  requiredColumns?: string[];
}

export function verifyShape(
  rows: Record<string, unknown>[],
  expectation: ShapeExpectation
): VerificationResult {
  if (expectation.minRows !== undefined && rows.length < expectation.minRows) {
    return {
      passed: false,
      actual: rows,
      diagnosis: `Expected at least ${expectation.minRows} row(s), got ${rows.length}`,
    };
  }
  if (expectation.maxRows !== undefined && rows.length > expectation.maxRows) {
    return {
      passed: false,
      actual: rows,
      diagnosis: `Expected at most ${expectation.maxRows} row(s), got ${rows.length}`,
    };
  }
  if (expectation.requiredColumns && rows.length > 0) {
    const actualCols = new Set(Object.keys(rows[0]));
    for (const col of expectation.requiredColumns) {
      if (!actualCols.has(col)) {
        return {
          passed: false,
          actual: rows,
          diagnosis: `Expected column '${col}' not found in result. Got: ${[...actualCols].join(", ")}`,
        };
      }
    }
  }
  return { passed: true, actual: rows, diagnosis: "OK" };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npm test src/lib/agent/VerificationEngine.test.ts
```

Expected:
```
✓ src/lib/agent/VerificationEngine.test.ts (9)
Tests  9 passed (9)
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/VerificationEngine.ts src/lib/agent/VerificationEngine.test.ts
git commit -m "feat: add VerificationEngine with mutation and result-shape checks"
```

---

## Task 5: Add 3 New LLM Tools to `toolDefinitions.ts`

**Files:**
- Modify: `src/lib/agent/toolDefinitions.ts`

- [ ] **Step 1: Append the three new tools to the `AGENT_TOOLS` array**

Open `src/lib/agent/toolDefinitions.ts`. At the end of the `AGENT_TOOLS` array, before the closing `];`, add:

```typescript
  // ── Task planning & verification ─────────────────────────────────────────

  {
    name: "create_task_plan",
    description:
      "Declare a multi-step plan before starting execution. Call this first for any goal requiring more than one database operation. Each subtask is a focused goal string. Do NOT call this for simple single-turn questions.",
    parameters: {
      type: "object",
      properties: {
        subtasks: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of subtask goals, each a single focused action",
        } as any,
      },
      required: ["subtasks"],
    },
  },
  {
    name: "verify_result",
    description:
      "After a mutation (INSERT, UPDATE, DELETE, ALTER TABLE, CREATE INDEX, DROP COLUMN), declare what you expect to see in the database. The system will run this check and retry if it fails.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SELECT query that should return rows if the mutation succeeded",
        },
        expectedMinRows: {
          type: "number",
          description: "Minimum rows the SELECT should return (default: 1)",
        },
        description: {
          type: "string",
          description: "Human-readable description of what you are verifying",
        },
      },
      required: ["sql", "description"],
    },
  },
  {
    name: "request_clarification",
    description:
      "Ask the user a question when you need input to proceed. Pauses the task until the user responds.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user",
        },
        context: {
          type: "string",
          description: "Why you need this information",
        },
      },
      required: ["question"],
    },
  },
```

- [ ] **Step 2: Verify type-check passes**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/toolDefinitions.ts
git commit -m "feat: add create_task_plan, verify_result, request_clarification LLM tools"
```

---

## Task 6: Add `currentTask` State to `WorkspaceStore.ts`

**Files:**
- Modify: `src/lib/stores/WorkspaceStore.ts`

- [ ] **Step 1: Add Task import at the top of `WorkspaceStore.ts`**

At line 8 (after the existing imports), add:

```typescript
import type { Task } from "../agent/TaskState";
```

- [ ] **Step 2: Add currentTask fields to the `WorkspaceState` interface**

After the `chartRequest` / `setChartRequest` block in the interface (around line 70), add:

```typescript
  // Task Engine state
  currentTask: Task | null;
  setTask: (task: Task) => void;
  updateCurrentTask: (task: Task) => void;
  clearTask: () => void;
```

- [ ] **Step 3: Add initializer in the store body**

In the `create<WorkspaceState>()(immer((set) => ({` block, after `chartRequest: null,` add:

```typescript
    currentTask: null,
```

- [ ] **Step 4: Add the three action implementations**

After the `setChartRequest` action, add:

```typescript
    setTask: (task) =>
      set((state) => {
        state.currentTask = task as any;
      }),

    updateCurrentTask: (task) =>
      set((state) => {
        state.currentTask = task as any;
      }),

    clearTask: () =>
      set((state) => {
        state.currentTask = null;
      }),
```

- [ ] **Step 5: Verify type-check passes**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/WorkspaceStore.ts
git commit -m "feat: add currentTask state to WorkspaceStore (setTask, updateCurrentTask, clearTask)"
```

---

## Task 7: Modify `AgentLoop.ts` to Handle the 3 Special Tools

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

The 3 new LLM tools (`create_task_plan`, `verify_result`, `request_clarification`) need special handling inside the loop — they do NOT go through CommandBus. TaskEngine provides callbacks via an optional `taskContext` field on `AgentLoopOptions`.

- [ ] **Step 1: Add `TaskContext` type and `taskContext` field to `AgentLoopOptions`**

After the existing imports at the top of `AgentLoop.ts`, add the import:

```typescript
import type { VerifyResultParams, VerificationResult } from "./TaskState";
```

Then, inside the `AgentLoopOptions` interface (after `onPlanQueued`), add:

```typescript
  /**
   * Optional context provided by TaskEngine. When set, the three special
   * task tools (create_task_plan, verify_result, request_clarification) are
   * intercepted and handled via these callbacks instead of CommandBus.
   */
  taskContext?: {
    onPlanCreated: (subtasks: string[]) => void;
    onVerifyRequested: (params: VerifyResultParams) => Promise<VerificationResult>;
    onClarificationNeeded: (question: string, context?: string) => Promise<string>;
  };
```

- [ ] **Step 2: Intercept the 3 special tools in the tool execution loop**

In `runAgentLoop`, find the `for (const tc of toolCalls)` loop. At the top of the loop body (before the `const cmd = toolCallToCommand(...)` line), add:

```typescript
      // ── Special task tools (handled by TaskEngine, not CommandBus) ──────
      if (tc.name === "create_task_plan" && options.taskContext) {
        const subtasks = (tc.input as { subtasks: string[] }).subtasks;
        options.taskContext.onPlanCreated(subtasks);
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: JSON.stringify({ status: "plan_created", subtaskCount: subtasks.length }),
          isError: false,
        });
        continue;
      }

      if (tc.name === "verify_result" && options.taskContext) {
        const params = tc.input as VerifyResultParams;
        onToolStart(tc.name, tc.input);
        const vr = await options.taskContext.onVerifyRequested(params);
        onToolEnd(tc.name, { success: vr.passed, result: vr.diagnosis, error: vr.passed ? undefined : vr.diagnosis });
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: JSON.stringify(vr),
          isError: false,
        });
        continue;
      }

      if (tc.name === "request_clarification" && options.taskContext) {
        const { question, context } = tc.input as { question: string; context?: string };
        onToolStart(tc.name, tc.input);
        const answer = await options.taskContext.onClarificationNeeded(question, context);
        onToolEnd(tc.name, { success: true, result: answer });
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: JSON.stringify({ answer }),
          isError: false,
        });
        continue;
      }
```

- [ ] **Step 3: Verify type-check passes**

```bash
npm run lint
```

Expected: no errors. If there is a type error on `toolResults!.push` because `toolResults` is defined below where you're adding the code, move the intercept block to AFTER `const toolResults: ConversationTurn["toolResults"] = [];`.

The correct placement: the intercept block goes AFTER `const toolResults: ConversationTurn["toolResults"] = [];` and BEFORE `for (const tc of toolCalls)`.

Wait — actually the intercept is INSIDE the `for (const tc of toolCalls)` loop. The structure is:

```typescript
// Execute tools and collect results
const toolResults: ConversationTurn["toolResults"] = [];

for (const tc of toolCalls) {
  // ── INSERT INTERCEPT BLOCK HERE ──

  const cmd = toolCallToCommand(tc, connectionId);
  // ... rest of existing code
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/AgentLoop.ts
git commit -m "feat: intercept create_task_plan/verify_result/request_clarification in AgentLoop via taskContext callbacks"
```

---

## Task 8: Create `TaskEngine.ts` with Integration Tests

**Files:**
- Create: `src/lib/agent/TaskEngine.ts`
- Create: `src/lib/agent/TaskEngine.test.ts`

- [ ] **Step 1: Write failing integration tests**

```typescript
// src/lib/agent/TaskEngine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./AgentLoop", () => ({
  runAgentLoop: vi.fn(),
}));
vi.mock("./VerificationEngine", () => ({
  verifyMutation: vi.fn(),
}));
vi.mock("../stores/WorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      setTask: vi.fn(),
      updateCurrentTask: vi.fn(),
      clearTask: vi.fn(),
      addPlanStep: vi.fn(),
      agentMode: "auto",
    })),
  },
}));

import { runTaskEngine } from "./TaskEngine";
import { runAgentLoop } from "./AgentLoop";
import { verifyMutation } from "./VerificationEngine";
import { useWorkspaceStore } from "../stores/WorkspaceStore";

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockVerifyMutation = vi.mocked(verifyMutation);

function makeOptions() {
  return {
    provider: {} as any,
    model: "test-model",
    connectionId: "conn-1",
    schema: null,
    currentSQL: null,
    currentResults: null,
    onToken: vi.fn(),
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onPlanQueued: vi.fn(),
  };
}

describe("runTaskEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls through to AgentLoop when no create_task_plan is called", async () => {
    // AgentLoop returns without calling onPlanCreated
    mockRunAgentLoop.mockResolvedValue({
      finalText: "Here are your tables.",
      updatedHistory: [],
    });

    const result = await runTaskEngine("show me all tables", [], makeOptions());

    expect(result.finalText).toBe("Here are your tables.");
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    // WorkspaceStore.setTask should NOT have been called
    const store = useWorkspaceStore.getState();
    expect(store.setTask).not.toHaveBeenCalled();
  });

  it("activates state machine when create_task_plan is called", async () => {
    // First call (round 0): LLM calls create_task_plan via taskContext callback
    mockRunAgentLoop.mockImplementationOnce(async (msg, history, opts) => {
      // Simulate LLM calling create_task_plan
      opts.taskContext!.onPlanCreated(["Explore schema", "Run analysis"]);
      return { finalText: "Planning complete.", updatedHistory: [] };
    });

    // Second call (subtask 0): succeeds
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, _opts) => {
      return { finalText: "Schema explored.", updatedHistory: [] };
    });

    // Third call (subtask 1): succeeds
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, _opts) => {
      return { finalText: "Analysis done.", updatedHistory: [] };
    });

    const store = useWorkspaceStore.getState();
    const result = await runTaskEngine("analyze my database", [], makeOptions());

    expect(mockRunAgentLoop).toHaveBeenCalledTimes(3);
    expect(store.setTask).toHaveBeenCalled();
    expect(store.clearTask).toHaveBeenCalled();
    expect(result.finalText).toContain("Schema explored.");
    expect(result.finalText).toContain("Analysis done.");
  });

  it("auto-retries safe subtask after verification failure then success", async () => {
    // Round 0: plan created
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, opts) => {
      opts.taskContext!.onPlanCreated(["Add index"]);
      return { finalText: "Plan ready.", updatedHistory: [] };
    });

    // Subtask attempt 1: LLM calls verify_result → fails
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, opts) => {
      const vr = await opts.taskContext!.onVerifyRequested({
        sql: "SELECT 1 FROM pg_indexes WHERE indexname='idx_users'",
        description: "Check index exists",
      });
      expect(vr.passed).toBe(false); // VerificationEngine will say fail
      return { finalText: "Index created.", updatedHistory: [] };
    });

    // Subtask attempt 2 (retry): LLM calls verify_result → passes
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, opts) => {
      const vr = await opts.taskContext!.onVerifyRequested({
        sql: "SELECT 1 FROM pg_indexes WHERE indexname='idx_users'",
        description: "Check index exists",
      });
      expect(vr.passed).toBe(true);
      return { finalText: "Index verified.", updatedHistory: [] };
    });

    // VerificationEngine: fail first, pass second
    mockVerifyMutation
      .mockResolvedValueOnce({ passed: false, actual: [], diagnosis: "Index not found" })
      .mockResolvedValueOnce({ passed: true, actual: [{ ok: 1 }], diagnosis: "OK" });

    const opts = makeOptions();
    await runTaskEngine("add index", [], opts);

    expect(mockRunAgentLoop).toHaveBeenCalledTimes(3); // plan + 2 subtask attempts
    expect(opts.onToken).toHaveBeenCalledWith(expect.stringContaining("Index not found"));
  });

  it("skips re-execution on retry if sql+result already set (idempotency)", async () => {
    // Round 0: plan created
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, opts) => {
      opts.taskContext!.onPlanCreated(["Insert row"]);
      return { finalText: "Plan ready.", updatedHistory: [] };
    });

    // Subtask attempt 1: executes, verify_result called, verification fails
    mockRunAgentLoop.mockImplementationOnce(async (_msg, _history, opts) => {
      // Simulate SQL was captured
      await opts.taskContext!.onVerifyRequested({ sql: "SELECT 1", description: "check" });
      return { finalText: "Row inserted.", updatedHistory: [] };
    });

    // Subtask attempt 2 (retry): SHOULD NOT call AgentLoop again if idempotency kicks in
    // But since sql+result are set, TaskEngine re-verifies directly via VerificationEngine

    mockVerifyMutation
      .mockResolvedValueOnce({ passed: false, actual: [], diagnosis: "Row not found" })
      .mockResolvedValueOnce({ passed: true, actual: [{}], diagnosis: "OK" });

    await runTaskEngine("insert row", [], makeOptions());

    // Round 0 (plan) + 1 subtask execution = 2 calls to AgentLoop
    // The re-verify should happen without a 3rd AgentLoop call
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npm test src/lib/agent/TaskEngine.test.ts
```

Expected: FAIL with "Cannot find module './TaskEngine'"

- [ ] **Step 3: Implement `TaskEngine.ts`**

```typescript
// src/lib/agent/TaskEngine.ts
import { runAgentLoop, type AgentLoopOptions } from "./AgentLoop";
import { verifyMutation } from "./VerificationEngine";
import { decide } from "./RetryPolicy";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { Task, SubTask, AuditEntry, SubTaskStatus, VerifyResultParams } from "./TaskState";
import type { ConversationTurn } from "../ai/types";

const RISKY_TOOLS = new Set(["delete_rows", "drop_column", "bulk_transform", "update_cell"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSubTask(id: string, goal: string): SubTask {
  return {
    id,
    goal,
    status: "pending",
    retryCount: 0,
    maxRetries: 3,
    isRisky: false,
    auditLog: [],
  };
}

function addAudit(subtask: SubTask, state: SubTaskStatus, note?: string): void {
  const entry: AuditEntry = { state, timestamp: Date.now(), note };
  subtask.auditLog.push(entry);
  subtask.status = state;
}

function notify(store: ReturnType<typeof useWorkspaceStore.getState>, task: Task): void {
  store.updateCurrentTask({ ...task, subtasks: task.subtasks.map((st) => ({ ...st })) });
}

function persistAuditLog(task: Task): void {
  try {
    const key = "daitalk_task_audit";
    const raw = localStorage.getItem(key);
    const history: Task[] = raw ? JSON.parse(raw) : [];
    history.unshift(task);
    // Keep last 10 tasks; cap total audit entries at 500
    const trimmed = history.slice(0, 10);
    let totalEntries = 0;
    for (const t of trimmed) {
      for (const st of t.subtasks) totalEntries += st.auditLog.length;
    }
    while (totalEntries > 500 && trimmed.length > 1) {
      const removed = trimmed.pop()!;
      for (const st of removed.subtasks) totalEntries -= st.auditLog.length;
    }
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // localStorage may be unavailable in some environments — ignore
  }
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export async function runTaskEngine(
  userMessage: string,
  history: ConversationTurn[],
  options: AgentLoopOptions
): Promise<{ finalText: string; updatedHistory: ConversationTurn[] }> {
  const store = useWorkspaceStore.getState();
  let capturedPlan: string[] | null = null;

  // Round 0: run AgentLoop with taskContext so create_task_plan can be intercepted
  const planResult = await runAgentLoop(userMessage, history, {
    ...options,
    taskContext: {
      onPlanCreated: (subtasks) => {
        capturedPlan = subtasks;
      },
      onVerifyRequested: async () => ({ passed: true, actual: null, diagnosis: "no-op in planning phase" }),
      onClarificationNeeded: async () => "",
    },
  });

  // If no plan was created, return directly — identical to current behavior
  if (!capturedPlan) {
    return planResult;
  }

  // Initialize Task
  const task: Task = {
    id: `task-${Date.now()}`,
    userGoal: userMessage,
    subtasks: capturedPlan.map((goal, i) => makeSubTask(`st-${i}`, goal)),
    currentIndex: 0,
    status: "running",
  };
  store.setTask(task);
  notify(store, task);

  let finalText = planResult.finalText;
  let workingHistory = planResult.updatedHistory;

  // Execute each subtask in sequence
  for (let i = 0; i < task.subtasks.length; i++) {
    task.currentIndex = i;
    const subtask = task.subtasks[i];
    addAudit(subtask, "executing");
    notify(store, task);

    let succeeded = false;

    while (!succeeded) {
      // Idempotency: if sql+result are already captured, skip to re-verification
      const shouldSkipExecution = subtask.sql !== undefined && subtask.result !== undefined;

      let lastVerificationResult: { passed: boolean; actual: unknown; diagnosis: string } | null = null;

      if (!shouldSkipExecution) {
        // Track whether any risky tool was called during this subtask
        let subtaskIsRisky = false;

        const subtaskResult = await runAgentLoop(subtask.goal, workingHistory, {
          ...options,
          onToolStart: (toolName, input) => {
            if (RISKY_TOOLS.has(toolName)) subtaskIsRisky = true;
            // Capture the SQL for idempotency — look for sql property in any tool input
            if (input && typeof input === "object" && "sql" in input) {
              subtask.sql = (input as { sql: string }).sql;
            }
            options.onToolStart(toolName, input);
          },
          taskContext: {
            onPlanCreated: () => {}, // nested plans ignored
            onVerifyRequested: async (params: VerifyResultParams) => {
              addAudit(subtask, "verifying");
              notify(store, task);
              const vr = await verifyMutation(options.connectionId!, {
                sql: params.sql,
                expectedMinRows: params.expectedMinRows,
              });
              lastVerificationResult = vr;
              subtask.verificationPassed = vr.passed;
              subtask.diagnosis = vr.diagnosis;
              return vr;
            },
            onClarificationNeeded: async (question, context) => {
              // Queue as a plan step and pause — returns empty string for now
              // (full async-pause implementation is out of scope for v1)
              const stepId = `clarify-${Date.now()}`;
              store.addPlanStep({
                id: stepId,
                commandType: "request_clarification",
                humanReadable: question,
                riskLevel: "safe",
                status: "pending",
              });
              options.onPlanQueued(stepId, question + (context ? ` (${context})` : ""));
              return "";
            },
          },
        });

        subtask.isRisky = subtaskIsRisky;
        subtask.result = subtaskResult.finalText;
        workingHistory = subtaskResult.updatedHistory;
        finalText += (finalText ? "\n" : "") + subtaskResult.finalText;
      }

      // If verify_result was called during execution, we have a result already
      if (lastVerificationResult !== null) {
        if (lastVerificationResult.passed) {
          addAudit(subtask, "complete", "Verification passed");
          notify(store, task);
          succeeded = true;
        } else {
          // Handle retry
          const decision = decide(subtask, lastVerificationResult);

          if (decision.action === "auto_retry") {
            const diagnosis = lastVerificationResult.diagnosis;
            options.onToken(
              `\n\n⚠ Verification failed: ${diagnosis}. Adjusting and retrying…\n\n`
            );
            addAudit(subtask, "retry_requested", diagnosis);
            subtask.retryCount += 1;
            // Clear result so execution re-runs
            subtask.result = undefined;
            subtask.sql = undefined;
            notify(store, task);
          } else if (decision.action === "ask_user") {
            const stepId = `retry-${Date.now()}`;
            const proposal = (decision as { action: "ask_user"; proposal: string }).proposal;
            store.addPlanStep({
              id: stepId,
              commandType: "retry_approval",
              humanReadable: `Retry subtask "${subtask.goal}"? Diagnosis: ${proposal}`,
              riskLevel: "destructive",
              status: "pending",
            });
            options.onPlanQueued(stepId, proposal);
            addAudit(subtask, "awaiting_approval", proposal);
            notify(store, task);
            // For v1, treat awaiting_approval as failed (user approval is async)
            addAudit(subtask, "failed", "Awaiting user approval — task paused");
            task.status = "failed";
            notify(store, task);
            persistAuditLog(task);
            store.clearTask();
            return { finalText, updatedHistory: workingHistory };
          } else {
            // fail
            const reason = (decision as { action: "fail"; reason: string }).reason;
            addAudit(subtask, "failed", reason);
            task.status = "failed";
            options.onToken(`\n\n✗ Subtask failed: ${reason}\n\n`);
            notify(store, task);
            persistAuditLog(task);
            store.clearTask();
            return { finalText, updatedHistory: workingHistory };
          }
        }
      } else {
        // No verify_result was called — subtask passes trivially
        addAudit(subtask, "complete", "No verification declared — passed trivially");
        notify(store, task);
        succeeded = true;
      }
    }
  }

  // All subtasks complete
  task.status = "complete";
  notify(store, task);
  persistAuditLog(task);
  store.clearTask();

  return { finalText, updatedHistory: workingHistory };
}
```

- [ ] **Step 4: Run integration tests**

```bash
npm test src/lib/agent/TaskEngine.test.ts
```

Expected:
```
✓ src/lib/agent/TaskEngine.test.ts (4)
Tests  4 passed (4)
```

If tests fail, check that `useWorkspaceStore.getState()` mock is being called within the function body (not at import time).

- [ ] **Step 5: Run all tests to confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/TaskEngine.ts src/lib/agent/TaskEngine.test.ts
git commit -m "feat: add TaskEngine state machine (plan→execute→verify→retry) with integration tests"
```

---

## Task 9: Create `TaskProgressPanel.tsx` and Update `AIChat.tsx`

**Files:**
- Create: `src/components/ai/TaskProgressPanel.tsx`
- Modify: `src/components/ai/AIChat.tsx`

- [ ] **Step 1: Create `TaskProgressPanel.tsx`**

```tsx
// src/components/ai/TaskProgressPanel.tsx
import React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Circle, X } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import type { SubTask, SubTaskStatus } from "../../lib/agent/TaskState";

function StatusIcon({ status }: { status: SubTaskStatus }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    case "awaiting_approval":
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case "executing":
    case "verifying":
    case "planning":
    case "retry_requested":
      return <Loader2 className="w-3.5 h-3.5 text-[#00d2ff] animate-spin shrink-0" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-white/20 shrink-0" />;
  }
}

function SubTaskRow({ subtask }: { subtask: SubTask }) {
  const isActive = ["executing", "verifying", "planning", "retry_requested"].includes(subtask.status);

  return (
    <div className={`flex items-center gap-2 py-0.5 ${isActive ? "text-white/80" : "text-white/40"}`}>
      <StatusIcon status={subtask.status} />
      <span className="text-xs font-mono truncate flex-1">{subtask.goal}</span>
      {subtask.retryCount > 0 && (
        <span className="text-[10px] text-amber-400 font-mono shrink-0">
          [retrying {subtask.retryCount}/3]
        </span>
      )}
    </div>
  );
}

export function TaskProgressPanel() {
  const { currentTask, clearTask } = useWorkspaceStore();

  if (!currentTask) return null;

  const goal =
    currentTask.userGoal.length > 60
      ? currentTask.userGoal.slice(0, 57) + "…"
      : currentTask.userGoal;

  return (
    <div className="mx-0 mb-3 rounded-lg border border-[#262626] bg-[#111] p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
          Task Plan
        </span>
        <button
          onClick={clearTask}
          title="Dismiss task panel (does not cancel execution)"
          className="text-white/20 hover:text-white/60 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Goal */}
      <p className="text-xs text-white/60 font-mono mb-2 truncate">{goal}</p>

      {/* Subtasks */}
      <div className="space-y-0.5">
        {currentTask.subtasks.map((st) => (
          <SubTaskRow key={st.id} subtask={st} />
        ))}
      </div>

      {/* Overall status */}
      {currentTask.status === "failed" && (
        <p className="mt-2 text-[10px] text-red-400 font-mono">Task failed — see chat for details.</p>
      )}
      {currentTask.status === "complete" && (
        <p className="mt-2 text-[10px] text-emerald-400 font-mono">All steps complete.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `AIChat.tsx` — change import and render TaskProgressPanel**

In `src/components/ai/AIChat.tsx`:

**a)** Replace the `runAgentLoop` import:

Old (line 14):
```typescript
import { runAgentLoop } from "../../lib/agent/AgentLoop";
```

New:
```typescript
import { runTaskEngine } from "../../lib/agent/TaskEngine";
```

**b)** Add the TaskProgressPanel import after the existing AI imports:

```typescript
import { TaskProgressPanel } from "./TaskProgressPanel";
```

**c)** Also add `currentTask` to the useWorkspaceStore destructure. Find line 126:

Old:
```typescript
  const { agentMode, undoStack, popUndo } = useWorkspaceStore();
```

New:
```typescript
  const { agentMode, undoStack, popUndo, currentTask } = useWorkspaceStore();
```

**d)** Replace the `runAgentLoop` call inside `handleSend` (around line 222):

Old:
```typescript
      const { updatedHistory } = await runAgentLoop(userMsg, historyRef.current, {
```

New:
```typescript
      const { updatedHistory } = await runTaskEngine(userMsg, historyRef.current, {
```

**e)** Render `TaskProgressPanel` above the message list. Find the `<div ref={scrollRef} ...>` (around line 285). Wrap the content so that `TaskProgressPanel` appears above `messages.map(...)`:

Old:
```tsx
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => {
```

New:
```tsx
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {currentTask && <TaskProgressPanel />}
        {messages.map((msg) => {
```

- [ ] **Step 3: Verify type-check passes**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/TaskProgressPanel.tsx src/components/ai/AIChat.tsx
git commit -m "feat: add TaskProgressPanel inline UI and wire AIChat to TaskEngine"
```

---

## Task 10: Regression Tests and Full Test Run

**Files:**
- Create: `src/lib/agent/AgentLoop.regression.test.ts`

- [ ] **Step 1: Write regression tests for single-turn behavior**

```typescript
// src/lib/agent/AgentLoop.regression.test.ts
/**
 * Regression tests: single-turn messages must behave identically to
 * before the agentic loop upgrade. TaskEngine must pass through when
 * create_task_plan is never called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./AgentLoop", () => ({
  runAgentLoop: vi.fn(),
}));
vi.mock("./VerificationEngine", () => ({
  verifyMutation: vi.fn(),
}));
vi.mock("../stores/WorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      setTask: vi.fn(),
      updateCurrentTask: vi.fn(),
      clearTask: vi.fn(),
      addPlanStep: vi.fn(),
      agentMode: "auto",
    })),
  },
}));

import { runTaskEngine } from "./TaskEngine";
import { runAgentLoop } from "./AgentLoop";
import { useWorkspaceStore } from "../stores/WorkspaceStore";

const mockAgentLoop = vi.mocked(runAgentLoop);

function makeOptions() {
  return {
    provider: {} as any,
    model: "test-model",
    connectionId: "conn-1",
    schema: null,
    currentSQL: null,
    currentResults: null,
    onToken: vi.fn(),
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onPlanQueued: vi.fn(),
  };
}

describe("regression: single-turn messages bypass TaskEngine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the exact same result as AgentLoop when no plan is created", async () => {
    const expected = {
      finalText: "You have 3 tables: users, orders, products.",
      updatedHistory: [{ role: "user" as const, text: "what tables?" }],
    };
    mockAgentLoop.mockResolvedValue(expected);

    const result = await runTaskEngine("what tables?", [], makeOptions());

    expect(result.finalText).toBe(expected.finalText);
    expect(result.updatedHistory).toBe(expected.updatedHistory);
    expect(mockAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("does NOT call setTask for simple messages", async () => {
    mockAgentLoop.mockResolvedValue({ finalText: "ok", updatedHistory: [] });

    await runTaskEngine("explain SQL joins", [], makeOptions());

    const store = useWorkspaceStore.getState();
    expect(store.setTask).not.toHaveBeenCalled();
    expect(store.clearTask).not.toHaveBeenCalled();
  });

  it("passes history through unchanged for simple messages", async () => {
    const history = [
      { role: "user" as const, text: "previous message" },
      { role: "assistant" as const, text: "previous reply" },
    ];
    mockAgentLoop.mockResolvedValue({ finalText: "ok", updatedHistory: history });

    const result = await runTaskEngine("follow-up question", history, makeOptions());

    // The first argument passed to runAgentLoop should be the user message
    expect(mockAgentLoop.mock.calls[0][0]).toBe("follow-up question");
    // The second argument should be the original history
    expect(mockAgentLoop.mock.calls[0][1]).toBe(history);
    expect(result.updatedHistory).toBe(history);
  });
});

describe("regression: Plan Mode queue still receives destructive commands", () => {
  it("onPlanQueued callback is passed through to AgentLoop options", async () => {
    const onPlanQueued = vi.fn();
    mockAgentLoop.mockResolvedValue({ finalText: "queued", updatedHistory: [] });

    await runTaskEngine("delete all rows", [], { ...makeOptions(), onPlanQueued });

    // onPlanQueued is passed as part of options to AgentLoop
    const optionsPassed = mockAgentLoop.mock.calls[0][2];
    expect(optionsPassed.onPlanQueued).toBe(onPlanQueued);
  });
});
```

- [ ] **Step 2: Run regression tests**

```bash
npm test src/lib/agent/AgentLoop.regression.test.ts
```

Expected:
```
✓ src/lib/agent/AgentLoop.regression.test.ts (4)
Tests  4 passed (4)
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected:
```
✓ src/lib/agent/RetryPolicy.test.ts (5)
✓ src/lib/agent/VerificationEngine.test.ts (9)
✓ src/lib/agent/TaskEngine.test.ts (4)
✓ src/lib/agent/AgentLoop.regression.test.ts (4)

Test Files  4 passed (4)
Tests       22 passed (22)
```

- [ ] **Step 4: Verify full app type-check**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/AgentLoop.regression.test.ts
git commit -m "test: regression tests for single-turn pass-through behavior"
```

---

## Task 11: Manual Smoke Tests in the Running App

Run `npm run tauri:dev` and verify these scenarios manually.

- [ ] **Scenario 1 — Single-turn (no task panel)**

  Ask: `"what tables do I have?"`
  Expected: normal streaming response, NO task progress panel appears.

- [ ] **Scenario 2 — Multi-step task (task panel appears)**

  Ask: `"Find all tables with no primary key and report them"`
  Expected:
  - Task progress panel appears above response text
  - Shows subtasks with `⟳` (spinning) on active one, `✓` on completed ones
  - Panel dismisses or shows "All steps complete" when done

- [ ] **Scenario 3 — Schema mutation with verification**

  Ask: `"Add a column called 'archived' of type boolean to the users table"`
  Expected: Agent calls `add_column` then `verify_result`, panel shows verifying state

- [ ] **Scenario 4 — Plan Mode queue unchanged**

  Switch to Plan Mode, ask: `"delete all rows from the test table"`
  Expected: destructive command still appears in Plan Queue for approval (unchanged behavior)

- [ ] **Scenario 5 — Dismiss button**

  During an active task, click `[×]` on the task panel
  Expected: panel hides, task continues executing in background (no crash)

---

## Self-Review

### Spec Coverage Check

| Spec Section | Covered By |
|---|---|
| Section A — State machine types | Task 2 (TaskState.ts) |
| Section A — States: pending/executing/verifying/complete/failed/retry_requested/awaiting_approval | Task 2 + Task 8 |
| Section A — AuditEntry | Task 2 |
| Section B — TaskEngine flow (planning round 0, fallthrough) | Task 8 |
| Section B — Idempotency (skip re-execution if sql+result set) | Task 8 |
| Section C — VerificationEngine mutation check | Task 4 |
| Section C — VerificationEngine result-shape check | Task 4 |
| Section C — 10s timeout | Task 4 |
| Section D — RetryPolicy all branches | Task 3 |
| Section D — isRisky detection via tool names | Task 8 |
| Section D — Auto-retry streaming diagnosis | Task 8 |
| Section D — ask_user routed through addPlanStep | Task 8 |
| Section E — create_task_plan tool | Task 5 + Task 7 |
| Section E — verify_result tool | Task 5 + Task 7 |
| Section E — request_clarification tool | Task 5 + Task 7 |
| Section F — TaskProgressPanel inline UI | Task 9 |
| Section F — Icons (○ ⟳ ✓ ✗ ⚠) | Task 9 |
| Section F — Retry counter [retrying N/3] | Task 9 |
| Section F — Dismiss [×] button | Task 9 |
| Section G — Audit log persisted to localStorage | Task 8 |
| Section H — Simple messages bypass TaskEngine | Task 10 (regression) |
| Section H — Plan Mode queue unchanged | Task 10 (regression) |
| Section H — Undo stack unchanged | Not tested explicitly — AgentLoop unchanged, undo still pushes in AgentLoop |
| Section H — MongoDB/Redis skip verify_result | Not implemented explicitly — verify_result only runs when LLM calls it, so dialect-safe by design |
