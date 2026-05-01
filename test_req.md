# Daitalk v2 — Test Requirements & Manual Test Checklist

> Run these tests after launching the app with:
> ```bash
> export PATH="/c/msys64/mingw64/bin:$HOME/.cargo/bin:$PATH"
> npm run tauri:dev
> ```
>
> **NVIDIA key confirmed working** (tested 2026-04-17):
> - Model: `qwen/qwen3.5-397b-a17b`
> - Text generation: ✓
> - Tool use / function calling: ✓
> - Streaming: ✓

---

## T-01 · App Launch

| # | Step | Expected |
|---|------|----------|
| 1.1 | Launch app | Window opens, dark theme, no console errors |
| 1.2 | Sidebar shows "DAITALK" header | Logo + plus button visible |
| 1.3 | Center panel shows SQL editor | Monaco editor loaded, empty or default SQL |
| 1.4 | Right panel shows "AI Agent" tab | Chat panel visible |
| 1.5 | Plan/Auto toggle visible in toolbar | Shows amber "Plan" and green "Auto" buttons |

---

## T-02 · Database Connection

| # | Step | Expected |
|---|------|----------|
| 2.1 | Click + icon in sidebar | ConnectionDialog opens |
| 2.2 | Enter a valid PostgreSQL connection string | No validation error |
| 2.3 | Click Connect | Toast: "Connected" |
| 2.4 | Sidebar populates with schemas and tables | Tree of schema → tables visible |
| 2.5 | Click a table name | SQL editor fills with `SELECT * FROM "schema"."table" LIMIT 100;` |
| 2.6 | Click Run | Results appear in VirtualTable |
| 2.7 | Disconnect and reconnect | State resets cleanly |

**Test connection string (PostgreSQL):**
```
postgresql://user:password@localhost:5432/dbname
```

---

## T-03 · SQL Editor

| # | Step | Expected |
|---|------|----------|
| 3.1 | Type SQL in editor | Monaco syntax highlighting active |
| 3.2 | Press Ctrl+Enter | Query executes |
| 3.3 | Click Run button | Query executes |
| 3.4 | Run `SELECT pg_sleep(5)` then click Run again | Button disabled while executing |
| 3.5 | Run invalid SQL | Error toast with message, no crash |
| 3.6 | Run `SELECT * FROM large_table` (1M+ rows) | First rows appear <200ms, scroll works |

---

## T-04 · VirtualTable (Streaming Results)

| # | Step | Expected |
|---|------|----------|
| 4.1 | Run a query returning 1000+ rows | Status bar shows "● Streaming — N rows…" |
| 4.2 | Scroll down rapidly | No lag, no blank rows |
| 4.3 | Scroll to bottom | All rows rendered |
| 4.4 | Final status bar | "N rows · Xms" (no "Streaming" prefix) |
| 4.5 | Run a new query | Table clears instantly, new results stream in |
| 4.6 | Timestamps in results | Show as `YYYY-MM-DDTHH:MM:SS.mmmZ` in blue mono |
| 4.7 | Boolean values | Green "true" / red "false" badges |
| 4.8 | JSON columns | Amber truncated preview |
| 4.9 | NULL values | Italic dimmed "null" |
| 4.10 | Numbers | Right-aligned |

---

## T-05 · AI Provider Settings

| # | Step | Expected |
|---|------|----------|
| 5.1 | Open app with no key set | "No AI provider configured" screen |
| 5.2 | Click "Configure Provider" | ProviderSettingsDialog opens |
| 5.3 | See five provider tabs | Claude, Gemini, OpenAI, NVIDIA, Ollama |
| 5.4 | **NVIDIA tab** — paste key `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` | Key shows as password dots |
| 5.5 | Select model "Qwen 3.5 397B A17B" | Dropdown updates |
| 5.6 | Click "Save & Use" | Dialog closes, footer shows "NVIDIA NIM / qwen3.5-397b-a17b" |
| 5.7 | Click "Provider" in chat footer | Dialog reopens with saved values |
| 5.8 | Switch to Claude tab, enter invalid key | Warning: "Key should start with sk-ant" |
| 5.9 | Enter OpenAI key `sk-...` | No warning |
| 5.10 | Enter custom NVIDIA model ID in text field | Model field updates |

---

## T-06 · AI Agent — Basic Chat (NVIDIA / Qwen 3.5)

> Configure NVIDIA as active provider with `qwen/qwen3.5-397b-a17b` before running these.

| # | Prompt | Expected |
|---|--------|----------|
| 6.1 | "Hello, what can you do?" | Streaming text response, cursor blinks while typing |
| 6.2 | "What tables do I have?" (with DB connected) | Agent calls `open_table` or `execute_sql` for schema |
| 6.3 | "Show me the first 5 rows of [table_name]" | Agent calls `execute_sql`, results appear in VirtualTable |
| 6.4 | "Write SQL to count rows grouped by status" | Agent calls `set_editor_content`, SQL appears in editor but not executed |
| 6.5 | "Run that query" | Agent calls `execute_sql` with the SQL from editor |
| 6.6 | "Open a new tab" | New tab opens in editor |
| 6.7 | Tool step rows visible | Each tool call shows spinner → checkmark inline in chat |

---

## T-07 · AI Agent — Multi-turn Conversation

| # | Steps | Expected |
|---|-------|----------|
| 7.1 | Ask: "How many rows are in [table]?" → Agent runs COUNT(*) → "Now filter by status='active'" | Agent refines query using conversation context |
| 7.2 | Ask: "Add a column called 'notes' TEXT to [table]" | Agent calls `add_column` (caution level) |
| 7.3 | Check schema sidebar after add_column | New column appears |
| 7.4 | Ask 10 messages without error | Conversation history stays within context limit |

---

## T-08 · Plan Mode

| # | Step | Expected |
|---|------|----------|
| 8.1 | Toggle to **Plan Mode** (amber) | Mode indicator changes |
| 8.2 | Ask agent: "Delete all rows where status='deleted' from [table]" | Command is **queued**, not executed immediately |
| 8.3 | PlanQueue panel appears | Step shows DESTRUCTIVE badge, WHERE clause preview |
| 8.4 | Click ✓ Approve | DELETE executes, row count toast appears |
| 8.5 | Repeat step 8.2, click ✕ Reject | Command is discarded, no DB change |
| 8.6 | Ask agent to rename a table | Queued with DESTRUCTIVE badge |
| 8.7 | Ask agent to execute a SELECT | Executes immediately even in Plan Mode (safe command) |
| 8.8 | Ask agent for multiple steps at once | Each destructive step queued separately, safe steps run inline |

---

## T-09 · Auto Mode

| # | Step | Expected |
|---|------|----------|
| 9.1 | Toggle to **Auto Mode** (green) | Mode indicator changes |
| 9.2 | Ask: "Run SELECT * FROM [table] LIMIT 10" | Executes immediately, no queue |
| 9.3 | Ask: "Add column 'created_at' TIMESTAMPTZ to [table]" | Executes immediately (caution but not destructive) |
| 9.4 | Ask: "Delete rows where id=-999" | Executes immediately (destructive in auto mode — should still warn in text) |

---

## T-10 · Schema Mutations via Agent

| # | Command | Expected DB change |
|---|---------|-------------------|
| 10.1 | "Add a nullable TEXT column 'description' to [table]" | `ALTER TABLE … ADD COLUMN description TEXT` |
| 10.2 | "Drop the column 'old_field' from [table]" | `ALTER TABLE … DROP COLUMN old_field` |
| 10.3 | "Rename table [old] to [new]" | `ALTER TABLE … RENAME TO …` |
| 10.4 | After each mutation | Sidebar refreshes automatically, new schema reflected |

---

## T-10b · New Agent Commands

| # | Prompt | Expected |
|---|--------|----------|
| 10b.1 | "Create an index on [table].[column]" | Agent calls `create_index`, SQL runs, success toast |
| 10b.2 | "Show me the [table] in the sidebar" | Agent calls `focus_schema_node`, sidebar highlights table, toast |
| 10b.3 | "Insert a row with name='test' into [table]" | Agent calls `insert_row`, row inserted |
| 10b.4 | "Update the status column for id=1 in [table] to 'active'" | Agent calls `update_cell`, UPDATE runs |
| 10b.5 | "Analyze [table] with DuckDB — count by status" | Agent calls `run_duckdb_analysis`, DuckDB results stream into VirtualTable |

---

## T-15 · Ollama (Local Inference)

> Requires Ollama running locally: `ollama serve` + `ollama pull qwen2.5:7b`

| # | Step | Expected |
|---|------|----------|
| 15.1 | Open Provider Settings → Ollama tab | Tab shows "Local Inference (No Key Required)" — no API key field |
| 15.2 | Instructions visible | Shows `http://127.0.0.1:11434` URL and `ollama pull` command |
| 15.3 | "Download Ollama" link visible | Opens ollama.com/download |
| 15.4 | Select model "Qwen 2.5 7B" | Dropdown updates |
| 15.5 | Click "Save & Use" (button enabled without key) | Saves, footer shows "Ollama (local) / qwen2.5:7b" |
| 15.6 | Ask "Hello, what can you do?" | Response streams from local Ollama instance |
| 15.7 | Ask "List my tables" (with DB connected) | Tool calling works — agent calls `open_table` or `execute_sql` |
| 15.8 | Custom model: type `llama3.1:8b` in text field | Saves and uses that model |
| 15.9 | Ollama not running — send message | Error: connection refused, shown in chat bubble |

---

## T-11 · Multi-Provider Switching

| # | Step | Expected |
|---|------|----------|
| 11.1 | Chat with NVIDIA → switch to Claude → chat again | New provider responds, conversation history preserved |
| 11.2 | Switch to Gemini, run a query | Gemini responds using function declarations |
| 11.3 | Switch to OpenAI GPT-4o, run a query | GPT-4o responds with tool_calls format |
| 11.4 | Each provider's footer label updates | Shows "Claude / claude-opus-4-6" etc. |

---

## T-12 · notify_user Tool

| # | Prompt | Expected |
|---|--------|----------|
| 12.1 | "Show me a success toast" | Agent calls `notify_user` level=success, green toast appears |
| 12.2 | "Warn me about something" | Amber warning toast |
| 12.3 | "Show an error notification" | Red error toast |

---

## T-13 · Edge Cases & Resilience

| # | Scenario | Expected |
|---|----------|----------|
| 13.1 | Send message with no DB connected | Agent responds but notes no connection; execute_sql returns error gracefully |
| 13.2 | Enter wrong API key | Error message in chat, no crash |
| 13.3 | Network offline during generation | Error message in chat bubble, can retry |
| 13.4 | Run query returning 0 rows | Status bar: "0 rows · Xms" |
| 13.5 | Run query with syntax error | Error in VirtualTable status bar |
| 13.6 | Very long SQL (10k chars) | Editor handles it, no truncation |
| 13.7 | Agent tool round limit (10) hit | Loop exits cleanly, partial results shown |
| 13.8 | Close and reopen app | Provider settings persist, conversation resets (expected) |

---

## T-14 · NVIDIA NIM Specific

| # | Test | Expected |
|---|------|----------|
| 14.1 | Use key: `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` | Authenticated |
| 14.2 | Model: `qwen/qwen3.5-397b-a17b` | Loads and responds |
| 14.3 | Tool use prompt | `finish_reason: tool_calls` returned, args parsed correctly |
| 14.4 | Streaming | Tokens arrive in chunks, cursor visible |
| 14.5 | Custom model field: type `nvidia/llama-3.1-nemotron-70b-instruct` manually | Model field accepts it |
| 14.6 | Preset dropdown: switch to "Nemotron 70B" | Model ID updates to `nvidia/llama-3.1-nemotron-70b-instruct` |

---

## API Test Results (Automated — Run 2026-04-17)

```
Provider : NVIDIA NIM
Endpoint : https://integrate.api.nvidia.com/v1/chat/completions
Model    : qwen/qwen3.5-397b-a17b

[PASS] Basic text generation     → "DAITALK_TEST_OK"
[PASS] Tool use / function call   → finish_reason=tool_calls, execute_sql({sql: "SELECT COUNT(*) FROM orders"})
[PASS] Streaming SSE              → 3 chunks received, content correct
```

---

## T-16 · Inline Cell Editing

| # | Step | Expected |
|---|------|----------|
| 16.1 | Run `SELECT * FROM [table] LIMIT 10` | Results appear in VirtualTable |
| 16.2 | Hover over any cell | Cursor changes, "Double-click to edit" tooltip visible |
| 16.3 | Double-click a text cell | Inline input appears, pre-filled with current value, cyan border |
| 16.4 | Edit the value and press Enter | Input disappears, toast "Cell updated", table refreshes with new value |
| 16.5 | Double-click, edit value, press Escape | Input disappears, no DB change |
| 16.6 | Double-click a numeric cell, enter a number | UPDATE executes with unquoted numeric literal |
| 16.7 | Double-click a cell, type "null", press Enter | UPDATE sets column to NULL |
| 16.8 | Double-click on a boolean cell, type "true", press Enter | UPDATE executes with TRUE (unquoted) |
| 16.9 | Double-click while streaming | Nothing happens (editing disabled during stream) |
| 16.10 | Run a JOIN query (two tables), double-click a cell | Toast: "Cannot update: run a simple SELECT from a single table first" |

---

## T-17 · Sidebar focusedNode Highlighting

| # | Step | Expected |
|---|------|----------|
| 17.1 | Ask agent: "Show me the [table] in the sidebar" | `focus_schema_node` command fires, sidebar table row highlights cyan |
| 17.2 | Highlighted table row appearance | Cyan background, "focus" badge, cyan icon |
| 17.3 | Highlighted table is not expanded | Table auto-expands to show columns |
| 17.4 | If focused table is off-screen (sidebar scrolled) | Sidebar smooth-scrolls to the focused row |
| 17.5 | Right-click the focused table | Context menu still opens normally |
| 17.6 | Focus switches to a different table | Previous highlight clears, new one highlights |

---

## T-18 · Table Right-Click Context Menu (Phase 16)

| # | Step | Expected |
|---|------|----------|
| 18.1 | Right-click a table in sidebar | Context menu appears at cursor position |
| 18.2 | Context menu header | Shows "schema.table" in cyan monospace font |
| 18.3 | Click "SELECT * (LIMIT 100)" | Editor fills with `SELECT * FROM "table" LIMIT 100;` |
| 18.4 | Click "COUNT rows" | Editor fills with `SELECT COUNT(*) AS row_count FROM "table";` |
| 18.5 | Click "INSERT template" | Editor fills with `INSERT INTO "table" (col1, col2, …) VALUES (NULL, NULL, …);` |
| 18.6 | Click "EXPLAIN last query" | Runs `EXPLAIN ANALYZE BUFFERS FORMAT TEXT` on current SQL |
| 18.7 | Click "Copy table name" | Table name copied to clipboard (no quotes) |
| 18.8 | Click "Copy qualified name" | `"schema"."table"` copied to clipboard |
| 18.9 | Click "Refresh schema" | Schema re-introspected, sidebar updates |
| 18.10 | Click "DROP TABLE [table]" | Editor fills with `DROP TABLE "schema"."table";` + warning toast |
| 18.11 | Press Escape | Menu closes without action |
| 18.12 | Click outside menu area | Menu closes without action |
| 18.13 | Menu near screen edge | Menu clamps within viewport (does not overflow) |

---

## T-19 · EXPLAIN ANALYZE Plan Viewer (Phase 17)

| # | Step | Expected |
|---|------|----------|
| 19.1 | Write a SELECT query in editor | Editor has valid SQL |
| 19.2 | Click "Explain" button in toolbar | Button shows amber color on hover, labeled "Explain" with ⚡ icon |
| 19.3 | Click Explain (PostgreSQL connected) | Runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <sql>`, results stream in |
| 19.4 | VirtualTable shows plan lines | Each row is one line of the EXPLAIN text plan |
| 19.5 | Status bar message | "EXPLAIN plan ready — N plan lines" toast appears |
| 19.6 | Click Explain on a slow query | Plan includes `actual time=` values |
| 19.7 | Press Shift+F5 | Triggers EXPLAIN (same as clicking button) |
| 19.8 | Click Explain with no SQL | Toast: "No SQL or connection active" |
| 19.9 | Click Explain with no DB connection | Button disabled |
| 19.10 | EXPLAIN on invalid SQL | Error toast: "EXPLAIN failed: …" |

---

## T-21 · Sidebar Table Search (Phase 18)

| # | Step | Expected |
|---|------|----------|
| 21.1 | Connect DB with many tables | Sidebar shows table count button "N tables" |
| 21.2 | Click the "N tables" search button | Search input expands with cyan border |
| 21.3 | Type partial table name | List filters live to matching tables only |
| 21.4 | Matching count shows | "X of N matching" label below input |
| 21.5 | Clear the filter (× button) | All tables shown again |
| 21.6 | Press Escape inside search input | Filter clears and input hides |
| 21.7 | Filter is case-insensitive | "USER" matches "users", "Users" etc. |
| 21.8 | Type something that matches nothing | Empty list, "0 of N matching" |
| 21.9 | Filtered + right-click a result | Context menu works normally |
| 21.10 | Filtered + focused table is in results | Highlight still shows correctly |

---

## T-22 · Tab Rename & Ctrl+W (Phase 19)

| # | Step | Expected |
|---|------|----------|
| 22.1 | Open multiple tabs | Tabs appear in tab bar |
| 22.2 | Double-click a tab title | Inline input appears with current name selected |
| 22.3 | Type new name, press Enter | Tab title updates |
| 22.4 | Double-click, type new name, press Escape | Title reverts to original |
| 22.5 | Double-click, type new name, click elsewhere (blur) | Title saves |
| 22.6 | Press Ctrl+W on active tab (2+ tabs open) | Active tab closes, adjacent tab activates |
| 22.7 | Press Ctrl+W with only 1 tab | Nothing happens (last tab cannot close) |
| 22.8 | Press Ctrl+T | New "Query N" tab opens and becomes active |
| 22.9 | Executing tab has amber dot | Pulsing amber indicator visible while query runs |
| 22.10 | Active tab has cyan top bar | 2px cyan line at top of active tab |

---

## T-23 · Column Resize in VirtualTable (Phase 20)

| # | Step | Expected |
|---|------|----------|
| 23.1 | Run a query, hover over column header | Resize handle (right edge) appears on hover |
| 23.2 | Drag resize handle to the right | Column expands; row cells follow |
| 23.3 | Drag resize handle to the left | Column shrinks; minimum width 60px |
| 23.4 | Drag to below minimum | Column stops at 60px |
| 23.5 | Double-click the resize handle | Column resets to default width (180px) |
| 23.6 | Resize multiple columns independently | Each column retains its own width |
| 23.7 | Scroll horizontally after resize | Header and rows stay aligned |
| 23.8 | Run a new query | Column widths reset to default (new column set) |
| 23.9 | Sort a resized column | Sort works; width unchanged |
| 23.10 | All columns visible simultaneously | No misalignment between header and data rows |

---

## T-24 · DuckDB File Import (Phase 21)

| # | Step | Expected |
|---|------|----------|
| 24.1 | Click ↑ Upload icon in sidebar header | FileImportDialog opens |
| 24.2 | Dialog header | "Import File into DuckDB", amber DuckDB icon |
| 24.3 | Drag-drop a .csv file onto the dropzone | Dropzone highlights amber; file name + size shown |
| 24.4 | File accepted | Table name auto-filled from filename (slugified) |
| 24.5 | Change the table name | Input accepts custom name |
| 24.6 | Click "Import & Preview" | DuckDB registers view, editor filled with SELECT, runs query |
| 24.7 | VirtualTable shows CSV data | Rows visible, column types inferred by DuckDB |
| 24.8 | Drag a .parquet file | File accepted, imports via `read_parquet()` |
| 24.9 | Drag an unsupported file (.xlsx) | Warning: "Unsupported file type" toast |
| 24.10 | Click "Browse" link | File picker opens, accepts .csv/.tsv/.parquet |
| 24.11 | Import then run `SELECT * FROM "table"` | DuckDB view persists for app session |
| 24.12 | Import CSV with same name twice | View replaced (CREATE OR REPLACE VIEW) |

---

## T-20 · End-to-End Agent Workflow

> Full workflow: connect → explore → edit → explain → verify

| # | Step | Expected |
|---|------|----------|
| 20.1 | Connect to PostgreSQL | Schema loads in sidebar |
| 20.2 | Ask agent: "Show me all tables and pick one with at least 100 rows" | Agent queries schema, picks a table, runs COUNT, reports back |
| 20.3 | Agent selects a table | `focus_schema_node` fires, sidebar highlights it |
| 20.4 | Ask: "Show me first 20 rows" | Agent runs SELECT, VirtualTable populates |
| 20.5 | Double-click a cell and edit it | Cell updates in DB, table refreshes |
| 20.6 | Click Explain on the query | Plan appears in VirtualTable |
| 20.7 | Ask: "Create an index on [column] in this table" | Agent calls `create_index`, success toast |
| 20.8 | Right-click the focused table | Context menu opens, shows correct table name |
| 20.9 | Click "INSERT template" from context menu | INSERT SQL loaded in editor |
| 20.10 | Export the current results as XLSX | File downloads, opens in Excel with correct data |

---

## T-25 · Row Numbers Column (Phase 22)

| # | Step | Expected |
|---|------|----------|
| 25.1 | Run any SELECT query | Leftmost column shows `#` header, 48px wide, dark background |
| 25.2 | Rows display 1-based index | Row 1 shows "1", row 500 shows "500" |
| 25.3 | Row number formatting | Numbers ≥1000 use locale separator (1,001) |
| 25.4 | Scroll to bottom | Row number tracks virtualizer index correctly (no reuse/overlap) |
| 25.5 | Run new query | Row numbers reset from 1 |
| 25.6 | Resize a data column | `#` column stays fixed at 48px |
| 25.7 | Sort by a column | Row numbers remain sequential (not sorted) |
| 25.8 | Export CSV | `#` column is NOT included in exported data |
| 25.9 | Export JSON | Row numbers NOT in JSON objects |
| 25.10 | VirtualTable header alignment | `#` header stays aligned with data rows during horizontal scroll |

---

## T-26 · Column Statistics Popover (Phase 24)

| # | Step | Expected |
|---|------|----------|
| 26.1 | Run a query, hover over a column header | BarChart2 icon appears (opacity 0→1 on hover) |
| 26.2 | Click the stats icon | Floating popover appears below the header |
| 26.3 | Popover header | Shows column name + type_name |
| 26.4 | Non-null fill bar | Blue bar proportional to non-null% |
| 26.5 | Core stats | Total rows, Non-null (with %), Null (with %), Distinct |
| 26.6 | Numeric column | Min, Max, Avg, Sum section appears below divider |
| 26.7 | String column | Min length, Max length, Avg length section appears |
| 26.8 | Low-cardinality column (≤200 distinct) | Top values section shows up to 5 entries with amber mini-bars |
| 26.9 | High-cardinality column (>200 distinct) | No top values section shown |
| 26.10 | Press Escape | Popover closes |
| 26.11 | Click outside popover | Popover closes |
| 26.12 | Stats computed instantly | No DB roundtrip — popover opens in <50ms |

---

## T-27 · Monaco Schema Autocomplete (Phase 25)

| # | Step | Expected |
|---|------|----------|
| 27.1 | Connect DB, type `SELECT * FROM ` in editor | Dropdown shows all table names from schema |
| 27.2 | Table suggestion insert | Selects quoted name: `"tablename"` |
| 27.3 | Qualified name | `"schema"."tablename"` appears as alternative suggestion |
| 27.4 | Type table name prefix | List filters to matching tables |
| 27.5 | Type `tablename.` | Dropdown shows all column names for that table |
| 27.6 | Column suggestion insert | Inserts `"colname"` |
| 27.7 | After JOIN keyword | Table suggestions appear same as after FROM |
| 27.8 | After UPDATE keyword | Table suggestions appear |
| 27.9 | No schema loaded | No crash — autocomplete simply shows no suggestions |
| 27.10 | Schema refreshed | New/renamed tables appear immediately in next autocomplete |

---

## T-28 · Cell Right-Click Context Menu (Phase 26)

| # | Step | Expected |
|---|------|----------|
| 28.1 | Run a query, right-click a data cell | Context menu appears near cursor |
| 28.2 | Context menu header | Shows row number + column name + truncated value |
| 28.3 | Click "Copy value" | Cell value copied to clipboard, success toast |
| 28.4 | Null cell → Copy value | "NULL" string copied |
| 28.5 | JSON cell → Copy value | Full JSON string copied |
| 28.6 | Click "Copy row as CSV" | All columns quoted CSV copied |
| 28.7 | Paste CSV into Excel | Correct columns and value count |
| 28.8 | Click "Copy row as JSON" | `{ "col": value, … }` JSON copied |
| 28.9 | Press Escape | Context menu closes |
| 28.10 | Click outside context menu | Context menu closes |
| 28.11 | Ctrl+Shift+C on any cell click | Last clicked row copied as CSV |
| 28.12 | Ctrl+Shift+J on any cell click | Last clicked row copied as JSON |

---

## T-29 · Multi-Connection Sidebar (Phase 27)

| # | Step | Expected |
|---|------|----------|
| 29.1 | Connect a DB | Connection appears in connections list (single = no header shown) |
| 29.2 | Open a second connection | "Connections" section appears at top of sidebar with both chips |
| 29.3 | Active connection chip | Cyan highlight, `#00d2ff` border |
| 29.4 | Inactive connection chip shows driver | `postgres`, `sqlite`, etc. below display name |
| 29.5 | Click inactive connection chip | Active connection switches, schema tree updates |
| 29.6 | Hover inactive chip | Red Power icon appears |
| 29.7 | Click Power icon on inactive chip | That connection disconnects, chip removed |
| 29.8 | Disconnect active connection | Next available connection becomes active |
| 29.9 | Disconnect last connection | Connection section disappears |
| 29.10 | WorkspaceStore.schemas | Each connectionId maps to its own FullSchema |

---

## T-30 · Ctrl+Tab Tab Navigation (Phase 28)

| # | Step | Expected |
|---|------|----------|
| 30.1 | Open 3 tabs, press Ctrl+Tab | Focus moves to next tab (wraps at end) |
| 30.2 | Press Ctrl+Shift+Tab | Focus moves to previous tab (wraps at start) |
| 30.3 | Ctrl+Tab on last tab | Wraps to first tab |
| 30.4 | Ctrl+Shift+Tab on first tab | Wraps to last tab |
| 30.5 | Single tab open | Ctrl+Tab stays on same tab (no crash) |
| 30.6 | Ctrl+Tab during rename | Tab navigation fires but rename stays active |
| 30.7 | Active tab indicator follows | Cyan top-bar moves to the newly activated tab |
| 30.8 | Ctrl+W closes active tab | After close, adjacent tab activates |
| 30.9 | Ctrl+T opens new tab | New "Query N" tab added and becomes active |
| 30.10 | Ctrl+Tab cycles through all tabs | Each tab receives focus in order |

---

## T-31 · SQL Snippets Library (Phase 29)

| # | Step | Expected |
|---|------|----------|
| 31.1 | Click "Snippets" tab in right panel | SnippetsPanel opens, shows empty state with instructions |
| 31.2 | Write SQL in editor, click "Save SQL" | Save form slides in: name input + tags input + SQL preview |
| 31.3 | Type name, press Enter | Snippet saved, form closes, snippet appears in list |
| 31.4 | Snippet shows truncated SQL preview | First 80 chars of SQL shown in mono font |
| 31.5 | Hover a snippet row | Play (insert) and Trash (delete) icons appear |
| 31.6 | Click Play icon | SQL inserted into editor, success toast |
| 31.7 | Click Trash icon | Snippet deleted, success toast, list updates |
| 31.8 | Double-click snippet name | Inline rename input appears |
| 31.9 | Rename and press Enter | Name updates in list |
| 31.10 | Add tags (comma-separated) | Tags appear as clickable chips below SQL preview |
| 31.11 | Click a tag chip | Filter text set to that tag, list filters live |
| 31.12 | >4 snippets: filter bar appears | Search input shown at top of list |
| 31.13 | Save SQL button disabled | When editor is empty |
| 31.14 | Snippets persist on app restart | localStorage survives page reload |

---

## T-32 · Connection Health Indicator (Phase 30)

| # | Step | Expected |
|---|------|----------|
| 32.1 | Open 2 connections | Each chip in sidebar shows a status dot |
| 32.2 | Immediately after connect | Dot pulses amber ("checking") |
| 32.3 | Ping succeeds (SELECT 1) | Dot turns solid emerald green ("healthy") |
| 32.4 | DB goes offline (kill server) | Dot turns red and pulses ("error") |
| 32.5 | DB comes back online (next ping) | Dot turns green again |
| 32.6 | Ping interval | Every 30 seconds automatically |
| 32.7 | Disconnect a connection | Health entry removed from map |
| 32.8 | Ctrl+K shortcut | Right panel switches to AI Agent tab, AI chat textarea focused |
| 32.9 | Ctrl+K while AI panel already open | Chat textarea focused immediately |
| 32.10 | Placeholder hint | AI textarea placeholder now says "Ask Daitalk AI… (Ctrl+K)" |

---

## Known Limitations (current)

- MSSQL not connected — requires tiberius crate (planned)
- MongoDB, Redis, ClickHouse show "not yet supported" error at connect time (planned)
- Conversation history persists in localStorage but resets if localStorage is cleared
- EXPLAIN viewer renders as plain text rows; visual flamechart/tree renderer planned
- Inline cell editing uses first `id` column if no `is_primary_key` flag from driver — may fail on tables without `id` column where driver doesn't set `is_primary_key`
- INSERT template generates `NULL` for all values — user must fill in actual values manually
- DuckDB file import requires native file path (Tauri WebView exposes `file.path`); drag-drop from OS works, browser file picker may only have the filename on some platforms
- Column widths reset when a new query runs (not persisted across queries)
- SSH tunnel not yet supported
- Monaco autocomplete `completionDisposable` is module-level (singleton) — works for single-editor sessions; multi-editor sessions would need per-instance registration
- Multi-connection sidebar chip section only shown when ≥2 connections open (single connection shows no header — by design)
- Health ping uses `SELECT 1` via `db_execute`; NoSQL drivers (MongoDB, Redis) will report error even when actually connected until a driver-specific ping is implemented

---

## T-33 · Chart View (Phase 31)

| # | Step | Expected |
|---|------|----------|
| 33.1 | Run a query with numeric columns | BarChart2 icon appears in status bar |
| 33.2 | Click BarChart2 icon | Chart view replaces table; Table2 icon shown to toggle back |
| 33.3 | Click Table2 icon | Table view returns |
| 33.4 | Bar chart default | Vertical bars rendered in cyan, proportional to Y values |
| 33.5 | Line chart toggle | Line + optional dots rendered; toggle between Bar/Line in chart controls |
| 33.6 | X-axis selector | Dropdown to pick any column as X-axis label |
| 33.7 | Y-axis selector | Dropdown to pick any column as Y value |
| 33.8 | Hover a bar/line point | Tooltip shows X label + formatted Y value |
| 33.9 | Move mouse away | Tooltip disappears |
| 33.10 | Query with >200 rows | "sampled from N" label shown; chart renders 200 points |
| 33.11 | No numeric columns | "No numeric columns to chart" empty state |
| 33.12 | Negative values | Bars rendered below zero-line; dashed zero-line visible |
| 33.13 | Large numbers (millions) | Y-axis uses K/M suffix formatting |
| 33.14 | X labels | Shown when ≤40 data points, rotated -35° to avoid overlap |

---

## T-34 · Row Selection (Phase 32)

| # | Step | Expected |
|---|------|----------|
| 34.1 | Click a data row | Row highlights cyan; status bar shows "1 selected ×" |
| 34.2 | Click another row | Previous deselected, new row selected |
| 34.3 | Ctrl+Click additional rows | Additive selection (each adds to set) |
| 34.4 | Ctrl+Click already-selected row | Row deselected |
| 34.5 | Shift+Click after first selection | Range fills between anchor and target |
| 34.6 | Shift+Click above anchor | Range fills upward |
| 34.7 | Click "N selected ×" in status bar | All selections cleared |
| 34.8 | Right-click with 2+ rows selected | Context menu shows "Copy N selected as CSV" option |
| 34.9 | "Copy N selected as CSV" | Header row + all selected rows copied with correct values |
| 34.10 | New query runs | Selection cleared automatically |
| 34.11 | Scroll while rows selected | Selection persists across virtual scroll |
| 34.12 | Chart view active | Row selection state preserved when toggling back to table |

---

## T-35 · Resizable Editor/Results Split (Phase 33)

| # | Step | Expected |
|---|------|----------|
| 35.1 | App loads | Editor occupies ~45% of center panel height by default |
| 35.2 | Hover drag handle | 6px strip between editor and results turns cyan-tinted |
| 35.3 | Drag handle up | Editor shrinks, results expand; layout updates live while dragging |
| 35.4 | Drag handle down | Editor grows, results shrink |
| 35.5 | Drag to extreme top | Editor clamped at 15% minimum; does not collapse entirely |
| 35.6 | Drag to extreme bottom | Editor clamped at 85% maximum; results panel always visible |
| 35.7 | Double-click drag handle | Split resets to 45% / 55% |
| 35.8 | Mouse leaves center panel during drag | Drag stops cleanly; no stuck dragging state |
| 35.9 | Run a query after resize | Results still load and scroll correctly in resized pane |
| 35.10 | Resize window | Split proportions are preserved (percentage-based layout) |

---

## T-36 · Schema Tree Enrichment (Phase 34)

| # | Step | Expected |
|---|------|----------|
| 36.1 | Connect to a PostgreSQL DB with data | Table list shows row estimates ("~12.3K") beside table names |
| 36.2 | Table with size metadata | Table size shown alongside estimate (e.g. "~12.3K · 2.4MB") |
| 36.3 | Table with no row estimate | No estimate badge shown; just table name |
| 36.4 | Expand a table with FK columns | FK columns show purple ExternalLink icon + "FK" badge |
| 36.5 | Hover over FK column row | Tooltip shows "FK → target_table.target_column" |
| 36.6 | Expand a table with primary key | PK column shows amber Key icon |
| 36.7 | Expand table with indexes | "Indexes" section visible below columns |
| 36.8 | Primary index | Amber dot indicator |
| 36.9 | Unique index | Cyan dot indicator |
| 36.10 | Non-unique index | White/dim dot indicator |
| 36.11 | Hover index row | Tooltip shows columns + UNIQUE/PRIMARY annotations |
| 36.12 | Table with no indexes | No "Indexes" section rendered |

---

## T-37 · Execute Selected SQL (Phase 35)

| # | Step | Expected |
|---|------|----------|
| 37.1 | Write multi-statement SQL in editor | Both statements visible |
| 37.2 | Select only the second statement text | Monaco selection highlight visible |
| 37.3 | Press Ctrl+Shift+Enter | Only the selected SQL executes; results show that query's output |
| 37.4 | Press Ctrl+Shift+Enter with no selection | Full editor SQL executes (fallback behavior) |
| 37.5 | Select whitespace only | Full editor SQL executes as fallback |
| 37.6 | Select a partial statement | Partial SQL sent — DB error shown in toast if invalid |
| 37.7 | Ctrl+Enter (no selection) | Full query always executes regardless |
| 37.8 | History entry after Ctrl+Shift+Enter | History shows the selected SQL, not the full editor content |

---

## T-38 · Copy Row as INSERT (Phase 36)

| # | Step | Expected |
|---|------|----------|
| 38.1 | Right-click any data cell | Context menu includes "Copy as INSERT" option |
| 38.2 | Click "Copy as INSERT" | Clipboard contains valid INSERT statement with all column values |
| 38.3 | Table name in INSERT | Inferred from FROM clause of last query (e.g. `"my_table"`) |
| 38.4 | String values | Properly single-quoted with internal quotes escaped |
| 38.5 | Numeric values | No quotes around numbers (e.g. `42` not `'42'`) |
| 38.6 | NULL values | NULL keyword (not empty string or 'NULL') |
| 38.7 | Boolean values | `true`/`false` without quotes |
| 38.8 | Select 3 rows, right-click | Context menu shows "Copy 3 as INSERT" option |
| 38.9 | "Copy N as INSERT" | Clipboard contains N separate INSERT statements |
| 38.10 | Paste copied INSERT in editor | Valid SQL that DB can execute |

---

## T-39 · Row Detail Panel (Phase 37)

| # | Step | Expected |
|---|------|----------|
| 39.1 | Run a query with results | Row number column (#) is clickable (cyan-tinted hover) |
| 39.2 | Click a row number | Right-side detail panel slides in (272px wide) |
| 39.3 | Panel header | Shows "Row N / M" with previous/next navigation buttons |
| 39.4 | Column list | All columns shown as key-value pairs; key is column name, value is data |
| 39.5 | Null values | Shown as italic "NULL" in dim color |
| 39.6 | Numeric values | Rendered in cyan |
| 39.7 | Boolean values | Green (true) or red (false) |
| 39.8 | Timestamp values | Rendered in purple |
| 39.9 | Hover over value row | Per-row copy icon appears; click to copy just that value |
| 39.10 | "JSON" button in footer | Copies entire row as JSON object |
| 39.11 | "INSERT" button in footer | Copies row as INSERT statement |
| 39.12 | Previous/next buttons | Navigate to adjacent rows; buttons disabled at first/last row |
| 39.13 | Press ↑/↓ arrow keys | Navigate rows via keyboard while panel is open |
| 39.14 | Press Escape | Panel closes |
| 39.15 | Click PanelRight icon in status bar | Toggles detail panel for focused row |
| 39.16 | New query executes | Panel stays open if row index still exists; closes otherwise |

---

## T-40 · Table DDL Viewer (Phase 38)

| # | Step | Expected |
|---|------|----------|
| 40.1 | Right-click a table in sidebar | Context menu includes "View DDL" option |
| 40.2 | Click "View DDL" | Modal opens with loading indicator |
| 40.3 | PostgreSQL table | CREATE TABLE statement with columns, types, constraints, primary key |
| 40.4 | MySQL table | SHOW CREATE TABLE output displayed |
| 40.5 | SQLite table | sqlite_master sql column displayed |
| 40.6 | "Copy" button | DDL copied to clipboard; success toast shown |
| 40.7 | "Send to Editor" button | DDL inserted into SQL editor; modal closes |
| 40.8 | Table not found | Error message displayed in modal body |
| 40.9 | Press Escape | Modal closes |
| 40.10 | Click backdrop | Modal closes |

---

## T-41 · Connection Persistence (Phase 39)

| # | Step | Expected |
|---|------|----------|
| 41.1 | Connect to a database | Connection saved to `connections.json` in app data dir AND localStorage |
| 41.2 | Close and reopen the app | All previously connected databases auto-reconnect on startup |
| 41.3 | Multiple saved connections | All connections restored in parallel; first active one becomes active tab |
| 41.4 | One connection fails to restore | Other connections still restore; failed one silently skipped |
| 41.5 | Toast on restore | "Reconnected to X" (single) or "Restored N connection(s)" (multiple) |
| 41.6 | No saved connections | No toast; app starts with blank slate |
| 41.7 | Disconnect a connection | Removed from both `connections.json` and localStorage immediately |
| 41.8 | Connect after disconnect | Re-added to persistence on next connect |
| 41.9 | Legacy localStorage data | Migrated automatically to Tauri native file on first launch |
| 41.10 | Inspect app data dir | `connections.json` exists with valid JSON array of connection configs |

---

## T-42 · AI Resilience / Retry (Phase 40)

| # | Step | Expected |
|---|------|----------|
| 42.1 | Normal AI request | No change in behavior; response streams as before |
| 42.2 | Simulate 429 rate limit | AI retries up to 3× with 1s/2s backoff; retry message shown inline |
| 42.3 | Retry notification text | "⚠ Rate limited — retrying in Xs (attempt N/3)…" visible in chat |
| 42.4 | Request succeeds on retry 2 | Conversation continues normally after retry |
| 42.5 | All 3 attempts fail | Error message shown in chat; isProcessing cleared |
| 42.6 | HTTP 500 server error | Treated as retryable; same backoff behavior |
| 42.7 | HTTP 400 bad request (invalid key) | NOT retried; error shown immediately |
| 42.8 | Network timeout | Treated as retryable if "fetch"/"network" in message |
| 42.9 | Retry-After header respected | Wait time uses header value instead of calculated backoff |
| 42.10 | Overloaded message (Anthropic) | Detected as retryable via "overloaded" keyword in error message |

---

## T-43 - OS Keychain for API Keys (Phase 41)

| # | Step | Expected |
|---|------|----------|
| 43.1 | Open AI Provider Settings dialog | Dialog opens; API key fields are blank or pre-loaded from OS keychain |
| 43.2 | Enter an API key and click Save and Use | Button shows Saving briefly; key stored in OS keychain (Windows Credential Manager) |
| 43.3 | Close and reopen app | API key reloaded from keychain on startup; AI chat works without re-entering key |
| 43.4 | Close and reopen settings dialog | Key pre-populated from keychain; no manual re-entry needed |
| 43.5 | Settings dialog disclaimer | Text reads Keys are stored in the OS keychain (not localStorage) |
| 43.6 | Inspect localStorage | No API key values in daitalk_provider_settings; only activeProvider and models |
| 43.7 | Delete key (clear field and save) | Key removed from OS keychain; AI chat shows no key warning |
| 43.8 | Multiple providers with keys | Each provider key stored separately in keychain; all preserved |
| 43.9 | Keychain unavailable (error) | Graceful failure; empty key; app does not crash |
| 43.10 | Model and provider selection | Still persisted to localStorage; survives restart |

---

## T-44 - MSSQL Driver (Phase 42)

| # | Step | Expected |
|---|------|----------|
| 44.1 | Open Connection Dialog, select MSSQL driver | Connection form shows connection string field |
| 44.2 | Enter ADO.NET string (Server=tcp:host,1433;Database=db;User Id=sa;Password=pass;TrustServerCertificate=True) and connect | Connects successfully; schema appears in sidebar |
| 44.3 | Schema sidebar shows tables | Table list from sys.tables with row estimates and sizes |
| 44.4 | Schema sidebar shows views | Views listed alongside tables |
| 44.5 | Click a table to SELECT | Streaming query runs; results appear in VirtualTable |
| 44.6 | Integer columns (INT, BIGINT, SMALLINT, TINYINT) | Display as numbers in cell |
| 44.7 | Float columns (FLOAT, REAL, DECIMAL) | Display as floating-point numbers |
| 44.8 | Bit column (BIT) | Display as boolean (true/false) |
| 44.9 | DateTime columns (datetime, datetime2, datetimeoffset) | Display as ISO 8601 string |
| 44.10 | VARCHAR, NVARCHAR, TEXT columns | Display as text |
| 44.11 | Binary columns (VARBINARY, IMAGE) | Display as hex string |
| 44.12 | NULL values in any column type | Display as empty/null in cell |
| 44.13 | Run a SELECT with >500 rows | Results stream in 500-row batches; status bar updates |
| 44.14 | Run DDL (CREATE TABLE) | Executes via db_execute; affected rows returned |
| 44.15 | View DDL modal for MSSQL table | Reconstructed CREATE TABLE shown via STRING_AGG query |
| 44.16 | Primary key columns | Detected via sys.index_columns; shown with PK badge |
| 44.17 | Connection string with TrustServerCertificate=False | TLS validation enforced via rustls |
| 44.18 | Wrong password | Connection error shown to user; app does not crash |
| 44.19 | Invalid host/port | TCP connect error shown to user |
| 44.20 | Disconnect MSSQL connection | Disconnects cleanly; sidebar clears |
