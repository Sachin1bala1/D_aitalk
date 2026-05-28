# Agent Inspector (v2)

Perform a full health check of the daitalk-v2 APEX agentic layer. Work through every layer below in order. Never skip a layer. Print a ✅/❌ verdict after each check. End with a single summary table.

---

## Baked-In Architecture (do NOT ask the user for this)

**Project root:** `C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2`

### What exists in v2

| File | Role |
|------|------|
| `src/lib/agent/AgentLoop.ts` | Provider-agnostic agentic loop. `runAgentLoop()` streams assistant turns, routes tool calls via CommandBus, handles Plan Mode queuing. Calls `onToolStart(name, input)` + `onToolEnd(name, result)`. |
| `src/lib/agent/CommandBus.ts` | Singleton typed dispatcher. `register<T>(type, handler)`, `dispatch(cmd)`, `hasHandler(type)`. Returns `CommandResult { success, result?, error? }`. |
| `src/lib/agent/commands.ts` | `AgentCommand` union of 23 command types. Each has a `risk` field: `"safe"`, `"caution"`, or `"destructive"`. `describeCommand()` returns a human-readable string for every case. `isDestructive()` gates Plan Mode. |
| `src/lib/agent/toolDefinitions.ts` | `AGENT_TOOLS: UnifiedTool[]` — 26 total tools spread from STAT_TOOLS + 19 core tools. No `handler` field (provider-agnostic). |
| `src/lib/agent/registerHandlers.ts` | Registers all 23 command type handlers on `commandBus` at app startup. `run_stat_tool` calls `PyodideRuntime.getInstance().run(kernel, params)`. |
| `src/lib/tools/stat.tools.ts` | `STAT_TOOLS: UnifiedTool[]` — 7 tools with `stat__` prefix. `statToolToKernelKey(name)` strips `stat__` to get kernel key. |
| `src/lib/pyodide/PyodideRuntime.ts` | Singleton WASM runtime. Lazy-loads Pyodide, installs numpy+scipy. Double-guard loading. Injects globals, cleans up in `finally`. |
| `src/lib/pyodide/stat_kernels.ts` | `STAT_KERNELS` dict of 7 Python kernel strings keyed by: `describe`, `spc_xbar_r`, `capability`, `western_electric`, `regression`, `fft`, `anomaly_zscore`. |
| `src/lib/pyodide/PyodideRuntime.test.ts` | 5 unit tests for the runtime. |

**The 7 stat tool names (stat__ prefix):** `stat__describe`, `stat__spc_xbar_r`, `stat__capability`, `stat__western_electric`, `stat__regression`, `stat__fft`, `stat__anomaly_zscore`

**26 total tools in AGENT_TOOLS:** 19 core + 7 stat

**APEX System Prompt sections (all 3 required):**
1. Process Engineering First Principles (Control → Capability → Drivers → Experiments)
2. Reasoning Protocol (5-step: Frame → Hypotheses → Depth → Tools → Quantify)
3. Statistical Tools Available (all 7 stat__ tools listed with descriptions)

**Baseline:** 5 PyodideRuntime tests, 0 TypeScript errors

---

## Inspection Procedure

---

### Layer 1 — Test Suite

Run:
```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2 && npx vitest run --reporter=verbose 2>&1
```

Check:
- `src/lib/pyodide/PyodideRuntime.test.ts` → **5 tests pass**
- Zero failures

Verdict: ✅ if 5 pass with no failures. ❌ with failure names.

---

### Layer 2 — Type Safety

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2 && npx tsc --noEmit 2>&1
```

Any `error TS` line is a failure.

Verdict: ✅ silent / ❌ list each error with file:line.

---

### Layer 3 — File Existence

Check each file exists using Glob or Read:

**Agent core:**
- `src/lib/agent/AgentLoop.ts`
- `src/lib/agent/CommandBus.ts`
- `src/lib/agent/commands.ts`
- `src/lib/agent/toolDefinitions.ts`
- `src/lib/agent/registerHandlers.ts`

**Stat tools:**
- `src/lib/tools/stat.tools.ts`

**Pyodide:**
- `src/lib/pyodide/PyodideRuntime.ts`
- `src/lib/pyodide/PyodideRuntime.test.ts`
- `src/lib/pyodide/stat_kernels.ts`

Verdict: ✅ all 9 present. ❌ list missing.

---

### Layer 4 — Key Implementation Checks

Use the Grep tool. ✅ found / ❌ missing.

**AgentLoop — stat__ prefix routing:**
- Pattern: `stat__` in `src/lib/agent/AgentLoop.ts`
- Pattern: `run_stat_tool` in `src/lib/agent/AgentLoop.ts`
- Pattern: `statToolToKernelKey` in `src/lib/agent/AgentLoop.ts`

**AgentLoop — APEX system prompt completeness:**
- Pattern: `Process Engineering First Principles` in `src/lib/agent/AgentLoop.ts`
- Pattern: `Reasoning Protocol` in `src/lib/agent/AgentLoop.ts`
- Pattern: `stat__western_electric` in `src/lib/agent/AgentLoop.ts`

**AgentLoop — callbacks correctly invoked:**
- Pattern: `onToolStart` in `src/lib/agent/AgentLoop.ts`
- Pattern: `onToolEnd` in `src/lib/agent/AgentLoop.ts`

**commands.ts — RunStatToolCmd present:**
- Pattern: `run_stat_tool` in `src/lib/agent/commands.ts`
- Pattern: `RunStatToolCmd` in `src/lib/agent/commands.ts`

**commands.ts — describeCommand handles all cases:**
- Pattern: `Stat analysis` in `src/lib/agent/commands.ts`

**toolDefinitions.ts — STAT_TOOLS spread:**
- Pattern: `STAT_TOOLS` in `src/lib/agent/toolDefinitions.ts`

**registerHandlers.ts — run_stat_tool handler:**
- Pattern: `run_stat_tool` in `src/lib/agent/registerHandlers.ts`
- Pattern: `PyodideRuntime` in `src/lib/agent/registerHandlers.ts`

**stat.tools.ts — stat__ prefix and converter:**
- Pattern: `stat__` in `src/lib/tools/stat.tools.ts`
- Pattern: `statToolToKernelKey` in `src/lib/tools/stat.tools.ts`

**PyodideRuntime — double-guard:**
- Pattern: `loadingPromise` in `src/lib/pyodide/PyodideRuntime.ts`

**PyodideRuntime — globals cleanup:**
- Pattern: `globals().pop` in `src/lib/pyodide/PyodideRuntime.ts`

**stat_kernels — all 3 least-common kernels (confirms all 7 present):**
- Pattern: `spc_xbar_r` in `src/lib/pyodide/stat_kernels.ts`
- Pattern: `western_electric` in `src/lib/pyodide/stat_kernels.ts`
- Pattern: `anomaly_zscore` in `src/lib/pyodide/stat_kernels.ts`

Verdict per item. Roll up to Layer 4 verdict.

---

### Layer 5 — Behavioral Coverage

Grep each test description string. ✅ found / ❌ missing.

| Expected test name | File |
|--------------------|------|
| `idle` or `status` initial state | `src/lib/pyodide/PyodideRuntime.test.ts` |
| `run` or `returns result` | `src/lib/pyodide/PyodideRuntime.test.ts` |
| `singleton` or `loadPyodide called only once` | `src/lib/pyodide/PyodideRuntime.test.ts` |
| `injects globals` | `src/lib/pyodide/PyodideRuntime.test.ts` |
| `error` or `re-throws` | `src/lib/pyodide/PyodideRuntime.test.ts` |

---

### Layer 6 — Vite WASM Config

- Pattern: `exclude.*pyodide` in `vite.config.ts`

Verdict: ✅ present / ❌ missing (if missing, Vite will break WASM imports at dev/build time).

---

## Final Report

```
╔══════════════════════════════════════════════╤════════╗
║ Layer                                        │ Status ║
╠══════════════════════════════════════════════╪════════╣
║ L1 — Test Suite (5/5 PyodideRuntime)         │  ✅/❌  ║
║ L2 — Type Safety (tsc --noEmit)              │  ✅/❌  ║
║ L3 — File Existence (9 files)                │  ✅/❌  ║
║ L4 — Implementation Checks                  │  ✅/❌  ║
║ L5 — Behavioral Coverage (5 tests)          │  ✅/❌  ║
║ L6 — Vite WASM Config                        │  ✅/❌  ║
╠══════════════════════════════════════════════╪════════╣
║ OVERALL                                      │  ✅/❌  ║
╚══════════════════════════════════════════════╧════════╝
```

For any ❌, list exactly what failed and what the fix is. If all green: **"APEX agent layer is healthy. 5/5 runtime tests pass, 0 TypeScript errors, all 26 tools wired, all 7 stat kernels present."**
