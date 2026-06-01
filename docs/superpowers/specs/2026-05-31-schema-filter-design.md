# Schema Filter & Sidebar Tree Design

**Date:** 2026-05-31
**Status:** Approved

---

## Goal

Replace the flat table list in the sidebar with a collapsible schema tree. By default only show schemas the user created (primarily `public`), hiding Supabase/Postgres internal schemas (`auth`, `storage`, `realtime`, etc.). Users can toggle schema visibility per-connection from a sidebar filter popover or the Connection Dialog.

---

## Architecture

All filtering happens in the **frontend**. The Rust introspection layer already returns a `schema` field on every `TableMeta` — no Rust changes needed. The frontend groups, filters, and persists schema visibility preferences.

### Components

| Component | File | Change |
|-----------|------|--------|
| `ConnectionConfig` | `src/lib/db/DbClient.ts` | Add `visible_schemas?: string[]` |
| `WorkspaceStore` | `src/lib/stores/WorkspaceStore.ts` | Add `visibleSchemas: Record<connId, string[]>` + `setVisibleSchemas` |
| Schema defaults module | `src/lib/schema/schemaDefaults.ts` | Create — blocklist + `deriveDefaultVisibleSchemas()` |
| `Sidebar` | `src/components/schema/Sidebar.tsx` | Restructure flat list → grouped schema tree + filter button |
| `SchemaFilterPopover` | `src/components/schema/SchemaFilterPopover.tsx` | Create — checklist popover for toggling schemas |
| `ConnectionDialog` | `src/components/dialogs/ConnectionDialog.tsx` | Add "Visible Schemas" checkboxes section |
| App introspect flow | `src/App.tsx` | After `setSchema()`, run smart default if `visible_schemas` unset |

---

## Data Flow

```
Rust introspect → FullSchema (all tables with .schema field on each TableMeta)
  → deriveDefaultVisibleSchemas(fullSchema) → string[]
  → saved to ConnectionConfig.visible_schemas (persisted)
  → WorkspaceStore.visibleSchemas[connId]
    → Sidebar reads visibleSchemas
      → groups tables by schema
      → renders collapsible schema sections (only visible schemas)
    → SchemaFilterPopover toggles schema
      → updates WorkspaceStore.visibleSchemas
      → saves to ConnectionConfig
```

---

## Smart Default Logic

`deriveDefaultVisibleSchemas(fullSchema: FullSchema): string[]`

1. Collect all unique schema names from `fullSchema.tables`
2. Always include `public`
3. Exclude any schema on the **system blocklist**
4. Include any schema NOT on the blocklist (user-created schemas)
5. If result is empty (no `public`, all schemas blocked) → return all schemas as fallback

### System Blocklist

Schemas hidden by default (known Supabase / Postgres platform internals):

```
auth, storage, realtime, extensions, graphql, graphql_public,
vault, pgsodium, pgsodium_masks, pgbouncer, supabase_functions,
supabase_migrations, _analytics, _realtime, pg_catalog,
information_schema, pg_toast, pg_internal
```

Any schema **not** on this list (other than `public`) is treated as user-created and shown by default.

---

## UI

### Sidebar Schema Tree

```
🔍 [search box]                     [⊞ filter]
────────────────────────────────────────────────
▼ public  ·  3 tables
    ⊞ sachin_test_data_table    -10K  1.6MB
    ⊞ torque_feature_imports    -16K
    ⊞ messages                  -0
▶ auth  ·  18 tables            (hidden — not rendered unless enabled)
▶ storage  ·  8 tables          (hidden — not rendered unless enabled)
```

- Visible schemas render as collapsible sections; `public` expanded by default
- Hidden schemas are not rendered (not just collapsed — fully absent)
- Schema section header: schema name + table count
- Table rows within each schema: identical to current flat list (row count, size, context menu)
- Search filters table names across all **visible** schemas only
- Non-Postgres drivers (MySQL, SQLite) that have no schema concept: degrade to existing flat list

### SchemaFilterPopover

Opens from the filter icon (⊞) in the sidebar header.

```
┌─ Schemas ────────────────────────┐
│ ☑ public          (3 tables)    │
│ ☐ auth            (18 tables)   │
│ ☐ storage         (8 tables)    │
│ ☐ extensions      (2 tables)    │
│                                  │
│ [Public only]    [Show all]      │
└──────────────────────────────────┘
```

- Lists **all** schemas discovered in the last introspect
- Checked = visible in sidebar; unchecked = hidden
- Toggling any checkbox: updates `WorkspaceStore.visibleSchemas` immediately + saves to `ConnectionConfig`
- **"Public only"**: resets to `["public"]`
- **"Show all"**: checks all schemas

### Connection Dialog

New "Visible Schemas" section — shown after a successful connection test when schemas are known:

```
Visible Schemas
☑ public   ☐ auth   ☐ storage   ☐ extensions
[Detect defaults]
```

- "Detect defaults" button re-runs `deriveDefaultVisibleSchemas()` and resets checkboxes
- Saved into `ConnectionConfig.visible_schemas` when the connection is saved

---

## Persistence

- `ConnectionConfig.visible_schemas: string[] | undefined`
  - `undefined` = not yet configured → smart default runs on next introspect
  - `string[]` = explicit list (may be empty if user hides everything)
- Saved via existing `DbClient.saveConnections()` (localStorage / keychain)
- `WorkspaceStore.visibleSchemas[connId]` is the live in-memory state; initialized from `ConnectionConfig.visible_schemas` on connect

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No `public` schema (MySQL, custom Postgres) | Smart default shows all non-blocklisted schemas |
| All schemas on blocklist | Fall back to showing all schemas (never empty sidebar) |
| User hides all schemas via filter | Sidebar shows "No schemas visible — use the filter ↗ to show schemas" |
| New schema added after introspect | Appears in filter popover after re-introspect; smart default classifies it |
| Old saved connection missing `visible_schemas` | Treated as undefined → smart default runs on next connect |
| Non-Postgres drivers with no schema concept | Flat list rendering preserved; schema tree not used |

---

## Testing

### Unit
- `deriveDefaultVisibleSchemas()`:
  - Supabase-like schema list → only `public` returned
  - Custom schema (`analytics`) → included alongside `public`
  - All-blocked schemas → fallback returns all
- `WorkspaceStore.setVisibleSchemas()` → persists to ConnectionConfig

### Component
- `Sidebar`: schema groups render; collapse/expand; search filters within visible schemas; hidden schemas absent from DOM
- `SchemaFilterPopover`: toggling checkbox updates visible tables; "Public only" resets; "Show all" shows all

---

## Out of Scope

- Rust-side schema filtering (not needed — frontend filtering is sufficient)
- Schema-level permissions or access control
- Creating/dropping schemas from the UI
- Per-schema color coding or icons
