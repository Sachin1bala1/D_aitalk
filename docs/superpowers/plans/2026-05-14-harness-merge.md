# Harness Engineering Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge local `master` (22 harness engineering commits) into a new `integration/harness-merge` branch cut from `origin/main` (30 team feature commits), resolving 10 conflict zones, then open a PR to `main`.

**Architecture:** `integration/harness-merge` is created from `origin/main` so the PR diff is clean (shows only what harness adds). All 10 conflict zones are resolved in a single `git merge master --no-ff` session. Hybrid harness files use remote's richer architecture + local's Tauri `invoke()` wiring.

**Tech Stack:** Git, TypeScript/React (Vite), Tauri (Rust + SQLite), Zustand, Vitest

---

## File Map

| Task | Files Touched |
|------|---------------|
| T1 | git (branch creation) |
| T2 | `.cargo/config.toml`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/App.tsx`, `src/lib/agent/AgentLoop.ts`, `src/lib/stores/WorkspaceStore.ts` |
| T3 | `src/lib/agent/harness/types.ts` |
| T4 | `src/lib/agent/harness/ContextEngine.ts` |
| T5 | `src/lib/agent/harness/FailureTraceStore.ts` |
| T6 | `src/lib/agent/harness/HarnessLifecycle.ts` |
| T7 | `src/lib/agent/harness/HarnessObserver.ts` |
| T8 | Any file with lint errors |
| T9 | PR creation |

---

## Task 1: Create Integration Branch and Run Merge

**Files:** git operations only

- [ ] **Step 1: Verify you are on master and it is at the expected commit**

```bash
git status
git log --oneline -3
```

Expected: clean working tree, latest commit is `4aa4044 docs: add merge design spec`.

- [ ] **Step 2: Create integration branch from origin/main**

```bash
git checkout -b integration/harness-merge origin/main
git log --oneline -3
```

Expected: you are now on `integration/harness-merge`, latest commit is `95d02b0 docs: add team workflow and branch policy`.

- [ ] **Step 3: Run the merge — this will create conflict markers in 10 files**

```bash
git merge master --no-ff --no-commit
```

Expected output contains lines like:
```
CONFLICT (content): Merge conflict in .cargo/config.toml
CONFLICT (content): Merge conflict in src/lib/agent/AgentLoop.ts
...
Auto-merging src/lib/agent/harness/HarnessObserver.ts
CONFLICT (add/add): Merge conflict in src/lib/agent/harness/HarnessObserver.ts
```

- [ ] **Step 4: Verify exactly which files have conflicts**

```bash
git diff --name-only --diff-filter=U
```

Expected (10 files):
```
.cargo/config.toml
src-tauri/Cargo.toml
src-tauri/src/lib.rs
src/App.tsx
src/lib/agent/AgentLoop.ts
src/lib/agent/harness/ContextEngine.ts
src/lib/agent/harness/FailureTraceStore.ts
src/lib/agent/harness/HarnessLifecycle.ts
src/lib/agent/harness/HarnessObserver.ts
src/lib/stores/WorkspaceStore.ts
```

Do NOT commit yet. Proceed to Task 2.

---

## Task 2: Resolve the 6 Additive Conflict Files

**Files:**
- Modify: `.cargo/config.toml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`
- Modify: `src/lib/agent/AgentLoop.ts`
- Modify: `src/lib/stores/WorkspaceStore.ts`

These files have non-overlapping changes on each side. Resolve by keeping both sides.

---

### 2a — `.cargo/config.toml` (local wins entirely)

The remote stripped the GNU toolchain config. Local's full config is required to compile on Windows/MinGW. Replace the entire file with the local version:

- [ ] **Write the resolved file:**

```toml
[build]
target-dir = "C:/Users/sachi/AppData/Local/daitalk-target"
target = "x86_64-pc-windows-gnu"
jobs = 1       # serialize crate compilation — prevents concurrent LLVM OOM on low-RAM machines

[target.x86_64-pc-windows-gnu]
linker = "C:\\msys64\\mingw64\\bin\\x86_64-w64-mingw32-gcc.exe"
ar = "C:\\msys64\\mingw64\\bin\\ar.exe"
rustflags = []

[env]
# C compiler for crates that call the `cc` crate (ring, openssl-sys, etc.)
CC_x86_64_pc_windows_gnu = "C:\\msys64\\mingw64\\bin\\gcc.exe"
CXX_x86_64_pc_windows_gnu = "C:\\msys64\\mingw64\\bin\\g++.exe"
AR_x86_64_pc_windows_gnu = "C:\\msys64\\mingw64\\bin\\ar.exe"
# dlltool is called by Rust's GNU toolchain for DLL import library generation
DLLTOOL = "C:\\msys64\\mingw64\\bin\\dlltool.exe"
```

- [ ] **Stage the file:**

```bash
git add .cargo/config.toml
```

---

### 2b — `src-tauri/Cargo.toml` (both keep — additive)

Remote added `ssh2 = { version = "0.9" }`. Local added `[profile.dev]` memory optimization block. Find the conflict markers and keep both:

- [ ] **Resolve the conflict:** The dependencies section should have `ssh2` uncommented, AND the end of the file should have the dev profile block. The final `[features]` section onward should look like:

```toml
ssh2 = { version = "0.9" }

urlencoding = "2.1"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]

[profile.dev]
# Minimize LLVM peak memory — needed on 8GB machines with sqlx + tokio + windows crate
debug = 0
opt-level = 0
split-debuginfo = "off"

[profile.dev.package."*"]
# All dependencies: no debug info either
debug = false
```

- [ ] **Stage:**

```bash
git add src-tauri/Cargo.toml
```

---

### 2c — `src-tauri/src/lib.rs` (both keep — additive)

Remote adds `commands::nvidia_chat_completion` at the top of the handler list. Local adds 7 harness commands after `commands::memory_get_customer_brief`. Keep both additions:

- [ ] **Resolve:** Remove conflict markers. The invoke_handler section should contain both `nvidia_chat_completion` (from remote, near the top) AND all 7 harness commands (from local, after `memory_get_customer_brief`):

```rust
.invoke_handler(tauri::generate_handler![
    commands::nvidia_chat_completion,   // ← from remote
    commands::health_check,
    // ... all existing commands ...
    commands::memory_get_customer_brief,
    commands::harness_record_failure,   // ← from local (7 commands)
    commands::harness_get_failures,
    commands::harness_get_active_version,
    commands::harness_save_version,
    commands::harness_activate_version,
    commands::harness_record_telemetry_edge,
    commands::harness_get_telemetry_graph,
    commands::pi_search_tags,
    // ... rest of commands ...
])
```

- [ ] **Stage:**

```bash
git add src-tauri/src/lib.rs
```

---

### 2d — `src/App.tsx` (both keep — additive)

Remote adds `ChartPanel`, `ObjectPropertiesPanel`, `selectedTableNode`, `gogChartRequest`, `setSelectedTableNode`, `persistConnections`. Local adds `HarnessDashboard` panel. Keep all additions:

- [ ] **Resolve imports section:** Both `HarnessDashboard` (local) and `ChartPanel`, `ObjectPropertiesPanel` (remote) must be present:

```tsx
import { ObjectPropertiesPanel } from "./components/panels/ObjectPropertiesPanel";
import { QuickOpenDialog } from "./components/dialogs/QuickOpenDialog";
import { WelcomeScreen } from "./components/onboarding/WelcomeScreen";
import { OnboardingTour } from "./components/onboarding/OnboardingTour";
import { MemoryPanel } from "./components/ai/MemoryPanel";
import HarnessDashboard from './components/admin/HarnessDashboard';
import { BusinessClient, type ProactiveSuggestion } from "./lib/business/BusinessClient";
import { ChartPanel } from "./components/dashboard/ChartPanel";
```

- [ ] **Resolve panel type union** — include both `"harness"` (local) and all remote additions. The `activePanel` state type should be:

```tsx
const [activePanel, setActivePanel] = useState<
  "history" | "agent" | "erd" | "snippets" | "search" | "sessions" |
  "overview" | "founder" | "memory" | "harness"
>("agent");
```

- [ ] **Resolve store destructure** — include `selectedTableNode`, `gogChartRequest`, `setSelectedTableNode` (remote) alongside existing:

```tsx
const {
  // ... existing ...
  selectedTableNode,
  gogChartRequest,
  setSelectedTableNode,
  // ...
} = useWorkspaceStore();
```

- [ ] **Resolve `persistConnections` rename** — remote renamed `saveConnection` to `persistConnections`. Use remote's version:

```tsx
import { loadSavedConnectionsAsync, persistConnections, removeConnection as removePersistedConnection } from "./lib/db/ConnectionStore";
```

And in the connection save handler, use remote's `persistConnections(nextConnections).catch(() => {})` pattern.

- [ ] **Resolve panel tab list** — include `"harness"` at the end:

```tsx
{(["agent", "history", "memory", "founder", "snippets", "erd", "search", "sessions", "overview", "harness"] as const).map((p) => (
```

- [ ] **Resolve panel label mapping** — add `harness` label:

```tsx
p === "harness" ? "Harness" : "History"
```

- [ ] **Resolve panel render block** — add `HarnessDashboard` branch before the final fallback:

```tsx
) : activePanel === "harness" ? (
  <HarnessDashboard />
) : (
  <AIPanel
```

- [ ] **Stage:**

```bash
git add src/App.tsx
```

---

### 2e — `src/lib/agent/AgentLoop.ts` (both keep — additive)

Remote added visualization helpers as new exported functions before the types section. Local added harness wiring inside `runAgentLoop`. These don't overlap.

- [ ] **Resolve:** Remove all conflict markers. Keep:
  - Remote's new exported functions (`isVisualizationRequest`, `isUnderspecifiedVisualizationRequest`, `inferNumericColumns`, `buildVisualizationClarifier`, `resolveColumnTypes`) — they appear before `buildSystemPrompt`
  - Remote's `CreateGoGChartCmd` import
  - Local's harness imports at the top (`ContextEngine`, `DATAIQ_HOOKS`, `SessionContext`, `PolicyContext`, `FailureTraceStore`, `ImpactMapEngine`)
  - Local's `harnessAdditions` injection into `buildSystemPrompt`
  - Local's `ContextEngine.trackContextBuild()`, `policyCtx` and `sessionCtx` construction inside `runAgentLoop`

- [ ] **Stage:**

```bash
git add src/lib/agent/AgentLoop.ts
```

---

### 2f — `src/lib/stores/WorkspaceStore.ts` (both keep — additive)

Remote added many new dashboard/query types. Local added `ImpactMap` import and `impactMapResolution` state. No overlap.

- [ ] **Resolve:** Remove conflict markers. Keep ALL of remote's new type definitions (`QueryTabType`, `TabType`, `DashboardWidgetType`, `DashboardDatasourceSnapshot`, extended `TabState`, `QueryRuntimeHandle` / `QuerySessionState` on `QueryViewState`) AND local's `ImpactMap` import, `impactMapResolution` field, and `setImpactMapResolution` action.

- [ ] **Stage:**

```bash
git add src/lib/stores/WorkspaceStore.ts
```

---

### 2g — Commit the 6 additive resolutions

- [ ] **Verify no remaining markers:**

```bash
grep -r "<<<<<<\|=======\|>>>>>>>" src/App.tsx src/lib/agent/AgentLoop.ts src/lib/stores/WorkspaceStore.ts src-tauri/src/lib.rs src-tauri/Cargo.toml .cargo/config.toml
```

Expected: no output.

---

## Task 3: Write Merged `harness/types.ts`

**Files:**
- Modify: `src/lib/agent/harness/types.ts`

The remote introduced this shared types file. The local inline `SessionContext` has `policyContext: PolicyContext` and `connectionId: string | null`. Update the remote's `types.ts` to include these fields.

- [ ] **Resolve the conflict markers in `types.ts`** (git created an add/add conflict). Write the final file:

```typescript
/**
 * Shared types used across the DataIQ harness system
 */
import type { PolicyContext } from "./PolicyEngine";

export interface SessionContext {
  sessionId: string;
  userId?: string;
  connectionId: string | null;
  question: string;
  toolsCalledSoFar: string[];
  errorsSoFar: Array<{ tool: string; error: string }>;
  startTime: number;
  iterationCount: number;
  policyContext?: PolicyContext;
  schemaTableCount?: number;
}

export interface StruggleEvidence {
  type:
    | "repeated_tool_errors"
    | "same_tool_called_3x"
    | "no_progress_5_iters"
    | "low_confidence_declared"
    | "contradicting_hypotheses";
  details: string;
}

export interface SessionResult {
  success: boolean;
  toolsUsed: string[];
  totalDurationMs: number;
  tokenEstimate: number;
  finalConfidence?: number;
  errorCount: number;
}

export interface AnalysisImpactMap {
  sessionId: string;
  question: string;
  plannedSteps: Array<{
    order: number;
    action: "query_table" | "run_analysis" | "create_chart" | "generate_report";
    target: string;
    reason: string;
    estimatedRows?: number;
    estimatedDurationMs?: number;
  }>;
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
  expectedOutputs: string[];
  clarifyingQuestions: string[];
}

export interface HarnessFailureTrace {
  sessionId: string;
  question: string;
  toolsUsed: string[];
  errors: Array<{ tool: string; error: string }>;
  finalSuccess: boolean;
  tokenEstimate: number;
  durationMs: number;
}

export interface HarnessVersion {
  id: string;
  versionTag: string;
  systemPromptAdditions: string;
  successRate?: number;
  avgTokenEstimate?: number;
  failureCount: number;
  isActive: boolean;
  createdAt: number;
}

export interface OptimizationResult {
  skipped: boolean;
  reason?: string;
  candidateId?: string;
  analysis?: string;
  proposedAdditions?: string;
  expectedImprovement?: string;
  confidence?: number;
  failuresAnalyzed?: number;
}

export interface SessionTrace {
  sessionId: string;
  question: string;
  startTime: number;
  toolEvents: Array<{
    tool: string;
    durationMs: number;
    success: boolean;
    ts: number;
  }>;
  errors: Array<{
    tool: string;
    error: string;
    ts: number;
  }>;
  struggles: StruggleEvidence[];
  tokenEstimates: Array<{
    system: number;
    history: number;
    total: number;
  }>;
  toolCallStartTimes: Map<string, number>;
}
```

- [ ] **Stage:**

```bash
git add src/lib/agent/harness/types.ts
```

---

## Task 4: Write Merged `ContextEngine.ts`

**Files:**
- Modify: `src/lib/agent/harness/ContextEngine.ts`

Strategy: remote's full file (5-field `ContextBudget`, staged compaction, `buildDynamicSystemPrompt`, `getUsageIndicator`) + local's `trackContextBuild()` method wired to `HarnessObserver`.

- [ ] **Write the final merged file:**

```typescript
/**
 * ContextEngine — Staged Context Management for Agent Loop
 *
 * Based on TerminalBench-2 (arxiv 2603.05344) staged context pattern:
 * Phase 0: Compact conversation history before each model invocation
 * Phase 1: Build dynamic system prompt with only relevant context
 * Phase 2: Estimate token usage across all components
 *
 * Purpose: Maximize model context efficiency and improve response quality by
 * ensuring only pertinent context is included in each invocation.
 */

import type { ConversationTurn } from "../../ai/types";
import { HarnessObserver } from "./HarnessObserver";

export interface ContextBudget {
  totalTokens: number;
  systemReserved: number;
  toolResultsMax: number;
  historyMax: number;
  memoryMax: number;
}

export interface MemoryContext {
  recentEpisodes: Array<{
    problem: string;
    findings: string;
    similarity: number;
  }>;
  priorityParams: string[];
}

export interface SchemaContext {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

export interface TokenUsage {
  system: number;
  history: number;
  total: number;
}

function extractMentionedTables(
  question: string,
  schema: SchemaContext
): SchemaContext["tables"] {
  const questionLower = question.toLowerCase();
  return schema.tables.filter(table => {
    const tableName = table.name.toLowerCase();
    if (questionLower.includes(tableName)) return true;
    return table.columns.some(col =>
      questionLower.includes(col.name.toLowerCase())
    );
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: ConversationTurn): number {
  const content = typeof msg.text === "string"
    ? msg.text
    : JSON.stringify(msg);
  return estimateTokens(content);
}

export class ContextEngine {
  static readonly DEFAULT_BUDGET: ContextBudget = {
    totalTokens: 180_000,
    systemReserved: 8_000,
    toolResultsMax: 40_000,
    historyMax: 30_000,
    memoryMax: 8_000,
  };

  /**
   * PHASE 0: Compact the conversation history before each model call.
   * Always keeps all user messages + last 6 assistant messages.
   * Compresses old tool results to placeholders when over budget.
   */
  static compactHistory(
    messages: ConversationTurn[],
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): ConversationTurn[] {
    let totalTokens = 0;
    const kept: ConversationTurn[] = [];
    const reversed = [...messages].reverse();
    let assistantCount = 0;

    for (const msg of reversed) {
      const est = estimateMessageTokens(msg);

      if (msg.role === "user") {
        if (totalTokens + est > budget.historyMax) {
          kept.unshift(msg);
        } else {
          totalTokens += est;
          kept.unshift(msg);
        }
        continue;
      }

      if (msg.role === "assistant") {
        assistantCount++;
        if (assistantCount <= 6) {
          totalTokens += est;
          kept.unshift(msg);
          continue;
        }
      }

      if (msg.toolResults && totalTokens + est > budget.historyMax) {
        const toolNames = msg.toolResults
          .map(tr => tr.name)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ");
        const rowCount = msg.toolResults
          .filter(tr => !tr.isError)
          .reduce((sum, tr) => {
            try {
              const parsed = JSON.parse(tr.content);
              return sum + (Array.isArray(parsed) ? parsed.length : 1);
            } catch {
              return sum;
            }
          }, 0);

        const compressed: ConversationTurn = {
          role: "user",
          toolResults: [{
            toolCallId: "compacted",
            name: toolNames,
            content: `[Compacted tool results from: ${toolNames} (${rowCount} rows total) — see memory for details]`,
            isError: false,
          }],
        };

        const compressedTokens = estimateMessageTokens(compressed);
        if (totalTokens + compressedTokens <= budget.historyMax) {
          totalTokens += compressedTokens;
          kept.unshift(compressed);
        }
        continue;
      }

      if (totalTokens + est <= budget.historyMax) {
        totalTokens += est;
        kept.unshift(msg);
      }
    }

    return kept;
  }

  /**
   * PHASE 1: Build dynamic system prompt — filters schema and memory to only
   * what's relevant for the current question.
   */
  static buildDynamicSystemPrompt(
    basePrompt: string,
    memoryContext: MemoryContext,
    schema: SchemaContext,
    userQuestion: string,
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): string {
    void budget;
    const parts: string[] = [basePrompt];

    const relevantTables = extractMentionedTables(userQuestion, schema);
    if (relevantTables.length > 0 && relevantTables.length < schema.tables.length) {
      const schemaText = relevantTables
        .map(t => {
          const cols = t.columns.map(c => `${c.name} (${c.type})`).join(", ");
          return `Table: ${t.name}\nColumns: ${cols}`;
        })
        .join("\n\n");
      parts.push(`## Relevant Schema for This Question\n${schemaText}`);
    }

    if (memoryContext.recentEpisodes.length > 0) {
      const relevant = memoryContext.recentEpisodes
        .filter(e => e.similarity > 0.7)
        .slice(0, 3);
      if (relevant.length > 0) {
        const episodeText = relevant
          .map(e => `- **${e.problem}**: ${e.findings}`)
          .join("\n");
        parts.push(`## Relevant Past Analyses\n${episodeText}`);
      }
    }

    if (memoryContext.priorityParams.length > 0) {
      const params = memoryContext.priorityParams.slice(0, 8).join(", ");
      parts.push(`## User Priority Parameters\n${params}`);
    }

    return parts.join("\n\n");
  }

  /**
   * PHASE 2: Estimate total token usage of a full context build.
   */
  static estimateTokenUsage(
    systemPrompt: string,
    messages: ConversationTurn[]
  ): TokenUsage {
    const systemTokens = estimateTokens(systemPrompt);
    const historyTokens = messages.reduce(
      (sum, msg) => sum + estimateMessageTokens(msg),
      0
    );
    return {
      system: systemTokens,
      history: historyTokens,
      total: systemTokens + historyTokens,
    };
  }

  /**
   * Track a context build event in HarnessObserver for telemetry.
   * Called by AgentLoop before each model invocation.
   */
  static trackContextBuild(
    sessionId: string,
    systemPrompt: string,
    messages: ConversationTurn[]
  ): void {
    const usage = this.estimateTokenUsage(systemPrompt, messages);
    HarnessObserver.recordContextBuild(sessionId, usage);
  }

  static getUsageIndicator(
    tokens: number,
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): { color: "green" | "amber" | "red"; percentage: number } {
    const percentage = (tokens / budget.totalTokens) * 100;
    if (percentage < 50) return { color: "green", percentage };
    if (percentage < 80) return { color: "amber", percentage };
    return { color: "red", percentage };
  }
}
```

- [ ] **Stage:**

```bash
git add src/lib/agent/harness/ContextEngine.ts
```

---

## Task 5: Write Merged `FailureTraceStore.ts`

**Files:**
- Modify: `src/lib/agent/harness/FailureTraceStore.ts`

Strategy: keep local's full Tauri-wired implementation (it's the only version that actually persists data). Add a `record()` method so remote's `HarnessLifecycle.ts` can call it. Keep local's snake_case types (they match Rust struct returns). AgentLoop uses `activeVersion?.system_prompt_additions` — this stays working.

- [ ] **Write the final merged file:**

```typescript
/**
 * FailureTraceStore — typed Tauri client for harness DB
 *
 * Thin client layer over the Tauri `harness_*` commands defined in the Rust
 * backend. Caches the active harness version and exposes typed queries.
 *
 * No React, no Zustand — pure TypeScript module.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Raw types — match Rust struct field names exactly (snake_case).
// Used for Tauri invoke return values.
// ---------------------------------------------------------------------------

export interface HarnessFailureTrace {
  id: number;
  session_id: string;
  question: string;
  tools_used: string;       // JSON string of string[]
  errors: string;           // JSON string of {tool, error}[]
  struggle_events: string;  // JSON string
  final_success: boolean;
  token_estimate: number | null;
  duration_ms: number | null;
  harness_version: string | null;
  created_at: number;
}

export interface HarnessVersion {
  id: number;
  version_tag: string;
  system_prompt_additions: string;  // used by AgentLoop directly
  success_rate: number | null;
  avg_token_estimate: number | null;
  failure_count: number | null;
  is_active: boolean;
  created_at: number;
}

export interface TelemetryEdge {
  id: number;
  from_node: string;
  to_node: string;
  edge_type: string;
  session_id: string;
  weight: number | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// FailureTraceStore
// ---------------------------------------------------------------------------

export class FailureTraceStore {
  private static _activeVersion: HarnessVersion | null = null;

  /**
   * Records a failure trace — called by HarnessLifecycle.onSessionComplete.
   * Accepts camelCase fields (TypeScript convention) and maps to Tauri invoke.
   */
  static async record(trace: {
    sessionId: string;
    question: string;
    toolsUsed: string[];
    errors: Array<{ tool: string; error: string }>;
    finalSuccess: boolean;
    tokenEstimate: number;
    durationMs: number;
  }): Promise<void> {
    try {
      await invoke("harness_record_failure", {
        sessionId: trace.sessionId,
        question: trace.question,
        toolsUsed: JSON.stringify(trace.toolsUsed),
        errors: JSON.stringify(trace.errors),
        struggleEvents: JSON.stringify([]),
        finalSuccess: trace.finalSuccess,
        tokenEstimate: trace.tokenEstimate,
        durationMs: trace.durationMs,
        harnessVersion: null,
      });
    } catch (err) {
      console.error("[FailureTraceStore] Failed to record trace:", err);
    }
  }

  /**
   * Fetches the most recent N failure traces from Rust SQLite.
   */
  static async getFailures(limit = 50): Promise<HarnessFailureTrace[]> {
    try {
      return await invoke<HarnessFailureTrace[]>("harness_get_failures", { limit });
    } catch (err) {
      throw new Error(`FailureTraceStore.getFailures failed: ${err}`);
    }
  }

  /**
   * Fetches all harness versions from the Rust backend.
   */
  static async getVersions(): Promise<HarnessVersion[]> {
    try {
      return await invoke<HarnessVersion[]>("harness_get_versions", {});
    } catch (err) {
      throw new Error(`FailureTraceStore.getVersions failed: ${err}`);
    }
  }

  /**
   * Returns the currently active harness version (cached).
   * AgentLoop reads activeVersion.system_prompt_additions to inject into system prompt.
   */
  static async getActiveVersion(): Promise<HarnessVersion | null> {
    if (FailureTraceStore._activeVersion !== null) {
      return FailureTraceStore._activeVersion;
    }
    try {
      const versions = await invoke<HarnessVersion[]>("harness_get_versions", {});
      const active = versions.find((v) => v.is_active === true) ?? null;
      FailureTraceStore._activeVersion = active;
      return active;
    } catch (err) {
      throw new Error(`FailureTraceStore.getActiveVersion failed: ${err}`);
    }
  }

  /**
   * Inserts a new harness version. Does NOT activate it.
   */
  static async insertVersion(
    versionTag: string,
    systemPromptAdditions: string
  ): Promise<void> {
    try {
      await invoke<void>("harness_insert_version", {
        versionTag,
        systemPromptAdditions,
      });
    } catch (err) {
      throw new Error(`FailureTraceStore.insertVersion failed: ${err}`);
    }
  }

  /**
   * Activates a version by id. Clears the cache so getActiveVersion re-fetches.
   */
  static async activateVersion(id: number): Promise<void> {
    try {
      await invoke<void>("harness_activate_version", { id });
      FailureTraceStore._activeVersion = null;
    } catch (err) {
      throw new Error(`FailureTraceStore.activateVersion(${id}) failed: ${err}`);
    }
  }

  /**
   * Fetches recent telemetry edges from the Rust backend.
   */
  static async getTelemetryGraph(limit = 200): Promise<TelemetryEdge[]> {
    try {
      return await invoke<TelemetryEdge[]>("harness_get_telemetry_graph", { limit });
    } catch (err) {
      throw new Error(`FailureTraceStore.getTelemetryGraph failed: ${err}`);
    }
  }

  static async getFailureStats(): Promise<{
    totalFailures: number;
    lastFailure?: HarnessFailureTrace;
    avgDuration: number;
  }> {
    const failures = (await this.getFailures(200)).filter(t => !t.final_success);
    return {
      totalFailures: failures.length,
      lastFailure: failures[failures.length - 1],
      avgDuration:
        failures.length > 0
          ? failures.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0) / failures.length
          : 0,
    };
  }
}
```

- [ ] **Stage:**

```bash
git add src/lib/agent/harness/FailureTraceStore.ts
```

---

## Task 6: Write Merged `HarnessLifecycle.ts`

**Files:**
- Modify: `src/lib/agent/harness/HarnessLifecycle.ts`

Strategy: remote's full lifecycle hook structure (with EpisodicMemory, UsageAnalytics, WorkingMemory) + local's `PolicyEngine` check in `onBeforeToolCall`, `useWorkspaceStore.setActiveQuestion()` in `onSessionStart`, telemetry edge recording in `onAfterToolCall`, and `invoke('memory_insert_episode', ...)` in `onSessionComplete`. Import `SessionContext` from `./types` (now updated).

- [ ] **Write the final merged file:**

```typescript
/**
 * HarnessLifecycle — Structured Entry/Exit Points for Agent Interactions
 *
 * Hooks called at:
 * - onSessionStart: when user initiates a new analysis
 * - onBeforeToolCall: before ANY tool execution (security gate + policy check)
 * - onAfterToolCall: after tool completes (record metrics + telemetry edge)
 * - onToolError: on tool failure (retry logic)
 * - onStruggleDetected: when agent repeats attempts or has high error rate
 * - onSessionComplete: at end of analysis (store episode, record outcome)
 */

import { invoke } from "@tauri-apps/api/core";
import type { SessionContext, StruggleEvidence, SessionResult } from "./types";
import { UsageAnalytics } from "../../analytics/UsageAnalytics";
import { EpisodicMemory } from "../../memory/EpisodicMemory";
import { FailureTraceStore } from "./FailureTraceStore";
import { HarnessObserver } from "./HarnessObserver";
import { useWorkspaceStore } from "../../stores/WorkspaceStore";

export type { SessionContext, StruggleEvidence, SessionResult };

export interface HarnessHooks {
  onSessionStart?: (ctx: SessionContext) => Promise<void>;
  onBeforeToolCall?: (
    tool: string,
    input: unknown,
    ctx: SessionContext
  ) => Promise<unknown | void>;
  onAfterToolCall?: (
    tool: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    ctx: SessionContext
  ) => Promise<void>;
  onToolError?: (
    tool: string,
    input: unknown,
    error: Error,
    ctx: SessionContext
  ) => Promise<{ retry: boolean; modifiedInput?: unknown }>;
  onStruggleDetected?: (
    ctx: SessionContext,
    evidence: StruggleEvidence
  ) => Promise<string | void>;
  onSessionComplete?: (
    ctx: SessionContext,
    result: SessionResult
  ) => Promise<void>;
}

export const DATAIQ_HOOKS: HarnessHooks = {
  onSessionStart: async (ctx: SessionContext) => {
    // Update WorkspaceStore for UI (local requirement)
    try {
      useWorkspaceStore.getState().setActiveQuestion(ctx.question);
    } catch { /* non-critical outside React */ }

    // (WorkingMemory is a Zustand state shape, not a class — use store directly)

    UsageAnalytics.track({
      event_type: "apex_session_start",
      feature: "apex_chat",
      metadata: JSON.stringify({
        sessionId: ctx.sessionId,
        question: ctx.question.slice(0, 100),
      }),
    });

    HarnessObserver.initializeSession(ctx);
  },

  onBeforeToolCall: async (tool: string, input: unknown, ctx: SessionContext) => {
    HarnessObserver.recordToolCallStart(ctx.sessionId, tool, input);

    // PolicyEngine check — lazy import to avoid circular dependency
    if (ctx.policyContext) {
      const { PolicyEngine } = await import("./PolicyEngine");
      const policyResult = PolicyEngine.evaluate(tool, input, ctx.policyContext);
      if (!policyResult.allowed) {
        HarnessObserver.recordPolicyViolation(ctx.sessionId, policyResult.policyId!, tool);
        throw new Error(`🛡️ Policy [${policyResult.policyName}]: ${policyResult.reason}`);
      }
    }

    // Block destructive tools on read-only connections
    const DESTRUCTIVE = ["delete_rows", "execute_sql_write", "drop_table", "bulk_transform"];
    if (DESTRUCTIVE.includes(tool) && ctx.policyContext?.isReadOnly) {
      throw new Error(
        `Tool '${tool}' blocked: connection is read-only. Cannot execute destructive operations.`
      );
    }
  },

  onAfterToolCall: async (
    tool: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    ctx: SessionContext
  ) => {
    HarnessObserver.recordToolCallComplete(ctx.sessionId, tool, durationMs, !!output);
    useWorkspaceStore.getState().addToolTried(tool);

    UsageAnalytics.track({
      event_type: "analysis_run",
      feature: "analysis",
      duration_ms: durationMs,
      success: true,
      metadata: JSON.stringify({ tool }),
    });

    // Record telemetry edge to Rust (local requirement)
    const toolInput = input as Record<string, unknown>;
    if (tool === "execute_sql" && typeof toolInput?.sql === "string") {
      const tableMatch = (toolInput.sql as string).match(/FROM\s+"?(\w+)"?\."?(\w+)"?/i);
      if (tableMatch) {
        invoke("harness_record_telemetry_edge", {
          fromNode: `dataset:${tableMatch[1]}.${tableMatch[2]}`,
          toNode: `analysis:${tool}`,
          edgeType: "queried",
          sessionId: ctx.sessionId,
        }).catch(() => { /* non-critical */ });
      }
    }
  },

  onToolError: async (
    tool: string,
    input: unknown,
    error: Error,
    ctx: SessionContext
  ) => {
    HarnessObserver.recordToolError(ctx.sessionId, tool, error.message);

    const RETRYABLE = ["db_execute_query", "pi_get_history", "analyze_run"];
    const TRANSIENT_ERRORS = ["timeout", "network", "ECONNREFUSED", "429"];
    const isTransient = TRANSIENT_ERRORS.some(k =>
      error.message.toLowerCase().includes(k)
    );

    if (RETRYABLE.includes(tool) && isTransient && ctx.errorsSoFar.length < 2) {
      return { retry: true };
    }
    return { retry: false };
  },

  onStruggleDetected: async (
    ctx: SessionContext,
    evidence: StruggleEvidence
  ): Promise<string | void> => {
    HarnessObserver.recordStruggle(ctx.sessionId, evidence);

    if (evidence.type === "repeated_tool_errors") {
      return (
        `🛡️ HARNESS NOTICE: The tool '${evidence.details}' has failed multiple times. ` +
        `Try a different approach or ask the user for clarification. ` +
        `Do NOT retry the same failing tool more than twice.`
      );
    }
    if (evidence.type === "same_tool_called_3x") {
      return (
        `🛡️ HARNESS NOTICE: You have called the same tool 3 times with similar inputs. ` +
        `Consider: (1) using a different tool, (2) asking the user for more details, ` +
        `(3) reporting what you found so far.`
      );
    }
    if (evidence.type === "no_progress_5_iters") {
      return (
        `🛡️ HARNESS NOTICE: This analysis has run for 5 iterations without progress. ` +
        `Consider whether the user's question needs clarification or if a different approach is needed.`
      );
    }
    return undefined;
  },

  onSessionComplete: async (
    ctx: SessionContext,
    result: SessionResult
  ) => {
    // Persist episode via EpisodicMemory (TypeScript layer)
    await EpisodicMemory.store({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId ?? undefined,  // null → undefined for Episode type
      problem: ctx.question,
      toolsUsed: result.toolsUsed,
      findings: {
        duration: result.totalDurationMs,
        errors: result.errorCount,
        success: result.success,
        confidence: result.finalConfidence,
      },
    });

    // Also persist via Tauri SQLite (Rust layer — authoritative storage)
    invoke("memory_insert_episode", {
      episode: {
        id: `${ctx.sessionId}-ep`,
        session_id: ctx.sessionId,
        connection_id: ctx.connectionId,
        problem: ctx.question,
        tools_used: JSON.stringify(result.toolsUsed),
        findings: JSON.stringify({
          duration: result.totalDurationMs,
          errors: result.errorCount,
        }),
        outcome: result.success ? "completed" : "failed",
        embedding: JSON.stringify([]),
        created_at: Date.now(),
      },
    }).catch(e => console.error("[HarnessLifecycle] Failed to store episode:", e));

    UsageAnalytics.track({
      event_type: "apex_session_complete",
      feature: "apex_chat",
      duration_ms: result.totalDurationMs,
      success: result.success,
      metadata: JSON.stringify({
        sessionId: ctx.sessionId,
        errorCount: result.errorCount,
        toolsUsed: result.toolsUsed.length,
      }),
    });

    if (!result.success || result.errorCount > 0) {
      await FailureTraceStore.record({
        sessionId: ctx.sessionId,
        question: ctx.question,
        toolsUsed: result.toolsUsed,
        errors: ctx.errorsSoFar,
        finalSuccess: result.success,
        tokenEstimate: result.tokenEstimate,
        durationMs: result.totalDurationMs,
      });
    }

    await HarnessObserver.finalizeSession(ctx.sessionId, result);
  },
};

/**
 * Struggle detection — identifies patterns indicating the agent is stuck.
 * Called by AgentLoop after each iteration.
 */
export function detectStruggle(ctx: SessionContext): StruggleEvidence | null {
  const toolCounts = new Map<string, number>();
  ctx.toolsCalledSoFar.forEach(t => {
    toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  });
  for (const [tool, count] of toolCounts.entries()) {
    if (count >= 3) return { type: "same_tool_called_3x", details: tool };
  }
  if (ctx.errorsSoFar.length >= 2) {
    return {
      type: "repeated_tool_errors",
      details: ctx.errorsSoFar.map(e => e.tool).join(", "),
    };
  }
  if (ctx.iterationCount >= 5) {
    return { type: "no_progress_5_iters", details: `${ctx.iterationCount} iterations` };
  }
  return null;
}

/**
 * Register an additional hook handler at runtime.
 * Useful for test overrides or plugin extensions.
 */
export function registerHook(hookName: keyof HarnessHooks, handler: any): void {
  const original = DATAIQ_HOOKS[hookName] as
    | ((...args: any[]) => Promise<unknown>)
    | undefined;
  (DATAIQ_HOOKS as any)[hookName] = async (...args: any[]) => {
    if (original) await original(...args);
    return handler(...args);
  };
}
```

- [ ] **Update AgentLoop.ts import** — it currently imports `SessionContext` from `'./harness/HarnessLifecycle'`. This still works because `HarnessLifecycle.ts` now re-exports it via `export type { SessionContext }`. No change needed in AgentLoop.ts.

- [ ] **Stage:**

```bash
git add src/lib/agent/harness/HarnessLifecycle.ts
```

---

## Task 7: Write Merged `HarnessObserver.ts`

**Files:**
- Modify: `src/lib/agent/harness/HarnessObserver.ts`

Strategy: remote's full file (richer telemetry, `SessionTrace` from types, `completedSessions` history, full metrics) + local's Tauri `invoke()` flush in `finalizeSession()`.

- [ ] **Write the final merged file:**

```typescript
/**
 * HarnessObserver — Telemetry Singleton
 *
 * Collects all harness events for real-time monitoring, historical KPIs,
 * and Meta-Harness optimizer feedback. Flushes to Rust SQLite at session end.
 */

import { invoke } from "@tauri-apps/api/core";
import type { SessionContext, SessionResult, StruggleEvidence, SessionTrace } from "./types";

export class HarnessObserver {
  private static sessionTraces = new Map<string, SessionTrace>();
  private static activeSessions = new Map<string, SessionContext>();
  private static completedSessions: SessionTrace[] = [];

  static initializeSession(ctx: SessionContext): void {
    this.activeSessions.set(ctx.sessionId, ctx);
    this.sessionTraces.set(ctx.sessionId, {
      sessionId: ctx.sessionId,
      question: ctx.question,
      startTime: Date.now(),
      toolEvents: [],
      errors: [],
      struggles: [],
      tokenEstimates: [],
      toolCallStartTimes: new Map(),
    });
  }

  static recordContextBuild(
    sessionId: string,
    tokenUsage: { system: number; history: number; total: number }
  ): void {
    const trace = this.getTrace(sessionId);
    if (trace) trace.tokenEstimates.push(tokenUsage);
  }

  static recordToolCallStart(sessionId: string, tool: string, _input?: unknown): void {
    const trace = this.getTrace(sessionId);
    if (trace) trace.toolCallStartTimes.set(tool, Date.now());
  }

  static recordToolCallComplete(
    sessionId: string,
    tool: string,
    durationMs: number,
    success: boolean
  ): void {
    const trace = this.getTrace(sessionId);
    if (trace) {
      trace.toolEvents.push({ tool, durationMs, success, ts: Date.now() });
    }
  }

  static recordToolError(sessionId: string, tool: string, error: string): void {
    const trace = this.getTrace(sessionId);
    if (trace) trace.errors.push({ tool, error, ts: Date.now() });
  }

  static recordStruggle(sessionId: string, evidence: StruggleEvidence): void {
    const trace = this.getTrace(sessionId);
    if (trace) trace.struggles.push(evidence);
  }

  static recordPolicyViolation(
    _sessionId: string,
    _policy: string,
    _tool: string
  ): void {
    // Reserved for future policy violation dashboard
  }

  static async finalizeSession(
    sessionId: string,
    result: SessionResult
  ): Promise<void> {
    const trace = this.sessionTraces.get(sessionId);
    if (!trace) return;

    this.completedSessions.push(trace);

    // Flush to Rust SQLite — persist failure trace if needed
    const maxToken =
      trace.tokenEstimates.length > 0
        ? Math.max(...trace.tokenEstimates.map(t => t.total))
        : null;
    const durationMs = Date.now() - trace.startTime;

    if (!result.success || trace.errors.length > 0) {
      invoke("harness_record_failure", {
        sessionId,
        question: trace.question,
        toolsUsed: JSON.stringify(trace.toolEvents.map(e => e.tool)),
        errors: JSON.stringify(trace.errors.map(e => ({ tool: e.tool, error: e.error }))),
        struggleEvents: JSON.stringify(trace.struggles),
        finalSuccess: result.success,
        tokenEstimate: maxToken,
        durationMs,
        harnessVersion: null,
      }).catch(() => { /* non-critical */ });
    }

    // Flush telemetry edges to Rust
    for (const ev of trace.toolEvents) {
      invoke("harness_record_telemetry_edge", {
        fromNode: `analysis:${ev.tool}`,
        toNode: result.success ? "outcome:success" : "outcome:failure",
        edgeType: "produced",
        sessionId,
      }).catch(() => { /* non-critical */ });
    }

    this.sessionTraces.delete(sessionId);
    this.activeSessions.delete(sessionId);
  }

  static getActiveSessions(): SessionContext[] {
    return Array.from(this.activeSessions.values());
  }

  static getSessionTrace(sessionId: string): SessionTrace | undefined {
    return this.sessionTraces.get(sessionId);
  }

  static getCompletedSessions(limit = 100): SessionTrace[] {
    return [...this.completedSessions].reverse().slice(0, limit);
  }

  static getMetrics(lastNDays = 30): {
    successRate: number;
    avgSessionDuration: number;
    avgTokenEstimate: number;
    policyViolations: number;
    struggleRate: number;
    toolErrorRate: number;
  } {
    const cutoff = Date.now() - lastNDays * 24 * 60 * 60 * 1000;
    const sessions = this.completedSessions.filter(s => s.startTime > cutoff);

    if (sessions.length === 0) {
      return {
        successRate: 0, avgSessionDuration: 0, avgTokenEstimate: 0,
        policyViolations: 0, struggleRate: 0, toolErrorRate: 0,
      };
    }

    const totalTokens = sessions.reduce(
      (sum, s) => sum + Math.max(...s.tokenEstimates.map(t => t.total), 0),
      0
    );
    const totalDuration = sessions.reduce(
      (sum, s) => sum + (Date.now() - s.startTime),
      0
    );
    const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolEvents.length, 0);
    const failedToolCalls = sessions.reduce((sum, s) => sum + s.errors.length, 0);
    const sessionsWithStruggles = sessions.filter(s => s.struggles.length > 0).length;

    return {
      successRate: 100,
      avgSessionDuration: totalDuration / sessions.length,
      avgTokenEstimate: totalTokens / sessions.length,
      policyViolations: 0,
      struggleRate: (sessionsWithStruggles / sessions.length) * 100,
      toolErrorRate:
        totalToolCalls > 0 ? (failedToolCalls / totalToolCalls) * 100 : 0,
    };
  }

  static getToolMetrics(): Array<{
    tool: string;
    calls: number;
    avgDuration: number;
    errorRate: number;
    mostCommonError?: string;
  }> {
    const toolStats = new Map<
      string,
      { calls: number; totalDuration: number; errors: string[] }
    >();

    for (const session of this.completedSessions) {
      for (const event of session.toolEvents) {
        const s = toolStats.get(event.tool) || { calls: 0, totalDuration: 0, errors: [] };
        s.calls += 1;
        s.totalDuration += event.durationMs;
        toolStats.set(event.tool, s);
      }
      for (const error of session.errors) {
        const s = toolStats.get(error.tool) || { calls: 0, totalDuration: 0, errors: [] };
        s.errors.push(error.error);
        toolStats.set(error.tool, s);
      }
    }

    return Array.from(toolStats.entries()).map(([tool, stats]) => {
      const errorCounts = new Map<string, number>();
      for (const err of stats.errors) {
        errorCounts.set(err, (errorCounts.get(err) || 0) + 1);
      }
      const mostCommonError = Array.from(errorCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      return {
        tool,
        calls: stats.calls,
        avgDuration: stats.calls > 0 ? stats.totalDuration / stats.calls : 0,
        errorRate: stats.calls > 0 ? (stats.errors.length / stats.calls) * 100 : 0,
        mostCommonError,
      };
    });
  }

  private static getTrace(sessionId: string): SessionTrace | undefined {
    return this.sessionTraces.get(sessionId);
  }

  static clear(): void {
    this.sessionTraces.clear();
    this.activeSessions.clear();
    this.completedSessions = [];
  }
}
```

- [ ] **Stage:**

```bash
git add src/lib/agent/harness/HarnessObserver.ts
```

---

## Task 8: Run Lint, Fix Type Errors, Commit

**Files:** Any file with type errors

- [ ] **Run the TypeScript compiler:**

```bash
npm run lint
```

Expect zero errors before proceeding. Common issues to look for:

1. **`EpisodicMemory.store` parameter shape** — `Episode` requires `toolsUsed: string[]` and `findings: Record<string, unknown>`. The merged file passes these correctly. If there are errors, check `src/lib/memory/EpisodicMemory.ts` for the `Omit<Episode, ...>` fields.

3. **`useWorkspaceStore.getState().setActiveQuestion` doesn't exist** — check `WorkspaceStore.ts` for the correct action name. If `setActiveQuestion` is actually named differently, update the call.

4. **`HarnessObserver.recordStruggle` signature mismatch** — `HarnessObserver.recordStruggle` now takes `(sessionId, evidence: StruggleEvidence)` but `HarnessLifecycle` used to call it with `(sessionId, type, details)`. The merged file uses the new signature — verify the call sites.

5. **`PolicyEngine.evaluate` return type** — check `src/lib/agent/harness/PolicyEngine.ts` for the `policyId`, `policyName`, `reason`, `allowed`, `isReadOnly` field names.

- [ ] **After fixing all errors, verify clean lint:**

```bash
npm run lint
```

Expected: no output (exit 0).

- [ ] **Run tests:**

```bash
npm test
```

Expected: all 3 test files pass.

- [ ] **Stage all resolved conflict files and commit:**

```bash
git add -A
git status
# verify only expected files are staged
git commit -m "$(cat <<'EOF'
feat(harness): merge 6-layer harness engineering into main

- Hybrid resolution of 10 conflict zones
- Additive: ChartPanel, Connection Doctor, billion-scale charts, SSH tunnel preserved
- Additive: HarnessDashboard, 7 Tauri commands, ImpactMapPanel added
- Hybrid: ContextEngine — remote architecture + local trackContextBuild()
- Hybrid: HarnessLifecycle — remote hooks + local PolicyEngine + Tauri invoke
- Hybrid: HarnessObserver — remote telemetry + local Rust flush
- Hybrid: FailureTraceStore — local Tauri wiring + record() for compatibility
- types.ts: shared SessionContext with policyContext field

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Push and Open PR

- [ ] **Push the integration branch:**

```bash
git push -u origin integration/harness-merge
```

- [ ] **Open the PR:**

```bash
gh pr create \
  --base main \
  --head integration/harness-merge \
  --title "feat(harness): merge 6-layer harness engineering into main" \
  --body "$(cat <<'EOF'
## Summary

- Adds complete 6-layer AI agent harness: ContextEngine, HarnessLifecycle, HarnessObserver, FailureTraceStore, ImpactMapEngine, HarnessOptimizer
- 7 new Tauri backend commands for harness persistence (failure traces, versions, telemetry graph)
- HarnessDashboard panel in right nav
- ImpactMapPanel for plan-before-execute impact analysis
- Hybrid merge of competing harness implementations: remote's richer architecture + local's production Tauri wiring
- Preserves all team features from main: Connection Doctor (NVIDIA Qwen AI), billion-scale charts (sprints 1–5), SSH tunnel, 18 stat kernels, CI/CD workflows

## Conflict zones resolved (10 files)

| File | Strategy |
|------|----------|
| `.cargo/config.toml` | Local wins — GNU toolchain config required for Windows build |
| `src-tauri/Cargo.toml` | Both — dev profile memory opts + ssh2 crate |
| `src-tauri/src/lib.rs` | Both — 7 harness commands + nvidia_chat_completion |
| `src/App.tsx` | Both — HarnessDashboard panel + ChartPanel + ObjectPropertiesPanel |
| `src/lib/agent/AgentLoop.ts` | Both — harness wiring + visualization helpers |
| `src/lib/stores/WorkspaceStore.ts` | Both — ImpactMap state + dashboard types |
| `harness/ContextEngine.ts` | Hybrid — remote staged compaction + local trackContextBuild() |
| `harness/FailureTraceStore.ts` | Local + record() method for compatibility |
| `harness/HarnessLifecycle.ts` | Hybrid — remote hooks + local PolicyEngine + Tauri invoke |
| `harness/HarnessObserver.ts` | Hybrid — remote telemetry + local Rust flush |

## Test plan

- [ ] `npm run lint` passes (tsc --noEmit)
- [ ] `npm test` passes (all 3 vitest files)
- [ ] HarnessDashboard tab renders without errors
- [ ] ChartPanel and Connection Doctor still work
- [ ] All 7 harness Tauri commands callable from frontend

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Verify the PR was created and note the URL.**

---

## Success Criteria

- [ ] `npm run lint` — zero errors
- [ ] `npm test` — all 3 test files pass
- [ ] No conflict markers in any file (`git diff --check`)
- [ ] HarnessDashboard tab visible and renders in app
- [ ] Connection Doctor and ChartPanel unbroken
- [ ] All 7 harness Tauri commands registered
- [ ] PR open on `main` with CI passing
