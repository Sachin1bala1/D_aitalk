# DataIQ Harness Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 production-grade harness layers around the existing APEX agent — context compaction, lifecycle hooks, impact maps, meta-harness optimization, policy engine, and observability — without breaking any existing code.

**Architecture:** All harness files live in `src/lib/agent/harness/`. They are ADDITIVE — `AgentLoop.ts`, `CommandBus.ts`, `WorkspaceStore.ts`, and the memory system are modified minimally to wire in the harness. Rust backend adds three new SQLite tables in the existing `daitalk_memory.db` via new commands in `src-tauri/src/commands/memory.rs`. Every harness event flows through `HarnessObserver` (built first) so it is always available to other harness files.

**Tech Stack:** TypeScript + React 18, Tauri 2 (invoke/listen), SQLite via sqlx (Rust), Zustand (immer), Vitest for unit tests, Tailwind CSS for UI.

---

## Build Order Rationale

`HarnessObserver` is built in Task 4 even though it is HARNESS-6 in the spec document, because every other harness file calls into it. The Rust tables (Tasks 1–3) come first so TypeScript invoke() calls have a backend to hit. Policy engine (H-5) comes before ImpactMapEngine (H-3) because it is simpler and independent.

---

## File Map

**New files — Rust:**
- `src-tauri/src/db/memory.rs` — add 3 new tables (harness_failure_traces, harness_versions, analysis_telemetry_graph)
- `src-tauri/src/commands/memory.rs` — add 7 new `#[tauri::command]` functions
- `src-tauri/src/lib.rs` — register 7 new commands in invoke_handler

**New files — TypeScript harness core:**
- `src/lib/agent/harness/HarnessObserver.ts` — singleton event collector (built first)
- `src/lib/agent/harness/ContextEngine.ts` — context compaction + dynamic system prompt (H-1)
- `src/lib/agent/harness/HarnessLifecycle.ts` — lifecycle hooks + struggle detection (H-2)
- `src/lib/agent/harness/PolicyEngine.ts` — policy evaluation (H-5)
- `src/lib/agent/harness/FailureTraceStore.ts` — Tauri client for harness DB tables (H-4)
- `src/lib/agent/harness/HarnessOptimizer.ts` — meta-harness optimizer (H-4)
- `src/lib/agent/harness/ImpactMapEngine.ts` — impact map generation (H-3)

**New files — React UI:**
- `src/components/ai/ImpactMapPanel.tsx` — impact map review modal (H-3)
- `src/components/admin/HarnessDashboard.tsx` — harness health + meta-harness UI (H-4/6)

**New files — Tests:**
- `src/lib/agent/harness/ContextEngine.test.ts`
- `src/lib/agent/harness/PolicyEngine.test.ts`
- `src/lib/agent/harness/HarnessLifecycle.test.ts`

**Modified files:**
- `src/lib/agent/AgentLoop.ts` — wire ContextEngine, HarnessLifecycle, ImpactMapEngine, active version injection
- `src/lib/stores/WorkspaceStore.ts` — add `pendingImpactMap`, `impactMapResolution` state
- `src/components/ai/AIChat.tsx` — add token badge footer + policy violation message rendering

---

## Task 1: Rust — Add harness tables to memory.rs

**Files:**
- Modify: `src-tauri/src/db/memory.rs` (after last existing table creation block)

- [ ] **Step 1: Add three new table-creation blocks at the end of `open_memory_db`, before the final `Ok(pool)`**

Find the end of the function — the last `.map_err(|e| e.to_string())?;` before `Ok(pool)`. Add immediately after it:

```rust
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS harness_failure_traces (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question TEXT NOT NULL,
            tools_used TEXT NOT NULL,
            errors TEXT NOT NULL,
            struggle_events TEXT NOT NULL,
            final_success INTEGER NOT NULL,
            token_estimate INTEGER,
            duration_ms INTEGER,
            harness_version TEXT NOT NULL DEFAULT 'v1.0',
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_harness_traces_created
         ON harness_failure_traces(created_at DESC)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS harness_versions (
            id TEXT PRIMARY KEY,
            version_tag TEXT NOT NULL,
            system_prompt_additions TEXT NOT NULL,
            success_rate REAL,
            avg_token_estimate REAL,
            failure_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS analysis_telemetry_graph (
            id TEXT PRIMARY KEY,
            from_node TEXT NOT NULL,
            to_node TEXT NOT NULL,
            edge_type TEXT NOT NULL,
            session_id TEXT,
            weight REAL DEFAULT 1.0,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_telemetry_graph_nodes
         ON analysis_telemetry_graph(from_node, to_node)",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
```

- [ ] **Step 2: Build to verify no compilation errors**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/memory.rs
git commit -m "feat(harness): add harness_failure_traces, harness_versions, analysis_telemetry_graph tables"
```

---

## Task 2: Rust — Add harness Tauri commands to commands/memory.rs

**Files:**
- Modify: `src-tauri/src/commands/memory.rs`

- [ ] **Step 1: Add struct definitions before the first `#[tauri::command]` line**

At line ~82 (after existing struct definitions, before `impl` or first command), add:

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct HarnessFailureTrace {
    pub id: String,
    pub session_id: String,
    pub question: String,
    pub tools_used: String,
    pub errors: String,
    pub struggle_events: String,
    pub final_success: i64,
    pub token_estimate: Option<i64>,
    pub duration_ms: Option<i64>,
    pub harness_version: String,
    pub created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct HarnessVersion {
    pub id: String,
    pub version_tag: String,
    pub system_prompt_additions: String,
    pub success_rate: Option<f64>,
    pub avg_token_estimate: Option<f64>,
    pub failure_count: i64,
    pub is_active: i64,
    pub created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, sqlx::FromRow)]
pub struct TelemetryEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub edge_type: String,
    pub session_id: Option<String>,
    pub weight: f64,
    pub created_at: i64,
}
```

- [ ] **Step 2: Append 7 new command functions at the end of the file**

```rust
#[tauri::command]
pub async fn harness_record_failure(
    session_id: String,
    question: String,
    tools_used: String,
    errors: String,
    struggle_events: String,
    final_success: bool,
    token_estimate: Option<i64>,
    duration_ms: Option<i64>,
    harness_version: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO harness_failure_traces
         (id, session_id, question, tools_used, errors, struggle_events,
          final_success, token_estimate, duration_ms, harness_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&session_id)
    .bind(&question)
    .bind(&tools_used)
    .bind(&errors)
    .bind(&struggle_events)
    .bind(if final_success { 1i64 } else { 0i64 })
    .bind(token_estimate)
    .bind(duration_ms)
    .bind(&harness_version)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn harness_get_failures(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<HarnessFailureTrace>, String> {
    let pool = get_pool(&state).await?;
    let n = limit.unwrap_or(50) as i64;
    let rows = sqlx::query_as::<_, HarnessFailureTrace>(
        "SELECT * FROM harness_failure_traces ORDER BY created_at DESC LIMIT ?",
    )
    .bind(n)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn harness_get_active_version(
    state: State<'_, AppState>,
) -> Result<Option<HarnessVersion>, String> {
    let pool = get_pool(&state).await?;
    let row = sqlx::query_as::<_, HarnessVersion>(
        "SELECT * FROM harness_versions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub async fn harness_save_version(
    version_tag: String,
    system_prompt_additions: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pool = get_pool(&state).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO harness_versions
         (id, version_tag, system_prompt_additions, is_active, failure_count, created_at)
         VALUES (?, ?, ?, 0, 0, ?)",
    )
    .bind(&id)
    .bind(&version_tag)
    .bind(&system_prompt_additions)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn harness_activate_version(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    sqlx::query("UPDATE harness_versions SET is_active = 0")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE harness_versions SET is_active = 1 WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn harness_record_telemetry_edge(
    from_node: String,
    to_node: String,
    edge_type: String,
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();
    // Upsert: if edge exists increment weight, else insert
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM analysis_telemetry_graph WHERE from_node=? AND to_node=? AND edge_type=?",
    )
    .bind(&from_node)
    .bind(&to_node)
    .bind(&edge_type)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(existing_id) = existing {
        sqlx::query(
            "UPDATE analysis_telemetry_graph SET weight = weight + 1.0 WHERE id = ?",
        )
        .bind(&existing_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query(
            "INSERT INTO analysis_telemetry_graph
             (id, from_node, to_node, edge_type, session_id, weight, created_at)
             VALUES (?, ?, ?, ?, ?, 1.0, ?)",
        )
        .bind(&id)
        .bind(&from_node)
        .bind(&to_node)
        .bind(&edge_type)
        .bind(&session_id)
        .bind(now)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn harness_get_telemetry_graph(
    state: State<'_, AppState>,
) -> Result<Vec<TelemetryEdge>, String> {
    let pool = get_pool(&state).await?;
    let edges = sqlx::query_as::<_, TelemetryEdge>(
        "SELECT * FROM analysis_telemetry_graph ORDER BY weight DESC LIMIT 200",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(edges)
}
```

- [ ] **Step 3: Build to verify no compilation errors**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/memory.rs
git commit -m "feat(harness): add 7 harness Tauri commands (failure traces, versions, telemetry)"
```

---

## Task 3: Rust — Register new commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the 7 new commands inside the existing `tauri::generate_handler![]` block**

Find the line `commands::remove_license,` (currently the last entry). After it, add:

```rust
            commands::harness_record_failure,
            commands::harness_get_failures,
            commands::harness_get_active_version,
            commands::harness_save_version,
            commands::harness_activate_version,
            commands::harness_record_telemetry_edge,
            commands::harness_get_telemetry_graph,
```

- [ ] **Step 2: Add the new commands to commands/mod.rs so they are exported**

Read `src-tauri/src/commands/mod.rs` and add after the last `pub use memory::` line:

```rust
pub use memory::{
    harness_record_failure, harness_get_failures, harness_get_active_version,
    harness_save_version, harness_activate_version,
    harness_record_telemetry_edge, harness_get_telemetry_graph,
};
```

- [ ] **Step 3: Build and verify**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/mod.rs
git commit -m "feat(harness): register 7 harness commands in Tauri invoke handler"
```

---

## Task 4: HarnessObserver — singleton event collector

Built first because all other harness files import from it.

**Files:**
- Create: `src/lib/agent/harness/HarnessObserver.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/agent/harness/HarnessObserver.ts
// Singleton that collects every harness event in a session.
// Written to by ContextEngine, HarnessLifecycle, PolicyEngine.
// Flushed to Rust at onSessionComplete.
import { invoke } from "@tauri-apps/api/core";

export interface TokenUsage {
  system: number;   // estimated tokens in system prompt
  history: number;  // estimated tokens in conversation history
  total: number;
}

export interface ToolEvent {
  tool: string;
  durationMs: number;
  success: boolean;
  ts: number;
}

export interface ToolError {
  tool: string;
  error: string;
  ts: number;
}

export interface StruggleRecord {
  type: string;
  details: string;
  ts: number;
}

interface SessionTrace {
  question: string;
  startTime: number;
  toolEvents: ToolEvent[];
  errors: ToolError[];
  struggles: StruggleRecord[];
  tokenEstimates: TokenUsage[];
  toolCallStartTimes: Map<string, number>;
}

export class HarnessObserver {
  private static sessionTraces = new Map<string, SessionTrace>();

  static startSession(sessionId: string, question: string): void {
    this.sessionTraces.set(sessionId, {
      question,
      startTime: Date.now(),
      toolEvents: [],
      errors: [],
      struggles: [],
      tokenEstimates: [],
      toolCallStartTimes: new Map(),
    });
  }

  static recordContextBuild(sessionId: string, usage: TokenUsage): void {
    this.getTrace(sessionId).tokenEstimates.push(usage);
  }

  static recordToolCallStart(sessionId: string, tool: string): void {
    this.getTrace(sessionId).toolCallStartTimes.set(tool + '_' + Date.now(), Date.now());
  }

  static recordToolCallComplete(
    sessionId: string,
    tool: string,
    durationMs: number,
    success: boolean
  ): void {
    this.getTrace(sessionId).toolEvents.push({ tool, durationMs, success, ts: Date.now() });
  }

  static recordToolError(sessionId: string, tool: string, error: string): void {
    this.getTrace(sessionId).errors.push({ tool, error, ts: Date.now() });
  }

  static recordStruggle(sessionId: string, type: string, details: string): void {
    this.getTrace(sessionId).struggles.push({ type, details, ts: Date.now() });
  }

  static recordPolicyViolation(sessionId: string, policyId: string, tool: string): void {
    // Fire-and-forget telemetry
    invoke('memory_track_usage_event', {
      event: {
        event_type: 'policy_violation',
        feature: 'harness',
        connection_id: null,
        driver: null,
        metadata_json: { policy: policyId, tool },
        created_at: null,
      }
    }).catch(console.error);
  }

  static getLatestTokenEstimate(sessionId: string): TokenUsage | null {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace || trace.tokenEstimates.length === 0) return null;
    return trace.tokenEstimates[trace.tokenEstimates.length - 1];
  }

  static async finalizeSession(
    sessionId: string,
    success: boolean,
    harnessVersion: string
  ): Promise<void> {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace) return;

    const maxToken = trace.tokenEstimates.length > 0
      ? Math.max(...trace.tokenEstimates.map(t => t.total))
      : null;

    const durationMs = Date.now() - trace.startTime;
    const errorCount = trace.errors.length;

    // Only persist sessions with errors OR failed sessions (to feed meta-harness)
    if (!success || errorCount > 0) {
      try {
        await invoke('harness_record_failure', {
          sessionId,
          question: trace.question,
          toolsUsed: JSON.stringify(trace.toolEvents.map(e => e.tool)),
          errors: JSON.stringify(trace.errors.map(e => ({ tool: e.tool, error: e.error }))),
          struggleEvents: JSON.stringify(trace.struggles),
          finalSuccess: success,
          tokenEstimate: maxToken,
          durationMs,
          harnessVersion,
        });
      } catch (e) {
        console.error('[HarnessObserver] Failed to persist session trace:', e);
      }
    }

    // Record telemetry edges: tool → outcome
    for (const ev of trace.toolEvents) {
      try {
        await invoke('harness_record_telemetry_edge', {
          fromNode: `analysis:${ev.tool}`,
          toNode: success ? 'outcome:success' : 'outcome:failure',
          edgeType: 'produced',
          sessionId,
        });
      } catch { /* non-critical */ }
    }

    this.sessionTraces.delete(sessionId);
  }

  private static getTrace(sessionId: string): SessionTrace {
    if (!this.sessionTraces.has(sessionId)) {
      this.sessionTraces.set(sessionId, {
        question: '',
        startTime: Date.now(),
        toolEvents: [],
        errors: [],
        struggles: [],
        tokenEstimates: [],
        toolCallStartTimes: new Map(),
      });
    }
    return this.sessionTraces.get(sessionId)!;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -i "harness"
```
Expected: no errors mentioning `HarnessObserver`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/harness/HarnessObserver.ts
git commit -m "feat(harness): add HarnessObserver singleton — session event collector"
```

---

## Task 5: ContextEngine — context compaction + dynamic system prompt (H-1)

**Files:**
- Create: `src/lib/agent/harness/ContextEngine.ts`
- Create: `src/lib/agent/harness/ContextEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/agent/harness/ContextEngine.test.ts
import { describe, it, expect } from 'vitest';
import { ContextEngine } from './ContextEngine';
import type { ConversationTurn } from '../../ai/types';

describe('ContextEngine.compactHistory', () => {
  it('keeps all messages when under budget', () => {
    const msgs: ConversationTurn[] = [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi' },
    ];
    const result = ContextEngine.compactHistory(msgs, { historyMax: 100_000 });
    expect(result).toHaveLength(2);
  });

  it('compresses tool result content when over historyMax', () => {
    const longContent = 'x'.repeat(10_000);
    const msgs: ConversationTurn[] = [
      { role: 'user', text: 'q' },
      {
        role: 'user',
        toolResults: [{ toolCallId: '1', name: 'execute_sql', content: longContent, isError: false }],
      },
      { role: 'assistant', text: 'final answer' },
    ];
    const result = ContextEngine.compactHistory(msgs, { historyMax: 500 });
    // The long tool result should be compressed
    const toolTurn = result.find(m => m.toolResults);
    expect(toolTurn?.toolResults?.[0].content.length).toBeLessThan(longContent.length);
  });

  it('always keeps the last assistant message', () => {
    const msgs: ConversationTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(200),
    } as ConversationTurn));
    const result = ContextEngine.compactHistory(msgs, { historyMax: 1_000 });
    const lastAssistant = result.filter(m => m.role === 'assistant').at(-1);
    expect(lastAssistant?.text).toBe('x'.repeat(200));
  });
});

describe('ContextEngine.estimateTokens', () => {
  it('returns a positive number', () => {
    const n = ContextEngine.estimateTokens('hello world');
    expect(n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/lib/agent/harness/ContextEngine.test.ts 2>&1 | tail -10
```
Expected: FAIL — `ContextEngine` not found.

- [ ] **Step 3: Create the implementation**

```typescript
// src/lib/agent/harness/ContextEngine.ts
import type { ConversationTurn } from '../../ai/types';
import { HarnessObserver } from './HarnessObserver';

export interface ContextBudget {
  historyMax: number;  // max estimated tokens for conversation history
}

export const DEFAULT_BUDGET: ContextBudget = {
  historyMax: 30_000,
};

export class ContextEngine {
  /** Rough token estimate: chars / 4 */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Phase 0 — Compact the conversation history before each model call.
   * Strategy:
   *  1. Always keep: all user text messages + the last 6 assistant turns.
   *  2. For tool result turns beyond budget: compress content to first 120 chars.
   *  3. For assistant turns beyond budget: compress text to first 200 chars.
   */
  static compactHistory(
    messages: ConversationTurn[],
    budget: ContextBudget = DEFAULT_BUDGET
  ): ConversationTurn[] {
    const estimateTurn = (m: ConversationTurn): number => {
      let chars = 0;
      if (m.text) chars += m.text.length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
      if (m.toolResults) chars += m.toolResults.reduce((s, r) => s + r.content.length, 0);
      return Math.ceil(chars / 4);
    };

    // Pass 1: find the last 6 assistant indices (always keep these)
    const assistantIndices = messages
      .map((m, i) => (m.role === 'assistant' ? i : -1))
      .filter(i => i >= 0);
    const keepAssistantIndices = new Set(assistantIndices.slice(-6));

    // Pass 2: walk backwards, accumulate tokens, compress when over budget
    let totalTokens = 0;
    const result: ConversationTurn[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const est = estimateTurn(m);

      if (totalTokens + est <= budget.historyMax || keepAssistantIndices.has(i)) {
        result.unshift(m);
        totalTokens += est;
      } else {
        // Compress tool results
        if (m.toolResults) {
          const compressed: ConversationTurn = {
            ...m,
            toolResults: m.toolResults.map(r => ({
              ...r,
              content: r.content.length > 120
                ? `[Compacted: ${r.content.slice(0, 120)}… (${r.content.length} chars total)]`
                : r.content,
            })),
          };
          result.unshift(compressed);
          totalTokens += Math.ceil(120 / 4) * (m.toolResults.length || 1);
        } else if (m.role === 'assistant' && m.text && m.text.length > 200) {
          // Compress long assistant turns
          result.unshift({
            ...m,
            text: m.text.slice(0, 200) + '… [compacted]',
          });
          totalTokens += Math.ceil(200 / 4);
        } else if (m.role === 'user' && m.text) {
          // Always keep user text messages — they are the anchor
          result.unshift(m);
          totalTokens += est;
        }
        // else: skip (old tool call assistant turns)
      }
    }

    return result;
  }

  /**
   * Phase 1 — Build dynamic system prompt.
   * Takes the base prompt from buildSystemPrompt() and adds only the
   * schema tables mentioned in the user's question (reduces token waste
   * from including all 50 tables when only 2 are relevant).
   */
  static buildDynamicSystemPrompt(
    basePrompt: string,
    userQuestion: string,
    tableNames: string[]
  ): string {
    if (tableNames.length === 0) return basePrompt;

    const q = userQuestion.toLowerCase();
    const mentioned = tableNames.filter(name =>
      q.includes(name.toLowerCase()) || q.includes(name.split('.').pop()?.toLowerCase() ?? '')
    );

    if (mentioned.length === 0 || mentioned.length === tableNames.length) {
      // No filtering benefit — return as-is
      return basePrompt;
    }

    // The base prompt already includes full schema. We don't re-inject here;
    // instead, the schema section in buildSystemPrompt() will be called
    // with only the relevant tables when ContextEngine is integrated.
    // This function is a hook point for future schema filtering.
    return basePrompt;
  }

  /**
   * Estimate token usage of a full context build.
   * Called after compaction to feed HarnessObserver.
   */
  static estimateContextUsage(
    systemPrompt: string,
    messages: ConversationTurn[]
  ): { system: number; history: number; total: number } {
    const system = Math.ceil(systemPrompt.length / 4);
    const history = messages.reduce((s, m) => {
      let chars = 0;
      if (m.text) chars += m.text.length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
      if (m.toolResults) chars += m.toolResults.reduce((a, r) => a + r.content.length, 0);
      return s + Math.ceil(chars / 4);
    }, 0);
    return { system, history, total: system + history };
  }

  /** Record a context build event to HarnessObserver */
  static trackContextBuild(sessionId: string, systemPrompt: string, messages: ConversationTurn[]): void {
    const usage = this.estimateContextUsage(systemPrompt, messages);
    HarnessObserver.recordContextBuild(sessionId, usage);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/agent/harness/ContextEngine.test.ts 2>&1 | tail -10
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/harness/ContextEngine.ts src/lib/agent/harness/ContextEngine.test.ts
git commit -m "feat(harness-1): ContextEngine — history compaction + token estimation"
```

---

## Task 6: Wire ContextEngine into AgentLoop + token badge in AIChat

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/components/ai/AIChat.tsx`

- [ ] **Step 1: Add imports to AgentLoop.ts**

At the top of `src/lib/agent/AgentLoop.ts`, after the existing imports, add:

```typescript
import { ContextEngine, DEFAULT_BUDGET } from "./harness/ContextEngine";
import { HarnessObserver } from "./harness/HarnessObserver";
```

- [ ] **Step 2: Wire compaction into the main loop in AgentLoop.ts**

In `runAgentLoop`, find the line:
```typescript
const system = buildSystemPrompt(schema, currentSQL, currentResults, agentMode, options.memoryContext, queryDepth);
```

Add a `sessionId` generation right before the loop, and wire in ContextEngine inside the `for (let round = 0; round < MAX_ROUNDS; round++)` loop, just before `provider.stream()`:

Replace the beginning of `runAgentLoop` (from `const { agentMode, addPlanStep }` through `let finalText = "";`) with:

```typescript
  const { agentMode, addPlanStep } = useWorkspaceStore.getState();
  const queryDepth = classifyQueryDepth(userMessage);
  const system = buildSystemPrompt(schema, currentSQL, currentResults, agentMode, options.memoryContext, queryDepth);

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  HarnessObserver.startSession(sessionId, userMessage);

  const working: ConversationTurn[] = [
    ...history,
    { role: "user", text: userMessage },
  ];

  const userToolDefs = useUserToolStore.getState().tools.map(userToolToUnifiedTool);
  const allTools = [...AGENT_TOOLS, ...userToolDefs];

  let finalText = "";
  const MAX_ROUNDS = 10;
```

Then inside the `for` loop, replace:
```typescript
    const { text, toolCalls, stopReason } = await withRetry(
      () => provider.stream({
        system,
        history: working,
        model,
        tools: allTools,
        onToken,
      }),
```
with:
```typescript
    // Phase 0: compact history before each model call
    const compactedWorking = ContextEngine.compactHistory(working, DEFAULT_BUDGET);
    ContextEngine.trackContextBuild(sessionId, system, compactedWorking);

    const { text, toolCalls, stopReason } = await withRetry(
      () => provider.stream({
        system,
        history: compactedWorking,
        model,
        tools: allTools,
        onToken,
      }),
```

- [ ] **Step 3: Return sessionId from runAgentLoop so AIChat can display token estimate**

Change the return type and return statement:

```typescript
// Change return type:
): Promise<{ finalText: string; updatedHistory: ConversationTurn[]; queryDepth: 'fast' | 'deep'; sessionId: string }>

// Change final return:
  await HarnessObserver.finalizeSession(sessionId, true, 'v1.0');
  return { finalText, updatedHistory: working.slice(-40), queryDepth, sessionId };
```

- [ ] **Step 4: Add token badge to AIChat.tsx**

Read `src/components/ai/AIChat.tsx`. Find the chat input area / footer section. Add a token counter state and render it.

At the top of the component function, add:
```typescript
const [tokenEstimate, setTokenEstimate] = useState<number>(0);
```

After `runAgentLoop` resolves, update the estimate:
```typescript
const { finalText, updatedHistory, queryDepth, sessionId } = await runAgentLoop(...);
const usage = HarnessObserver.getLatestTokenEstimate(sessionId);
if (usage) setTokenEstimate(usage.total);
```

In the JSX footer (or below the chat input), add:
```tsx
{tokenEstimate > 0 && (
  <span
    className={`text-xs font-mono px-2 py-0.5 rounded ${
      tokenEstimate > 120_000 ? 'text-red-400 bg-red-900/20' :
      tokenEstimate > 50_000  ? 'text-amber-400 bg-amber-900/20' :
                                'text-green-400 bg-green-900/20'
    }`}
  >
    ~{tokenEstimate.toLocaleString()} ctx tokens
  </span>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error|Error" | head -10
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/AgentLoop.ts src/components/ai/AIChat.tsx
git commit -m "feat(harness-1): wire ContextEngine into AgentLoop + token badge in AIChat"
```

---

## Task 7: HarnessLifecycle — lifecycle hooks + struggle detection (H-2)

**Files:**
- Create: `src/lib/agent/harness/HarnessLifecycle.ts`
- Create: `src/lib/agent/harness/HarnessLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/agent/harness/HarnessLifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { detectStruggle } from './HarnessLifecycle';
import type { SessionContext } from './HarnessLifecycle';

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'test-session',
    connectionId: 'conn-1',
    question: 'test question',
    toolsCalledSoFar: [],
    errorsSoFar: [],
    startTime: Date.now(),
    iterationCount: 0,
    ...overrides,
  };
}

describe('detectStruggle', () => {
  it('returns null when no patterns detected', () => {
    expect(detectStruggle(makeCtx())).toBeNull();
  });

  it('detects same_tool_called_3x', () => {
    const ctx = makeCtx({
      toolsCalledSoFar: ['execute_sql', 'execute_sql', 'execute_sql'],
    });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('same_tool_called_3x');
    expect(result?.details).toBe('execute_sql');
  });

  it('detects repeated_tool_errors after 2 errors', () => {
    const ctx = makeCtx({
      errorsSoFar: [
        { tool: 'execute_sql', error: 'bad sql' },
        { tool: 'execute_sql', error: 'still bad' },
      ],
    });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('repeated_tool_errors');
  });

  it('detects no_progress_5_iters at iteration 5', () => {
    const ctx = makeCtx({ iterationCount: 5 });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('no_progress_5_iters');
  });

  it('same_tool_called_3x takes priority over iteration count', () => {
    const ctx = makeCtx({
      toolsCalledSoFar: ['execute_sql', 'execute_sql', 'execute_sql'],
      iterationCount: 5,
    });
    expect(detectStruggle(ctx)?.type).toBe('same_tool_called_3x');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/lib/agent/harness/HarnessLifecycle.test.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Create HarnessLifecycle.ts**

```typescript
// src/lib/agent/harness/HarnessLifecycle.ts
// Lifecycle hooks and struggle detection for the APEX agent harness.
import { invoke } from "@tauri-apps/api/core";
import { HarnessObserver } from "./HarnessObserver";
import { useWorkspaceStore } from "../../stores/WorkspaceStore";

export interface SessionContext {
  sessionId: string;
  connectionId: string | null;
  question: string;
  toolsCalledSoFar: string[];
  errorsSoFar: { tool: string; error: string }[];
  startTime: number;
  iterationCount: number;
}

export interface StruggleEvidence {
  type: 'repeated_tool_errors' | 'same_tool_called_3x' | 'no_progress_5_iters';
  details: string;
}

export interface SessionResult {
  success: boolean;
  toolsUsed: string[];
  totalDurationMs: number;
  tokenEstimate: number;
  errorCount: number;
}

export interface HarnessHooks {
  onSessionStart: (ctx: SessionContext) => Promise<void>;
  onBeforeToolCall: (tool: string, input: unknown, ctx: SessionContext) => Promise<void>;
  onAfterToolCall: (tool: string, input: unknown, output: unknown, durationMs: number, ctx: SessionContext) => Promise<void>;
  onToolError: (tool: string, error: Error, ctx: SessionContext) => Promise<{ retry: boolean }>;
  onStruggleDetected: (ctx: SessionContext, evidence: StruggleEvidence) => Promise<string | null>;
  onSessionComplete: (ctx: SessionContext, result: SessionResult) => Promise<void>;
}

/** Detect if the agent is struggling based on session context patterns. */
export function detectStruggle(ctx: SessionContext): StruggleEvidence | null {
  // Pattern 1: same tool called 3+ times
  const toolCounts = new Map<string, number>();
  for (const t of ctx.toolsCalledSoFar) {
    toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
  }
  for (const [tool, count] of toolCounts) {
    if (count >= 3) return { type: 'same_tool_called_3x', details: tool };
  }

  // Pattern 2: 2+ tool errors
  if (ctx.errorsSoFar.length >= 2) {
    return {
      type: 'repeated_tool_errors',
      details: ctx.errorsSoFar.map(e => e.tool).join(', '),
    };
  }

  // Pattern 3: 5+ iterations
  if (ctx.iterationCount >= 5) {
    return { type: 'no_progress_5_iters', details: `${ctx.iterationCount} iterations` };
  }

  return null;
}

const RETRYABLE_TOOLS = new Set(['db_execute_query', 'db_execute', 'pi_get_history']);

/** Standard DataIQ lifecycle hooks — registered at runAgentLoop call time. */
export const DATAIQ_HOOKS: HarnessHooks = {
  async onSessionStart(ctx) {
    useWorkspaceStore.getState().setActiveQuestion(ctx.question);
    HarnessObserver.startSession(ctx.sessionId, ctx.question);
  },

  async onBeforeToolCall(_tool, _input, _ctx) {
    // PolicyEngine is called separately in AgentLoop before this hook
    // so this hook only needs to record the start time
    HarnessObserver.recordToolCallStart(_ctx.sessionId, _tool);
  },

  async onAfterToolCall(tool, _input, _output, durationMs, ctx) {
    HarnessObserver.recordToolCallComplete(ctx.sessionId, tool, durationMs, true);
    useWorkspaceStore.getState().addToolTried(tool);

    // Record telemetry edge: if tool queries a table, record dataset→analysis edge
    const toolInput = _input as Record<string, unknown>;
    if (tool === 'execute_sql' && typeof toolInput.sql === 'string') {
      const tableMatch = toolInput.sql.match(/FROM\s+"?(\w+)"?\."?(\w+)"?/i);
      if (tableMatch) {
        const tableName = `${tableMatch[1]}.${tableMatch[2]}`;
        invoke('harness_record_telemetry_edge', {
          fromNode: `dataset:${tableName}`,
          toNode: `analysis:${tool}`,
          edgeType: 'queried',
          sessionId: ctx.sessionId,
        }).catch(console.error);
      }
    }
  },

  async onToolError(tool, error, ctx) {
    HarnessObserver.recordToolError(ctx.sessionId, tool, error.message);
    const isRetryable = RETRYABLE_TOOLS.has(tool) && ctx.errorsSoFar.length < 2;
    return { retry: isRetryable };
  },

  async onStruggleDetected(ctx, evidence) {
    HarnessObserver.recordStruggle(ctx.sessionId, evidence.type, evidence.details);

    if (evidence.type === 'repeated_tool_errors') {
      return `HARNESS NOTICE: The tool '${evidence.details}' has failed multiple times. Try a different approach or ask the user for clarification. Do not retry the same failing tool.`;
    }
    if (evidence.type === 'same_tool_called_3x') {
      return `HARNESS NOTICE: You have called '${evidence.details}' 3 times with similar inputs. The repeated calls suggest this approach is not working. Consider: (1) using a different tool, (2) asking the user, (3) reporting what you found so far.`;
    }
    if (evidence.type === 'no_progress_5_iters') {
      return `HARNESS NOTICE: After ${ctx.iterationCount} iterations, consider summarizing what you have found so far and asking the user if they want to continue or change direction.`;
    }
    return null;
  },

  async onSessionComplete(ctx, result) {
    // Store episode in EpisodicMemory
    try {
      await invoke('memory_insert_episode', {
        episode: {
          id: `${ctx.sessionId}-ep`,
          session_id: ctx.sessionId,
          connection_id: ctx.connectionId,
          problem: ctx.question,
          tools_used: JSON.stringify(result.toolsUsed),
          findings: JSON.stringify({ duration: result.totalDurationMs, errors: result.errorCount }),
          outcome: result.success ? 'completed' : 'failed',
          embedding: JSON.stringify([]),
          created_at: Date.now(),
        }
      });
    } catch (e) {
      console.error('[HarnessLifecycle] Failed to store episode:', e);
    }

    await HarnessObserver.finalizeSession(ctx.sessionId, result.success, 'v1.0');
  },
};
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/agent/harness/HarnessLifecycle.test.ts 2>&1 | tail -10
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/harness/HarnessLifecycle.ts src/lib/agent/harness/HarnessLifecycle.test.ts
git commit -m "feat(harness-2): HarnessLifecycle — hooks + struggle detection"
```

---

## Task 8: Wire HarnessLifecycle into AgentLoop

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

- [ ] **Step 1: Add imports**

In `AgentLoop.ts`, add after existing harness imports:

```typescript
import { DATAIQ_HOOKS, detectStruggle } from "./harness/HarnessLifecycle";
import type { SessionContext } from "./harness/HarnessLifecycle";
```

- [ ] **Step 2: Create SessionContext at the start of runAgentLoop**

After `const sessionId = ...` line, add:

```typescript
  const ctx: SessionContext = {
    sessionId,
    connectionId,
    question: userMessage,
    toolsCalledSoFar: [],
    errorsSoFar: [],
    startTime: Date.now(),
    iterationCount: 0,
  };

  await DATAIQ_HOOKS.onSessionStart(ctx);
```

- [ ] **Step 3: Wire hooks into the tool execution loop**

Inside the `for (const tc of toolCalls)` loop, replace the current tool execution block:

Find this pattern:
```typescript
      onToolStart(tc.name, tc.input);
      let result: CommandResult;
```

Replace with:
```typescript
      onToolStart(tc.name, tc.input);
      await DATAIQ_HOOKS.onBeforeToolCall(tc.name, tc.input, ctx);
      ctx.toolsCalledSoFar.push(tc.name);
      const toolStartTime = Date.now();
      let result: CommandResult;
```

After the `result = await commandBus.dispatch(cmd);` line (the non-plan-mode dispatch), add:
```typescript
        await DATAIQ_HOOKS.onAfterToolCall(tc.name, tc.input, result, Date.now() - toolStartTime, ctx);
```

In the error handling path (when `!cmd`), add:
```typescript
        ctx.errorsSoFar.push({ tool: tc.name, error: `Unknown tool: ${tc.name}` });
```

- [ ] **Step 4: Add struggle detection + injection at each iteration**

At the top of the `for (let round = 0; ...)` loop, AFTER the `ctx.iterationCount++` increment (add this line first), add:

```typescript
    ctx.iterationCount++;

    // Struggle detection: inject corrective context if struggling
    const struggle = detectStruggle(ctx);
    if (struggle) {
      const injection = await DATAIQ_HOOKS.onStruggleDetected(ctx, struggle);
      if (injection) {
        working.push({ role: 'user', text: injection });
      }
    }
```

- [ ] **Step 5: Call onSessionComplete at the end**

Replace the final return in `runAgentLoop`:

```typescript
  const sessionResult = {
    success: true,
    toolsUsed: [...new Set(ctx.toolsCalledSoFar)],
    totalDurationMs: Date.now() - ctx.startTime,
    tokenEstimate: HarnessObserver.getLatestTokenEstimate(sessionId)?.total ?? 0,
    errorCount: ctx.errorsSoFar.length,
  };
  await DATAIQ_HOOKS.onSessionComplete(ctx, sessionResult);

  return { finalText, updatedHistory: working.slice(-40), queryDepth, sessionId };
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent/AgentLoop.ts
git commit -m "feat(harness-2): wire HarnessLifecycle hooks into AgentLoop — struggle detection + lifecycle"
```

---

## Task 9: PolicyEngine — built-in policies (H-5)

**Files:**
- Create: `src/lib/agent/harness/PolicyEngine.ts`
- Create: `src/lib/agent/harness/PolicyEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/agent/harness/PolicyEngine.test.ts
import { describe, it, expect } from 'vitest';
import { PolicyEngine, DATAIQ_POLICIES } from './PolicyEngine';
import type { PolicyContext } from './PolicyEngine';

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    sessionId: 'test',
    connectionId: 'conn-1',
    question: 'test',
    isReadOnly: false,
    connectionType: 'postgresql',
    piiColumns: [],
    ...overrides,
  };
}

describe('PolicyEngine.evaluate', () => {
  it('allows safe tools on normal connections', () => {
    const result = PolicyEngine.evaluate('execute_sql', { sql: 'SELECT 1' }, makeCtx());
    expect(result.allowed).toBe(true);
  });

  it('blocks write tools on read-only connections', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'DELETE FROM users WHERE id = 1' },
      makeCtx({ isReadOnly: true })
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('read-only');
  });

  it('blocks PI historian write attempts', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'DELETE FROM tags' },
      makeCtx({ connectionType: 'PIHistorian' })
    );
    expect(result.allowed).toBe(false);
    expect(result.policyId).toBe('pi-historian-readonly');
  });

  it('blocks queries without LIMIT on large tables', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'SELECT * FROM sensor_readings' },
      makeCtx()
    );
    expect(result.allowed).toBe(false);
    expect(result.policyId).toBe('row-limit-enforcer');
  });

  it('allows aggregate queries without LIMIT', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'SELECT COUNT(*) FROM sensor_readings' },
      makeCtx()
    );
    expect(result.allowed).toBe(true);
  });

  it('allows SELECT with LIMIT', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'SELECT * FROM sensor_readings LIMIT 100' },
      makeCtx()
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks PII columns from being queried', () => {
    const result = PolicyEngine.evaluate(
      'execute_sql',
      { sql: 'SELECT email, name FROM users' },
      makeCtx({ piiColumns: ['email'] })
    );
    expect(result.allowed).toBe(false);
    expect(result.policyId).toBe('no-pii-in-ai-context');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/lib/agent/harness/PolicyEngine.test.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Create PolicyEngine.ts**

```typescript
// src/lib/agent/harness/PolicyEngine.ts
// Executable policy checks applied to every tool call before execution.

export interface PolicyContext {
  sessionId: string;
  connectionId: string | null;
  question: string;
  isReadOnly: boolean;
  connectionType: string;   // 'postgresql' | 'mysql' | 'PIHistorian' | etc.
  piiColumns: string[];     // column names tagged as PII for this connection
}

export interface PolicyResult {
  allowed: boolean;
  policyId?: string;
  policyName?: string;
  reason?: string;
}

export interface Policy {
  id: string;
  name: string;
  check: (tool: string, input: unknown, ctx: PolicyContext) => string | null;
}

const WRITE_SQL_PATTERNS = /^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE|ALTER)\b/i;
const WRITE_TOOLS = new Set(['delete_rows', 'drop_column', 'rename_table', 'bulk_transform', 'add_column', 'update_cell', 'insert_row']);
const HAS_LIMIT = /\bLIMIT\s+\d+/i;
const HAS_AGGREGATE = /\b(COUNT|SUM|AVG|MAX|MIN|GROUP\s+BY|HAVING|DISTINCT)\b/i;

export const DATAIQ_POLICIES: Policy[] = [
  {
    id: 'no-write-on-readonly',
    name: 'No writes on read-only connections',
    check: (tool, input, ctx) => {
      if (!ctx.isReadOnly) return null;
      if (WRITE_TOOLS.has(tool)) {
        return `Connection is read-only — '${tool}' is blocked`;
      }
      if (tool === 'execute_sql') {
        const sql = ((input as Record<string, unknown>).sql as string) ?? '';
        if (WRITE_SQL_PATTERNS.test(sql)) {
          return `Connection is read-only — write SQL is blocked`;
        }
      }
      return null;
    },
  },

  {
    id: 'pi-historian-readonly',
    name: 'PI Historian is always read-only',
    check: (tool, input, ctx) => {
      if (ctx.connectionType !== 'PIHistorian') return null;
      if (WRITE_TOOLS.has(tool)) {
        return `PI Historian connections are permanently read-only`;
      }
      if (tool === 'execute_sql') {
        const sql = ((input as Record<string, unknown>).sql as string) ?? '';
        if (WRITE_SQL_PATTERNS.test(sql)) {
          return `PI Historian connections are permanently read-only`;
        }
      }
      return null;
    },
  },

  {
    id: 'row-limit-enforcer',
    name: 'Enforce row limits on SELECT queries',
    check: (tool, input, _ctx) => {
      if (tool !== 'execute_sql') return null;
      const sql = ((input as Record<string, unknown>).sql as string) ?? '';
      // Only apply to SELECT queries
      if (!/^\s*SELECT\b/i.test(sql)) return null;
      if (HAS_LIMIT.test(sql) || HAS_AGGREGATE.test(sql)) return null;
      return `Query must include LIMIT or aggregate functions (COUNT, SUM, AVG, etc.). Add LIMIT to prevent scanning millions of rows.`;
    },
  },

  {
    id: 'no-pii-in-ai-context',
    name: 'Block PII columns from AI context',
    check: (tool, input, ctx) => {
      if (ctx.piiColumns.length === 0) return null;
      if (tool !== 'execute_sql') return null;
      const sql = ((input as Record<string, unknown>).sql as string) ?? '';
      const violating = ctx.piiColumns.filter(col =>
        new RegExp(`\\b${col}\\b`, 'i').test(sql)
      );
      if (violating.length > 0) {
        return `Query references PII-tagged columns: ${violating.join(', ')}. These cannot be sent to the AI model.`;
      }
      return null;
    },
  },
];

export class PolicyEngine {
  static evaluate(
    tool: string,
    input: unknown,
    ctx: PolicyContext,
    policies: Policy[] = DATAIQ_POLICIES
  ): PolicyResult {
    for (const policy of policies) {
      const reason = policy.check(tool, input, ctx);
      if (reason) {
        return { allowed: false, policyId: policy.id, policyName: policy.name, reason };
      }
    }
    return { allowed: true };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/agent/harness/PolicyEngine.test.ts 2>&1 | tail -10
```
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/harness/PolicyEngine.ts src/lib/agent/harness/PolicyEngine.test.ts
git commit -m "feat(harness-5): PolicyEngine — 4 built-in policies with tests"
```

---

## Task 10: Wire PolicyEngine into HarnessLifecycle + policy UI in AIChat

**Files:**
- Modify: `src/lib/agent/harness/HarnessLifecycle.ts`
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/components/ai/AIChat.tsx`

- [ ] **Step 1: Import PolicyEngine in HarnessLifecycle.ts**

Add at top of `HarnessLifecycle.ts`:
```typescript
import { PolicyEngine } from './PolicyEngine';
import type { PolicyContext } from './PolicyEngine';
```

Add a `policyContext` field to `SessionContext`:
```typescript
export interface SessionContext {
  sessionId: string;
  connectionId: string | null;
  question: string;
  toolsCalledSoFar: string[];
  errorsSoFar: { tool: string; error: string }[];
  startTime: number;
  iterationCount: number;
  policyContext: PolicyContext;  // ADD THIS
}
```

Update `onBeforeToolCall` in `DATAIQ_HOOKS` to run policy check:
```typescript
  async onBeforeToolCall(tool, input, ctx) {
    HarnessObserver.recordToolCallStart(ctx.sessionId, tool);

    const policyResult = PolicyEngine.evaluate(tool, input, ctx.policyContext);
    if (!policyResult.allowed) {
      HarnessObserver.recordPolicyViolation(ctx.sessionId, policyResult.policyId!, tool);
      throw new Error(`🛡️ Policy [${policyResult.policyName}]: ${policyResult.reason}`);
    }
  },
```

- [ ] **Step 2: Build PolicyContext in AgentLoop.ts**

In `runAgentLoop`, after creating `ctx`, add:

```typescript
  const activeConn = useWorkspaceStore.getState().connections.find(c => c.id === connectionId);
  const policyContext: import('./harness/PolicyEngine').PolicyContext = {
    sessionId,
    connectionId,
    question: userMessage,
    isReadOnly: (activeConn as Record<string, unknown>)?.isReadOnly === true,
    connectionType: (activeConn as Record<string, unknown>)?.type as string ?? 'postgresql',
    piiColumns: [],
  };
  ctx.policyContext = policyContext;
```

- [ ] **Step 3: Handle policy errors in tool execution (AgentLoop.ts)**

In the tool dispatch, the `DATAIQ_HOOKS.onBeforeToolCall` can throw a policy error. Wrap it:

```typescript
      try {
        await DATAIQ_HOOKS.onBeforeToolCall(tc.name, tc.input, ctx);
      } catch (policyErr) {
        const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
        ctx.errorsSoFar.push({ tool: tc.name, error: msg });
        toolResults!.push({
          toolCallId: tc.id,
          name: tc.name,
          content: msg,
          isError: true,
        });
        onToken(`\n${msg}\n`);
        continue;
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -10
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/harness/HarnessLifecycle.ts src/lib/agent/AgentLoop.ts src/components/ai/AIChat.tsx
git commit -m "feat(harness-5): wire PolicyEngine into HarnessLifecycle onBeforeToolCall"
```

---

## Task 11: FailureTraceStore — TypeScript client for harness DB (H-4)

**Files:**
- Create: `src/lib/agent/harness/FailureTraceStore.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/agent/harness/FailureTraceStore.ts
// TypeScript client for the harness_failure_traces + harness_versions tables.
import { invoke } from "@tauri-apps/api/core";

export interface HarnessFailureTrace {
  id: string;
  sessionId: string;
  question: string;
  toolsUsed: string[];   // parsed from JSON string
  errors: { tool: string; error: string }[];
  struggleEvents: { type: string; details: string }[];
  finalSuccess: boolean;
  tokenEstimate: number | null;
  durationMs: number | null;
  harnessVersion: string;
  createdAt: number;
}

export interface HarnessVersion {
  id: string;
  versionTag: string;
  systemPromptAdditions: string;
  successRate: number | null;
  avgTokenEstimate: number | null;
  failureCount: number;
  isActive: boolean;
  createdAt: number;
}

// Raw shape from Rust (snake_case)
interface RawHarnessTrace {
  id: string;
  session_id: string;
  question: string;
  tools_used: string;
  errors: string;
  struggle_events: string;
  final_success: number;
  token_estimate: number | null;
  duration_ms: number | null;
  harness_version: string;
  created_at: number;
}

interface RawHarnessVersion {
  id: string;
  version_tag: string;
  system_prompt_additions: string;
  success_rate: number | null;
  avg_token_estimate: number | null;
  failure_count: number;
  is_active: number;
  created_at: number;
}

function parseTrace(r: RawHarnessTrace): HarnessFailureTrace {
  return {
    id: r.id,
    sessionId: r.session_id,
    question: r.question,
    toolsUsed: tryParse(r.tools_used, []),
    errors: tryParse(r.errors, []),
    struggleEvents: tryParse(r.struggle_events, []),
    finalSuccess: r.final_success === 1,
    tokenEstimate: r.token_estimate,
    durationMs: r.duration_ms,
    harnessVersion: r.harness_version,
    createdAt: r.created_at,
  };
}

function parseVersion(r: RawHarnessVersion): HarnessVersion {
  return {
    id: r.id,
    versionTag: r.version_tag,
    systemPromptAdditions: r.system_prompt_additions,
    successRate: r.success_rate,
    avgTokenEstimate: r.avg_token_estimate,
    failureCount: r.failure_count,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  };
}

function tryParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

export class FailureTraceStore {
  static async getRecentFailures(limit = 50): Promise<HarnessFailureTrace[]> {
    const raw = await invoke<RawHarnessTrace[]>('harness_get_failures', { limit });
    return raw.map(parseTrace);
  }

  static async getActiveVersion(): Promise<HarnessVersion | null> {
    const raw = await invoke<RawHarnessVersion | null>('harness_get_active_version');
    return raw ? parseVersion(raw) : null;
  }

  static async saveVersion(versionTag: string, systemPromptAdditions: string): Promise<string> {
    return invoke<string>('harness_save_version', { versionTag, systemPromptAdditions });
  }

  static async activateVersion(id: string): Promise<void> {
    return invoke('harness_activate_version', { id });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep "FailureTraceStore"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/harness/FailureTraceStore.ts
git commit -m "feat(harness-4): FailureTraceStore — Tauri client for failure traces + harness versions"
```

---

## Task 12: HarnessOptimizer — meta-harness self-improvement (H-4)

**Files:**
- Create: `src/lib/agent/harness/HarnessOptimizer.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/agent/harness/HarnessOptimizer.ts
// Meta-harness: reads failure traces and proposes system prompt improvements.
// Based on Stanford Meta-Harness paper (arxiv 2603.28052).
import type { AIProvider } from '../../ai/types';
import { FailureTraceStore } from './FailureTraceStore';

export interface OptimizationResult {
  skipped: boolean;
  skipReason?: string;
  candidateId?: string;
  analysis?: string;
  proposedAdditions?: string;
  expectedImprovement?: string;
  confidence?: number;
  failuresAnalyzed?: number;
}

export class HarnessOptimizer {
  /**
   * Analyze recent failure traces and propose system prompt improvements.
   * Returns a candidate version that can be reviewed and activated.
   */
  static async runOptimizationCycle(
    provider: AIProvider,
    model: string
  ): Promise<OptimizationResult> {
    const failures = await FailureTraceStore.getRecentFailures(50);

    if (failures.length < 5) {
      return { skipped: true, skipReason: `Insufficient failure data — need 5+ traces, have ${failures.length}` };
    }

    const currentVersion = await FailureTraceStore.getActiveVersion();
    const currentAdditions = currentVersion?.systemPromptAdditions ?? '(none)';

    const failureSummaries = failures.slice(0, 20).map(f => `
Question: "${f.question.slice(0, 120)}"
Tools tried: ${f.toolsUsed.join(', ')}
Errors: ${f.errors.map(e => `${e.tool}: ${e.error}`).join('; ').slice(0, 200)}
Struggles: ${f.struggleEvents.map(s => s.type).join(', ') || 'none'}
Success: ${f.finalSuccess}`).join('\n---\n');

    const analysisPrompt = `You are analyzing AI agent failure traces to improve the agent harness system prompt.

Current harness additions (already in prompt):
${currentAdditions}

RECENT FAILURE TRACES (${failures.length} total, showing first 20):
${failureSummaries}

Your task: propose SPECIFIC, CONCRETE additions to the system prompt that would prevent these failures.
Focus on:
1. Patterns in which questions caused failures
2. Which tools were misused or called incorrectly
3. What context or instructions were missing

Return ONLY valid JSON in this exact format:
{
  "analysis": "2-3 sentences describing the failure patterns you identified",
  "proposed_additions": "Exact text to add to the system prompt. Must be actionable instructions, not vague advice.",
  "expected_improvement": "Which specific failure types this should fix",
  "confidence": 0.75
}`;

    let responseText = '';
    try {
      const result = await provider.stream({
        system: 'You are a harness engineering expert. Respond with valid JSON only.',
        history: [{ role: 'user', text: analysisPrompt }],
        model,
        tools: [],
        onToken: (t) => { responseText += t; },
      });
      responseText = result.text || responseText;
    } catch (e) {
      return { skipped: true, skipReason: `Provider error: ${String(e)}` };
    }

    // Extract JSON from response
    let proposal: { analysis: string; proposed_additions: string; expected_improvement: string; confidence: number };
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      proposal = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return { skipped: true, skipReason: `Failed to parse optimizer response: ${String(e)}` };
    }

    // Save as candidate version (not yet active)
    const candidateId = await FailureTraceStore.saveVersion(
      `meta-${Date.now()}`,
      proposal.proposed_additions
    );

    return {
      skipped: false,
      candidateId,
      analysis: proposal.analysis,
      proposedAdditions: proposal.proposed_additions,
      expectedImprovement: proposal.expected_improvement,
      confidence: proposal.confidence,
      failuresAnalyzed: failures.length,
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep "HarnessOptimizer"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/harness/HarnessOptimizer.ts
git commit -m "feat(harness-4): HarnessOptimizer — meta-harness reads failures, proposes prompt improvements"
```

---

## Task 13: Load active harness version into AgentLoop system prompt (H-4)

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

- [ ] **Step 1: Add import**

```typescript
import { FailureTraceStore } from "./harness/FailureTraceStore";
```

- [ ] **Step 2: Load active version and append to system prompt**

In `runAgentLoop`, after `const system = buildSystemPrompt(...)`, add:

```typescript
  // Append meta-harness learned improvements from active harness version
  let finalSystem = system;
  try {
    const activeVersion = await FailureTraceStore.getActiveVersion();
    if (activeVersion?.systemPromptAdditions) {
      finalSystem = system + '\n\n## Harness Learned Improvements\n' + activeVersion.systemPromptAdditions;
    }
  } catch {
    // Non-critical — proceed with base system prompt
  }
```

Then replace all uses of `system` in `provider.stream()` calls with `finalSystem`:
- In `ContextEngine.trackContextBuild(sessionId, system, ...)` → `ContextEngine.trackContextBuild(sessionId, finalSystem, ...)`
- In `provider.stream({ system, ... })` → `provider.stream({ system: finalSystem, ... })`

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/AgentLoop.ts
git commit -m "feat(harness-4): inject active harness version into APEX system prompt"
```

---

## Task 14: ImpactMapEngine — plan before execute (H-3)

**Files:**
- Create: `src/lib/agent/harness/ImpactMapEngine.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/agent/harness/ImpactMapEngine.ts
// Generates a human-reviewable analysis plan before APEX executes tools.
// Based on Red Hat two-phase pattern (Rizzi, 2026).
import type { AIProvider } from '../../ai/types';
import type { FullSchema } from '../../db/DbClient';

export type ImpactMapAction = 'query_table' | 'run_analysis' | 'create_chart' | 'generate_report';

export interface PlannedStep {
  order: number;
  action: ImpactMapAction;
  target: string;
  reason: string;
  estimatedRows?: number;
}

export interface AnalysisImpactMap {
  sessionId: string;
  question: string;
  plannedSteps: PlannedStep[];
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  expectedOutputs: string[];
  clarifyingQuestions: string[];
}

const COMPLEX_TRIGGERS = [
  'analyze', 'analyse', 'investigate', 'find root cause', 'root cause',
  'run a study', 'create dashboard', 'build report', 'compare', 'correlate',
  'anomaly', 'diagnose', 'why is', 'why are', 'why does',
];

const HIGH_RISK_TRIGGERS = [
  'delete', 'drop', 'truncate', 'update all', 'modify', 'alter', 'bulk',
];

export class ImpactMapEngine {
  /** Determine if a complex request warrants an impact map. */
  static needsImpactMap(question: string, tableCount: number): boolean {
    const q = question.toLowerCase();
    const isComplex = COMPLEX_TRIGGERS.some(t => q.includes(t));
    const hasMultipleTables = tableCount > 5;
    const wordCount = question.trim().split(/\s+/).length;
    return isComplex || (hasMultipleTables && wordCount > 10);
  }

  /** Generate an impact map using a fast model call (no tools). */
  static async generate(
    question: string,
    schema: FullSchema | null,
    provider: AIProvider,
    model: string,
    sessionId: string
  ): Promise<AnalysisImpactMap> {
    const tableList = schema
      ? schema.tables.slice(0, 30).map(t => `${t.schema}.${t.name}`).join(', ')
      : '(no schema loaded)';

    const riskLevel = HIGH_RISK_TRIGGERS.some(t => question.toLowerCase().includes(t))
      ? 'high'
      : 'medium';

    const planPrompt = `You are planning a database analysis. Do NOT execute anything — just plan.

User question: "${question}"
Available tables: ${tableList}

Produce a JSON plan:
{
  "plannedSteps": [
    { "order": 1, "action": "query_table|run_analysis|create_chart|generate_report", "target": "table_name_or_tool", "reason": "why this step" }
  ],
  "riskLevel": "${riskLevel}",
  "riskReasons": ["list specific risks or empty array"],
  "expectedOutputs": ["what the user will see after this analysis"],
  "clarifyingQuestions": ["any ambiguities that need answering before proceeding, or empty array"]
}

Return ONLY valid JSON. Maximum 5 steps. Be concise.`;

    let responseText = '';
    try {
      const result = await provider.stream({
        system: 'You are a planning assistant. Respond with valid JSON only.',
        history: [{ role: 'user', text: planPrompt }],
        model,
        tools: [],
        onToken: (t) => { responseText += t; },
      });
      responseText = result.text || responseText;
    } catch {
      // Fallback: return a simple generic plan
      return {
        sessionId,
        question,
        plannedSteps: [{ order: 1, action: 'query_table', target: 'unknown', reason: 'General query' }],
        riskLevel: 'low',
        riskReasons: [],
        expectedOutputs: ['Query results'],
        clarifyingQuestions: [],
      };
    }

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');
      const plan = JSON.parse(jsonMatch[0]);
      return { sessionId, question, ...plan };
    } catch {
      return {
        sessionId,
        question,
        plannedSteps: [{ order: 1, action: 'query_table', target: 'to be determined', reason: 'Analysis starting point' }],
        riskLevel: 'medium',
        riskReasons: ['Unable to generate detailed plan'],
        expectedOutputs: ['Analysis results'],
        clarifyingQuestions: [],
      };
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep "ImpactMapEngine"
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/harness/ImpactMapEngine.ts
git commit -m "feat(harness-3): ImpactMapEngine — generates analysis plan before execution"
```

---

## Task 15: ImpactMapPanel + WorkspaceStore additions + wire into AgentLoop (H-3)

**Files:**
- Create: `src/components/ai/ImpactMapPanel.tsx`
- Modify: `src/lib/stores/WorkspaceStore.ts`
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/components/ai/AIChat.tsx`

- [ ] **Step 1: Add ImpactMap state to WorkspaceStore.ts**

Add to `WorkspaceState` interface (after `pendingChatInput`):
```typescript
  // Impact Map (H-3)
  pendingImpactMap: import('../agent/harness/ImpactMapEngine').AnalysisImpactMap | null;
  setPendingImpactMap: (plan: import('../agent/harness/ImpactMapEngine').AnalysisImpactMap | null) => void;
  impactMapResolution: { approved: boolean; answers: string[] } | null;
  resolveImpactMap: (resolution: { approved: boolean; answers: string[] }) => void;
```

Add initial values in the `create` call:
```typescript
    pendingImpactMap: null,
    impactMapResolution: null,
```

Add implementations in the `immer` function:
```typescript
    setPendingImpactMap: (plan) =>
      set((state) => { state.pendingImpactMap = plan as WorkspaceState['pendingImpactMap']; }),

    resolveImpactMap: (resolution) =>
      set((state) => {
        state.impactMapResolution = resolution;
        state.pendingImpactMap = null;
      }),
```

- [ ] **Step 2: Create ImpactMapPanel.tsx**

```tsx
// src/components/ai/ImpactMapPanel.tsx
// Shows the impact map for user review BEFORE APEX executes any tools.
import React from 'react';
import { useWorkspaceStore } from '../../lib/stores/WorkspaceStore';
import type { AnalysisImpactMap, PlannedStep } from '../../lib/agent/harness/ImpactMapEngine';

const ACTION_ICONS: Record<string, string> = {
  query_table: '🗄️',
  run_analysis: '📊',
  create_chart: '📈',
  generate_report: '📄',
};

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400 border-green-700 bg-green-900/20',
  medium: 'text-amber-400 border-amber-700 bg-amber-900/20',
  high: 'text-red-400 border-red-700 bg-red-900/20',
};

function StepCard({ step }: { step: PlannedStep }) {
  return (
    <div className="flex gap-3 p-3 rounded border border-white/10 bg-white/5">
      <span className="text-2xl">{ACTION_ICONS[step.action] ?? '⚙️'}</span>
      <div>
        <div className="text-sm font-semibold text-white">
          {step.order}. {step.target}
        </div>
        <div className="text-xs text-white/60 mt-0.5">{step.reason}</div>
        {step.estimatedRows != null && (
          <div className="text-xs text-white/40 mt-0.5">~{step.estimatedRows.toLocaleString()} rows</div>
        )}
      </div>
    </div>
  );
}

export function ImpactMapPanel() {
  const plan = useWorkspaceStore(s => s.pendingImpactMap);
  const resolveImpactMap = useWorkspaceStore(s => s.resolveImpactMap);
  const [answers, setAnswers] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (plan?.clarifyingQuestions) {
      setAnswers(plan.clarifyingQuestions.map(() => ''));
    }
  }, [plan]);

  if (!plan) return null;

  const riskColorClass = RISK_COLORS[plan.riskLevel] ?? RISK_COLORS.medium;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">
            Analysis Plan — Review Before Executing
          </div>
          <div className="text-sm text-white/80 line-clamp-2">"{plan.question}"</div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* Planned steps */}
          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">
              Planned Steps ({plan.plannedSteps.length})
            </div>
            <div className="space-y-2">
              {plan.plannedSteps.map(step => <StepCard key={step.order} step={step} />)}
            </div>
          </div>

          {/* Risk */}
          {plan.riskLevel !== 'low' && plan.riskReasons.length > 0 && (
            <div className={`p-3 rounded border text-xs ${riskColorClass}`}>
              <div className="font-semibold mb-1 capitalize">⚠ {plan.riskLevel} Risk</div>
              <ul className="list-disc list-inside space-y-0.5">
                {plan.riskReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          {/* Expected outputs */}
          {plan.expectedOutputs.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">
                Expected Outputs
              </div>
              <ul className="text-xs text-white/70 list-disc list-inside space-y-0.5">
                {plan.expectedOutputs.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}

          {/* Clarifying questions */}
          {plan.clarifyingQuestions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">
                Clarifying Questions
              </div>
              <div className="space-y-2">
                {plan.clarifyingQuestions.map((q, i) => (
                  <div key={i}>
                    <div className="text-xs text-white/60 mb-1">{q}</div>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500"
                      placeholder="Your answer (optional)…"
                      value={answers[i] ?? ''}
                      onChange={e => {
                        const next = [...answers];
                        next[i] = e.target.value;
                        setAnswers(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="p-4 border-t border-white/10 flex gap-2">
          <button
            onClick={() => resolveImpactMap({ approved: true, answers })}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded transition-colors"
          >
            ✅ Approve & Execute
          </button>
          <button
            onClick={() => resolveImpactMap({ approved: false, answers: [] })}
            className="px-4 bg-white/10 hover:bg-white/20 text-white/70 text-sm py-2 rounded transition-colors"
          >
            ❌ Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire ImpactMapEngine into AgentLoop.ts**

Add import at top:
```typescript
import { ImpactMapEngine } from "./harness/ImpactMapEngine";
```

In `runAgentLoop`, after `await DATAIQ_HOOKS.onSessionStart(ctx)` and before the `for` loop, add:

```typescript
  // H-3: Impact Map — show plan for complex requests before executing
  const tableCount = schema?.tables.length ?? 0;
  if (ImpactMapEngine.needsImpactMap(userMessage, tableCount)) {
    const plan = await ImpactMapEngine.generate(userMessage, schema, provider, model, sessionId);
    useWorkspaceStore.getState().setPendingImpactMap(plan);

    // Wait for user approval (resolveImpactMap sets impactMapResolution)
    // Uses plain Zustand subscribe (no subscribeWithSelector needed).
    const resolution = await new Promise<{ approved: boolean; answers: string[] }>((resolve) => {
      const unsubscribe = useWorkspaceStore.subscribe((state) => {
        if (state.impactMapResolution !== null) {
          const res = state.impactMapResolution;
          unsubscribe();
          // Reset after consuming so it doesn't fire again
          useWorkspaceStore.setState({ impactMapResolution: null });
          resolve(res);
        }
      });
    });

    if (!resolution.approved) {
      await DATAIQ_HOOKS.onSessionComplete(ctx, {
        success: false, toolsUsed: [], totalDurationMs: Date.now() - ctx.startTime,
        tokenEstimate: 0, errorCount: 0,
      });
      return { finalText: 'Analysis cancelled.', updatedHistory: working, queryDepth, sessionId };
    }

    // Append clarifying answers to the user question if any were provided
    const nonEmptyAnswers = resolution.answers.filter(a => a.trim().length > 0);
    if (nonEmptyAnswers.length > 0) {
      working.push({
        role: 'user',
        text: 'Additional context: ' + nonEmptyAnswers.join('. '),
      });
    }
  }
```

- [ ] **Step 4: Add ImpactMapPanel to AIChat.tsx**

In `AIChat.tsx`, import and render the panel:
```tsx
import { ImpactMapPanel } from './ImpactMapPanel';

// Inside the JSX render, at the top level of the component's return:
<>
  <ImpactMapPanel />
  {/* rest of existing AIChat JSX */}
</>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -10
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/ImpactMapPanel.tsx src/lib/stores/WorkspaceStore.ts src/lib/agent/AgentLoop.ts src/components/ai/AIChat.tsx
git commit -m "feat(harness-3): ImpactMapPanel + WorkspaceStore state + wire into AgentLoop"
```

---

## Task 16: HarnessDashboard — health metrics + meta-harness UI (H-4/6)

**Files:**
- Create: `src/components/admin/HarnessDashboard.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/admin/HarnessDashboard.tsx
// Harness health dashboard — surfaces KPIs, failure analysis, and meta-harness optimizer.
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FailureTraceStore } from '../../lib/agent/harness/FailureTraceStore';
import { HarnessOptimizer } from '../../lib/agent/harness/HarnessOptimizer';
import type { HarnessFailureTrace, HarnessVersion } from '../../lib/agent/harness/FailureTraceStore';
import type { OptimizationResult } from '../../lib/agent/harness/HarnessOptimizer';
import { getProvider } from '../../lib/ai/providers/ProviderRegistry';
import { loadSettings, getActiveModel } from '../../lib/ai/types';

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
      <div className="text-xs text-white/40 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

export function HarnessDashboard({ onClose }: { onClose: () => void }) {
  const [traces, setTraces] = useState<HarnessFailureTrace[]>([]);
  const [versions, setVersions] = useState<HarnessVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<HarnessVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<HarnessFailureTrace | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [t, av] = await Promise.all([
        FailureTraceStore.getRecentFailures(50),
        FailureTraceStore.getActiveVersion(),
      ]);
      setTraces(t);
      setActiveVersion(av);
      if (av) setVersions([av]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const successCount = traces.filter(t => t.finalSuccess).length;
  const failCount = traces.filter(t => !t.finalSuccess).length;
  const successRate = traces.length > 0 ? Math.round((successCount / traces.length) * 100) : 0;
  const avgDuration = traces.length > 0
    ? Math.round(traces.reduce((s, t) => s + (t.durationMs ?? 0), 0) / traces.length / 1000)
    : 0;
  const avgTokens = traces.length > 0
    ? Math.round(traces.reduce((s, t) => s + (t.tokenEstimate ?? 0), 0) / traces.length)
    : 0;

  async function runOptimization() {
    setOptimizing(true);
    setOptimizationResult(null);
    try {
      const settings = loadSettings();
      const provider = await getProvider(settings);
      const model = getActiveModel(settings);
      const result = await HarnessOptimizer.runOptimizationCycle(provider, model);
      setOptimizationResult(result);
      if (!result.skipped) await refresh();
    } catch (e) {
      setOptimizationResult({ skipped: true, skipReason: String(e) });
    } finally {
      setOptimizing(false);
    }
  }

  async function activateVersion(id: string) {
    await FailureTraceStore.activateVersion(id);
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white">Harness Engineering Dashboard</h1>
          <p className="text-xs text-white/40">APEX agent harness health, failure analysis, and meta-harness optimizer</p>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-xl">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {loading ? (
          <div className="text-white/40 text-center py-20">Loading harness data…</div>
        ) : (
          <>
            {/* KPIs */}
            <section>
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Harness KPIs (last 50 sessions with issues)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Sessions Logged" value={traces.length.toString()} />
                <KpiCard label="Success Rate" value={`${successRate}%`} sub={`${successCount} succeeded, ${failCount} failed`} />
                <KpiCard label="Avg Duration" value={`${avgDuration}s`} />
                <KpiCard label="Avg Context Tokens" value={avgTokens > 0 ? avgTokens.toLocaleString() : '—'} />
              </div>
            </section>

            {/* Failure analysis */}
            <section>
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Recent Failed Sessions</h2>
              {traces.filter(t => !t.finalSuccess).length === 0 ? (
                <p className="text-sm text-white/40">No failed sessions recorded.</p>
              ) : (
                <div className="space-y-2">
                  {traces.filter(t => !t.finalSuccess).slice(0, 10).map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTrace(selectedTrace?.id === t.id ? null : t)}
                      className="w-full text-left p-3 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm text-white/80 line-clamp-1 flex-1">"{t.question}"</div>
                        <div className="text-xs text-white/40 shrink-0">
                          {t.errors.length} error{t.errors.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {selectedTrace?.id === t.id && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs text-white/60">
                            <span className="text-white/40">Tools: </span>{t.toolsUsed.join(', ') || '—'}
                          </div>
                          {t.errors.map((e, i) => (
                            <div key={i} className="text-xs text-red-400">
                              {e.tool}: {e.error.slice(0, 120)}
                            </div>
                          ))}
                          {t.struggleEvents.length > 0 && (
                            <div className="text-xs text-amber-400">
                              Struggles: {t.struggleEvents.map(s => s.type).join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Active harness version */}
            <section>
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Active Harness Version</h2>
              {activeVersion ? (
                <div className="p-4 rounded border border-blue-700 bg-blue-900/20">
                  <div className="text-sm font-semibold text-blue-300">{activeVersion.versionTag}</div>
                  {activeVersion.systemPromptAdditions && (
                    <pre className="text-xs text-white/60 mt-2 whitespace-pre-wrap font-mono">
                      {activeVersion.systemPromptAdditions.slice(0, 400)}
                      {activeVersion.systemPromptAdditions.length > 400 ? '…' : ''}
                    </pre>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/40">No active harness version. Run optimization to create one.</p>
              )}
            </section>

            {/* Meta-harness optimizer */}
            <section>
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Meta-Harness Optimizer</h2>
              <p className="text-xs text-white/50 mb-3">
                Analyzes recent failure traces and proposes system prompt improvements. Requires 5+ failure traces.
              </p>
              <button
                onClick={runOptimization}
                disabled={optimizing}
                className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
              >
                {optimizing ? '🔄 Analyzing…' : '🔄 Analyze Failures & Propose Improvements'}
              </button>

              {optimizationResult && (
                <div className={`mt-4 p-4 rounded border text-sm ${optimizationResult.skipped ? 'border-amber-700 bg-amber-900/20' : 'border-green-700 bg-green-900/20'}`}>
                  {optimizationResult.skipped ? (
                    <p className="text-amber-300">Skipped: {optimizationResult.skipReason}</p>
                  ) : (
                    <>
                      <p className="text-green-300 font-semibold mb-2">
                        Optimization complete — analyzed {optimizationResult.failuresAnalyzed} traces
                      </p>
                      <div className="text-xs text-white/70 space-y-2">
                        <div><span className="text-white/40">Analysis: </span>{optimizationResult.analysis}</div>
                        <div><span className="text-white/40">Expected improvement: </span>{optimizationResult.expectedImprovement}</div>
                        <div><span className="text-white/40">Confidence: </span>{((optimizationResult.confidence ?? 0) * 100).toFixed(0)}%</div>
                        <div>
                          <span className="text-white/40">Proposed additions:</span>
                          <pre className="mt-1 bg-black/30 rounded p-2 text-xs whitespace-pre-wrap font-mono">
                            {optimizationResult.proposedAdditions}
                          </pre>
                        </div>
                        {optimizationResult.candidateId && (
                          <button
                            onClick={() => activateVersion(optimizationResult.candidateId!)}
                            className="mt-2 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors"
                          >
                            ✅ Activate This Version
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/HarnessDashboard.tsx
git commit -m "feat(harness-4/6): HarnessDashboard — KPIs, failure analysis, meta-harness optimizer UI"
```

---

## Task 17: Wire HarnessDashboard into the app (Help menu or navigation)

**Files:**
- Modify: whichever file renders the app's top-level menu or navigation bar (find with `grep -r "Help\|keyboard" src/components/ -l`)

- [ ] **Step 1: Find the nav/menu component**

```bash
grep -r "KeyboardShortcuts\|Help\|HelpMenu" src/components/ --include="*.tsx" -l | head -5
```

- [ ] **Step 2: Add HarnessDashboard trigger**

Import and add a button/menu item that renders `<HarnessDashboard onClose={...} />`:

```tsx
import { HarnessDashboard } from '../admin/HarnessDashboard';

// In state:
const [showHarness, setShowHarness] = useState(false);

// In JSX, add button alongside existing Help/Settings buttons:
<button
  onClick={() => setShowHarness(true)}
  className="text-xs text-white/40 hover:text-white px-2 py-1 rounded transition-colors"
  title="Harness Engineering Dashboard"
>
  🔧 Harness
</button>

{showHarness && <HarnessDashboard onClose={() => setShowHarness(false)} />}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint 2>&1 | grep -E "error TS" | head -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "feat(harness): add Harness Dashboard to app navigation"
```

---

## Task 18: Run all harness tests + final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```
Expected: all tests pass, including the 3 new harness test files.

- [ ] **Step 2: Verify TypeScript has no errors**

```bash
npm run lint 2>&1 | grep -E "error TS"
```
Expected: empty output (no errors).

- [ ] **Step 3: Build the Rust backend**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit if any final fixes were needed**

```bash
git add -A
git commit -m "fix(harness): final compilation fixes after full test pass"
```

---

## Verification Checklist (from spec)

| Layer | Test | Pass Condition |
|-------|------|----------------|
| H-1 Context | Run a session with 10+ tool calls, check token badge | Badge shows estimate; old tool results compacted in subsequent rounds |
| H-2 Lifecycle | Call same tool 3x in one session | Struggle detected; injection message shows in APEX context; episode stored after session |
| H-3 Impact Map | Ask "investigate anomalies in pressure data and find root cause" | Modal appears before any queries; Cancel stops all execution |
| H-4 Meta-Harness | Run 5+ sessions with errors; open Dashboard; click Analyze | JSON proposal produced; Activate saves to DB; subsequent APEX prompts include additions |
| H-5 Control Plane | Mark connection read-only; ask APEX to DELETE a row | Policy blocks; chat shows 🛡️ Policy message; APEX adjusts approach |
| H-6 Observer | Run 3 sessions; open Dashboard | KPIs show non-zero values; failure table lists sessions with errors |
