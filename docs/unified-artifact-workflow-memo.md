# Unified Artifact Workflow Memo

## Purpose

This memo proposes how to turn the current query, chart, dashboard, and report pieces into one persisted artifact workflow suitable for a Cursor-for-data product. The goal is to make every meaningful output addressable, reopenable, lineage-aware, and agent-operable instead of leaving key work in tab state, transient UI requests, or export-only flows.

## Current State

- Query work is tab-centric and primarily session state in `WorkspaceStore`; tabs can be SQL editors or dashboards, but not a general persisted artifact model yet (`src/lib/stores/WorkspaceStore.ts:19`, `src/lib/stores/WorkspaceStore.ts:379`).
- Dashboard state exists only as in-memory tab data with datasource snapshots and widgets. Snapshots currently embed sampled result rows, not reusable references to upstream artifacts (`src/lib/stores/WorkspaceStore.ts:76`, `src/lib/stores/WorkspaceStore.ts:132`, `src/lib/dashboard/dashboardState.ts:15`, `src/lib/dashboard/dashboardState.ts:36`).
- Dashboard rendering is explicitly snapshot-based. The UI even describes widgets as bound to a datasource snapshot, and seeded dashboards are built from sampled rows (`src/components/dashboard/DashboardWorkspace.tsx:270`, `src/components/dashboard/DashboardWorkspace.tsx:779`).
- Reports are export-oriented, not persisted artifacts. `ReportPanel` builds a `ReportSpec` on demand, captures chart DOM images, and exports PDF/PPTX; there is no reopen/edit/report artifact lifecycle (`src/components/reports/ReportPanel.tsx:72`, `src/components/reports/ReportPanel.tsx:110`, `src/lib/reports/ReportBuilder.ts:117`, `src/lib/reports/ReportBuilder.ts:187`).
- AI report sessions are assembled only from `stat__*` tool outputs captured in chat-local `sessionSections`, which means most query/chart/dashboard work is invisible to reporting today (`src/components/ai/AIChat.tsx:139`, `src/components/ai/AIChat.tsx:333`, `src/components/ai/AIChat.tsx:580`).
- Agent chart flows split into two separate UI targets: `create_chart` opens Graph Builder from loaded query results, while `create_gog_chart` opens the large-scale chart panel; neither creates a persisted artifact (`src/lib/agent/registerHandlers.ts:495`, `src/lib/agent/registerHandlers.ts:540`).
- Pipeline support is still a stub with no backing model or runtime prerequisite tracking (`src/lib/agent/commands.ts:220`, `src/lib/agent/registerHandlers.ts:711`).
- There is no app router today. Navigation is mostly `activePanel` plus tab switching, which is not enough for durable deep links like “open dashboard X” or “open chart revision Y” (`src/App.tsx:68`, `src/components/editor/TabBar.tsx:20`).
- Tauri persistence exists for connections and a local intelligence store, but not for user-facing artifacts. Current hardening docs also explicitly keep query/chat/snippets session-only unless a secure native store is designed (`src-tauri/src/commands/persistence.rs:10`, `src-tauri/src/commands/persistence.rs:289`, `docs/implementation-phases.md:44`).

## 1. Target Artifact Model

### Core principle

Everything user-visible becomes an artifact with an id, type, revision history, dependencies, and execution state. Tabs stop being the thing itself and become views over artifacts.

### Top-level artifact types

- `query`
  - Canonical SQL artifact.
  - Owns SQL text, parameters, connection binding policy, execution settings, and optional semantic metadata.
- `dataset`
  - Logical result shape produced by a query or pipeline node.
  - Usually references a producing query artifact plus a materialization policy instead of storing arbitrary result rows inline.
- `chart`
  - Visualization spec artifact.
  - Can target a dataset artifact or a query artifact with an embedded projection/filter spec.
  - Covers both Graph Builder charts and GoG/table-scale charts with one spec envelope plus runtime strategy metadata.
- `dashboard`
  - Layout artifact composed of widget references to chart, metric, table, and text artifacts.
  - Widgets should reference other artifacts, not embedded sampled snapshots as the primary source of truth.
- `report`
  - Ordered narrative artifact composed of sections that reference charts, datasets, dashboards, text blocks, and generated summaries.
  - Export becomes a build target of the report artifact, not the artifact itself.
- `pipeline`
  - Scheduled or manual transformation artifact that produces datasets/materializations and can feed charts, dashboards, and reports.

### Shared artifact envelope

Each artifact should carry:

- `id`, `type`, `title`, `workspace_id`
- `created_at`, `updated_at`, `created_by`, `last_run_at`
- `connection_scope`
  - single connection initially; multi-connection later
- `status`
  - `draft | ready | stale | running | failed`
- `revision`
  - immutable revision records for save history and agent edits
- `body`
  - type-specific document
- `inputs`
  - upstream artifact ids and external table refs
- `outputs`
  - produced dataset/materialization ids
- `lineage`
  - normalized edge list for query/table/artifact dependencies

### Type-specific bodies

`query.body`

- SQL text
- parameter schema/defaults
- execution mode
  - ad hoc, notebook-like, dashboard datasource, report datasource, pipeline step
- result contract
  - expected columns, optional row-limit policy, optional assertions

`chart.body`

- visualization spec
  - unify Graph Builder and GoG under one schema
- source reference
  - `artifact_ref` to `query` or `dataset`
- interaction policy
  - brush/filter/cross-filter capabilities
- rendering strategy
  - `raw | sampled | binned | aggregated`

`dashboard.body`

- layout tree
- widget refs
- dashboard-level filters/variables
- refresh policy
- optional parameter bindings to upstream queries

`report.body`

- ordered section list
- section refs to artifacts or inline rich text
- report variables
- build/export presets
- last generated outputs

`pipeline.body`

- DAG nodes
- source/transform/load definitions
- schedule/manual trigger policy
- runtime environment requirements
- output contracts

### Materialization model

The system needs a deliberate split between artifact definition and runtime materialization:

- Definition artifact: the saved object users edit.
- Run/materialization record: one execution of a query, chart aggregation, report build, or pipeline run.

This keeps persisted user intent small while still supporting previews, caching, history, and reproducibility.

### Lineage model

Lineage should exist at three levels:

- Artifact-to-artifact
  - dashboard widget uses chart, report section uses dashboard, pipeline node produces dataset
- Artifact-to-table
  - query reads `schema.table`; pipeline writes `schema.table`
- Run-to-run
  - report build used query run `Q123` and chart render `C456`

The current query execution path already emits `source_tables` and records query events in the intelligence store, so that should seed the first lineage implementation rather than starting from zero (`src/lib/stores/WorkspaceStore.ts:53`, `src-tauri/src/commands/query.rs:39`, `src-tauri/src/commands/query.rs:95`).

## Tabs And Routing

Tabs should become ephemeral presentations of persisted artifacts:

- `tab.id` stays local UI state.
- `tab.route` becomes `artifact/<type>/<id>` plus optional revision/run context.
- Opening a tab means opening an artifact view.
- “New Query” creates an unsaved query artifact draft immediately, not a free-floating editor buffer.

Routing should support:

- `artifact/query/:id`
- `artifact/chart/:id`
- `artifact/dashboard/:id`
- `artifact/report/:id`
- `artifact/pipeline/:id`

Initial implementation does not need full URL routing, but it does need an internal route object in store state so commands like “open dashboard X in new tab” are stable and serializable.

## Dashboards

Dashboards should stop owning copied result snapshots as their primary model.

Target behavior:

- A dashboard references query/dataset artifacts as datasources.
- Widgets reference charts or local view specs over those datasources.
- Snapshotting is optional and explicit:
  - preview cache
  - pinned report snapshot
  - offline export snapshot

This avoids today’s drift where a dashboard can silently diverge from the query that originally produced the sampled rows.

## Reports

Reports should become first-class editable artifacts, not just export sheets opened from chat.

Target behavior:

- A report can include:
  - chart refs
  - dashboard refs
  - dataset table refs
  - AI-generated narrative blocks
  - manually authored text blocks
- A report build produces export runs:
  - PDF
  - PPTX
  - later HTML/share link
- Reports can pin either:
  - live artifact refs
  - frozen snapshot revisions for auditability

This also fixes the current limitation where report content only sees `stat__*` tool activity from chat.

## Pipeline Prerequisites

Pipelines should not ship as a UI-only concept. They need minimum runtime primitives first:

- persisted pipeline artifact + DAG schema
- execution run records
- credential and connection resolution
- materialized outputs
- failure state + logs
- scheduler/trigger abstraction

Without that, dashboards and reports cannot reliably depend on pipeline-produced datasets. The artifact model should therefore allow dashboards/reports to depend on `query` artifacts immediately, and only later depend on `pipeline` outputs once runtime support exists.

## 2. Phases

### Phase A: Foundation

- Add native artifact persistence in Tauri.
- Introduce artifact registry, artifact revisions, and artifact route state.
- Convert tabs to point at artifact routes.
- Add `query` artifact as the first saved type.

### Phase B: Query-Centric Workflow

- Save/open/duplicate/rename query artifacts.
- Persist editor SQL, parameters, and result contract.
- Store query run history as run records linked to the query artifact.
- Reuse current `source_tables` analysis to create initial lineage edges.

### Phase C: Charts As Artifacts

- Unify `create_chart` and `create_gog_chart` under one chart artifact schema.
- Persist chart definitions separately from chart runs.
- Allow charts to reference query artifacts directly.
- Keep raw vs binned strategy as runtime metadata, not separate product concepts.

### Phase D: Dashboards As Compositions

- Migrate dashboard tabs into dashboard artifacts.
- Replace embedded datasource snapshots with datasource refs plus optional cache snapshots.
- Add widget refs and dashboard-level variables/filters.
- Support “open source query” and “show lineage” from widgets.

### Phase E: Reports As Compositions

- Persist report artifacts and section refs.
- Add build/export runs with frozen snapshot option.
- Let agent author or revise report sections against saved artifacts.
- Move report entry point out of chat-only session state.

### Phase F: Pipelines And Scheduled Refresh

- Add pipeline artifact + execution runtime.
- Support materialized datasets as stable downstream inputs.
- Add freshness state so charts/dashboards/reports can show stale upstream dependencies.

### Phase G: Workspace Polish

- Search/open palette across artifacts.
- Internal routing + deep links.
- Artifact permissions/share semantics later if multi-user becomes relevant.

## 3. Risks

### Product risks

- If query artifacts are not the first-class center, dashboards and reports will continue to fork logic and drift.
- If reports remain chat-session-derived, users will not trust them as durable deliverables.
- If pipeline support is surfaced before runtime/state exists, downstream artifacts will be unreliable.

### Technical risks

- Large embedded snapshots will bloat state and persistence if copied naively from current dashboard design.
- Mixing live refs and frozen snapshots without explicit semantics will create confusing freshness bugs.
- A router retrofit can become invasive if attempted alongside full UI redesign.
- Multi-connection artifacts add real complexity; first version should stay single-connection unless a type truly requires more.

### Migration risks

- Existing dashboard tabs have sampled data but no durable upstream query artifact ids, so some migration will be lossy.
- Existing reports are not persisted at all; they may need “import current chat session as report draft” rather than automatic migration.
- Some current users may rely on transient behavior. Forcing immediate persistence everywhere could feel heavy unless drafts autosave quietly.

## 4. First Implementation Slice

The first slice should be: persisted query artifacts plus tab-to-artifact routing, with enough lineage to make downstream work possible.

### Scope

- Add a native artifact store in Tauri.
- Define `ArtifactEnvelope`, `QueryArtifactBody`, `ArtifactRevision`, and `ArtifactRoute`.
- Create a query artifact automatically when a new SQL tab is opened.
- Convert `TabState` to include route metadata to an artifact instead of only ad hoc title/sql state.
- Save/load/reopen query artifacts from a command palette or tab restore path.
- Link query runs to the artifact id and record `source_tables` lineage edges.

### Why this slice first

- It matches the current center of gravity of the app.
- It does not depend on pipeline runtime.
- It gives dashboards and reports a stable upstream object to reference next.
- It removes the biggest architectural dead-end: tabs as the de facto persistence model.

### Concrete deliverables

- Rust:
  - artifact persistence commands
  - artifact storage schema
  - query run record linked to artifact id
- Frontend:
  - query artifact DTOs/client
  - tab route state
  - save/open query flows
  - migration shim from old `sql_editor` tabs to query artifact drafts
- Migration:
  - existing open tabs become unsaved query drafts on first boot after upgrade
  - existing dashboard tabs stay legacy/in-memory for one release behind a compatibility adapter

### Explicit non-goals for slice one

- full dashboard migration
- report artifact editor
- pipeline runtime
- multi-user sharing
- external URL router

## Migration Strategy

Use a compatibility-first migration, not a flag day.

### Step 1

Introduce the artifact store and keep existing `WorkspaceStore` tab shape working through adapters.

### Step 2

Make new query tabs artifact-backed immediately. Old tabs hydrate into draft query artifacts in memory and can be saved explicitly.

### Step 3

Wrap current dashboard state in a legacy adapter:

- legacy dashboard tab opens as before
- “Save as dashboard artifact” creates the new model
- datasource snapshots remain supported temporarily

### Step 4

Replace chat-only report export with:

- “Create report draft from current session”
- sections referencing saved query/chart/dashboard artifacts where possible

### Step 5

After one stable cycle, deprecate legacy snapshot-owned dashboards and session-only report composition.

## Recommendation

Center the product on `query` as the first durable artifact, then make `chart`, `dashboard`, and `report` compositional layers over saved upstream artifacts. Do not start with dashboards or reports first; both depend on a stable upstream persistence and lineage model that the app does not currently have.
