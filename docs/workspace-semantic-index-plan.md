# Workspace Semantic Index Plan

Status: Phase 3 complete
Owner: Codex
Date: 2026-05-17

## Goal

Close the "no semantic indexing layer for the whole data workspace" gap by building one shared retrieval system for:

- schemas, tables, columns, indexes
- saved query, chart, and report artifacts
- pipelines and pipeline runs
- background analysis agents and their recent runs
- query history
- episodic memory / prior investigations

The product outcome is not "better schema search." It is a workspace-wide retrieval layer that both the user interface and the AI runtime can query consistently.

## Product Requirements

1. One shared retrieval surface across the workspace.
2. Works locally without cloud dependencies.
3. Safe for desktop/offline usage.
4. Reusable by both UI and agent runtime.
5. Supports direct action from results:
   - open a table
   - open an artifact
   - switch to pipelines / agents / memory
   - restore prior SQL context
6. Honest trust posture:
   - lexical-semantic ranking is acceptable for MVP
   - do not pretend we have embedding-backed semantic recall until we actually do

## Architecture

### Shared index module

Add a shared module under `src/lib/search/` that:

- normalizes workspace entities into search documents
- scores documents against a query
- returns ranked matches with metadata the UI and agent can act on

### Indexed entity types

- `schema_table`
- `schema_view`
- `schema_column`
- `schema_index`
- `artifact_query`
- `artifact_chart`
- `artifact_report`
- `pipeline`
- `background_agent`
- `query_history`
- `memory_episode`

### Document shape

Each indexed document should carry:

- stable `id`
- `kind`
- `title`
- `subtitle`
- `body`
- `keywords`
- `connectionId`
- `updatedAt`
- `action` metadata

### Ranking model

Phase 1 uses deterministic local ranking:

- exact token match boost
- title match boost
- keyword match boost
- recency boost
- kind-specific boosts for direct workspace objects

This is intentionally a lexical-semantic hybrid, not embeddings. That keeps the system local, fast, explainable, and testable.

## Delivery Phases

### Phase 1: Shared search foundation

Action items:

1. Add `docs/workspace-semantic-index-plan.md`.
2. Create a shared workspace search index module in `src/lib/search/`.
3. Index schemas, artifacts, pipelines, background agents, history, and memory.
4. Replace the right-side schema-only search panel with a unified workspace search panel.
5. Add an agent retrieval tool and command handler using the same index.
6. Add ranking tests.

Exit criteria:

- Search panel returns mixed workspace entities, not just schema results.
- AI can call the same search layer.
- `npm run lint` passes.

### Phase 2: Persistence and warm-start

Action items:

1. Persist index snapshots via native app storage.
2. Track rebuild timestamps and partial invalidation triggers.
3. Rebuild incrementally when artifacts, pipelines, or agents change.
4. Add restore-safe fallbacks if persistence is unavailable.

Exit criteria:

- Search opens quickly after restart without full cold rebuild.
- Index rebuilds are scoped, not always full scans.

### Phase 3: Retrieval quality

Action items:

1. Add structured filters by kind, connection, and recency.
2. Add query-intent boosts:
   - "sales trend" prefers saved reports/charts over raw schema nodes
   - "customer table" prefers schema/query results
3. Add richer snippets/highlight rendering.
4. Expand memory indexing to include outcomes and tool traces.

Exit criteria:

- Search quality is meaningfully better than plain substring matching.

### Phase 4: Deeper Cursor-for-data retrieval

Action items:

1. Index background-agent outputs and approvals as first-class retrievable evidence.
2. Index pipeline lineage and downstream artifacts.
3. Add "used by" and "related to" retrieval joins across:
   - artifacts
   - pipelines
   - agents
   - memory episodes
4. Add optional embedding-backed retrieval only if we can do it locally or with explicit provider configuration.

Exit criteria:

- The workspace behaves like a searchable investigation graph, not just a file picker.

## Guardrails

- Do not create a separate UI-only search index and a second agent-only search path.
- Do not hardcode a cloud vector dependency into the MVP.
- Do not treat substring table search as "semantic search."
- Keep ranking explainable and testable.

## Validation

Minimum validation for Phase 1:

- unit tests for ranking and mixed-entity retrieval
- manual smoke test:
  - search a table
  - search a saved artifact
  - search a pipeline
  - search a background agent
  - search a prior memory episode
  - search from the AI runtime through the shared tool

## Current Execution Order

1. Phase 1 complete: shared workspace index, UI search, and agent search tool.
2. Phase 2 complete: native persisted snapshots and segment-level incremental rebuilds.
3. Phase 3 complete: structured filters, intent-aware ranking, and richer snippets.
4. Next: Phase 4 deeper retrieval joins across artifacts, pipelines, agents, and memory.
