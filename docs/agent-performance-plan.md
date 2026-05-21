# Agent Performance Plan

## Goal

Make the Daitalk agent feel fast and reliable for routine requests like:
- `hi`
- `pull 100 rows`
- `plot process temp vs wear by type`
- `what are the most important parameters`

The target is not to imitate one provider exactly. The target is to make the runtime behave with the same practical responsiveness users expect from top-tier assistants.

## Problems Observed

1. Fast-mode model rounds were capped at `10s`, which is too aggressive for real provider latency.
2. The agent used the same heavy system prompt for both deep investigation and routine requests.
3. Planning and verification timeouts were tuned too low, causing normal provider latency to look like system failure.
4. Timeout failures were treated as terminal instead of retryable transient failures.
5. User-facing timeout messaging did not explain what actually happened.

## Phase 1: Timeout Hardening

- Raise fast-mode round timeout from `10s` to a more realistic interactive budget.
- Raise deep-mode timeout substantially.
- Raise task-planning and verification planning timeouts.
- Raise single-step and subtask execution budgets.
- Treat timeout errors as retryable in the shared AI resilience layer.

## Phase 2: Prompt Weight Reduction

- Use a compact fast-mode system prompt for routine requests.
- Keep the full investigation prompt only for deep analysis requests.
- Limit schema context in fast mode to a compact table and column summary.
- Keep approved rules context, but trim it to the most relevant slice.

## Phase 3: Adaptive Runtime Budgets

- Compute round timeout from:
  - query depth
  - provider
  - model family
  - user prompt size
- Give slower providers and larger frontier models more room.
- Cap the maximum timeout so the app does not appear hung forever.

## Phase 4: User Feedback

- Replace brittle `Agent error` timeout text with a clear explanation:
  - the model took longer than the interactive budget
  - the runtime retried automatically when safe
  - the user can try again if the provider remains slow
- Keep visible progress so long tasks feel active, not dead.

## Phase 5: Validation

- Lint must pass.
- Agent/task tests must pass.
- Manual regression scenarios:
  - greeting does not error
  - simple plot request does not fail at `10s`
  - simple query and summary requests stay on fast path
  - deep analysis still uses the richer workflow

## Current Execution Status

- Phase 1: complete
- Phase 2: complete
- Phase 3: complete
- Phase 4: complete
- Phase 5: complete
