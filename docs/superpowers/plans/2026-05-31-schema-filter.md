# Schema Filter & Sidebar Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat sidebar table list with a collapsible schema tree; default to showing only user schemas (e.g. `public`); let users toggle schema visibility from a filter popover and connection settings.

**Architecture:** All filtering is frontend-only — Rust already returns `schema` on every `TableMeta`. A new `schemaDefaults.ts` module classifies schemas via a blocklist. `ConnectionConfig` stores `visible_schemas`. `WorkspaceStore` holds the live `visibleSchemas` map. `Sidebar` groups tables by schema; a new `SchemaFilterPopover` handles toggling. Smart defaults run once after each introspect when `visible_schemas` is not yet set.

**Tech Stack:** TypeScript, React, Zustand (immer), Vitest, Lucide icons, Tailwind CSS.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/schema/schemaDefaults.ts` | Create | Blocklist + `deriveDefaultVisibleSchemas()` |
| `src/lib/schema/schemaDefaults.test.ts` | Create | Unit tests for smart default logic |
| `src/lib/db/DbClient.ts` | Modify | Add `visible_schemas?: string[]` to `ConnectionConfig` |
| `src/lib/stores/WorkspaceStore.ts` | Modify | Add `visibleSchemas` state + `setVisibleSchemas` action |
| `src/components/schema/SchemaFilterPopover.tsx` | Create | Schema checklist popover |
| `src/components/schema/SchemaFilterPopover.test.tsx` | Create | Component tests |
| `src/components/schema/Sidebar.tsx` | Modify | Schema tree rendering + filter button |
| `src/App.tsx` | Modify | Run smart default after `setSchema()`; pass `visibleSchemas` to Sidebar |

---

## Task 1: schemaDefaults Module

**Files:**
- Create: `src/lib/schema/schemaDefaults.ts`
- Create: `src/lib/schema/schemaDefaults.test.ts`

### Step 1.1 — Write failing tests

Create `src/lib/schema/schemaDefaults.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveDefaultVisibleSchemas, SYSTEM_SCHEMA_BLOCKLIST } from "./schemaDefaults";
import type { FullSchema } from "../db/DbClient";

const makeSchema = (schemas: string[]): FullSchema => ({
  connection_id: "c1",
  driver: "postgres",
  tables: schemas.map((s, i) => ({
    name: `table_${i}`,
    schema: s,
    row_count: 0,
    size_bytes: 0,
    object_type: "table" as const,
  })),
  columns: {},
  foreign_keys: [],
  indexes: [],
  hypertable_tables: [],
  functions: [],
});

describe("deriveDefaultVisibleSchemas", () => {
  it("always includes public", () => {
    const result = deriveDefaultVisibleSchemas(makeSchema(["public", "auth", "storage"]));
    expect(result).toContain("public");
  });

  it("excludes known Supabase system schemas", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "auth", "storage", "realtime", "extensions", "vault"])
    );
    expect(result).not.toContain("auth");
    expect(result).not.toContain("storage");
    expect(result).not.toContain("realtime");
    expect(result).not.toContain("extensions");
    expect(result).not.toContain("vault");
  });

  it("includes custom user schemas not on blocklist", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "auth", "analytics", "reporting"])
    );
    expect(result).toContain("analytics");
    expect(result).toContain("reporting");
    expect(result).not.toContain("auth");
  });

  it("falls back to all schemas when everything is blocked", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["auth", "storage", "realtime"])
    );
    expect(result).toEqual(["auth", "storage", "realtime"]);
  });

  it("returns [] for empty schema (no tables)", () => {
    const result = deriveDefaultVisibleSchemas(makeSchema([]));
    expect(result).toEqual([]);
  });

  it("deduplicates schemas", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "public", "analytics"])
    );
    expect(result.filter((s) => s === "public").length).toBe(1);
  });

  it("exports SYSTEM_SCHEMA_BLOCKLIST as a Set", () => {
    expect(SYSTEM_SCHEMA_BLOCKLIST.has("auth")).toBe(true);
    expect(SYSTEM_SCHEMA_BLOCKLIST.has("public")).toBe(false);
  });
});
```

### Step 1.2 — Run tests to verify they fail

```
npx vitest run src/lib/schema/schemaDefaults.test.ts
```
Expected: FAIL — module not found

### Step 1.3 — Implement `schemaDefaults.ts`

Create `src/lib/schema/schemaDefaults.ts`:

```typescript
import type { FullSchema } from "../db/DbClient";

/**
 * Postgres / Supabase internal schemas hidden by default.
 * Any schema NOT in this set (other than "public") is treated as user-created.
 */
export const SYSTEM_SCHEMA_BLOCKLIST = new Set([
  "auth",
  "storage",
  "realtime",
  "extensions",
  "graphql",
  "graphql_public",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "pgbouncer",
  "supabase_functions",
  "supabase_migrations",
  "_analytics",
  "_realtime",
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "pg_internal",
]);

/**
 * Derive which schemas should be visible by default for a freshly introspected connection.
 *
 * Rules (in order):
 * 1. Always include "public" if present.
 * 2. Exclude any schema on SYSTEM_SCHEMA_BLOCKLIST.
 * 3. Include any schema NOT on the blocklist (user-created custom schemas).
 * 4. Fallback: if the result is empty, return all unique schemas (never leave sidebar blank).
 */
export function deriveDefaultVisibleSchemas(fullSchema: FullSchema): string[] {
  const all = [...new Set(fullSchema.tables.map((t) => t.schema).filter(Boolean))];
  if (all.length === 0) return [];

  const defaults = all.filter(
    (s) => s === "public" || !SYSTEM_SCHEMA_BLOCKLIST.has(s)
  );

  // Fallback: if everything was blocked, show everything
  return defaults.length > 0 ? defaults : all;
}
```

### Step 1.4 — Run tests to verify they pass

```
npx vitest run src/lib/schema/schemaDefaults.test.ts
```
Expected: PASS (7 tests)

### Step 1.5 — Commit

```bash
git add src/lib/schema/schemaDefaults.ts src/lib/schema/schemaDefaults.test.ts
git commit -m "feat(schema): deriveDefaultVisibleSchemas — smart blocklist-based schema defaults"
```

---

## Task 2: ConnectionConfig + WorkspaceStore

**Files:**
- Modify: `src/lib/db/DbClient.ts` (line ~93 — `ConnectionConfig` interface)
- Modify: `src/lib/stores/WorkspaceStore.ts`

### Step 2.1 — Add `visible_schemas` to `ConnectionConfig`

In `src/lib/db/DbClient.ts`, update the `ConnectionConfig` interface to add one optional field after `read_only`:

```typescript
export interface ConnectionConfig {
  id: string;
  display_name: string;
  driver: DbDriver;
  connection_string: string;
  pool_min?: number;
  pool_max?: number;
  read_only?: boolean;
  visible_schemas?: string[];   // ← add this line
  pi_config?: PIConfig;
  rest_config?: RestApiConfig;
}
```

### Step 2.2 — Add `visibleSchemas` to WorkspaceStore state interface

In `src/lib/stores/WorkspaceStore.ts`, find the state interface block that contains `schemas: Record<string, FullSchema>` (around line 626) and add below it:

```typescript
visibleSchemas: Record<string, string[]>; // connectionId → visible schema names
setVisibleSchemas: (connectionId: string, schemas: string[]) => void;
```

### Step 2.3 — Add initial value in the store initializer

Find the initial state block that sets `schemas: {}` (around line 761) and add after it:

```typescript
visibleSchemas: {},
```

### Step 2.4 — Add the `setVisibleSchemas` action

Find the `setSchema` action (around line 1067) and add after it:

```typescript
setVisibleSchemas: (connectionId, schemas) =>
  set((state) => {
    state.visibleSchemas[connectionId] = schemas;
    // Persist to ConnectionConfig so it survives app restarts
    const conn = state.connections.find((c) => c.id === connectionId);
    if (conn) conn.visible_schemas = schemas;
  }),
```

### Step 2.5 — Run type check

```
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

### Step 2.6 — Commit

```bash
git add src/lib/db/DbClient.ts src/lib/stores/WorkspaceStore.ts
git commit -m "feat(store): visible_schemas on ConnectionConfig; visibleSchemas in WorkspaceStore"
```

---

## Task 3: Smart Default Wiring in App.tsx

**Files:**
- Modify: `src/App.tsx`

After every `setSchema()` call (introspect result), check if the connection already has `visible_schemas`. If not, derive defaults and store them.

### Step 3.1 — Update `refreshSchema` to run smart default

Find the `refreshSchema` function (around line 801 of `src/App.tsx`). Replace it with:

```typescript
const refreshSchema = async (connectionId: string) => {
  try {
    const schema = await DbClient.getSchema(connectionId);
    setSchema(connectionId, schema);

    // Run smart default once per connection (when visible_schemas not yet set)
    const conn = connections.find((c) => c.id === connectionId);
    if (conn && !conn.visible_schemas) {
      const { deriveDefaultVisibleSchemas } = await import("./lib/schema/schemaDefaults");
      const defaults = deriveDefaultVisibleSchemas(schema);
      setVisibleSchemas(connectionId, defaults);
    }
  } catch (error: any) {
    setSchema(connectionId, {
      tables: [],
      columns: {},
      functions: [],
      foreign_keys: [],
      indexes: [],
      hypertable_tables: [],
      driver: "postgres",
      connection_id: connectionId,
    });
    toast.error(
      `Schema load failed: ${error.message ?? "unknown error"} — click Refresh in sidebar to retry`
    );
  }
};
```

### Step 3.2 — Destructure `setVisibleSchemas` from WorkspaceStore

Find the destructuring block near the top of the `App` component that pulls `setSchema` from `useWorkspaceStore` (around line 96). Add `setVisibleSchemas` alongside it:

```typescript
const {
  // ... existing destructured values ...
  setSchema,
  setVisibleSchemas,   // ← add this
  // ...
} = useWorkspaceStore();
```

### Step 3.3 — Run type check

```
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

### Step 3.4 — Commit

```bash
git add src/App.tsx
git commit -m "feat(app): run smart schema default after every introspect"
```

---

## Task 4: SchemaFilterPopover Component

**Files:**
- Create: `src/components/schema/SchemaFilterPopover.tsx`
- Create: `src/components/schema/SchemaFilterPopover.test.tsx`

### Step 4.1 — Write failing tests

Create `src/components/schema/SchemaFilterPopover.test.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchemaFilterPopover } from "./SchemaFilterPopover";

describe("SchemaFilterPopover", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  const allSchemas = ["public", "auth", "storage", "analytics"];
  const onChange = vi.fn();

  const render = (visible = ["public"]) => {
    act(() => {
      root.render(
        <SchemaFilterPopover
          open={true}
          allSchemas={allSchemas}
          visibleSchemas={visible}
          onChange={onChange}
          onClose={vi.fn()}
        />
      );
    });
  };

  it("renders a checkbox for each schema", () => {
    render();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(4);
  });

  it("public is checked, others unchecked by default", () => {
    render(["public"]);
    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[];
    const publicBox = checkboxes.find((cb) => cb.dataset.schema === "public");
    const authBox = checkboxes.find((cb) => cb.dataset.schema === "auth");
    expect(publicBox?.checked).toBe(true);
    expect(authBox?.checked).toBe(false);
  });

  it("clicking a checkbox calls onChange with updated list", () => {
    render(["public"]);
    const authBox = container.querySelector(
      'input[data-schema="auth"]'
    ) as HTMLInputElement;
    act(() => { authBox.click(); });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["public", "auth"]));
  });

  it("Public only button resets to [public]", () => {
    render(["public", "auth", "storage"]);
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /public only/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => { btn.click(); });
    expect(onChange).toHaveBeenCalledWith(["public"]);
  });

  it("Show all button checks every schema", () => {
    render(["public"]);
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /show all/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => { btn.click(); });
    expect(onChange).toHaveBeenCalledWith(allSchemas);
  });
});
```

### Step 4.2 — Run tests to verify they fail

```
npx vitest run src/components/schema/SchemaFilterPopover.test.tsx
```
Expected: FAIL — module not found

### Step 4.3 — Implement `SchemaFilterPopover.tsx`

Create `src/components/schema/SchemaFilterPopover.tsx`:

```tsx
import React, { useRef, useEffect } from "react";

interface Props {
  open: boolean;
  allSchemas: string[];        // all schemas discovered in last introspect
  visibleSchemas: string[];    // currently visible schemas
  onChange: (schemas: string[]) => void;
  onClose: () => void;
}

export function SchemaFilterPopover({
  open,
  allSchemas,
  visibleSchemas,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (schema: string) => {
    const next = visibleSchemas.includes(schema)
      ? visibleSchemas.filter((s) => s !== schema)
      : [...visibleSchemas, schema];
    onChange(next);
  };

  return (
    <div
      ref={ref}
      className="absolute top-8 right-2 z-50 w-52 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl py-2"
    >
      <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 pb-1.5 border-b border-[#2a2a2a] mb-1">
        Schemas
      </p>

      <div className="max-h-48 overflow-y-auto">
        {allSchemas.map((schema) => {
          const checked = visibleSchemas.includes(schema);
          return (
            <label
              key={schema}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
            >
              <input
                type="checkbox"
                data-schema={schema}
                checked={checked}
                onChange={() => toggle(schema)}
                className="w-3 h-3 accent-[#00d2ff]"
              />
              <span className="text-xs text-white/70 flex-1 truncate font-mono">{schema}</span>
            </label>
          );
        })}
      </div>

      {allSchemas.length === 0 && (
        <p className="text-[10px] text-white/30 px-3 py-2 text-center">No schemas found</p>
      )}

      <div className="flex gap-2 px-3 pt-2 mt-1 border-t border-[#2a2a2a]">
        <button
          onClick={() => onChange(["public"])}
          className="flex-1 text-[10px] text-white/40 hover:text-white py-1 hover:bg-white/5 rounded transition-colors"
        >
          Public only
        </button>
        <button
          onClick={() => onChange(allSchemas)}
          className="flex-1 text-[10px] text-white/40 hover:text-white py-1 hover:bg-white/5 rounded transition-colors"
        >
          Show all
        </button>
      </div>
    </div>
  );
}
```

### Step 4.4 — Run tests to verify they pass

```
npx vitest run src/components/schema/SchemaFilterPopover.test.tsx
```
Expected: PASS (5 tests)

### Step 4.5 — Commit

```bash
git add src/components/schema/SchemaFilterPopover.tsx src/components/schema/SchemaFilterPopover.test.tsx
git commit -m "feat(ui): SchemaFilterPopover — per-schema visibility checklist"
```

---

## Task 5: Sidebar Schema Tree

**Files:**
- Modify: `src/components/schema/Sidebar.tsx`

This is the biggest change. Replace the flat `filtered.map(([tableName, columns]) => ...)` list with a grouped schema tree. Keep all existing table-row rendering logic intact inside the groups.

### Step 5.1 — Add new props to `SidebarProps`

In `src/components/schema/Sidebar.tsx`, find the `SidebarProps` interface (around line 10) and add after `onDisconnect?`:

```typescript
visibleSchemas?: string[];
onVisibleSchemasChange?: (schemas: string[]) => void;
```

### Step 5.2 — Add imports for new components and icons

At the top of `Sidebar.tsx`, add `SlidersHorizontal` to the lucide import line (alongside `Search`, `X`, etc.):

```typescript
import { Table, ChevronRight, ChevronDown, Columns, Key, Search, X, Database, Power, ExternalLink, Layers, Hash, FolderOpen, Clock, BarChart2, Eye, Braces, Cog, Sigma, SlidersHorizontal } from "lucide-react";
import { SchemaFilterPopover } from "./SchemaFilterPopover";
```

### Step 5.3 — Add schema-related state

In the component body, find where `const [expandedTables, setExpandedTables] = useState` lives and add after the existing state declarations:

```typescript
const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
const [filterOpen, setFilterOpen] = useState(false);
```

### Step 5.4 — Replace the flat table list with schema groups

Find the block starting at `const allTableEntries = Object.entries(schema);` (around line 150) through the end of the component's main return block. Replace the flat rendering logic with schema-grouped logic.

**Replace this section** (from `const allTableEntries = ...` down to just before the `TableContextMenu` render at the bottom):

```tsx
  const allTableEntries = Object.entries(schema);

  // ── Schema grouping ─────────────────────────────────────────────────────────
  // Determine if this driver uses schemas (Postgres/MSSQL yes; SQLite/Redis no)
  const hasSchemas =
    fullSchema != null &&
    fullSchema.tables.length > 0 &&
    fullSchema.tables.some((t) => t.schema && t.schema !== "");

  // Build schema → table names map from fullSchema (preserves schema assignment)
  const schemaGroups: Record<string, string[]> = {};
  if (hasSchemas && fullSchema) {
    for (const t of fullSchema.tables) {
      const s = t.schema || "public";
      if (!schemaGroups[s]) schemaGroups[s] = [];
      schemaGroups[s].push(t.name);
    }
  }

  // All schemas discovered in introspect (for filter popover)
  const allDiscoveredSchemas = Object.keys(schemaGroups).sort();

  // Schemas to actually render (filtered by visibleSchemas prop)
  const schemasToShow =
    hasSchemas && visibleSchemas && visibleSchemas.length > 0
      ? allDiscoveredSchemas.filter((s) => visibleSchemas.includes(s))
      : allDiscoveredSchemas;

  // Flat table entries for non-schema drivers (fallback)
  const allTableEntries = Object.entries(schema);

  const ctxTable = contextMenu ? schema[contextMenu.tableName] ?? [] : [];

  // Search filtering helper
  const tableMatchesSearch = (tableName: string) =>
    !searchText || tableName.toLowerCase().includes(searchText.toLowerCase());

  const totalVisible = hasSchemas
    ? schemasToShow.reduce(
        (n, s) => n + (schemaGroups[s]?.filter(tableMatchesSearch).length ?? 0),
        0
      )
    : allTableEntries.filter(([n]) => tableMatchesSearch(n)).length;

  // Toggle schema expand/collapse — public starts expanded, others collapsed
  const isSchemaExpanded = (s: string) =>
    expandedSchemas[s] !== undefined ? expandedSchemas[s] : s === "public";

  const toggleSchema = (s: string) =>
    setExpandedSchemas((prev) => ({ ...prev, [s]: !isSchemaExpanded(s) }));

  // ── Render helper: one table row (reused for both schema-tree and flat mode) ──
  const renderTableRow = (tableName: string, schemaName_: string = schemaName ?? "public") => {
    const isFocused =
      focusedNode != null &&
      (focusedNode === tableName || focusedNode.endsWith(`.${tableName}`));
    const tableMeta = fullSchema?.tables.find((t) => t.name === tableName && (!hasSchemas || t.schema === schemaName_));
    const richCols = fullSchema?.columns[tableName];
    const fkColumns = new Set(
      fullSchema?.foreign_keys
        .filter((fk) => fk.from_table === tableName)
        .map((fk) => fk.from_column) ?? []
    );
    const fkTargets = Object.fromEntries(
      (fullSchema?.foreign_keys ?? [])
        .filter((fk) => fk.from_table === tableName)
        .map((fk) => [fk.from_column, `${fk.to_table}.${fk.to_column}`])
    );
    const tableIndexes = fullSchema?.indexes.filter((ix) => ix.table_name === tableName) ?? [];
    const columns = schema[tableName] ?? [];

    return (
      <div key={`${schemaName_}.${tableName}`} className="group" ref={isFocused ? focusedRef : null}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
            isFocused
              ? "bg-[#00d2ff]/10 border border-[#00d2ff]/20"
              : "hover:bg-white/5"
          }`}
          onClick={() => toggleTable(tableName)}
          onContextMenu={(e) => handleContextMenu(e, tableName)}
        >
          {expandedTables[tableName] ? (
            <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
          )}
          {(() => {
            const fullKey = `${schemaName_}.${tableName}`;
            const isHypertable = hypertableSet.has(fullKey);
            const objType = tableMeta?.object_type;
            const iconCls = `w-3.5 h-3.5 shrink-0 ${isFocused ? "text-[#00d2ff]" : "text-[#00d2ff]/60"}`;
            if (isHypertable) return <span title="TimescaleDB hypertable"><Clock className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-amber-400" : "text-amber-400/70"}`} /></span>;
            if (objType === "view") return <span title="View"><Eye className={iconCls} /></span>;
            if (objType === "materialized_view") return <span title="Materialized view"><Layers className={iconCls} /></span>;
            if (activeDriver === "mongodb") return <span title="Collection"><FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-emerald-400" : "text-emerald-400/70"}`} /></span>;
            if (activeDriver === "redis") return <span title="Key namespace"><Hash className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-red-400" : "text-red-400/60"}`} /></span>;
            if (activeDriver === "clickhouse") return <span title="ClickHouse table"><BarChart2 className={`w-3.5 h-3.5 shrink-0 ${isFocused ? "text-yellow-400" : "text-yellow-400/60"}`} /></span>;
            return <Table className={iconCls} />;
          })()}
          <span
            className={`text-xs font-medium truncate flex-1 ${
              isFocused ? "text-[#00d2ff]" : "text-white/80 group-hover:text-white"
            }`}
            onDoubleClick={() => onTableClick(tableName)}
          >
            {tableName}
          </span>
          {tableMeta && (tableMeta.row_count !== 0 || tableMeta.size_bytes !== 0) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {tableMeta.row_count !== 0 && (
                <span className="text-[9px] text-white/25 font-mono">
                  {tableMeta.row_count < 0
                    ? `~${Math.abs(tableMeta.row_count / 1000).toFixed(0)}K`
                    : tableMeta.row_count.toLocaleString()}
                </span>
              )}
              {tableMeta.size_bytes > 0 && (
                <span className="text-[9px] text-white/20 font-mono">
                  {tableMeta.size_bytes >= 1_048_576
                    ? `${(tableMeta.size_bytes / 1_048_576).toFixed(1)}MB`
                    : `${Math.round(tableMeta.size_bytes / 1024)}KB`}
                </span>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {expandedTables[tableName] && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pl-6 pb-1 space-y-0">
                {(richCols ?? columns).map((col) => {
                  const colName = "name" in col ? col.name : col.name;
                  const colType = "display_type" in col ? col.display_type?.label ?? col.type_name : col.type;
                  const isPK = "is_primary_key" in col ? col.is_primary_key : false;
                  const isFK = fkColumns.has(colName);
                  const fkTarget = fkTargets[colName];
                  return (
                    <div
                      key={colName}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-white/[0.03] group/col cursor-default"
                      title={fkTarget ? `→ ${fkTarget}` : undefined}
                    >
                      {isPK ? (
                        <Key className="w-2.5 h-2.5 text-amber-400/70 shrink-0" />
                      ) : isFK ? (
                        <ExternalLink className="w-2.5 h-2.5 text-sky-400/60 shrink-0" />
                      ) : (
                        <Columns className="w-2.5 h-2.5 text-white/20 shrink-0" />
                      )}
                      <span className={`text-[11px] truncate flex-1 ${isPK ? "text-amber-300/80" : isFK ? "text-sky-300/70" : "text-white/50"}`}>
                        {colName}
                      </span>
                      <span className="text-[9px] text-white/20 font-mono shrink-0">{colType}</span>
                    </div>
                  );
                })}
                {tableIndexes.length > 0 && (
                  <div className="pt-0.5 pb-0.5">
                    {tableIndexes.map((ix) => (
                      <div key={ix.index_name} className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-white/25">
                        <Sigma className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate flex-1">{ix.index_name}</span>
                        {ix.is_unique && <span className="text-[9px] text-emerald-400/50">UNIQUE</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };
```

Then replace the existing search bar + table list rendering block. Find the search bar section starting with `{/* Search bar */}` and replace the search count display and table list below it.

**In the search bar section**, replace:
```tsx
        {searchText && (
          <p className="text-[9px] text-white/25 px-2 pt-0.5">
            {filtered.length} of {allTableEntries.length} matching
          </p>
        )}
      </div>
```

With:
```tsx
        {searchText && (
          <p className="text-[9px] text-white/25 px-2 pt-0.5">
            {totalVisible} matching
          </p>
        )}
      </div>
```

**Replace the search button text** (the `{allTableEntries.length} table...` span) with:
```tsx
            <span>
              {totalVisible} table{totalVisible !== 1 ? "s" : ""}
            </span>
```

**Also add the filter button** next to the search button. Find the `{searchVisible ? (` block and in the outer `<div className="px-2 pt-1 pb-0.5">`, wrap both the search area and the filter button:

Replace the outer search container div:
```tsx
      {/* Search bar + filter button */}
      <div
        className="px-2 pt-1 pb-0.5 relative"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-1">
          <div className="flex-1">
            {searchVisible ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1a1a1a] border border-[#00d2ff]/30">
                <Search className="w-3 h-3 text-white/30 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Filter tables…"
                  className="flex-1 bg-transparent text-xs text-white/70 focus:outline-none placeholder:text-white/20"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchText(""); setSearchVisible(false); }
                  }}
                />
                <button
                  onClick={() => { setSearchText(""); setSearchVisible(false); }}
                  className="text-white/20 hover:text-white/60"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setSearchVisible(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-white/20 hover:text-white/40 hover:bg-white/[0.03] transition-colors text-[10px]"
                title="Filter tables (Ctrl+F)"
              >
                <Search className="w-3 h-3" />
                <span>
                  {totalVisible} table{totalVisible !== 1 ? "s" : ""}
                </span>
              </button>
            )}
          </div>
          {hasSchemas && onVisibleSchemasChange && (
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`p-1 rounded transition-colors shrink-0 ${filterOpen ? "text-[#00d2ff] bg-[#00d2ff]/10" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`}
              title="Filter schemas"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {searchText && (
          <p className="text-[9px] text-white/25 px-2 pt-0.5">
            {totalVisible} matching
          </p>
        )}
        {hasSchemas && onVisibleSchemasChange && (
          <SchemaFilterPopover
            open={filterOpen}
            allSchemas={allDiscoveredSchemas}
            visibleSchemas={visibleSchemas ?? allDiscoveredSchemas}
            onChange={(schemas) => {
              onVisibleSchemasChange(schemas);
              setFilterOpen(false);
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </div>
```

**Replace the table list render block** (`<div className="space-y-0.5 py-1">` through the functions section):

```tsx
      {/* Schema tree (Postgres/MSSQL) or flat list (SQLite/Redis/etc.) */}
      {hasSchemas ? (
        <div className="py-1">
          {schemasToShow.length === 0 ? (
            <div className="px-4 py-4 text-center">
              <p className="text-[11px] text-white/30">No schemas visible</p>
              <p className="text-[10px] text-white/20 mt-1">
                Use the filter ↗ to show schemas
              </p>
            </div>
          ) : (
            schemasToShow.map((s) => {
              const tables = (schemaGroups[s] ?? []).filter(tableMatchesSearch);
              const expanded = isSchemaExpanded(s);
              return (
                <div key={s}>
                  {/* Schema header */}
                  <button
                    onClick={() => toggleSchema(s)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 transition-colors group/schema"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
                    )}
                    <span className="text-[10px] font-semibold text-white/40 group-hover/schema:text-white/60 uppercase tracking-wider flex-1 text-left truncate">
                      {s}
                    </span>
                    <span className="text-[9px] text-white/20 shrink-0">
                      {tables.length}
                    </span>
                  </button>
                  {/* Tables within schema */}
                  {expanded && (
                    <div className="pl-2 space-y-0.5">
                      {tables.map((tableName) => renderTableRow(tableName, s))}
                      {tables.length === 0 && searchText && (
                        <p className="text-[10px] text-white/20 px-3 py-1">No matches</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Flat list for drivers without schema concept */
        <div className="space-y-0.5 py-1">
          {allTableEntries
            .filter(([name]) => tableMatchesSearch(name))
            .map(([tableName]) => renderTableRow(tableName))}
        </div>
      )}
```

### Step 5.5 — Remove the old `filtered.map(...)` block

After inserting the new blocks above, delete the old `const filtered = ...` variable and the old `<div className="space-y-0.5 py-1">` block (they are now replaced). The old `ctxTable` declaration should remain since `TableContextMenu` still uses it.

### Step 5.6 — Run type check

```
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors (fix any that appear — likely a missing prop or import)

### Step 5.7 — Commit

```bash
git add src/components/schema/Sidebar.tsx
git commit -m "feat(ui): Sidebar schema tree — collapsible schema groups, filter button"
```

---

## Task 6: Wire visibleSchemas into Sidebar from App.tsx

**Files:**
- Modify: `src/App.tsx`

The Sidebar is rendered in App.tsx. We need to pass `visibleSchemas` and `onVisibleSchemasChange` to it.

### Step 6.1 — Destructure `visibleSchemas` + `setVisibleSchemas` from WorkspaceStore

Find the WorkspaceStore destructuring in `App.tsx` (the large `const { ... } = useWorkspaceStore()` block). Add:

```typescript
const visibleSchemas = useWorkspaceStore((s) => s.visibleSchemas);
```

(Add this as a separate `useWorkspaceStore` selector near the top of the component, alongside other per-connection selectors.)

### Step 6.2 — Pass props to Sidebar

Find the `<Sidebar` component render in App.tsx (search for `<Sidebar`). Add the two new props:

```tsx
<Sidebar
  {/* ...existing props... */}
  visibleSchemas={activeConnectionId ? (visibleSchemas[activeConnectionId] ?? []) : []}
  onVisibleSchemasChange={(schemas) => {
    if (activeConnectionId) setVisibleSchemas(activeConnectionId, schemas);
  }}
/>
```

### Step 6.3 — Run type check

```
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

### Step 6.4 — Commit

```bash
git add src/App.tsx
git commit -m "feat(app): wire visibleSchemas into Sidebar"
```

---

## Task 7: Final Integration Check

### Step 7.1 — Run full test suite

```
npx vitest run
```
Expected: all tests pass

### Step 7.2 — Run type check

```
npx tsc --noEmit
```
Expected: no errors

### Step 7.3 — Manual smoke test checklist

Start the app with `npm run tauri:dev` and verify:
- [ ] Sidebar shows only `public` tables for a Supabase connection (auth/storage/etc. hidden)
- [ ] Filter icon (⊞) appears in sidebar header — clicking it opens the schema popover
- [ ] Checking `auth` in popover adds those tables to the sidebar immediately
- [ ] "Public only" button resets to just public tables
- [ ] "Show all" shows every schema
- [ ] Schema sections are collapsible (▶/▼ arrows)
- [ ] `public` starts expanded, newly-enabled schemas start collapsed
- [ ] Search filters table names within visible schemas
- [ ] Non-Postgres connections (SQLite) still show flat list (no schema headers)

---

## Self-Review

**Spec coverage:**
- ✅ Smart default: `deriveDefaultVisibleSchemas` in Task 1
- ✅ `ConnectionConfig.visible_schemas` in Task 2
- ✅ WorkspaceStore `visibleSchemas` in Task 2
- ✅ Smart default triggered after introspect in Task 3
- ✅ SchemaFilterPopover with checkboxes + Public only + Show all in Task 4
- ✅ Sidebar schema tree in Task 5
- ✅ Props wired from App.tsx in Task 6
- ✅ Fallback flat list for non-schema drivers in Task 5
- ✅ Empty-state when all schemas hidden in Task 5
- ✅ Persistence to ConnectionConfig in Task 2 (setVisibleSchemas writes back to conn)

**Type consistency:**
- `deriveDefaultVisibleSchemas(fullSchema: FullSchema): string[]` — used consistently in Tasks 1 and 3
- `visibleSchemas: Record<string, string[]>` and `setVisibleSchemas(connectionId, schemas)` — consistent across Tasks 2, 3, 6
- `SchemaFilterPopover` props: `allSchemas`, `visibleSchemas`, `onChange`, `onClose` — consistent Tasks 4 and 5
- Sidebar new props: `visibleSchemas?: string[]`, `onVisibleSchemasChange?: (schemas: string[]) => void` — consistent Tasks 5 and 6
