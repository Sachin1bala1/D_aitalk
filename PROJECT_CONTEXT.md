# DataIQ — Project Context

> **For AI agents:** Read this file first. It is the single source of truth for project state, active work, and architecture. Updated automatically after every commit.

## What This Is

DataIQ (repo: `daitalk-v2`) is a desktop database IDE combining DBeaver-style schema navigation with Cursor-style AI assistance. An AI agent has full workspace control: it navigates schemas, writes and executes SQL, mutates tables, and builds pipelines. Built with Tauri (Rust backend) + React 19 frontend, distributed as a native desktop installer.

## Quick Start

```bash
npm run tauri:dev    # Start desktop app in dev mode (Vite + Rust together)
npm run dev          # Start Vite frontend only (no desktop window)
npm test             # Run tests once (vitest run)
npm run lint         # Type-check (tsc --noEmit)
```

## Architecture at a Glance

- **Tauri IPC** — All DB operations use `invoke("command_name", args)` from `@tauri-apps/api/core`. NO HTTP fetch. Streaming queries emit `"query_batch"` events (500 rows/batch). 62 commands total. (`src-tauri/src/commands/`)
- **WorkspaceStore** — Single Zustand store (Immer mutations, ~420 lines) for all app state: tabs, connections, schemas, agent mode, plan queue, working memory, hypotheses. (`src/lib/stores/WorkspaceStore.ts`)
- **AgentLoop** — Provider-agnostic AI iteration loop. Classifies queries as fast/deep path, builds system prompt with memory context, drives the entire agent session. (`src/lib/agent/AgentLoop.ts`)
- **CommandBus** — Dispatches 30+ typed `AgentCommand` objects to UI + Tauri `invoke()`. (`src/lib/agent/CommandBus.ts`)
- **AI Providers** — Four fully-implemented providers (Claude, Gemini, OpenAI/NIM, Ollama) behind a common interface. Factory in `ProviderRegistry.ts`. (`src/lib/ai/providers/`)
- **Plan Mode vs Auto Mode** — Auto: commands execute immediately. Plan: commands queue in `planQueue` for user approval. Destructive commands always queue. (`src/lib/stores/WorkspaceStore.ts` + `src/components/PlanQueue.tsx`)
- **Memory System** — Episodic memory + user calibration via 20 `memory_*` Tauri commands persisted to local SQLite. In-session context in `WorkingMemoryState`. (`src-tauri/src/`, `src/lib/stores/WorkspaceStore.ts`)
- **Database Layer (Rust)** — sqlx connection pool registry, streaming query executor, per-driver schema introspection. (`src-tauri/src/db/`)
- **Statistical Analysis** — Pyodide (in-browser Python), hypothesis engine, confidence scoring wired into AgentLoop. (`src/lib/pyodide/`)

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + TypeScript + Vite 6 | Monaco editor, TanStack Virtual, XY Flow |
| Styling | Tailwind CSS 4 + Framer Motion | `clsx`, `tailwind-merge`, `lucide-react` |
| State | Zustand 5 + Immer | Single `WorkspaceStore`; no Redux |
| Agent | Custom `AgentLoop` + `CommandBus` | 30+ typed commands, plan/auto modes |
| AI Providers | Claude (`@anthropic-ai/sdk`), Gemini (`@google/genai`), OpenAI, Ollama | All streaming, tool-use capable |
| Backend | Tauri 2 (Rust) | 62 IPC commands, keyring, AppState |
| Databases | PostgreSQL, MySQL, SQLite, MSSQL, MongoDB, Redis, ClickHouse | sqlx + tiberius; DuckDB disabled |
| Industrial | OSIsoft PI Web API, TimescaleDB | Sprint 6 connectors |
| Reporting | pptxgenjs + html2canvas | PPTX/PNG export via ReportBuilder |
| Testing | Vitest 4 + jsdom | 3 test files; `npm test` |

## Feature Status

| Feature | Status | Key Files |
|---------|--------|-----------|
| SQL Editor (multi-tab, streaming) | Done | `src/components/SQLEditor.tsx`, `src-tauri/src/db/query_executor.rs` |
| AI Agent (AgentLoop / APEX) | Done | `src/lib/agent/AgentLoop.ts`, `CommandBus.ts`, `commands.ts` |
| Plan Mode (approval queue) | Done | `src/lib/stores/WorkspaceStore.ts`, `src/components/PlanQueue.tsx` |
| Memory System (episodic + working) | Done | `src-tauri/src/` (`memory_*` commands), `WorkspaceStore.ts` |
| Statistical Analysis (Pyodide) | Done | `src/lib/pyodide/PyodideRuntime.ts` |
| Reporting (ReportBuilder, PPTX/PNG) | Done | `src/components/ReportBuilder.tsx`, `ReportPanel.tsx` |
| License Validation (HMAC-SHA256) | Done | `src/lib/hooks/useLicenseTier.ts`, `src-tauri/src/commands/` |
| Industrial Connectors (PI/TimescaleDB) | Done | `src/lib/pi/`, `src/components/TimescalePanel.tsx` |
| Multi-DB Support (7 engines) | Done | `src-tauri/src/db/` |
| Credential Vault (keyring) | Done | `src-tauri/src/commands/` (`store_api_key`/`get_api_key`) |
| Onboarding (WelcomeScreen + Tour) | Done | `src/components/WelcomeScreen.tsx`, `OnboardingTour.tsx` |
| Harness Engineering (6-layer system) | Done | `src/lib/agent/harness/` (10 files, 1874 lines added) |

## Active Work

**Status:** Harness engineering complete — merged to master 2026-05-07 (commit `800067e`).

### Harness Tasks Progress

| Task | Description | Status |
|------|-------------|--------|
| H-1 | ContextEngine — history compaction + token badge | Done |
| H-2 | HarnessLifecycle — hooks + struggle detection | Done |
| H-3 | ImpactMapEngine + ImpactMapPanel | Done |
| H-4 | FailureTraceStore + HarnessOptimizer + Dashboard | Done |
| H-5 | PolicyEngine — 4 built-in policies | Done |
| H-6 | HarnessObserver — session telemetry | Done |
| Wire | AgentLoop integration (ContextEngine, Lifecycle, PolicyContext, ImpactMap, HarnessVersion) | Done |
| UI | HarnessDashboard + ImpactMapPanel | Done |

**Key files added:**
- `src/lib/agent/harness/` — 10 files: ContextEngine, HarnessLifecycle, HarnessObserver, PolicyEngine, FailureTraceStore, HarnessOptimizer, ImpactMapEngine (+ 3 test files)
- `src/components/admin/HarnessDashboard.tsx` — admin panel (failure traces, version mgmt, optimizer)
- `src/components/panels/ImpactMapPanel.tsx` — pre-execution impact analysis panel
- `src-tauri/src/commands/memory.rs` — 7 new Tauri commands + 3 new SQLite tables

## Recent Changes

| Date | Commit | Description |
|------|--------|-------------|
| 2026-05-07 | `800067e` | feat: harness engineering — 6-layer AI agent control system (18 tasks) |
| 2026-05-07 | `1f6e635` | feat(harness-17): add HarnessDashboard panel to app navigation |
| 2026-05-07 | `62273a4` | feat(harness-15): ImpactMapPanel + WorkspaceStore state + AgentLoop wire (H-3) |
| 2026-05-07 | `0ba7366` | feat(harness-13): inject active harness version into AgentLoop system prompt |
| 2026-05-07 | `01fb9dd` | feat(harness-16): HarnessDashboard — failure traces, version management, optimizer UI |
| 2026-05-07 | `77622c8` | feat: auto-update PROJECT_CONTEXT.md after every git commit |
| 2026-05-07 | `61fb305` | feat(harness-12): HarnessOptimizer — meta-harness self-improvement engine (H-4) |
| 2026-05-07 | `c98c77e` | feat(harness-11): FailureTraceStore — typed Tauri client for harness DB |
| 2026-05-07 | `4d2368c` | feat(harness-14): ImpactMapEngine — plan-before-execute impact analysis (H-3) |
| 2026-05-07 | `8843dc3` | feat(harness-6-8-10): wire ContextEngine + HarnessLifecycle + PolicyContext into AgentLoop |

## Known Constraints

- **DuckDB disabled** on Windows MinGW — bundled OOM issue; feature is in `Cargo.toml` but commented out
- **Rust toolchain** — uses GNU toolchain (MinGW GCC), not MSVC; `rust-toolchain.toml` pinned to Rust 2021 edition
- **PATH ordering** — `cargo build` requires correct PATH so MinGW's `link.exe` is used, not MSVC's
- **No `.env` files** — all secrets go through Tauri keyring via `store_api_key`/`get_api_key` commands
- **CSP disabled** in `tauri.conf.json` (dev convenience; tighten before production)
- **Supabase/PgBouncer** — prepared statements disabled for pooler compatibility (`sslmode=require` auto-added for non-local Postgres)
- **Min window** — 1024×600 enforced in `tauri.conf.json`

## Files AI Agents Should Read First

| Purpose | File |
|---------|------|
| Architecture & commands | `CLAUDE.md` |
| Agent loop (main AI logic) | `src/lib/agent/AgentLoop.ts` |
| All agent command types | `src/lib/agent/commands.ts` |
| Command dispatch to UI + Tauri | `src/lib/agent/CommandBus.ts` |
| Central app state | `src/lib/stores/WorkspaceStore.ts` |
| All 62 Tauri commands | `src-tauri/src/commands/` |
| AI provider interface | `src/lib/ai/types.ts` |
| AI provider implementations | `src/lib/ai/providers/` |
| Harness layer files (WIP) | `src/lib/agent/harness/` |
| Harness implementation plan | `docs/superpowers/plans/2026-05-07-harness-engineering.md` |

---
*Last updated: 2026-05-07 — Harness engineering complete. Updated automatically by Claude Code hook after each commit.*
