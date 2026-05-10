# Branch Protection Guide

This repo's GitHub branch settings should reinforce the workflow in [integration-playbook.md](./integration-playbook.md): keep `main` releasable, stabilize risky intake on `integration/*`, and avoid direct large merges into the release line.

## Protect `main`

Recommended settings for `main`:

- Require a pull request before merging.
- Require approvals before merging.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Block force pushes.
- Block branch deletion.

`main` should be treated as the release branch. Direct pushes should be avoided except for rare emergency fixes.

## Required Status Checks

Require these checks before merging to `main`:

- `npm exec tsc -- --noEmit`
- `npm run build`
- `cargo check`

If CI names differ, map the branch protection rules to the workflow job names that run those commands. Do not protect `main` with optional or flaky checks.

Recommended additional rule:

- Require branches to be up to date before merging, if CI runtime is acceptable for the team.

## Linear History Choice

Do **not** require linear history on `main`.

Reason:

- the integration strategy intentionally uses merge commits for large branch intake
- integration work may include a merge commit plus explicit stabilization commits
- forcing linear history pushes the repo toward rebases/squashes that hide how a risky intake was resolved

For this repo, preserving integration history is more useful than enforcing a strictly linear graph.

## Merge Method Guidance

Recommended GitHub merge settings:

- Enable **Merge commit**
- Enable **Squash merge**
- Disable **Rebase merge**

Use them like this:

- Use **merge commits** for `integration/* -> main`
  - preserves the intake history and matches the playbook
- Use **squash merge** for small `feature/* -> main` or `feature/* -> integration/*`
  - keeps routine feature history compact
- Avoid **rebase merge**
  - it rewrites the visible branch story and is a poor fit for large divergent reconciliations

## Admin Bypass Guidance

Keep admin bypass available only for true emergencies.

Recommended policy:

- admins may bypass protections only for:
  - urgent production/release repair
  - broken CI infrastructure that is itself blocking a known-safe fix
  - repository access or security emergencies
- admins should not bypass protection for convenience or to skip validation
- any bypassed merge should be followed by:
  - a written note in the PR
  - immediate follow-up validation on `main`

If GitHub rulesets are used, keep bypass limited to a small maintainer set.

## How To Treat `integration/*` Branches

`integration/*` branches are staging branches, not long-lived release branches.

Recommended handling:

- Do not protect `integration/*` as strictly as `main`.
- Allow maintainers to push stabilization commits directly when resolving merge seams.
- Still open a PR from `integration/*` into `main` for final review and audit trail.
- Run the same build checks on `integration/*` before merge-back.

Practical rules:

- `integration/*` should always branch from current `main`
- merge the target branch into `integration/*`
- fix compile/runtime seams there
- validate there
- merge back to `main` only after it is green

## Suggested GitHub Configuration Summary

For `main`:

- PR required: yes
- Approvals required: yes
- Stale approval dismissal: yes
- Conversation resolution required: yes
- Required checks: `tsc`, frontend build, `cargo check`
- Force push: no
- Delete branch: no
- Linear history: no
- Merge commit: yes
- Squash merge: yes
- Rebase merge: no

For `integration/*`:

- lighter protection or none
- CI should still run
- use as temporary stabilization branches only

## Rule Of Thumb

If a branch is large enough that you expect conflict resolution or runtime repair, it belongs in `integration/<topic>` first, not directly in a PR to `main`.
