# Derived Data Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI agent persist analysis results (feature importance, correlation, etc.) as named, queryable data sets — visible in a new tab, chartable via Graph Builder, and stored in the SQLite memory DB.

**Architecture:** A new `save_derived_table` Tauri command stores rows into a dynamic SQLite table (one table per derived name). The frontend `create_derived_table` agent command invokes this, then opens the rows in a new tab via `setQueryResults`. No new UI boxes — derived tables surface through the existing tab/VirtualTable/GraphBuilder flow.

**Tech Stack:** Rust + sqlx (SQLite), TypeScript, Tauri 2 invoke, Zustand `useWorkspaceStore`, existing `commandBus`/`registerHandlers` pattern.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/src/db/memory.rs` | Modify | Add `derived_tables` metadata table schema |
| `src-tauri/src/commands/memory.rs` | Modify | Add `save_derived_table`, `list_derived_tables`, `drop_derived_table` commands |
| `src-tauri/src/lib.rs` | Modify | Register 3 new commands in `invoke_handler!` |
| `src/lib/agent/commands.ts` | Modify | Add `CreateDerivedTableCmd` type + union + `describeCommand` case |
| `src/lib/agent/toolDefinitions.ts` | Modify | Add `create_derived_table` tool to `AGENT_TOOLS` |
| `src/lib/agent/registerHandlers.ts` | Modify | Add handler: invoke Tauri + open tab |
| `src/lib/agent/AgentLoop.ts` | Modify | System prompt: explain when/how to use `create_derived_table` |

---

### Task 1: Add `derived_tables` metadata table to SQLite schema

**Files:**
- Modify: `src-tauri/src/db/memory.rs`

- [ ] **Step 1: Read the file to find the end of `open_memory_db`**

  The function ends around line 284 with `Ok(pool)`. Find the last `sqlx::query("CREATE TABLE IF NOT EXISTS ...").execute` block before `Ok(pool)`.

- [ ] **Step 2: Add the derived_tables metadata table**

  In `src-tauri/src/db/memory.rs`, insert this block immediately before the final `Ok(pool)`:

```rust
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS derived_tables (
            name TEXT PRIMARY KEY,
            display_title TEXT NOT NULL,
            columns_json TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            permanent INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
```

- [ ] **Step 3: Verify the file compiles**

  ```bash
  cd src-tauri && cargo check 2>&1 | tail -20
  ```
  Expected: no errors related to `memory.rs`.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/db/memory.rs
  git commit -m "feat(memory): add derived_tables metadata schema"
  ```

---

### Task 2: Add Rust Tauri commands for derived tables

**Files:**
- Modify: `src-tauri/src/commands/memory.rs`

- [ ] **Step 1: Add input/output structs at the end of the struct definitions section (around line 200)**

  In `src-tauri/src/commands/memory.rs`, after the `TelemetryEdge` struct (around line 202), add:

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DerivedTableMeta {
    pub name: String,
    pub display_title: String,
    pub columns: Vec<String>,
    pub row_count: i64,
    pub permanent: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SaveDerivedTableInput {
    pub name: String,
    pub display_title: Option<String>,
    pub columns: Vec<String>,
    pub rows_json: String,  // JSON array of objects
    pub permanent: Option<bool>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SaveDerivedTableResult {
    pub name: String,
    pub row_count: i64,
    pub permanent: bool,
}
```

- [ ] **Step 2: Add `save_derived_table` command at the end of the file**

  Append to `src-tauri/src/commands/memory.rs`:

```rust
#[tauri::command]
pub async fn save_derived_table(
    input: SaveDerivedTableInput,
    state: State<'_, AppState>,
) -> Result<SaveDerivedTableResult, String> {
    let pool = get_pool(&state).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let permanent = input.permanent.unwrap_or(false);
    let display_title = input
        .display_title
        .unwrap_or_else(|| input.name.replace('_', " "));

    // Parse rows from JSON
    let rows: Vec<serde_json::Value> = serde_json::from_str(&input.rows_json)
        .map_err(|e| format!("Invalid rows_json: {e}"))?;
    let row_count = rows.len() as i64;

    // Sanitize table name — only alphanumeric + underscore
    let safe_name: String = input
        .name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect();

    // Drop existing table with this name (idempotent replace)
    sqlx::query(&format!("DROP TABLE IF EXISTS derived__{safe_name}"))
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // Build CREATE TABLE with columns as TEXT (we cast on read)
    if !input.columns.is_empty() {
        let col_defs: Vec<String> = input
            .columns
            .iter()
            .map(|c| {
                let safe_col: String = c
                    .chars()
                    .map(|ch| if ch.is_alphanumeric() || ch == '_' { ch } else { '_' })
                    .collect();
                format!("\"{safe_col}\" TEXT")
            })
            .collect();
        let create_sql = format!(
            "CREATE TABLE IF NOT EXISTS derived__{safe_name} ({})",
            col_defs.join(", ")
        );
        sqlx::query(&create_sql)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;

        // Insert rows
        for row in &rows {
            let obj = row.as_object().ok_or("Each row must be a JSON object")?;
            let placeholders: Vec<String> = (0..input.columns.len()).map(|_| "?".to_string()).collect();
            let col_names: Vec<String> = input
                .columns
                .iter()
                .map(|c| {
                    let safe_col: String = c
                        .chars()
                        .map(|ch| if ch.is_alphanumeric() || ch == '_' { ch } else { '_' })
                        .collect();
                    format!("\"{safe_col}\"")
                })
                .collect();
            let insert_sql = format!(
                "INSERT INTO derived__{safe_name} ({}) VALUES ({})",
                col_names.join(", "),
                placeholders.join(", ")
            );
            let mut query = sqlx::query(&insert_sql);
            for col in &input.columns {
                let val = obj.get(col).cloned().unwrap_or(serde_json::Value::Null);
                let s = match &val {
                    serde_json::Value::Null => None,
                    serde_json::Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                };
                query = query.bind(s);
            }
            query.execute(&pool).await.map_err(|e| e.to_string())?;
        }
    }

    // Upsert metadata
    let columns_json =
        serde_json::to_string(&input.columns).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT OR REPLACE INTO derived_tables
         (name, display_title, columns_json, row_count, permanent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&safe_name)
    .bind(&display_title)
    .bind(&columns_json)
    .bind(row_count)
    .bind(permanent as i64)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(SaveDerivedTableResult {
        name: safe_name,
        row_count,
        permanent,
    })
}

#[tauri::command]
pub async fn list_derived_tables(
    state: State<'_, AppState>,
) -> Result<Vec<DerivedTableMeta>, String> {
    let pool = get_pool(&state).await?;
    let rows = sqlx::query(
        "SELECT name, display_title, columns_json, row_count, permanent, created_at, updated_at
         FROM derived_tables ORDER BY updated_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(|row| {
            let columns_json: String = row.try_get("columns_json").unwrap_or_default();
            let columns: Vec<String> =
                serde_json::from_str(&columns_json).unwrap_or_default();
            Ok(DerivedTableMeta {
                name: row.try_get("name").unwrap_or_default(),
                display_title: row.try_get("display_title").unwrap_or_default(),
                columns,
                row_count: row.try_get("row_count").unwrap_or(0),
                permanent: {
                    let v: i64 = row.try_get("permanent").unwrap_or(0);
                    v != 0
                },
                created_at: row.try_get("created_at").unwrap_or(0),
                updated_at: row.try_get("updated_at").unwrap_or(0),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn drop_derived_table(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = get_pool(&state).await?;
    let safe_name: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    sqlx::query(&format!("DROP TABLE IF EXISTS derived__{safe_name}"))
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM derived_tables WHERE name = ?")
        .bind(&safe_name)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Verify the commands compile**

  ```bash
  cd src-tauri && cargo check 2>&1 | grep -E "error|warning: unused"
  ```
  Expected: no `error[` lines. Unused import warnings are ok.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/commands/memory.rs
  git commit -m "feat(memory): add save/list/drop derived table Tauri commands"
  ```

---

### Task 3: Register new Tauri commands in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add 3 commands to `invoke_handler!`**

  In `src-tauri/src/lib.rs`, find the line `commands::import_excel_file,` (near the end of the handler list, around line 132), and add immediately after it:

```rust
            commands::save_derived_table,
            commands::list_derived_tables,
            commands::drop_derived_table,
```

  So the block looks like:
  ```rust
            commands::import_excel_file,
            commands::save_derived_table,
            commands::list_derived_tables,
            commands::drop_derived_table,
            commands::clear_query_cache,
  ```

- [ ] **Step 2: Verify compile**

  ```bash
  cd src-tauri && cargo check 2>&1 | tail -5
  ```
  Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src-tauri/src/lib.rs
  git commit -m "feat(tauri): register save/list/drop derived table commands"
  ```

---

### Task 4: Add `CreateDerivedTableCmd` to frontend command types

**Files:**
- Modify: `src/lib/agent/commands.ts`

- [ ] **Step 1: Add the interface after `CreateAnalysisChartCmd` (around line 226)**

  In `src/lib/agent/commands.ts`, after the closing `}` of `CreateAnalysisChartCmd` (after line 226), add:

```typescript
export interface CreateDerivedTableCmd {
  type: "create_derived_table";
  /** Snake_case table name, e.g. "feature_importance_lean_rate" */
  name: string;
  rows: Record<string, unknown>[];
  /** Optional explicit column order. If omitted, derived from first row keys. */
  columns?: string[];
  /** Human-readable title shown in the tab. Defaults to name with underscores as spaces. */
  title?: string;
  /** If true, table survives app restarts. Default false (session-only). */
  permanent?: boolean;
  /** If true (default), open the derived table in a new SQL tab immediately. */
  openInTab?: boolean;
  risk: "safe";
}
```

- [ ] **Step 2: Add to the `AgentCommand` union**

  In `src/lib/agent/commands.ts`, find the end of the `AgentCommand` union type (around line 380-390). It ends with `| PIGetCurrentCmd;`. Change it to:

```typescript
  | PIGetCurrentCmd
  | CreateDerivedTableCmd;
```

- [ ] **Step 3: Add to `describeCommand`**

  In `src/lib/agent/commands.ts`, inside `describeCommand`, before `case "pi_search_tags":` add:

```typescript
    case "create_derived_table": return `Save derived table "${cmd.name}" (${cmd.rows.length} rows)`;
```

- [ ] **Step 4: Verify TypeScript**

  ```bash
  npm run lint 2>&1 | grep -E "error TS|commands.ts"
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/agent/commands.ts
  git commit -m "feat(agent): add CreateDerivedTableCmd type"
  ```

---

### Task 5: Add `create_derived_table` tool definition

**Files:**
- Modify: `src/lib/agent/toolDefinitions.ts`

- [ ] **Step 1: Find where to insert — after the `create_analysis_chart` tool (around line 330)**

  Look for `name: "create_analysis_chart"` block, which ends with `required: ["chartType", "rows", "xKey", "yKey"]`. After its closing `},`, add:

```typescript
  {
    name: "create_derived_table",
    description:
      "Persist analysis results as a named derived data table stored in the app's local database. After feature importance, correlation, or any analysis that produces rows, call this to save the result as a queryable table that opens in a new tab for inspection and charting. Use snake_case for the name (e.g. 'feature_importance_lean_rate'). Do NOT call this after analyze_loaded_feature_importance — that already auto-charts; only call this if the user explicitly asks to save results as a table.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Snake_case table name, e.g. 'feature_importance_lean_rate'. Used as the table identifier in the local DB.",
        },
        rows: {
          type: "array",
          items: { type: "object" } as any,
          description: "Array of result row objects to store.",
        } as any,
        columns: {
          type: "array",
          items: { type: "string" } as any,
          description: "Optional explicit column order. If omitted, derived from first row keys.",
        } as any,
        title: {
          type: "string",
          description: "Human-readable table title shown in the tab header.",
        },
        permanent: {
          type: "boolean",
          description: "If true, table persists across app restarts. Default false.",
        },
        openInTab: {
          type: "boolean",
          description: "If true (default), open the derived table in a new tab immediately.",
        },
      },
      required: ["name", "rows"],
    },
  },
```

- [ ] **Step 2: Verify TypeScript**

  ```bash
  npm run lint 2>&1 | grep -E "error TS|toolDefinitions.ts"
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/agent/toolDefinitions.ts
  git commit -m "feat(agent): add create_derived_table tool definition"
  ```

---

### Task 6: Register the `create_derived_table` handler

**Files:**
- Modify: `src/lib/agent/registerHandlers.ts`

- [ ] **Step 1: Add import for `CreateDerivedTableCmd` in the import block**

  In `src/lib/agent/registerHandlers.ts`, in the imports from `"./commands"` (around lines 26-62), add `CreateDerivedTableCmd` to the import list. Find the line `PIGetCurrentCmd,` and add after it:

```typescript
  CreateDerivedTableCmd,
```

- [ ] **Step 2: Add the handler at the end of `registerHandlers` function, before the final closing `}`**

  Find the last registered handler in `registerHandlers.ts` (search for the last `commandBus.register` call). After its closing block, add:

```typescript
  commandBus.register<CreateDerivedTableCmd>("create_derived_table", async (cmd) => {
    if (!Array.isArray(cmd.rows) || cmd.rows.length === 0) {
      return { success: false, error: "No rows provided to create_derived_table." };
    }

    const columns =
      cmd.columns && cmd.columns.length > 0
        ? cmd.columns
        : Object.keys(cmd.rows[0] ?? {});

    if (columns.length === 0) {
      return { success: false, error: "Cannot determine columns from rows." };
    }

    const rowsJson = JSON.stringify(cmd.rows);

    let savedName = cmd.name;
    try {
      const result = await invoke<{ name: string; row_count: number; permanent: boolean }>(
        "save_derived_table",
        {
          input: {
            name: cmd.name,
            display_title: cmd.title ?? null,
            columns,
            rows_json: rowsJson,
            permanent: cmd.permanent ?? false,
          },
        }
      );
      savedName = result.name;
    } catch (err) {
      console.error("[create_derived_table] Tauri invoke failed:", err);
      // Non-fatal: still open in tab even if persistence failed
    }

    const openInTab = cmd.openInTab !== false;
    if (openInTab) {
      const title = cmd.title ?? savedName.replace(/_/g, " ");
      const fields = columns.map((name) => ({ name }));
      const queryResults = {
        rows: cmd.rows,
        fields,
        rowCount: cmd.rows.length,
        elapsedMs: 0,
        queryId: `derived-${savedName}-${Date.now()}`,
        source_tables: [`derived__${savedName}`],
      };
      const store = useWorkspaceStore.getState();
      const tabId = `tab-derived-${Date.now()}`;
      store.addTab({
        id: tabId,
        type: "sql_editor",
        title,
        sql: "",
        connectionId: store.activeConnectionId,
        queryResults,
        isExecuting: false,
      });
      toast.success(`Derived table "${title}" ready — ${cmd.rows.length} rows`, {
        duration: 4000,
      });
    }

    return {
      success: true,
      tableName: savedName,
      rowCount: cmd.rows.length,
      columns,
    };
  });
```

- [ ] **Step 3: Verify TypeScript**

  ```bash
  npm run lint 2>&1 | grep -E "error TS|registerHandlers.ts"
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/agent/registerHandlers.ts
  git commit -m "feat(agent): register create_derived_table handler — saves to memory DB + opens tab"
  ```

---

### Task 7: Update system prompt in `AgentLoop.ts`

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

- [ ] **Step 1: Find the "After Analysis Tools" section (around lines 504-516)**

  Locate the block:
  ```
  ## After Analysis Tools — How to Plot Results
  After analyze_loaded_feature_importance returns, the chart is AUTOMATICALLY...
  ```

  Replace the entire "After Analysis Tools" block with:

```typescript
`## After Analysis Tools — Results and Derived Tables
After analyze_loaded_feature_importance: the chart is AUTOMATICALLY created in Graph Builder. Do NOT call create_analysis_chart — handled automatically. Just confirm the analysis is done.

If the user asks to "save the results as a table", "keep these factors", or "create a derived table": call create_derived_table with:
  name: "feature_importance_<target_column>" (snake_case)
  rows: the detailed_factors array from the analysis result
  title: "Feature Importance — <Target Column>"

After analyze_loaded_correlation returns, the result has correlations: [{column, correlation, ...}].
To chart it: call create_analysis_chart with rows=result.correlations, xKey="column", yKey="correlation", chartType="bar".
If user asks to save it: call create_derived_table with name="correlation_<target>", rows=result.correlations.

Derived tables open automatically in a new tab — the user can inspect, filter, and chart from there.`
```

  The exact lines to replace in `AgentLoop.ts` are the block starting with:
  ```
  ## After Analysis Tools — How to Plot Results
  ```
  and ending with:
  ```
  To chart it: call create_analysis_chart with rows=result.correlations, xKey="column", yKey="correlation", chartType="bar".
  ```

- [ ] **Step 2: Verify TypeScript**

  ```bash
  npm run lint 2>&1 | grep -E "error TS|AgentLoop.ts"
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/agent/AgentLoop.ts
  git commit -m "feat(agent): update system prompt for derived tables and analysis auto-chart"
  ```

---

### Task 8: Build and validate end-to-end

- [ ] **Step 1: Full Rust build**

  ```bash
  cd src-tauri && cargo build --no-default-features 2>&1 | grep -E "^error"
  ```
  Expected: no `error` lines.

- [ ] **Step 2: Start the app**

  ```bash
  npm run tauri:dev
  ```
  Expected: app opens without crash, no errors in terminal.

- [ ] **Step 3: Validate feature importance chart fix**

  In the app:
  1. Connect to the manufacturing DB
  2. Run a feature importance query via the agent: _"What factors affect lean_rate?"_
  3. Expected: Graph Builder opens with a bar chart showing feature vs importance. Agent does NOT call `create_analysis_chart` after.

- [ ] **Step 4: Validate derived table creation**

  In the app, after the feature importance analysis:
  1. Say to the agent: _"Save these results as a table"_
  2. Expected: Agent calls `create_derived_table` → a new tab opens titled "Feature Importance — lean_rate" with the factors as rows
  3. Click "Chart" on the tab (or ask agent: "chart this") → bar chart opens with feature vs importance

- [ ] **Step 5: Validate persistence**

  1. Restart the app
  2. Go to agent and ask: _"Save results as a permanent table"_ (with `permanent: true`)
  3. Restart app again
  4. Expected: the derived table data is still in the SQLite DB (verify via: `init_memory_db` is called → table `derived__feature_importance_*` exists)

- [ ] **Step 6: Final commit (if any pending changes)**

  ```bash
  git status
  git add -p  # review any remaining changes
  git commit -m "fix: validate derived tables e2e"
  ```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Agent creates derived table from analysis results → Task 6 handler
- ✅ Stored in SQLite memory DB → Task 1-3 (Rust side)
- ✅ Temporary by default, permanent if requested → `permanent` flag throughout
- ✅ Opens in tab for inspection and charting → Task 6 handler (`openInTab`)
- ✅ No new UI boxes → uses existing tab/VirtualTable/GraphBuilder
- ✅ Feature importance auto-chart fix → already done in AgentLoop.ts (pre-plan fix)
- ✅ System prompt updated → Task 7

**Type consistency check:**
- `SaveDerivedTableInput.rows_json` (Rust) ↔ `JSON.stringify(cmd.rows)` (TS handler) ✅
- `SaveDerivedTableInput.columns` (Rust Vec<String>) ↔ `columns: string[]` (TS) ✅  
- `invoke("save_derived_table", { input: { ... } })` matches `#[tauri::command] pub async fn save_derived_table(input: SaveDerivedTableInput, ...)` ✅
- `store.openNewTab({ title })` — check that `openNewTab` accepts `{ title?: string }` in WorkspaceStore. If the method signature differs, use `store.addTab({ title })` or whichever method exists.
