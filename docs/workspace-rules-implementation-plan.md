# Workspace Rules Implementation Plan

Status: All phases complete
Owner: Codex
Date: 2026-05-17

## Goal

Close the "no approved learned rules / project-scoped operating guidance" gap by adding a first-class workspace rules layer that is:

- persisted natively
- visible and manageable by the user
- fed into the AI runtime automatically
- approval-based for AI-suggested rules
- searchable from the same workspace retrieval layer

The product outcome is not "more memory." It is durable operating guidance that the user can explicitly approve, reject, edit, and trust.

## Product Requirements

1. Rules are first-class data, not hidden prompt text.
2. Rules can be scoped globally or to a specific connection.
3. AI can suggest rules, but never silently enable them.
4. Approved rules are injected into agent context automatically.
5. Users can review, edit, approve, reject, and delete rules from the UI.
6. Rules are retrievable through workspace search.

## Delivery Phases

### Phase 1: Persisted rules foundation

Action items:

1. Add `docs/workspace-rules-implementation-plan.md`.
2. Create a native-persisted `WorkspaceRuleStore`.
3. Support rule lifecycle states:
   - `suggested`
   - `approved`
   - `rejected`
4. Support sources:
   - `user`
   - `agent`
   - `memory`

Exit criteria:

- Rules persist across restarts.
- Approved and suggested rules can be enumerated from one store.

### Phase 2: User approval and management UX

Action items:

1. Extend the Memory panel with:
   - approved rules
   - suggested rules
   - manual rule creation
2. Add approve / reject / delete controls.
3. Show scope, source, and rationale/evidence.

Exit criteria:

- Users can manage rules without editing hidden config.

### Phase 3: Agent runtime integration

Action items:

1. Add approved rules to the AI memory context.
2. Inject rules into the agent system prompt.
3. Add an AI tool for `propose_workspace_rule`.
4. Route AI proposals into the suggested-rule queue.

Exit criteria:

- Approved rules materially shape AI behavior.
- AI can suggest durable guidance without bypassing approval.

### Phase 4: Shared retrieval and product hardening

Action items:

1. Add rules to the shared workspace semantic index.
2. Expose rules through `search_workspace`.
3. Add unit coverage for the store and indexing paths.
4. Validate end-to-end lint and test flow.

Exit criteria:

- Rules are visible to both UI search and the AI runtime.
- The gap is closed as a product capability, not only a prompt feature.

## Guardrails

- Do not silently auto-approve AI-proposed rules.
- Do not hide rule state inside `localStorage`-only prompt tweaks.
- Do not let connection-scoped rules bleed into unrelated connections.
- Keep the rule language human-readable and editable.

## Completion Notes

- Rules are now natively persisted and available across restarts.
- The Memory panel supports manual creation plus approval and rejection of AI-suggested rules.
- Approved rules are injected into the AI runtime as explicit workspace guidance.
- The agent can propose durable rules through `propose_workspace_rule`, but they remain pending until user review.
- Rules are indexed in the shared workspace search layer and visible through `search_workspace`.
