# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Daitalk v2 — a desktop database IDE (like DBeaver + Cursor AI). An AI agent has full workspace control: it can navigate schemas, write/execute SQL, mutate tables, build pipelines. Built with Tauri (Rust backend) + React frontend.

## Commands

```bash
npm run tauri:dev    # Start desktop app in dev mode (runs Vite + Rust together)
npm run dev          # Start Vite frontend only (no desktop window)
npm run build        # Build frontend for production
npm run tauri:build  # Build full desktop installer
npm run lint         # Type-check (tsc --noEmit)
```

## Architecture

### Tauri IPC (the key pattern)
All database operations go through Tauri commands — NOT HTTP fetch. The frontend calls `invoke("command_name", { ...args })` via `@tauri-apps/api/core`. Results come back as typed values or errors (strings).

For streaming queries, Rust emits `"query_batch"` events which the frontend listens to via `listen("query_batch", callback)` from `@tauri-apps/api/event`.

### Frontend State
`src/lib/stores/WorkspaceStore.ts` — single Zustand store for the entire app:
- `agentMode: "plan" | "auto"` — Plan Mode vs Auto Mode toggle
- `planQueue: PlanStep[]` — commands waiting for user approval in Plan Mode
- `tabs[]` + `activeTabId` — multi-tab SQL editor state
- `schemas` — schema cache per connection
- `activeConnectionId` — currently selected DB connection

### Database Layer (Rust)
- `src-tauri/src/db/connection_manager.rs` — connection pool registry (sqlx)
- `src-tauri/src/db/query_executor.rs` — streaming query execution (500 rows/batch)
- `src-tauri/src/db/introspection.rs` — schema introspection per driver
- `src-tauri/src/db/types.rs` — shared types (ColumnMeta, FullSchema, QueryBatch, etc.)
- `src-tauri/src/commands.rs` — all `#[tauri::command]` exports
- `src-tauri/src/lib.rs` — Tauri builder + AppState setup

### Agent System (Phase 4 — not yet implemented)
Will live in `src/lib/agent/`. Key files:
- `AgentLoop.ts` — agentic iteration loop (replaces old AgentSystem.ts)
- `CommandBus.ts` — dispatches typed `AgentCommand` objects to UI + Tauri
- `commands.ts` — full AgentCommand union type (navigate, execute_sql, add_column, etc.)
- `registerHandlers.ts` — wires each command type to its handler

### Plan Mode vs Auto Mode
- **Auto Mode**: agent commands execute immediately
- **Plan Mode**: commands queue in `WorkspaceStore.planQueue`; shown in `PlanQueue.tsx` for user approval
- Destructive commands (`delete_rows`, `drop_column`) always queue for approval even in Auto Mode

### AI Providers (Phase 5 — not yet implemented)
Will live in `src/lib/ai/providers/`. Unified `AIProvider` interface over:
- Claude (`@anthropic-ai/sdk`)
- Gemini (`@google/genai`)
- GPT-4o + NVIDIA NIM (`openai` SDK, different baseURL)
- Ollama (`http://127.0.0.1:11434/v1`, OpenAI-compatible)

## Current Phase

**Phase 1 (complete)**: Tauri shell wrapping React frontend. Rust DB layer for PostgreSQL/MySQL/SQLite. WorkspaceStore. Plan/Auto mode toggle UI. ConnectionDialog using `invoke()`.

**Phase 2 (next)**: Wire the actual streaming query results into the VirtualTable (currently using the PoC's ResultsTable). Replace `components/table/ResultsTable.tsx` with `VirtualTable.tsx` using TanStack Virtual.
