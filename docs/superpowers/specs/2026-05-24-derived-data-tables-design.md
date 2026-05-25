# Derived Data Tables Design Spec

**Date:** 2026-05-24  
**Status:** Approved

## Goal

Let the AI agent (and in the future, the user) persist analysis results (feature importance, correlation, etc.) as real SQL tables inside the app's built-in SQLite memory database, so they can be queried, filtered, and charted exactly like any other data source — no new UI boxes required.

## Problem

After `analyze_loaded_feature_importance`, the agent knows the feature rankings but the user has no way to treat that result as a queryable table. In JMP, analysis output immediately becomes a new data table. We want the same: analysis → table → SQL → chart.

## Architecture

The app already has an SQLite memory database (`memory.rs`) used for agent episodic memory, calibration, etc. We extend it with a `derived_tables` metadata registry and allow the agent to CREATE ad-hoc tables inside it at runtime.

The memory DB is auto-registered as a special permanent connection called `"Analysis (Memory)"` in the ConnectionManager on app startup. This means:
- Tables appear in the schema sidebar under "Analysis (Memory)"
- Users can run `SELECT * FROM feature_importance_lean_rate` in any SQL tab
- Charts can be built from those queries via Graph Builder

No new sidebar panels, no new dialogs, no new artifact types — it integrates into every existing surface.

## Data Flow

```
analyze_loaded_feature_importance
  → auto-chart to GraphBuilder (existing)
  → agent calls create_derived_table(name, rows, permanent=false)
      → Tauri: CREATE TABLE IF NOT EXISTS <name> + INSERT rows
      → returns { connectionId, tableName, rowCount }
  → agent opens the table in a new SQL tab (setQueryResults)
  → user sees table + can chart/query
```

## Persistence

- `permanent: false` (default): table is dropped on app exit via a cleanup pass
- `permanent: true`: table survives restarts, stays in memory DB file

The `derived_tables` metadata table tracks which tables exist and whether they are permanent.

## New Rust (`src-tauri/src/db/derived_tables.rs`)

Three async functions exposed as Tauri commands:

1. `save_derived_table(name, columns, rows, permanent)` → creates/replaces table, inserts rows, records metadata
2. `list_derived_tables()` → returns `[{name, rowCount, permanent, createdAt}]`
3. `drop_derived_table(name)` → drops table + removes metadata row
4. `cleanup_temp_derived_tables()` → called on startup to drop non-permanent tables from prior session

## New Tauri Commands (`commands.rs`)

```rust
#[tauri::command] save_derived_table(...)
#[tauri::command] list_derived_tables(...)
#[tauri::command] drop_derived_table(...)
```

## Auto-Register Memory DB as Connection (`lib.rs`)

On startup, after opening the memory pool, register it in ConnectionManager as:
```
id: "analysis-memory"
name: "Analysis (Memory)"
driver: SQLite
path: <same path as memory DB>
```

This makes the memory DB queryable through all existing SQL/schema/introspection machinery.

## Frontend (`src/lib/agent/`)

### New command type (`commands.ts`)
```typescript
export interface CreateDerivedTableCmd {
  type: "create_derived_table";
  name: string;           // e.g. "feature_importance_lean_rate"
  rows: Record<string, unknown>[];
  columns?: string[];     // optional explicit column order
  permanent?: boolean;    // default false
  title?: string;         // display name
  openInTab?: boolean;    // default true — open result in new SQL tab
  risk: "safe";
}
```

### Tool definition (`toolDefinitions.ts`)
LLM-callable tool that the agent uses after analysis commands.

### Handler (`registerHandlers.ts`)
- Validates rows
- Calls `invoke("save_derived_table", ...)`
- If `openInTab`, creates new tab with queryResults set to the rows
- Returns `{ success, tableName, rowCount, connectionId: "analysis-memory" }`

### System prompt addition (`AgentLoop.ts`)
After `analyze_loaded_feature_importance`: auto-chart fires automatically; agent MAY ALSO call `create_derived_table` to persist the factors as a queryable table.

## Not in scope
- User-facing "New Derived Table" button (future)
- Export/import of derived tables
- Joins between derived tables and live DB tables (requires DuckDB — future)
- Column type inference beyond text/real (all numeric columns stored as REAL, all others TEXT)
