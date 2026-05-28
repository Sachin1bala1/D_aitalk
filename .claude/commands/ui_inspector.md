# UI Inspector (v2)

Perform a full health check of the daitalk-v2 React UI layer — AI chat components, provider settings, and store wiring. Work through every layer below in order. Never skip a layer. Print a ✅/❌ verdict after each check. End with a single summary table.

---

## Baked-In Architecture (do NOT ask the user for this)

**Project root:** `C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2`

### UI Layer Overview

Multi-provider streaming chat panel in `src/components/ai/AIChat.tsx`. No separate `useAPEX` hook — all agent wiring is inside `AIChat` directly via `runAgentLoop()` callbacks.

### AI Components

| File | Role |
|------|------|
| `src/components/ai/AIChat.tsx` | Main chat panel. `MessageRole = "user" \| "assistant" \| "plan_queued" \| "error"`. `ChatMessage` has `toolLog?: ToolLogEntry[]`. `onToolStart` creates a ToolLogEntry on the current assistant message. `onToolEnd` finds the matching running entry and stamps its result. Renders `<ToolCallLog>` inside assistant bubbles. |
| `src/components/ai/AIPanel.tsx` | Wrapper: shows PlanQueue or AIChat based on active tab. |
| `src/components/ai/ToolCallLog.tsx` | Collapsible rows per tool call. SQL blocks have Apply button. `stat__*` tools render `<StatResultView>`. Spinner when `result === undefined`. Color: `#39FF14` for stat, `#00d2ff` for sql/editor tools. |
| `src/components/ai/StatResultView.tsx` | Renders stat results: scalar metric grid (2-col), violations list (western_electric), anomalies list (anomaly_zscore), dominant frequencies (fft). |
| `src/components/ai/HypothesisPanel.tsx` | Collapsible. Sorted by probability descending. evidence_for = green, evidence_against = red. Imports `Hypothesis` from `../../lib/ai/types`. |
| `src/components/ai/ConfidenceBar.tsx` | Mini bar: green ≥ 85%, yellow ≥ 60%, red < 60%. Shows fast⚡/slow🧠 label. |
| `src/components/ai/ProviderSettingsDialog.tsx` | Multi-tab settings modal: claude, gemini, openai, nvidia, ollama. API keys saved to OS keychain (not localStorage). Ollama shows instructions instead of key field. |
| `src/components/ai/PlanQueue.tsx` | List of pending plan steps with Approve/Reject buttons and risk badges. |
| `src/components/ai/AgentModeToggle.tsx` | Toggle between "plan" and "auto" agent modes. |

### Key Types

| Type | Location | Shape |
|------|----------|-------|
| `MessageRole` | AIChat.tsx | `"user" \| "assistant" \| "plan_queued" \| "error"` — NO tool_start/tool_end |
| `ChatMessage` | AIChat.tsx | `{ id, role, content, streaming?, toolLog?: ToolLogEntry[] }` |
| `ToolLogEntry` | ToolCallLog.tsx | `{ id, toolName, input: Record<string,unknown>, result?: { success, summary, data? } }` |
| `Hypothesis` | src/lib/ai/types.ts | `{ text, probability, evidence_for[], evidence_against[] }` |

### WorkspaceStore (src/lib/stores/WorkspaceStore.ts)
Must export: `agentMode`, `undoStack`, `popUndo`, `pushUndo`, `addPlanStep`, `planQueue`

### APEX Welcome Message
Must appear in AIChat.tsx WELCOME constant: "APEX", "Autonomous Process Engineering", "SPC"

### Provider Catalog (src/lib/ai/types.ts)
5 providers: claude, gemini, openai, nvidia, ollama
Current Claude models: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`

### Baseline
No automated component tests (UI correctness verified via inspection). TypeScript must be clean.

---

## Inspection Procedure

---

### Layer 1 — Type Safety

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2 && npx tsc --noEmit 2>&1
```

Any `error TS` line is a failure.

Verdict: ✅ silent / ❌ list each error with file:line.

---

### Layer 2 — File Existence

Check each file exists:

- `src/components/ai/AIChat.tsx`
- `src/components/ai/AIPanel.tsx`
- `src/components/ai/ToolCallLog.tsx`
- `src/components/ai/StatResultView.tsx`
- `src/components/ai/HypothesisPanel.tsx`
- `src/components/ai/ConfidenceBar.tsx`
- `src/components/ai/ProviderSettingsDialog.tsx`
- `src/components/ai/PlanQueue.tsx`
- `src/components/ai/AgentModeToggle.tsx`
- `src/lib/ai/types.ts`
- `src/lib/stores/WorkspaceStore.ts`

Verdict: ✅ all 11 present. ❌ list missing.

---

### Layer 3 — AIChat.tsx Wiring Checks

Use Grep tool. ✅ found / ❌ missing.

**MessageRole is correct (no old roles):**
- Pattern: `plan_queued` in `src/components/ai/AIChat.tsx`
- Pattern must NOT exist: `tool_start` in `src/components/ai/AIChat.tsx`
- Pattern must NOT exist: `tool_end` in `src/components/ai/AIChat.tsx`
- Pattern must NOT exist: `ToolStep` in `src/components/ai/AIChat.tsx`

**ToolLogEntry wiring:**
- Pattern: `toolLog` in `src/components/ai/AIChat.tsx`
- Pattern: `ToolLogEntry` in `src/components/ai/AIChat.tsx`
- Pattern: `onToolStart` in `src/components/ai/AIChat.tsx`
- Pattern: `onToolEnd` in `src/components/ai/AIChat.tsx`

**ToolCallLog rendered in assistant bubble:**
- Pattern: `ToolCallLog` in `src/components/ai/AIChat.tsx`
- Pattern: `onApplySQL` in `src/components/ai/AIChat.tsx`

**APEX welcome:**
- Pattern: `APEX` in `src/components/ai/AIChat.tsx`
- Pattern: `Autonomous Process Engineering` in `src/components/ai/AIChat.tsx`

**Loader2 removed (was unused):**
- Pattern must NOT exist: `Loader2` in `src/components/ai/AIChat.tsx`

Verdict per item. Roll up to Layer 3 verdict.

---

### Layer 4 — ToolCallLog Checks

**StatResultView integration:**
- Pattern: `StatResultView` in `src/components/ai/ToolCallLog.tsx`
- Pattern: `stat__` in `src/components/ai/ToolCallLog.tsx`

**SQL Apply button:**
- Pattern: `onApplySQL` in `src/components/ai/ToolCallLog.tsx`
- Pattern: `Apply` in `src/components/ai/ToolCallLog.tsx`

**Color map — stat gets green:**
- Pattern: `39FF14` in `src/components/ai/ToolCallLog.tsx`
- Pattern: `00d2ff` in `src/components/ai/ToolCallLog.tsx`

**Running spinner:**
- Pattern: `animate-spin` in `src/components/ai/ToolCallLog.tsx`

Verdict per item. Roll up to Layer 4 verdict.

---

### Layer 5 — StatResultView Checks

- Pattern: `violations` in `src/components/ai/StatResultView.tsx`
- Pattern: `anomalies` in `src/components/ai/StatResultView.tsx`
- Pattern: `frequencies` in `src/components/ai/StatResultView.tsx`

Verdict: ✅ all 3 found / ❌ list missing.

---

### Layer 6 — HypothesisPanel + ConfidenceBar Checks

**HypothesisPanel:**
- Pattern: `Hypothesis` in `src/components/ai/HypothesisPanel.tsx`
- Pattern: `evidence_for` in `src/components/ai/HypothesisPanel.tsx`
- Pattern: `evidence_against` in `src/components/ai/HypothesisPanel.tsx`
- Pattern: `probability` in `src/components/ai/HypothesisPanel.tsx`

**ConfidenceBar:**
- Pattern: `0.85` in `src/components/ai/ConfidenceBar.tsx` (green threshold)
- Pattern: `fast` in `src/components/ai/ConfidenceBar.tsx`
- Pattern: `slow` in `src/components/ai/ConfidenceBar.tsx`

Verdict per item. Roll up to Layer 6 verdict.

---

### Layer 7 — Provider Catalog + WorkspaceStore

**All 5 providers in PROVIDER_CATALOG:**
- Pattern: `ollama` in `src/lib/ai/types.ts`
- Pattern: `nvidia` in `src/lib/ai/types.ts`
- Pattern: `claude-opus-4-6` in `src/lib/ai/types.ts`
- Pattern: `claude-haiku-4-5-20251001` in `src/lib/ai/types.ts`
- Pattern: `Hypothesis` in `src/lib/ai/types.ts`

**WorkspaceStore exports:**
- Pattern: `agentMode` in `src/lib/stores/WorkspaceStore.ts`
- Pattern: `undoStack` in `src/lib/stores/WorkspaceStore.ts`
- Pattern: `planQueue` in `src/lib/stores/WorkspaceStore.ts`
- Pattern: `addPlanStep` in `src/lib/stores/WorkspaceStore.ts`

Verdict per item. Roll up to Layer 7 verdict.

---

## Final Report

```
╔══════════════════════════════════════════════╤════════╗
║ Layer                                        │ Status ║
╠══════════════════════════════════════════════╪════════╣
║ L1 — Type Safety (tsc --noEmit)              │  ✅/❌  ║
║ L2 — File Existence (11 files)               │  ✅/❌  ║
║ L3 — AIChat.tsx Wiring                       │  ✅/❌  ║
║ L4 — ToolCallLog Checks                      │  ✅/❌  ║
║ L5 — StatResultView Checks                   │  ✅/❌  ║
║ L6 — HypothesisPanel + ConfidenceBar         │  ✅/❌  ║
║ L7 — Provider Catalog + WorkspaceStore       │  ✅/❌  ║
╠══════════════════════════════════════════════╪════════╣
║ OVERALL                                      │  ✅/❌  ║
╚══════════════════════════════════════════════╧════════╝
```

For any ❌, state exactly what failed and what the fix is. If all green: **"daitalk-v2 UI layer is healthy. 0 TypeScript errors, all 11 components present, AIChat tool wiring correct, APEX branding verified."**
