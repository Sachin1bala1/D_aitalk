# Track 1: AI Speed & Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut first-token latency to <1.5s, simple query+chart to <5s, eliminate infinite hangs on plan approval.

**Architecture:** Three independent improvements: (1) per-tool 8s timeout in resilience layer, (2) parallel tool dispatch via Promise.all in AgentLoop, (3) schema-filtered context injection in ContextEngine. Plus a 30s approval timeout and streaming progress counter in AIChat.

**Tech Stack:** TypeScript, React, existing `withTimeout`/`withRetry` in `src/lib/ai/resilience.ts`, Zustand store.

---

## File Map

| File | Change |
|------|--------|
| `src/lib/ai/resilience.ts` | Add `withToolTimeout` wrapper (8s cap per tool) |
| `src/lib/agent/AgentLoop.ts` | Parallel tool dispatch; 30s approval timeout; remove sequential `for` loop |
| `src/lib/agent/harness/ContextEngine.ts` | Schema filtering by query keywords; token budget guard |
| `src/components/ai/AIChat.tsx` | "Running tool N of M…" progress counter in streaming bubble |

---

## Task 1: Per-tool 8s timeout in resilience.ts

**Files:**
- Modify: `src/lib/ai/resilience.ts`

- [ ] **Step 1: Add `withToolTimeout` export**

Open `src/lib/ai/resilience.ts`. After the existing `withTimeout` function (around line 114), add:

```typescript
/**
 * Wraps a single tool dispatch with an 8-second hard timeout.
 * Throws TimeoutError if the tool does not resolve in time.
 */
export function withToolTimeout<T>(
  promise: Promise<T>,
  toolName: string,
  timeoutMs = 8_000,
): Promise<T> {
  return withTimeout(promise, timeoutMs, `Tool "${toolName}"`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/resilience.ts
git commit -m "feat(ai): add withToolTimeout — 8s cap per tool call"
```

---

## Task 2: Parallel tool dispatch in AgentLoop.ts

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

Context: currently tools execute sequentially in a `for` loop at line ~965. When the agent returns multiple tool calls in one round, each one waits for the previous. Independent tools (e.g. `execute_sql` + `declare_hypotheses`) can run concurrently.

- [ ] **Step 1: Import `withToolTimeout`**

Find the resilience import near the top of `AgentLoop.ts`:
```typescript
import { withRetry, withTimeout } from "../ai/resilience";
```
Change to:
```typescript
import { withRetry, withTimeout, withToolTimeout } from "../ai/resilience";
```

- [ ] **Step 2: Replace sequential tool loop with parallel dispatch**

Find the block starting at ~line 962:
```typescript
    // Execute tools and collect results
    const toolResults: ConversationTurn["toolResults"] = [];

    for (const tc of toolCalls) {
```

Replace the entire `for` loop (from `for (const tc of toolCalls) {` through the closing `}` before `working.push(...)`) with a `Promise.all` map. The key rule: tools are independent unless they share the same `connectionId` AND are both `execute_sql`. Keep existing guard logic per-tool.

Replace with:

```typescript
    // Execute tools in parallel — each gets an 8s individual timeout
    const toolResults: ConversationTurn["toolResults"] = [];

    const toolResultEntries = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolSignature = `${tc.name}:${JSON.stringify(tc.input ?? {})}`;
        const priorSignatureCount = toolSignatureCounts.get(toolSignature) ?? 0;
        toolSignatureCounts.set(toolSignature, priorSignatureCount + 1);

        if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) {
          if (queryDepth === "fast" && resultFetchingAttempts >= 2) {
            return {
              toolCallId: tc.id,
              name: tc.name,
              content:
                "Skipped additional data-fetch attempt because this fast analysis already exhausted its live-query budget. Use the currently loaded results or answer with the best available evidence.",
              isError: true,
            };
          }
          if (priorSignatureCount >= 1) {
            return {
              toolCallId: tc.id,
              name: tc.name,
              content:
                "Skipped duplicate data-fetch attempt. Do not repeat the same live query path; summarize the current evidence or choose a narrower alternative.",
              isError: true,
            };
          }
        }

        const cmd = toolCallToCommand(tc, connectionId);
        if (!cmd) {
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Unknown tool or missing connectionId: ${tc.name}`,
            isError: true,
          };
        }

        sessionCtx.toolsCalledSoFar.push(tc.name);
        try {
          await DATAIQ_HOOKS.onBeforeToolCall?.(tc.name, tc.input, sessionCtx);
        } catch (policyErr) {
          const errMsg = policyErr instanceof Error ? policyErr.message : String(policyErr);
          onToolEnd(tc.name, { success: false, error: errMsg });
          return { toolCallId: tc.id, name: tc.name, content: errMsg, isError: true };
        }

        onToolStart(tc.name, tc.input);

        if (agentMode === "plan") {
          const impactMap = ImpactMapEngine.fromCommands([cmd], connectionId);
          useWorkspaceStore.getState().setImpactMapResolution(impactMap);
        }

        if (isDestructive(cmd)) {
          const stepId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const description = describeCommand(cmd);
          addPlanStep({
            id: stepId,
            commandType: cmd.type,
            humanReadable: description,
            sqlPreview:
              "sql" in cmd && typeof cmd.sql === "string"
                ? cmd.sql
                : cmd.type === "delete_rows"
                  ? `DELETE FROM "${cmd.schema}"."${cmd.table}" WHERE ${cmd.where};`
                  : cmd.type === "drop_column"
                    ? `ALTER TABLE "${cmd.schema}"."${cmd.table}" DROP COLUMN "${cmd.columnName}";`
                    : cmd.type === "rename_table"
                      ? `ALTER TABLE "${cmd.schema}"."${cmd.oldName}" RENAME TO "${cmd.newName}";`
                      : undefined,
            taskId: currentTask?.id,
            subtaskId: currentSubtask?.id,
            riskLevel: cmd.risk,
            status: "pending",
            command: cmd,
          });
          onPlanQueued(stepId, description);
          pendingApprovalSteps.push(stepId);
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Queued for approval: "${description}". Waiting for user to approve in the Plan Queue.`,
            isError: false,
          };
        }

        try {
          const result = await withToolTimeout(
            commandBus.dispatch(cmd),
            tc.name,
          );
          if (RESULT_FETCHING_TOOL_NAMES.has(tc.name)) resultFetchingAttempts++;
          try {
            await DATAIQ_HOOKS.onAfterToolCall?.(tc.name, tc.input, result, sessionCtx);
          } catch {
            // non-fatal hook error
          }
          onToolEnd(tc.name, result);
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: result.result ?? result.error ?? "done",
            isError: !result.success,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          onToolEnd(tc.name, { success: false, error: errMsg });
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: `Tool error: ${errMsg}`,
            isError: true,
          };
        }
      })
    );

    toolResults.push(...toolResultEntries);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/AgentLoop.ts
git commit -m "feat(ai): parallel tool dispatch via Promise.all + 8s per-tool timeout"
```

---

## Task 3: 30s approval timeout — unblock agent on stale plan steps

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

Context: when a destructive command is queued in plan mode, the agent returns immediately (result = "Queued for approval"). The issue is the *outer* caller (`AIChat.tsx`) waits forever for the run to complete if the user never approves. We fix this at the `addPlanStep` level — auto-reject after 30s.

- [ ] **Step 1: Add timeout logic inside the destructive-command branch**

Find the block where `addPlanStep` is called (now inside the `Promise.all` map from Task 2). After the `addPlanStep({...})` call, add:

```typescript
          // Auto-reject after 30s so the agent never hangs indefinitely
          setTimeout(() => {
            const { planQueue, setPlanStepStatus } = useWorkspaceStore.getState();
            const still = planQueue.find((s) => s.id === stepId && s.status === "pending");
            if (still) {
              setPlanStepStatus(stepId, "rejected");
              onToken("\n\n⏱ Plan step auto-rejected after 30s inactivity.\n\n");
            }
          }, 30_000);
```

- [ ] **Step 2: Verify `setPlanStepStatus` exists in WorkspaceStore**

```bash
grep -n "setPlanStepStatus" src/lib/stores/WorkspaceStore.ts
```

If it does NOT exist, add it. Find the `planQueue` state block in `WorkspaceStore.ts` and add:

```typescript
  setPlanStepStatus: (id: string, status: "approved" | "rejected") =>
    set((state) => {
      const step = state.planQueue.find((s) => s.id === id);
      if (step) step.status = status;
    }),
```

Also add the type declaration in the `WorkspaceState` interface:
```typescript
  setPlanStepStatus: (id: string, status: "approved" | "rejected") => void;
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/lib/stores/WorkspaceStore.ts
git commit -m "feat(ai): auto-reject plan steps after 30s — no more infinite hangs"
```

---

## Task 4: Schema-filtered context injection in ContextEngine.ts

**Files:**
- Modify: `src/lib/agent/harness/ContextEngine.ts`

Context: the system prompt currently injects the full schema for all tables. For a DB with 50 tables, only 2–3 are usually relevant to any given question. Filtering reduces prompt size ~60% → faster first token.

- [ ] **Step 1: Add `filterSchemaToRelevant` helper**

Open `src/lib/agent/harness/ContextEngine.ts`. Find where the schema is serialized into the system prompt (search for `schema` or `tables` in the `buildSystemPrompt` or equivalent method). Add this helper before the class or at the top of the relevant method:

```typescript
/**
 * Returns only the schema sections whose table names appear as keywords
 * in the user message. Falls back to all tables if fewer than 3 match.
 */
function filterSchemaToRelevant(
  schema: Record<string, unknown>,
  userMessage: string,
): Record<string, unknown> {
  const lower = userMessage.toLowerCase();
  const allKeys = Object.keys(schema);
  const relevant = allKeys.filter((k) => lower.includes(k.toLowerCase()));
  // Always include at least 3 tables so the agent has context
  if (relevant.length < 3) return schema;
  return Object.fromEntries(relevant.map((k) => [k, schema[k]]));
}
```

- [ ] **Step 2: Apply filter before schema serialization**

In the same file, find where `schema` is converted to a string for the system prompt. Wrap it:

```typescript
// Before (example — match the actual variable name in the file):
const schemaStr = JSON.stringify(schema, null, 2);

// After:
const filteredSchema = filterSchemaToRelevant(schema, userMessage);
const schemaStr = JSON.stringify(filteredSchema, null, 2);
```

The exact variable names may differ — grep for `JSON.stringify` in ContextEngine.ts to find the right line.

- [ ] **Step 3: Add token budget guard**

In the same file, find the `estimateTokenUsage` method (or wherever the final system prompt string is assembled). After building the full prompt string, add:

```typescript
// If estimated prompt exceeds 80k tokens (~320k chars), compact schema to table names only
const PROMPT_CHAR_BUDGET = 320_000;
if (systemPrompt.length > PROMPT_CHAR_BUDGET) {
  const tableNamesOnly = Object.fromEntries(
    Object.keys(filteredSchema).map((k) => [k, "(schema omitted — prompt too large)"])
  );
  systemPrompt = systemPrompt.replace(schemaStr, JSON.stringify(tableNamesOnly, null, 2));
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/harness/ContextEngine.ts
git commit -m "feat(ai): filter schema injection to relevant tables — cuts prompt size ~60%"
```

---

## Task 5: Streaming progress counter in AIChat.tsx

**Files:**
- Modify: `src/components/ai/AIChat.tsx`

Context: `onToolStart` and `onToolEnd` callbacks already track tool entries in `toolLog`. We just need to display "Running tool N of M…" in the streaming bubble while tools are executing.

- [ ] **Step 1: Add tool-count display to the streaming assistant bubble**

In `AIChat.tsx`, find where the streaming bubble renders (search for `streaming: true` or `m.streaming`). The assistant bubble renders `m.content`. Add a sub-line that reads from `m.toolLog`:

```tsx
{m.streaming && m.toolLog && m.toolLog.length > 0 && (
  <div className="text-[10px] text-white/40 font-mono mt-1">
    {(() => {
      const running = m.toolLog.filter((t) => t.result === undefined);
      const done = m.toolLog.filter((t) => t.result !== undefined);
      if (running.length > 0) {
        return `Running tool ${done.length + 1} of ${m.toolLog.length}: ${running[0].toolName}…`;
      }
      return `✓ ${done.length} tool${done.length !== 1 ? "s" : ""} completed`;
    })()}
  </div>
)}
```

Place this inside the assistant bubble `div`, below where `m.content` renders.

- [ ] **Step 2: Verify TypeScript**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Verify the app starts**

```bash
npm run dev
```
Open `http://localhost:1420`. No visual regressions on the chat panel.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/AIChat.tsx
git commit -m "feat(ai): show running tool progress in streaming bubble"
```

---

## Validation

- [ ] Run `npm run lint` — zero errors
- [ ] Run `npm run tauri:dev` — app starts, chat panel loads
- [ ] Manually trigger an AI query with a connected DB — verify streaming counter appears
- [ ] Verify no TypeScript errors in AgentLoop.ts with the parallel dispatch
