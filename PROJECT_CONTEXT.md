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
| Harness Engineering (6-layer system) | In Progress | `src/lib/agent/harness/` (not yet created) |

## Active Work

**Branch:** `feature/harness-engineering`
**Goal:** 6-layer harness engineering system — context compaction, lifecycle hooks, impact maps, meta-harness optimizer, policy engine, observability.
**Plan:** `docs/superpowers/plans/2026-05-07-harness-engineering.md`

### Harness Tasks Progress

| Task | Description | Status |
|------|-------------|--------|
| H-1 | ContextEngine — history compaction + token badge | Pending |
| H-2 | HarnessLifecycle — hooks + struggle detection | Pending |
| H-3 | ImpactMapEngine + ImpactMapPanel | Pending |
| H-4 | FailureTraceStore + HarnessOptimizer + Dashboard | Pending |
| H-5 | PolicyEngine — 4 built-in policies | Pending |
| H-6 | HarnessObserver — session telemetry | Pending |
| Wire | AgentLoop integration (Tasks 6, 8, 10, 13) | Pending |
| UI | HarnessDashboard + ImpactMapPanel | Pending |

> Note: `src/lib/agent/harness/` directory does not yet exist — all harness tasks are pending implementation.

## Recent Changes

| Date | Commit | Description |
|------|--------|-------------|
| 2026-05-07 | `330c648` | docs: add harness engineering implementation plan (6 layers, 18 tasks) |
| 2026-05-06 | `5b1f551` | fix: switch to GNU toolchain — MSVC not installed, MinGW GCC works |
| 2026-05-02 | `523ac41` | feat: close yc operating intelligence gaps |
| 2026-05-02 | `93d44e9` | feat: port intelligence, security, command split, and query transform |
| 2026-05-02 | `9da03c1` | Merge remote-tracking branch 'origin/feature/sprint-8' |
| 2026-05-01 | `606e05b` | fix: PgBouncer/Supavisor compatibility — disable prepared statements + show real error |
| 2026-05-01 | `7937945` | fix: auto-add sslmode=require for non-local Postgres connections |
| 2026-05-01 | `fbea63e` | fix: schema sidebar empty on Supabase/pooler connections |
| 2026-05-01 | `ffba9c3` | fix(sprint-8): quality review fixes — remove_license command, useCallback, tier mapping, MVP note |
| 2026-05-01 | `112fa72` | feat(sprint-8): license key system — HMAC-SHA256 offline validation + useLicenseTier hook |

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
*Last updated: 2026-05-07 — Updated automatically by Claude Code hook after each commit.*
