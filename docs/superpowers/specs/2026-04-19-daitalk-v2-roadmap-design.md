# Daitalk v2 — Commercial Product Roadmap

## Context

Daitalk v2 is a desktop database IDE (Tauri + React + Rust) targeting **manufacturing/industrial companies and data analyst teams** as a commercial product. It is positioned as "DBeaver + Cursor AI" — combining DBeaver's database exploration features with an agentic AI that has full workspace control.

**Timeline:** 1–3 months to first paying customers.  
**Stack:** Tauri v2, React 19, TypeScript, Rust/sqlx, Zustand, TanStack Virtual, Monaco.

---

## What Is Already Built (Out of Scope)

- Multi-connection management, saved connections, connection color tags
- Schema sidebar with tables/views/functions
- Monaco SQL editor with autocomplete (schema + result columns)
- VirtualTable: billion-row streaming, server-side sort/filter/null-filter/per-column filter
- ER Diagram with FK edges and smart layout
- Query history with bookmarks and deduplication
- Export: CSV, JSON, XLSX, XML, HTML, INSERT SQL
- DDL viewer, EXPLAIN plan with index suggestions
- Column stats popover, chart view, pivot/transpose view
- Session monitor with kill-query support
- DB Overview panel (size, cache hit ratio, connections, top tables)
- Table context menu (VACUUM, TRUNCATE, REINDEX, CLUSTER)
- AI agent: Claude / GPT-4o / Gemini / Ollama with Plan Mode and Auto Mode
- CommandBus, WorkspaceStore (Zustand), RowStore, QueryManager
- Bind parameters dialog, Quick Open (Ctrl+P), Insert Row dialog
- File import via DuckDB (CSV, Parquet, Excel)
- Keyboard shortcuts dialog, schema search, snippets panel

---

## Phase 1 — DBeaver Parity: The 4 Blockers (Weeks 1–4)

These are the features that cause a DBeaver user to say "I can't switch."

### 1.1 SSH Tunnel Support
**What:** ConnectionDialog gains an SSH tab. User provides SSH host/port/user/key or password. The Rust layer opens an SSH tunnel (port-forward) before connecting to the DB.  
**Why:** Most production databases are behind a jump host. Without SSH, Daitalk cannot connect to production.  
**Scope:** postgres + timescaledb first. MySQL/MSSQL follow-up.  
**Rust:** `ssh2` crate for tunnel; bind a random local port; pass `localhost:<localPort>` to sqlx pool.

### 1.2 Hierarchical Sidebar Tree
**What:** Tables in the sidebar become expandable nodes. Expanding a table shows child nodes: Columns, Indexes, Foreign Keys, Triggers (where available). Each child type is a collapsible sub-group.  
**Why:** DBeaver users navigate schema entirely via the tree. A flat list feels broken to them.  
**Data source:** Already available in `FullSchema` (columns, indexes, foreign_keys). No new Tauri commands needed.  
**UX:** Click to expand (chevron), lazy-render children. Column nodes show name + type + PK/FK badge inline.

### 1.3 Object Properties Panel
**What:** A resizable bottom panel that appears when a table is selected in the sidebar (or double-clicked). Contains tabs: **Columns** (sortable grid), **Indexes**, **Foreign Keys**, **DDL**, **Data** (runs SELECT * LIMIT 200).  
**Why:** DBeaver's bottom panel is one of its most-used features. Users expect to click a table and inspect it without writing SQL.  
**Layout:** Splits the main area vertically — editor+results on top, properties panel on bottom (draggable divider). Dismissable.

### 1.4 Result Set Editor Toolbar
**What:** A toolbar above the VirtualTable with: **+ Add Row**, **🗑 Delete Selected**, **↩ Revert**, **✓ Apply All** buttons. Edited cells are marked dirty (amber border). Apply All executes all pending UPDATEs/INSERTs/DELETEs in a transaction.  
**Why:** DBeaver users edit data inline constantly. The current double-click UPDATE one-at-a-time is not workflow-compatible.  
**State:** `pendingEdits: Map<rowIndex+col, {type, sql}>` in VirtualTable local state. Apply All batches them.

---

## Phase 2 — Differentiators: Why Pick Daitalk (Weeks 5–8)

Features DBeaver cannot match.

### 2.1 Multiple Result Sets Per Script
**What:** Running a script with multiple SELECT statements shows each result in its own tab below the editor (Result 1, Result 2, …). Tab bar appears when >1 result set is present.  
**Why:** DBeaver supports this; it's expected for script execution. Also enables side-by-side query comparison.

### 2.2 TimescaleDB Hypertable Browser
**What:** TimescaleDB hypertables get a special icon and expandable **Chunks** sub-node in the sidebar. Selecting a hypertable shows a dedicated properties tab: chunk count, compression ratio, retention policy, continuous aggregates.  
**Why:** Core differentiator for manufacturing/industrial customers who use TimescaleDB for sensor/historian data.  
**Data:** `timescaledb_information.hypertables`, `timescaledb_information.chunks`, `timescaledb_information.continuous_aggregates`.

### 2.3 Table / Column Comments Editor
**What:** Columns and tables show their `COMMENT ON` value inline in the sidebar and properties panel. Double-clicking a comment opens an edit field that generates and runs `COMMENT ON TABLE/COLUMN ... IS '...'`.  
**Why:** Data teams rely on column comments for documentation. DBeaver shows these; missing them breaks a workflow.

### 2.4 Table Creation Wizard
**What:** Right-click schema → "New Table" opens a multi-step dialog: (1) name + schema, (2) add columns (name, type, nullable, default, PK), (3) review generated DDL, (4) execute.  
**Why:** DBeaver users expect visual table creation. Running raw CREATE TABLE is a regression for non-SQL-expert users.

### 2.5 First-Run Onboarding Flow
**What:** On first launch (no saved connections), show a welcome screen with: quick-connect cards for common DB types, a short feature tour (3 slides), and a "Connect your first database" CTA.  
**Why:** Commercial product must have a polished first impression. An empty grey screen on first launch loses users immediately.

---

## Phase 3 — Polish & Ship (Weeks 9–12)

### 3.1 Settings / Preferences Dialog
Font size, editor theme (dark/light/high-contrast), default query limit, keyboard binding presets (DBeaver-compatible, VS Code-compatible).

### 3.2 Licensing & Activation
License key validation (online check + offline grace period), per-seat model. Tauri keychain stores the license key. Expired/invalid license degrades to read-only mode rather than blocking entirely.

### 3.3 Auto-Updater
Tauri's built-in updater plugin pointed at a release server. In-app notification when a new version is available. One-click install + relaunch.

### 3.4 Installer & Landing Page
Tauri `tauri build` produces an NSIS installer (Windows) and .dmg (Mac). Landing page with feature comparison vs DBeaver, pricing, and download.

### 3.5 Error Handling & Stability
Audit all `invoke()` call sites for missing error boundaries. Add a global error toast for unhandled Rust panics. Connection retry logic with exponential backoff.

---

## What Is Explicitly Out of Scope (for this roadmap)

- Visual query builder (drag-drop joins)
- pg_dump / restore UI
- Mock data generator
- BLOB / binary viewer
- InfluxDB driver (Phase 4+)
- MongoDB driver UI improvements (Phase 4+)

---

## Success Criteria

- A DBeaver user can connect to a production PostgreSQL DB (via SSH), browse the schema tree, inspect table properties, edit data, and run multi-statement scripts — all without reaching for DBeaver.
- A TimescaleDB user can browse hypertable chunks, view compression stats, and inspect continuous aggregates in one click.
- First-run experience takes < 60 seconds from app launch to first query result.
- App launches in < 2 seconds on a installed production build.
