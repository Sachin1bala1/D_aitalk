# Agent Live Execution Hardening Plan

Goal: when a user asks Daitalk AI to run, pull, fetch, or show live data, the system must either:

1. execute the safe read query and load results, or
2. surface a clear execution failure.

It must never silently degrade into "SQL was written to the editor" while the assistant implies that data was already pulled.

## Phase 1: Connection Binding Integrity

- [x] Audit how AI runtime receives connection context versus how the active SQL tab stores connection context.
- [x] Remove drift between `activeConnectionId` and `activeTab.connectionId` for agent execution.
- [x] Ensure app-level AI panel uses the tab-bound connection when available.
- [x] Sync the global active connection to the active tab connection when a valid tab-specific binding exists.

## Phase 2: Execution Intent Contract

- [x] Add a deterministic execution-intent classifier for prompts like:
  - run the query
  - pull 100 rows
  - show data from table
  - fetch rows
- [x] Detect whether a live result-producing tool actually succeeded in the current AI turn.
- [x] Mark safe read SQL eligible for automatic fallback execution only when it is truly read-only (`SELECT` / `WITH`).

## Phase 3: Safe Fallback Execution

- [x] If the user intent requires live execution and no result-producing tool succeeded, auto-run the current safe SQL from the active tab.
- [x] Use the effective tab-bound connection first, then the global active connection as fallback.
- [x] If fallback execution succeeds, explicitly tell the user that the query was auto-executed and results are loaded.
- [x] If fallback execution fails, explicitly tell the user that live execution failed and why.

## Phase 4: Agent Guidance and UX Guardrails

- [x] Strengthen the agent prompt so execution requests prefer `execute_sql` over `set_editor_content`.
- [x] Keep `open_table` only for generic previews, not for explicit row-count requests.
- [x] Prevent user-facing wording that implies success when only editor content was written.

## Phase 5: Regression Coverage

- [x] Add unit coverage for execution-intent classification and safe fallback eligibility.
- [x] Keep regression coverage for `open_table` loading rows instead of only writing SQL.
- [x] Re-run focused agent tests plus typecheck after the hardening changes.

## Done Criteria

- [x] A prompt like "run the data table and put all temperature in deg celcius" ends with loaded rows or a clear failure.
- [x] A prompt like "pull 100 rows" does not stop at editor-only SQL unless the user explicitly asked for SQL only.
- [x] Connection drift between tab context and global active connection no longer breaks agent query execution silently.
