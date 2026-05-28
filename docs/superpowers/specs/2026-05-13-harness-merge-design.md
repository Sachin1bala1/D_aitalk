# Merge Design: master (harness) → origin/main (team features)

**Date:** 2026-05-13  
**Author:** Sachin Bala  
**Status:** Approved

---

## Context

Local `master` and `origin/main` have diverged from a common ancestor (`523ac41`):

- **Local `master`** — 22 commits ahead: 6-layer harness engineering (ContextEngine, HarnessLifecycle, HarnessObserver, FailureTraceStore, ImpactMapEngine, HarnessOptimizer, HarnessDashboard, Tauri backend commands)
- **`origin/main`** — 30 commits ahead: Connection Doctor (NVIDIA Qwen AI), billion-scale chart sprints 1–5 (ScaleRouter, CanvasChart, ChartPanel, SelectionBus, APEX types), gaps feature sprints (TaskEngine, SSH tunnel, 18 stat kernels), CI/CD hardening, `v1.0.0` tag

All harness engineering was authored solely by Sachin. The remote harness files are alternative (incomplete) implementations that must be merged carefully.

---

## Branch Strategy

```
origin/main  ──────────────────────────────────────────► (untouched until PR merges)
                  └── integration/harness-merge           (new branch, starts from origin/main)
                            └── git merge master --no-ff  (surfaces all conflicts once)
                            └── resolve 10 conflict zones
                            └── push + open PR → main
local/master ──────────────────────────────────────────► (preserved as fallback)
```

**Commands to create the branch:**
```bash
git checkout -b integration/harness-merge origin/main
git merge master --no-ff
# resolve conflicts per the map below
git push -u origin integration/harness-merge
gh pr create --base main --head integration/harness-merge
```

---

## Conflict Resolution Map

### 1. `.cargo/config.toml` — Local wins entirely

Remote stripped the GNU toolchain config down to just `[build] target-dir`. Local has the full working Windows/MinGW config required to compile on this machine. Without it, `cargo build` fails.

**Resolution:** Accept local version in full (GNU target, `jobs=1`, linker, env vars for cc/cxx/ar/dlltool).

---

### 2. `src-tauri/Cargo.toml` — Both keep (additive)

- Local adds `[profile.dev]` memory optimization block (debug=0, opt-level=0, split-debuginfo=off) — prevents LLVM OOM on 8GB machines
- Remote enables `ssh2 = { version = "0.9" }` for SSH tunnel support

No overlap. Accept both blocks.

---

### 3. `src-tauri/src/lib.rs` — Both keep (additive)

- Local registers 7 harness Tauri commands (`harness_record_failure`, `harness_get_failures`, `harness_get_active_version`, `harness_save_version`, `harness_activate_version`, `harness_record_telemetry_edge`, `harness_get_telemetry_graph`)
- Remote registers `nvidia_chat_completion`

No overlap in command names. Accept both additions into the `invoke_handler!` macro.

---

### 4. `src/App.tsx` — Both keep (additive)

- Local adds: `"harness"` to panel type union, `HarnessDashboard` import, harness tab button label, `<HarnessDashboard />` render branch
- Remote adds: `ChartPanel` import, `ObjectPropertiesPanel` import, `selectedTableNode` / `gogChartRequest` / `setSelectedTableNode` from store, `persistConnections` (replaces `saveConnection`), `setSelectedTableNode` in `onTableClick`

No overlap. Accept all additions from both sides. The panel tab list becomes:
`["agent", "history", "memory", "founder", "snippets", "erd", "search", "sessions", "overview", "harness"]`

---

### 5. `src/lib/agent/AgentLoop.ts` — Both keep (additive)

- Local adds: harness imports (ContextEngine, HarnessLifecycle, FailureTraceStore, ImpactMapEngine, PolicyContext, SessionContext), `harnessAdditions` injection into system prompt, `ContextEngine.trackContextBuild()`, `PolicyContext` + `SessionContext` construction
- Remote adds: visualization helpers (`isVisualizationRequest`, `isUnderspecifiedVisualizationRequest`, `inferNumericColumns`, `buildVisualizationClarifier`), `resolveColumnTypes`, `CreateGoGChartCmd` import

No overlap — harness wiring is in the loop execution path; visualization helpers are new exported utility functions. Accept both.

---

### 6. `src/lib/stores/WorkspaceStore.ts` — Both keep (additive)

- Local adds: `ImpactMap` import, `impactMapResolution: ImpactMap | null` state field, `setImpactMapResolution()` action
- Remote adds: `QueryTabType`, `TabType`, `DashboardWidgetType` type exports, `QueryRuntimeHandle` / `QuerySessionState` fields on `QueryViewState`, `DashboardDatasourceSnapshot` and many dashboard-related interfaces, expanded `TabState`

No overlap. Accept all additions from both sides.

---

### 7. `src/lib/agent/harness/ContextEngine.ts` — Hybrid

| Aspect | Local (keep) | Remote (keep) |
|--------|-------------|---------------|
| `ContextBudget` | 1-field (`historyMax` only) | 5-field (totalTokens, systemReserved, toolResultsMax, historyMax, memoryMax) — **richer, keep remote** |
| `MemoryContext` interface | absent | present — **keep remote** |
| `compactHistory()` | present | present (longer version with staged phases) — **keep remote** |
| `trackContextBuild()` | present, calls `HarnessObserver` | absent — **keep local** |
| `estimateTokens()` | present | present — same logic, keep either |

**Resolution:** Use remote's full file as the base. Add local's `HarnessObserver` import and `trackContextBuild()` method back in.

---

### 8. `src/lib/agent/harness/FailureTraceStore.ts` — Local + remote types

- Local: 141-line fully Tauri-wired implementation with `invoke()` calls for all operations, `getActiveVersion()`, caching
- Remote: 45-line in-memory stub (no Tauri, `invoke` commented out), imports `HarnessFailureTrace` from `./types`

**Resolution:** Keep local's full Tauri implementation. Update the `HarnessFailureTrace` type import to pull from `./types` (remote introduced this shared types file — confirmed present in origin/main).

---

### 9. `src/lib/agent/harness/HarnessLifecycle.ts` — Hybrid

| Aspect | Local (keep) | Remote (keep) |
|--------|-------------|---------------|
| `SessionContext` / `StruggleEvidence` / `SessionResult` interfaces | defined inline | defined in `./types` — **move to types, import** |
| `DATAIQ_HOOKS` export | present (used by AgentLoop) | absent — **keep local** |
| `detectStruggle()` | present (used by AgentLoop) | absent — **keep local** |
| Full lifecycle hooks (onBeforeToolCall, onAfterToolCall, onToolError) | absent | present — **keep remote** |
| EpisodicMemory + UsageAnalytics integration | absent | present — **keep remote** |
| Tauri `invoke()` in onSessionComplete | present | absent (stub) — **keep local** |

**Resolution:** Use remote's full lifecycle hook structure as the base. Add back `DATAIQ_HOOKS`, `detectStruggle()`, and the `invoke()` call in `onSessionComplete`. Move shared types to `./types.ts`.

---

### 10. `src/lib/agent/harness/HarnessObserver.ts` — Hybrid

| Aspect | Local (keep) | Remote (keep) |
|--------|-------------|---------------|
| `SessionTrace` type | absent | present — **keep remote** |
| `TokenUsage` / `ToolEvent` / `ToolError` inline interfaces | present | moved to `./types` — **consolidate in types** |
| `sessionTraces` Map + `activeSessions` Map | absent | present — **keep remote** |
| `completedSessions` history array | absent | present — **keep remote** |
| Tauri `invoke("harness_record_telemetry_edge")` flush | present | absent — **keep local** |

**Resolution:** Use remote's richer observer structure as base. Add local's `invoke()` telemetry flush back in `onSessionComplete`.

---

### New file: `src/lib/agent/harness/types.ts`

Remote introduced this shared types file. Local has these types defined inline. After the merge, shared types (`HarnessFailureTrace`, `SessionContext`, `StruggleEvidence`, `SessionResult`, `SessionTrace`, `TokenUsage`, `ToolEvent`, `ToolError`) should live here and be imported by all harness modules. This consolidation is part of the hybrid resolution.

---

## PR Description

**Title:** `feat(harness): merge 6-layer harness engineering into main`

**Summary:**
- Adds complete 6-layer AI agent harness (ContextEngine, HarnessLifecycle, HarnessObserver, FailureTraceStore, ImpactMapEngine, HarnessOptimizer)
- 7 new Tauri backend commands for harness persistence (failure traces, versions, telemetry graph)
- HarnessDashboard panel in the right nav
- ImpactMapPanel for plan-before-execute impact analysis
- Hybrid resolution of competing harness implementations: remote's richer architecture + local's production Tauri wiring
- Preserves all team features from main (Connection Doctor, billion-scale charts, SSH tunnel, stat kernels)

---

## Success Criteria

- [ ] `npm run lint` passes (tsc --noEmit)
- [ ] `npm test` passes (all 3 vitest files)
- [ ] `npm run tauri:build` compiles without OOM on Windows/MinGW
- [ ] HarnessDashboard tab renders in app
- [ ] ChartPanel and Connection Doctor still work (team features unbroken)
- [ ] All 7 harness Tauri commands registered and callable
- [ ] PR CI validation workflow passes
