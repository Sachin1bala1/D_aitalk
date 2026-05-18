# Agent Runtime Latency Hardening Plan

Goal: make simple data-analysis requests finish quickly, and make slow or stuck executions fail fast with visible status instead of appearing to run forever.

## Phase 1: Fail-Fast Runtime Budgets

- [x] Add explicit timeout budgets for task planning.
- [x] Add explicit timeout budgets for verification planning.
- [x] Add explicit timeout budgets for single-step and planned subtask agent execution.
- [x] Add explicit timeout budgets for streaming `execute_sql` and `run_duckdb_analysis`.

## Phase 2: Fast Path for Simple Analysis

- [x] Skip multi-step planning for simple statistics, correlation, parameter-importance, and row-sample requests.
- [x] Prefer one focused read-only execution pass for already-loaded result sets.
- [x] Tighten prompt guidance so exploratory questions do not over-decompose by default.

## Phase 3: Visible Stall Detection

- [x] Show subtask elapsed time in the task progress panel.
- [x] Mark long-running working states as stalled.
- [x] Surface the last active note instead of leaving the UI in a silent “running” state.

## Phase 4: Regression Coverage

- [x] Add tests for planning-skip heuristics.
- [x] Add tests for streaming-query timeout behavior.

## Notes

- This hardening intentionally favors responsiveness over indefinite waiting.
- Safe parallel read-only fanout is a future optimization, but the immediate user-facing problem was lack of execution budgets and lack of clear stall signaling.
