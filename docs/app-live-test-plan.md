# App Live Test Plan

## Goal

Validate Daitalk against the current product goal:
- desktop-first Cursor-for-data workflow
- reliable saved database and saved AI provider state
- AI can execute, analyze, and visualize without manual rescue steps
- chart builder interactions feel stable for exploratory analysis

## Phase 1: Connection and Persistence

### 1. Saved database connection
- Open Connect Database dialog
- Select an existing saved connection
- Verify driver, name, and connection string hydrate into the form
- Click `Test`
- Click `Connect`
- Restart the app and verify the saved connection still restores cleanly

### 2. AI provider persistence
- Open provider settings
- Enter or confirm API key for the active provider
- Change active model/provider
- Restart the app
- Verify provider selection/model remain restored
- Verify key is still usable without re-entry

## Phase 2: Query Execution Reliability

### 3. Direct SQL execution
- Run `SELECT 1`
- Run `SELECT * FROM public.sachin_test_data_table LIMIT 100`
- Verify rows render in the results pane

### 4. AI live execution
- Ask AI to pull 100 rows from the table
- Ask AI to compute simple aggregates
- Verify AI executes the live query instead of only writing SQL to the editor

### 5. Pooler-safe Postgres behavior
- Repeat AI/data queries against the saved Supabase/pooler connection
- Confirm no `prepared statement "sqlx_s_*" already exists` failures

## Phase 3: Visualization

### 6. AI-generated chart
- Ask AI to plot air temperature vs process temperature by type
- Verify data loads and chart renders without “no rows available” errors

### 7. Graph Builder interaction
- Assign X/Y/Color/Group using click-to-select then target click
- Drag a field onto target zones
- Reassign an already-bound field
- Verify no blocked cursor / no random auto-assignment

## Phase 4: Regression Pass

### 8. Connection doctor path
- Trigger a known bad connection string
- Verify diagnosis renders without crashing and suggested fix path appears

### 9. Query tab trust path
- Restore a saved workspace
- Verify restored query tabs show expected snapshot/offline trust state

### 10. Artifact path
- Save a query snapshot
- Create a chart artifact
- Reopen the artifact from the artifacts panel

## Exit Criteria

- No prepared-statement collision on the saved Postgres pooler connection
- AI “run/query/plot” requests execute live and populate results
- Graph Builder field assignment works by click and drag
- Saved DB connection and AI provider settings survive restart
