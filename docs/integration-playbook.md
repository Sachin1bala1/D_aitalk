# Integration Playbook

This repo should integrate large incoming branches through a controlled path, not directly into `main`.

## Branch Roles

- `main`
  - Always releasable.
  - Must pass `npm exec tsc -- --noEmit`, `npm run build`, and `cargo check`.
  - Never receives a large divergent branch merge directly.

- `integration/<topic>`
  - Temporary stabilization branch for large or risky intake.
  - Created from current `main`.
  - Used to merge the target branch, resolve compile/runtime seams, and validate.

- `feature/<topic>`
  - Normal focused development branch.
  - Can merge into `integration/<topic>` or directly into `main` if low-risk and validated.

## Naming Convention

- `integration/connection-doctor`
- `integration/billion-scale-intake`
- `integration/dashboard-reconciliation`
- `feature/dashboard-linked-brushing`
- `feature/release-signing`

## Default Intake Workflow

For any divergent branch or external repo intake:

1. Update local refs.
2. Branch from current `main`.
3. Merge the target branch into `integration/<topic>`.
4. Resolve structural conflicts intentionally.
5. Run validation.
6. Fix compile/runtime regressions in follow-up commits on the integration branch.
7. Only after validation succeeds, merge the integration branch back to `main`.

GitHub Actions now enforces the minimum validation gate on:

- `main`
- `integration/**`
- `feature/**`

## Commands

### Start a new integration branch

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-integration-branch.ps1 -Topic "dashboard-reconciliation"
```

### Start and merge a target ref into it

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-integration-branch.ps1 -Topic "branch-intake" -MergeRef "origin/feature/gaps-complete"
```

## Pre-Merge Requirements

Before starting any intake:

1. `git status --short` must be clean.
2. `main` must already build locally.
3. The target branch/ref must be fetched locally.
4. The incoming scope must be identified:
   - frontend shell
   - dashboard/graph builder
   - agent/AI workflow
   - backend/db
   - release/security

## Conflict Resolution Rules

When a large branch collides with this app, resolve in this order:

1. Preserve build-critical runtime contracts first.
   - `src/lib/stores/WorkspaceStore.ts`
   - `src/lib/db/DbClient.ts`
   - `src/lib/agent/AgentLoop.ts`
   - `src/lib/agent/registerHandlers.ts`
   - `src/App.tsx`
   - `src-tauri/src/lib.rs`

2. Keep `main` as source of truth for:
   - desktop connection stability
   - release/security workflow
   - query runtime wiring
   - dashboard tab/state contracts

3. Pull in incoming branch behavior selectively when it adds:
   - new tools
   - new panels
   - new agent features
   - new analytics/memory modules

4. Do not accept incoming versions blindly when they remove existing fields or contracts used elsewhere.

## Validation Gate

Every integration branch must pass:

```powershell
npm exec tsc -- --noEmit
npm run build
cd .\src-tauri
cargo check
```

These same checks are mirrored in `.github/workflows/validate.yml`.

If desktop/runtime-sensitive changes landed, also verify manually:

1. Launch desktop app.
2. Open SQL editor and confirm it renders.
3. Connect to a known-good database.
4. Run a safe query like `SELECT 1`.
5. Open dashboard tab.
6. Open AI panel.
7. Open Safety & Local Data if touched.

## Merge-Back Checklist

Before merging `integration/<topic>` into `main`:

1. No uncommitted changes.
2. Validation commands pass.
3. Any post-merge repair commits are already included in the integration branch.
4. If the intake changed release/build behavior, verify GitHub workflow files are still valid.
5. Summarize:
   - what came in
   - what was intentionally preserved from `main`
   - any remaining warnings or follow-up debt

## Rules of Thumb

- Prefer one merge commit plus one or more explicit stabilization commits over a messy half-working merge.
- Do not merge a divergent branch into a dirty tree.
- Do not assume a successful merge means a safe integration; compile/runtime validation is mandatory.
- If the incoming branch is huge, stabilize by subsystem rather than trying to reason about everything at once.
