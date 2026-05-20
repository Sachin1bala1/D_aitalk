# Agent Analysis + Plot Hardening Plan

## Goal

Make the AI agent reliably complete analysis-and-plot requests end to end instead of stopping after only loading rows.

## Failure Modes Observed

1. Pyodide runtime drift:
   - frontend package version and CDN `indexURL` version diverged
   - statistical tools failed before analysis could complete

2. Incomplete Pyodide package preload:
   - kernels use `scikit-learn` and `statsmodels`
   - runtime only preloaded `numpy` and `scipy`

3. Weak analysis fallback:
   - when `stat__feature_importance` failed, the agent could stall instead of continuing with the next valid analysis path

4. Incomplete chart command shape:
   - `create_chart` could not carry color grouping
   - requests like “plot process temp vs wear by type” could not fully resolve in one tool call

## Implementation Phases

### Phase 1: Stabilize Statistical Runtime

- Align `PyodideRuntime` CDN version with the installed `pyodide` package
- Centralize the version and package list in one place
- Preload the packages the kernels actually depend on:
  - `numpy`
  - `scipy`
  - `scikit-learn`
  - `statsmodels`

### Phase 2: Add Resilient Analysis Fallbacks

- Catch `feature_importance` runtime failures
- Fallback to a deterministic correlation-based ranking when Random Forest analysis is unavailable
- Return a successful ranked result instead of a hard-stop tool failure when a safe fallback exists

### Phase 3: Complete Plot Tooling

- Extend `create_chart` to accept `colorColumn`
- Thread `colorColumn` through:
  - tool schema
  - agent tool-call conversion
  - chart artifact creation
  - Graph Builder request state

### Phase 4: Regression Coverage

- Verify the correct Pyodide CDN version and package list are loaded
- Verify feature-importance fallback behavior
- Verify `create_chart` can open Graph Builder with color grouping

## Exit Criteria

- Analysis requests no longer fail due to Pyodide version mismatch
- `stat__feature_importance` does not dead-end the agent when a safe fallback is possible
- Requests like “plot X vs Y by type” can open Graph Builder with color grouping in one turn
- Targeted tests and lint pass
