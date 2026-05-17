# Data Change Review Plan

Status: All phases complete
Owner: Codex
Date: 2026-05-17

## Goal

Close the Cursor/Bugbot-style review gap by adding a first-class review layer for risky data changes and derived artifact refreshes.

The product outcome is not "another approval button." It is a review dossier that explains:

- what is about to change
- why it is risky
- what downstream objects may be affected
- what policy or verification limitations apply
- what evidence the operator should inspect before approving

## Product Requirements

1. One shared review engine for risky change classes.
2. Review surfaces for:
   - AI approval queue commands
   - manual pipeline runs
   - report refreshes from changed upstream artifacts
3. Findings are structured by severity and category.
4. Reviews are explainable and visible before execution.
5. Review evidence is included in audit logging where applicable.

## Delivery Phases

### Phase 1: Shared review engine

Action items:

1. Add `docs/data-change-review-plan.md`.
2. Create a shared `DataChangeReviewEngine`.
3. Define review dossier and finding types.
4. Cover:
   - destructive SQL mutations
   - pipeline execution
   - report refresh / artifact regeneration

Exit criteria:

- One review engine can generate structured findings for all target classes.

### Phase 2: Approval queue integration

Action items:

1. Attach a review dossier to risky AI approval steps.
2. Render findings inline in `PlanQueue`.
3. Include review summary and findings in approval audit logs.

Exit criteria:

- Operators see more than a one-line description before approving risky work.

### Phase 3: Manual workflow reviews

Action items:

1. Add pre-run review for manual pipeline execution.
2. Add pre-refresh review for report refresh actions.
3. Reuse one review dialog/panel instead of bespoke UI.

Exit criteria:

- Manual high-impact workflows have the same review discipline as AI-driven ones.

### Phase 4: Validation and hardening

Action items:

1. Add targeted unit coverage for review generation.
2. Keep lint and full frontend/Rust test suite green.
3. Mark the plan complete once all review surfaces are wired.

Exit criteria:

- The review layer is a stable product capability, not a partial prototype.

## Guardrails

- Do not pretend lexical heuristics are perfect lineage analysis.
- Do not auto-approve based on review results.
- Keep findings honest about deterministic vs best-effort knowledge.
- Reuse the same review model across AI and manual actions.

## Completion Notes

- A shared review engine now generates structured findings for risky AI commands, pipeline runs, and report refreshes.
- `PlanQueue` renders review findings inline before approval and includes review context in approval audit events.
- Manual pipeline execution now opens a review dialog before running.
- Report refresh actions now open a review dialog before rebuilding bound sections.
- The review model is shared rather than duplicated per surface.
