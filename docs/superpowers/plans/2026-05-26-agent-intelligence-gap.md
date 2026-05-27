# Agent Intelligence Gap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between Daitalk's APEX agent and Cursor/Codex on self-correction, situational awareness, grounded responses, and proactive behaviour — without changing any UI chrome or Rust code.

**Architecture:** Five targeted injections into the agent loop and memory layer. Each is additive (new exported functions + wiring into existing call sites). No schema changes, no new files except tests. All changes stay in `AgentLoop.ts`, `EpisodicMemory.ts`, and `AIChat.tsx`.

**Tech Stack:** TypeScript, Vitest, Zustand (WorkspaceStore), existing agent loop in `src/lib/agent/AgentLoop.ts`

**Branch:** `integration/harness-merge` (current branch — do NOT switch)

**Test command:** `npm run test` (runs vitest once) — expected output: all tests pass

---

## File Map

| File | Change |
|------|--------|
| `src/lib/agent/AgentLoop.ts` | Add `buildReflectionGuidance`, `buildDataEvidence`, `buildOpenTabsSummary`, confidence tracking — all wired into `runAgentLoop` |
| `src/lib/agent/AgentLoop.test.ts` | Tests for all three new pure functions |
| `src/lib/memory/EpisodicMemory.ts` | Add `searchWithScores()` returning `{episode, score}[]` |
| `src/components/ai/AIChat.tsx` | Use `searchWithScores`, show proactive suggestion banner when score > 0.7 |

---

## Task 1: Reflection injection for empty/error tool results

**Purpose:** When `execute_sql` returns 0 rows OR any tool returns an error, append a structured reflection prompt to the tool result content. The agent reads this as part of the tool result and must diagnose the problem before taking its next action. This closes the "agent loops on failures" gap.

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/lib/agent/AgentLoop.test.ts`

- [ ] **Step 1: Write the failing tests for `buildReflectionGuidance`**

Add to `src/lib/agent/AgentLoop.test.ts` (after the existing `describe` blocks):

```typescript
import { buildReflectionGuidance } from "./AgentLoop";

describe("buildReflectionGuidance", () => {
  it("returns content unchanged for successful non-empty execute_sql", () => {
    const content = JSON.stringify({ rows: [{ a: 1 }], rowCount: 1 });
    expect(buildReflectionGuidance("execute_sql", content, false)).toBe(content);
  });

  it("appends ZERO RESULTS block when execute_sql returns empty rows", () => {
    const content = JSON.stringify({ rows: [], rowCount: 0, fields: [], elapsedMs: 5 });
    const out = buildReflectionGuidance("execute_sql", content, false);
    expect(out).toContain("ZERO RESULTS");
    expect(out).toContain("derived table");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION block on tool error", () => {
    const content = "Error: column not found";
    const out = buildReflectionGuidance("execute_sql", content, true);
    expect(out).toContain("ERROR REFLECTION");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION for non-execute_sql tool errors", () => {
    const content = "Error: connection refused";
    const out = buildReflectionGuidance("analyze_loaded_correlation", content, true);
    expect(out).toContain("ERROR REFLECTION");
  });

  it("returns content unchanged for successful non-execute_sql tool", () => {
    const content = JSON.stringify({ correlations: [{ column: "A", correlation: 0.9 }] });
    expect(buildReflectionGuidance("analyze_loaded_correlation", content, false)).toBe(content);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /c/Users/sachi/Documents/manufacturing_agent/daitalk-v2
npm run test -- AgentLoop.test.ts
```

Expected: FAIL — `buildReflectionGuidance is not exported`

- [ ] **Step 3: Add `buildReflectionGuidance` to `AgentLoop.ts`**

Add this function after `buildVisualizationClarifier` (around line 174), before `buildCompactSchemaSummary`:

```typescript
/**
 * buildReflectionGuidance — appends structured self-diagnosis guidance to
 * tool result content when the result is empty or errored.
 *
 * The model reads tool results verbatim. By embedding the reflection prompt
 * inside the result string, the model is forced to diagnose before retrying.
 */
export function buildReflectionGuidance(
  toolName: string,
  content: string,
  isError: boolean,
): string {
  // Error path — any tool
  if (isError) {
    return (
      content +
      `\n\n⚠️ ERROR REFLECTION — diagnose before the next action:\n` +
      `1. Read the error message above carefully. What exactly failed?\n` +
      `2. Is this a column name mismatch? A schema qualification issue? A type error?\n` +
      `3. Choose a DIFFERENT approach — do NOT repeat the identical call.\n` +
      `State your diagnosis in your next response, then take a corrective action.`
    );
  }

  // Zero-rows path — execute_sql only
  if (toolName === "execute_sql") {
    try {
      const parsed = JSON.parse(content) as { rowCount?: number };
      if (parsed.rowCount === 0) {
        return (
          content +
          `\n\n⚠️ ZERO RESULTS REFLECTION — diagnose before the next action:\n` +
          `1. Derived table? If the table name comes from create_derived_table, it lives in SQLite only — execute_sql queries PostgreSQL/MySQL and will always return empty. Use the pre-loaded tab data directly.\n` +
          `2. WHERE clause? Try removing the filter to check if the base table has rows.\n` +
          `3. Schema/table name? PostgreSQL requires "schema"."table" with double-quotes.\n` +
          `State your diagnosis, then choose a DIFFERENT approach — do NOT repeat the same query.`
        );
      }
    } catch {
      // not JSON — leave content unchanged
    }
  }

  return content;
}
```

- [ ] **Step 4: Wire `buildReflectionGuidance` into the tool result mapper in `runAgentLoop`**

In `runAgentLoop`, find the `return` at the end of the `commandBus.dispatch` success/error path (around line 1188-1204):

```typescript
          onToolEnd(tc.name, result);
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: result.success
              ? JSON.stringify(result.result ?? "done")
              : `Error: ${result.error}`,
            isError: !result.success,
          };
```

Replace with:

```typescript
          onToolEnd(tc.name, result);
          const rawContent = result.success
            ? JSON.stringify(result.result ?? "done")
            : `Error: ${result.error}`;
          return {
            toolCallId: tc.id,
            name: tc.name,
            content: buildReflectionGuidance(tc.name, rawContent, !result.success),
            isError: !result.success,
          };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: all `buildReflectionGuidance` tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/lib/agent/AgentLoop.test.ts
git commit -m "feat(agent): reflection injection on empty/error tool results — diagnose before retry"
```

---

## Task 2: Data evidence tagging in execute_sql results

**Purpose:** When `execute_sql` returns rows, append a compact numeric summary (min/max/mean for each numeric column) to the tool result content. The agent uses these verbatim numbers in its response — preventing hallucinated or rounded statistics. This closes the "semantic result verification" gap.

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/lib/agent/AgentLoop.test.ts`

- [ ] **Step 1: Write the failing tests for `buildDataEvidence`**

Add to `src/lib/agent/AgentLoop.test.ts`:

```typescript
import { buildDataEvidence } from "./AgentLoop";

describe("buildDataEvidence", () => {
  it("returns null for empty results", () => {
    const results: QueryResults = {
      rows: [],
      fields: [{ name: "Torque" }],
      rowCount: 0,
      elapsedMs: 5,
      queryId: "q1",
      source_tables: [],
    };
    expect(buildDataEvidence(results)).toBeNull();
  });

  it("includes row count and numeric column stats", () => {
    const results: QueryResults = {
      rows: [
        { "Torque [Nm]": 40, Type: "L" },
        { "Torque [Nm]": 60, Type: "M" },
      ],
      fields: [{ name: "Torque [Nm]" }, { name: "Type" }],
      rowCount: 2,
      elapsedMs: 10,
      queryId: "q2",
      source_tables: ["public.data"],
    };
    const evidence = buildDataEvidence(results);
    expect(evidence).not.toBeNull();
    expect(evidence).toContain("2 rows");
    expect(evidence).toContain("Torque [Nm]");
    expect(evidence).toContain("min=40");
    expect(evidence).toContain("max=60");
    expect(evidence).toContain("mean=50");
  });

  it("skips non-numeric columns", () => {
    const results: QueryResults = {
      rows: [{ Type: "L" }, { Type: "M" }],
      fields: [{ name: "Type" }],
      rowCount: 2,
      elapsedMs: 5,
      queryId: "q3",
      source_tables: [],
    };
    const evidence = buildDataEvidence(results);
    // No numeric cols → no stats block, but still returns row count info
    expect(evidence).toContain("2 rows");
    expect(evidence).not.toContain("min=");
  });

  it("caps numeric summary at 6 columns", () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({ name: `col${i}` }));
    const row = Object.fromEntries(fields.map((f) => [f.name, i]));
    const results: QueryResults = {
      rows: [row, row],
      fields,
      rowCount: 2,
      elapsedMs: 5,
      queryId: "q4",
      source_tables: [],
    };
    const evidence = buildDataEvidence(results);
    // Should cap at 6 numeric columns to keep tokens low
    const matches = (evidence ?? "").match(/min=/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: FAIL — `buildDataEvidence is not exported`

- [ ] **Step 3: Add `buildDataEvidence` to `AgentLoop.ts`**

Add directly after `buildReflectionGuidance`:

```typescript
/**
 * buildDataEvidence — compact numeric summary appended to execute_sql results.
 *
 * Provides grounded min/max/mean for up to 6 numeric columns so the model
 * never needs to guess or hallucinate statistics from sample rows alone.
 * Returns null for empty result sets (nothing to summarise).
 */
export function buildDataEvidence(results: QueryResults): string | null {
  if (!results || results.rowCount === 0) return null;

  const numericCols = results.fields
    .map((f) => f.name)
    .filter((name) => {
      for (const row of results.rows.slice(0, 20)) {
        const v = row[name];
        if (v === null || v === undefined) continue;
        if (typeof v === "number") return true;
        if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return true;
        return false;
      }
      return false;
    })
    .slice(0, 6); // cap to keep tokens low

  const lines: string[] = [
    `DATA_EVIDENCE (use these values verbatim — do not round, extrapolate, or invent):`,
    `• ${results.rowCount} rows returned`,
  ];

  for (const col of numericCols) {
    const vals = results.rows
      .map((r) => r[col])
      .filter((v): v is number =>
        v !== null && v !== undefined && typeof v === "number" && Number.isFinite(v)
      );
    // Also accept numeric strings
    const numVals = results.rows
      .map((r) => {
        const v = r[col];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
        return null;
      })
      .filter((v): v is number => v !== null);

    if (numVals.length === 0) continue;
    const min = Math.min(...numVals);
    const max = Math.max(...numVals);
    const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
    lines.push(
      `• ${col}: n=${numVals.length}, min=${Number(min.toFixed(4))}, max=${Number(max.toFixed(4))}, mean=${Number(mean.toFixed(4))}`
    );
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Wire `buildDataEvidence` into the execute_sql tool result**

In `runAgentLoop`, find the tool result mapper (in the `commandBus.dispatch` success path) where `rawContent` is now built from Task 1. Extend it to append evidence for `execute_sql`:

```typescript
          onToolEnd(tc.name, result);
          const rawContent = result.success
            ? JSON.stringify(result.result ?? "done")
            : `Error: ${result.error}`;

          // Append data evidence summary for execute_sql results
          let enrichedContent = rawContent;
          if (result.success && tc.name === "execute_sql") {
            try {
              const qr = result.result as QueryResults | undefined;
              if (qr) {
                const evidence = buildDataEvidence(qr);
                if (evidence) enrichedContent = rawContent + "\n\n" + evidence;
              }
            } catch {
              // non-fatal — proceed without evidence
            }
          }

          return {
            toolCallId: tc.id,
            name: tc.name,
            content: buildReflectionGuidance(tc.name, enrichedContent, !result.success),
            isError: !result.success,
          };
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: all `buildDataEvidence` tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/lib/agent/AgentLoop.test.ts
git commit -m "feat(agent): data evidence tagging in execute_sql results — grounds responses in actual numbers"
```

---

## Task 3: Cross-tab awareness in system prompt

**Purpose:** The agent currently only sees the active tab's query results. Other open sheet tabs (derived tables, slices) are invisible to it. Add an OPEN TABS summary to both system prompts so the agent knows what pre-loaded data is available and can reference it without running SQL. This closes the "cross-tab awareness" gap.

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/lib/agent/AgentLoop.test.ts`

- [ ] **Step 1: Write the failing tests for `buildOpenTabsSummary`**

Add to `src/lib/agent/AgentLoop.test.ts`:

```typescript
import { buildOpenTabsSummary } from "./AgentLoop";
import type { TabState } from "../stores/WorkspaceStore";

describe("buildOpenTabsSummary", () => {
  const makeTab = (overrides: Partial<TabState>): TabState =>
    ({
      id: "t1",
      type: "sql_editor",
      title: "Query",
      connectionId: "conn1",
      sql: "",
      queryResults: null,
      isExecuting: false,
      queryView: "results",
      isSheet: false,
      ...overrides,
    } as TabState);

  it("returns null when no tabs have results", () => {
    expect(buildOpenTabsSummary([])).toBeNull();
    expect(buildOpenTabsSummary([makeTab({ queryResults: null })])).toBeNull();
  });

  it("returns null when only the active tab has results (activeTabId provided)", () => {
    const tab = makeTab({
      id: "active",
      queryResults: { rows: [{ a: 1 }], fields: [{ name: "a" }], rowCount: 1, elapsedMs: 5, queryId: "q1", source_tables: [] },
    });
    // When activeTabId = "active", this tab is the current context — exclude it
    expect(buildOpenTabsSummary([tab], "active")).toBeNull();
  });

  it("includes non-active tabs with results", () => {
    const tabs: TabState[] = [
      makeTab({
        id: "active",
        title: "Live Query",
        queryResults: { rows: [{ x: 1 }], fields: [{ name: "x" }], rowCount: 10, elapsedMs: 5, queryId: "q1", source_tables: [] },
      }),
      makeTab({
        id: "sheet1",
        title: "Type-L rows",
        isSheet: true,
        queryResults: { rows: [{ Torque: 40 }], fields: [{ name: "Torque" }, { name: "Type" }], rowCount: 150, elapsedMs: 5, queryId: "q2", source_tables: [] },
      }),
    ];
    const summary = buildOpenTabsSummary(tabs, "active");
    expect(summary).not.toBeNull();
    expect(summary).toContain("Type-L rows");
    expect(summary).toContain("150 rows");
    expect(summary).toContain("Torque");
    expect(summary).toContain("sheet");
  });

  it("caps at 5 tabs to limit tokens", () => {
    const tabs = Array.from({ length: 8 }, (_, i) =>
      makeTab({
        id: `t${i}`,
        title: `Tab ${i}`,
        queryResults: { rows: [{ v: i }], fields: [{ name: "v" }], rowCount: i + 1, elapsedMs: 1, queryId: `q${i}`, source_tables: [] },
      })
    );
    const summary = buildOpenTabsSummary(tabs) ?? "";
    const matches = summary.match(/Tab \d/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: FAIL — `buildOpenTabsSummary is not exported`

- [ ] **Step 3: Add `buildOpenTabsSummary` to `AgentLoop.ts`**

Add after `buildDataEvidence`. This requires importing `TabState` from WorkspaceStore at the top:

At the top of `AgentLoop.ts`, the existing imports include:
```typescript
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { WorkspaceRule } from "../memory/WorkspaceRuleStore";
```

Add `TabState` to the WorkspaceStore import:
```typescript
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { TabState } from "../stores/WorkspaceStore";
```

Then add the function:

```typescript
/**
 * buildOpenTabsSummary — lists all open tabs with loaded data (excluding
 * the active tab, which is already covered by LAST QUERY RESULTS).
 *
 * Gives the agent cross-tab situational awareness: it can reference sheet
 * tabs with pre-loaded derived data without running additional SQL queries.
 * Capped at 5 tabs to limit token spend.
 */
export function buildOpenTabsSummary(
  tabs: TabState[],
  activeTabId?: string,
): string | null {
  const candidates = tabs
    .filter(
      (t) =>
        t.id !== activeTabId &&
        t.queryResults != null &&
        t.queryResults.rowCount > 0,
    )
    .slice(0, 5);

  if (candidates.length === 0) return null;

  const lines = candidates.map((t) => {
    const cols = (t.queryResults?.fields ?? []).map((f) => f.name).slice(0, 6).join(", ");
    const moreCols = (t.queryResults?.fields?.length ?? 0) > 6
      ? ` +${(t.queryResults?.fields?.length ?? 0) - 6} more`
      : "";
    const kind = t.isSheet ? "sheet" : "sql";
    return `- "${t.title}" (${kind}, ${t.queryResults!.rowCount} rows, cols: ${cols}${moreCols})`;
  });

  return (
    `OTHER OPEN TABS WITH DATA (reference these directly — no SQL needed to access them):\n` +
    lines.join("\n") +
    `\nTo chart or analyse data from a sheet tab, use create_analysis_chart with the tab's rows ` +
    `or ask the user to make that tab active first.`
  );
}
```

- [ ] **Step 4: Wire `buildOpenTabsSummary` into `buildSystemPrompt`**

In `buildSystemPrompt` (around line 619 — after `harnessAdditions` block, before `return parts.join(...)`):

```typescript
  // Cross-tab awareness
  const { tabs, activeTabId } = useWorkspaceStore.getState();
  const openTabsSummary = buildOpenTabsSummary(tabs, activeTabId);
  if (openTabsSummary) parts.push(openTabsSummary);

  if (harnessAdditions) {
    parts.push(`## Harness Guidance (Auto-Updated)\n${harnessAdditions}`);
  }

  return parts.join("\n\n");
```

- [ ] **Step 5: Wire `buildOpenTabsSummary` into `buildFastSystemPrompt`**

In `buildFastSystemPrompt` (around line 248 — before `return parts.join(...)`):

```typescript
  // Cross-tab awareness (fast path)
  const { tabs, activeTabId } = useWorkspaceStore.getState();
  const openTabsSummary = buildOpenTabsSummary(tabs, activeTabId);
  if (openTabsSummary) parts.push(openTabsSummary);

  return parts.join("\n\n");
```

- [ ] **Step 6: Run tests**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: all `buildOpenTabsSummary` tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/lib/agent/AgentLoop.test.ts
git commit -m "feat(agent): cross-tab awareness in system prompt — agent sees all open tabs with data"
```

---

## Task 4: Confidence-gated execution

**Purpose:** When the agent calls `declare_confidence` with confidence < 50%, it has admitted uncertainty but the current loop lets it proceed to mutating actions anyway. This task gates `caution` and `destructive` commands after a low-confidence declaration — injecting a block that forces the agent to surface uncertainty to the user before acting. Fires once per session then resets, so it doesn't permanently block the agent.

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/lib/agent/AgentLoop.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/agent/AgentLoop.test.ts`:

```typescript
import { buildConfidenceGateMessage } from "./AgentLoop";

describe("buildConfidenceGateMessage", () => {
  it("returns null when confidence is null (never declared)", () => {
    expect(buildConfidenceGateMessage(null, "add_column", "caution")).toBeNull();
  });

  it("returns null when confidence is high enough (>= 0.5)", () => {
    expect(buildConfidenceGateMessage(0.8, "add_column", "caution")).toBeNull();
    expect(buildConfidenceGateMessage(0.5, "delete_rows", "destructive")).toBeNull();
  });

  it("returns null for safe commands regardless of confidence", () => {
    expect(buildConfidenceGateMessage(0.1, "execute_sql", "safe")).toBeNull();
  });

  it("returns gate message for low confidence + caution command", () => {
    const msg = buildConfidenceGateMessage(0.3, "add_column", "caution");
    expect(msg).not.toBeNull();
    expect(msg).toContain("30%");
    expect(msg).toContain("CONFIDENCE GATE");
    expect(msg).toContain("NOT been executed");
  });

  it("returns gate message for low confidence + destructive command", () => {
    const msg = buildConfidenceGateMessage(0.2, "delete_rows", "destructive");
    expect(msg).not.toBeNull();
    expect(msg).toContain("CONFIDENCE GATE");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: FAIL — `buildConfidenceGateMessage is not exported`

- [ ] **Step 3: Add `buildConfidenceGateMessage` to `AgentLoop.ts`**

Add after `buildOpenTabsSummary`:

```typescript
/**
 * buildConfidenceGateMessage — produces a gate message when the agent has
 * declared low confidence (<50%) and is about to take a non-safe action.
 *
 * Returns null (no gate) when:
 * - confidence was never declared (null)
 * - confidence >= 0.5
 * - the command is safe (read-only)
 *
 * When the gate fires, the content is returned as a tool result instead of
 * executing the command. The agent must surface its uncertainty to the user.
 */
export function buildConfidenceGateMessage(
  sessionConfidenceScore: number | null,
  commandType: string,
  riskLevel: "safe" | "caution" | "destructive",
): string | null {
  if (sessionConfidenceScore === null) return null;
  if (sessionConfidenceScore >= 0.5) return null;
  if (riskLevel === "safe") return null;

  const pct = Math.round(sessionConfidenceScore * 100);
  return (
    `CONFIDENCE GATE: You declared ${pct}% confidence earlier in this session. ` +
    `The action "${commandType}" (${riskLevel}) has NOT been executed.\n` +
    `Before proceeding:\n` +
    `1. Tell the user what specific data or information is missing that causes uncertainty.\n` +
    `2. Ask whether to gather more evidence first or proceed despite the uncertainty.\n` +
    `Do not attempt this action again until the user explicitly confirms.`
  );
}
```

- [ ] **Step 4: Wire confidence tracking + gating into `runAgentLoop`**

In `runAgentLoop`, find the variable declarations just before the main `for` loop (around line 989-993):

```typescript
  let finalText = "";
  const pendingApprovalSteps: string[] = [];
  const MAX_ROUNDS = queryDepth === "fast" ? 6 : 12;
  const toolSignatureCounts = new Map<string, number>();
  let resultFetchingAttempts = 0;
```

Add two variables after `resultFetchingAttempts`:

```typescript
  let finalText = "";
  const pendingApprovalSteps: string[] = [];
  const MAX_ROUNDS = queryDepth === "fast" ? 6 : 12;
  const toolSignatureCounts = new Map<string, number>();
  let resultFetchingAttempts = 0;
  let sessionConfidenceScore: number | null = null;  // tracks last declare_confidence score
  let confidenceGateFired = false;                   // gate fires once then resets
```

Then, in the tool result mapper, after the `cmd` is resolved and before `isDestructive(cmd)` check, add confidence tracking for `declare_confidence` and gating for non-safe commands.

Find the block starting with `onToolStart(tc.name, tc.input);` (around line 1096). Add the confidence tracking right after the `cmd` is resolved:

```typescript
        // ── Track declare_confidence score ───────────────────────────────
        if (tc.name === "declare_confidence" && typeof tc.input.confidence === "number") {
          sessionConfidenceScore = tc.input.confidence as number;
          if (sessionConfidenceScore >= 0.5) confidenceGateFired = false; // reset if confidence recovers
        }

        // ── Confidence gate — block non-safe actions after low confidence ─
        if (!confidenceGateFired) {
          const gateMsg = buildConfidenceGateMessage(sessionConfidenceScore, cmd.type, cmd.risk);
          if (gateMsg) {
            confidenceGateFired = true; // fires once per confidence declaration
            onToolEnd(tc.name, { success: false, error: "Confidence gate" });
            return {
              toolCallId: tc.id,
              name: tc.name,
              content: gateMsg,
              isError: false, // not an error — it's a guidance message
            };
          }
        }

        onToolStart(tc.name, tc.input);
```

Note: This block goes BEFORE the existing `if (agentMode === "plan")` and `if (isDestructive(cmd))` checks.

- [ ] **Step 5: Run tests**

```bash
npm run test -- AgentLoop.test.ts
```

Expected: all `buildConfidenceGateMessage` tests PASS

- [ ] **Step 6: Lint check**

```bash
npm run lint
```

Expected: no TypeScript errors. If `cmd.risk` is not typed as `"safe" | "caution" | "destructive"`, cast: `cmd.risk as "safe" | "caution" | "destructive"`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/lib/agent/AgentLoop.test.ts
git commit -m "feat(agent): confidence gate — blocks caution/destructive actions after low confidence declaration"
```

---

## Task 5: Memory-driven proactive suggestion

**Purpose:** Episodic memory exists but is passive — it injects past context into the system prompt but never surfaces a visible, actionable suggestion to the user. This task adds a proactive suggestion banner in `AIChat.tsx` that appears when a past episode matches the current query with score > 0.7. The user can dismiss it or click "Continue from here" to pre-fill the chat with a follow-up. This closes the "memory is passive" gap.

**Files:**
- Modify: `src/lib/memory/EpisodicMemory.ts`
- Modify: `src/components/ai/AIChat.tsx`

- [ ] **Step 1: Add `searchWithScores` to `EpisodicMemory.ts`**

Open `src/lib/memory/EpisodicMemory.ts`. The existing `search()` at line 67 computes scores internally but drops them before returning. Add a new method that preserves scores:

```typescript
  async searchWithScores(
    query: string,
    limit = 5,
    connectionId?: string,
  ): Promise<Array<{ episode: Episode; score: number }>> {
    const qvec = embed(query);
    const raw = await invoke<RawEpisode[]>("memory_get_episodes", {
      limit: 200,
      connection_id: connectionId ?? null,
    });
    const episodes = raw.map(fromRaw);
    const now = Date.now();
    const ONE_DAY_MS = 86_400_000;
    const scored = episodes.map((ep) => {
      const similarity = ep.embedding ? cosineSimilarity(qvec, ep.embedding) : 0;
      const ageInDays = (now - ep.createdAt) / ONE_DAY_MS;
      const recency = Math.exp(-0.1 * ageInDays);
      return { episode: ep, score: similarity * 0.7 + recency * 0.3 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  },
```

Add this method to the `EpisodicMemory` object, after the existing `search` method and before `getRecent`.

- [ ] **Step 2: Add proactive suggestion state to `AIChat.tsx`**

In `AIChat.tsx`, find the existing state declarations around line 164-181. Add one new state variable after the existing `useState` declarations:

```typescript
  const [proactiveSuggestion, setProactiveSuggestion] = useState<{
    summary: string;
    date: string;
    continuePrompt: string;
  } | null>(null);
```

- [ ] **Step 3: Load scores in `executeAgentRequest` and set suggestion**

In `executeAgentRequest` in `AIChat.tsx`, the current memory load (around line 308) is:

```typescript
      const [episodes, profile] = await Promise.all([
        EpisodicMemory.search(userMsg, 5, connectionId ?? undefined),
        UserCalibrationProfile.getProfile(),
      ]);
```

Replace with:

```typescript
      const [scoredEpisodes, profile] = await Promise.all([
        EpisodicMemory.searchWithScores(userMsg, 5, connectionId ?? undefined),
        UserCalibrationProfile.getProfile(),
      ]);
      const episodes = scoredEpisodes.map((s) => s.episode);

      // Proactive suggestion: surface top match if score is high and it's from a prior session
      const topMatch = scoredEpisodes[0];
      if (
        topMatch &&
        topMatch.score > 0.7 &&
        historyRef.current.length === 0 // only at session start, not mid-conversation
      ) {
        const ep = topMatch.episode;
        const date = new Date(ep.createdAt).toLocaleDateString();
        const summary =
          ep.outcome ??
          (typeof ep.findings?.["summary"] === "string"
            ? (ep.findings["summary"] as string)
            : ep.problem.slice(0, 120));
        setProactiveSuggestion({
          summary: summary.slice(0, 160),
          date,
          continuePrompt: `Continue the analysis from ${date}: ${ep.problem.slice(0, 80)}`,
        });
      } else {
        setProactiveSuggestion(null);
      }
```

- [ ] **Step 4: Render the suggestion banner in `AIChat.tsx`**

Find where `<HypothesisPanel />` and `<ConfidenceBar />` are rendered in the JSX (search for `<HypothesisPanel` in the file). Just before the message list `<div ref={scrollRef}...>`, add the suggestion banner:

```tsx
      {/* Proactive memory suggestion */}
      {proactiveSuggestion && !isProcessing && (
        <div className="mx-3 mt-2 mb-1 px-3 py-2 rounded-lg bg-[#4f8ef7]/10 border border-[#4f8ef7]/20 flex items-start gap-2 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-[#4f8ef7] mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-white/50">{proactiveSuggestion.date}: </span>
            <span className="text-white/70">{proactiveSuggestion.summary}</span>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => {
                setInput(proactiveSuggestion.continuePrompt);
                setProactiveSuggestion(null);
                inputRef.current?.focus();
              }}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#4f8ef7]/20 text-[#4f8ef7] hover:bg-[#4f8ef7]/30"
            >
              Continue
            </button>
            <button
              onClick={() => setProactiveSuggestion(null)}
              className="px-2 py-0.5 rounded text-[10px] font-medium text-white/30 hover:text-white/60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Clear the suggestion when a message is sent**

In `executeAgentRequest`, immediately after `addMsg({ role: "user", content: visibleUserMessage });` (around line 302), add:

```typescript
    setProactiveSuggestion(null);
```

- [ ] **Step 6: Type-check**

```bash
npm run lint
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/memory/EpisodicMemory.ts src/components/ai/AIChat.tsx
git commit -m "feat(memory): proactive suggestion banner — surfaces relevant past sessions at conversation start"
```

---

## Final Integration Test

After all 5 tasks are committed, run the full test suite:

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: all tests pass, no regressions. Pay attention to:
- `AgentLoop.test.ts` — 5 new describe blocks must all be green
- `WorkspaceStore.test.ts` — no regressions (we only read from the store, didn't mutate it)
- `registerHandlers.test.ts` — no regressions

- [ ] **Step 2: TypeScript clean check**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 3: Verify exports from `AgentLoop.ts`**

The following must be exported from `AgentLoop.ts` (they need to be importable by tests):
- `buildReflectionGuidance(toolName, content, isError): string`
- `buildDataEvidence(results: QueryResults): string | null`
- `buildOpenTabsSummary(tabs: TabState[], activeTabId?: string): string | null`
- `buildConfidenceGateMessage(score: number | null, commandType: string, riskLevel: string): string | null`

All are already marked `export function` in the steps above. Confirm by grepping:

```bash
grep "^export function build" src/lib/agent/AgentLoop.ts
```

Expected output:
```
export function buildVisualizationClarifier(...)
export function buildReflectionGuidance(...)
export function buildDataEvidence(...)
export function buildOpenTabsSummary(...)
export function buildConfidenceGateMessage(...)
```

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -p
git commit -m "chore(agent): final cleanup and lint fixes for intelligence gap tasks"
```

---

## What These Changes Close

| Gap (from review) | Task | How |
|---|---|---|
| Self-correction on failures | Task 1 | Reflection injected into every error/empty tool result |
| Hallucinated statistics | Task 2 | Actual min/max/mean appended to every execute_sql result |
| Cross-tab blindness | Task 3 | All open tabs listed in both system prompts |
| Confidence not acted on | Task 4 | Gate fires on caution/destructive after low confidence |
| Memory is passive | Task 5 | Suggestion banner at session start with Continue button |

## What Remains Out of Scope (next plan)

- Proactive anomaly watching (background polling loop — needs new Tauri command)
- Schema diff tracking across sessions (Rust changes needed)
- Cell-level result verification (requires semantic LLM comparison pass)
- File/code awareness like Cursor (out of scope for a SQL IDE)
