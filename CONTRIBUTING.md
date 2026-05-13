# Contributing to Daitalk

## Branching policy

Do not work directly on `main` for normal development.

Use short-lived branches from the latest `origin/main`:

- `feat/<topic>`
- `fix/<topic>`
- `ci/<topic>`
- `hotfix/<topic>`
- `docs/<topic>`

Examples:

- `feat/graph-builder-facets`
- `fix/historical-connection-persistence`
- `ci/windows-cargo-check`

## Merge policy

- Merge to `main` only through pull requests
- Keep PRs focused on one feature, fix, or CI change
- Re-sync long-lived branches with `main` at least daily
- Resolve conflicts in the branch before merge

Preferred merge mode:

- `Squash and merge` for most PRs

## Validation policy

Before opening or merging a PR, run the checks that apply to your area.

Typical frontend checks:

```text
npm ci
npm exec tsc -- --noEmit
npm run build
npm test
```

Typical desktop / Rust checks:

```text
cd src-tauri
cargo check
cargo build
cargo test
```

If a change touches agent flows, database connections, graph builder, dashboards, or Tauri runtime paths, record a runtime validation note in the PR.

## Ownership lanes

Use these as default ownership boundaries to reduce conflicts:

- AI / agent: `src/lib/agent`, `src/components/ai`
- DB / persistence / connections: `src/lib/db`, `src-tauri/src/commands`, `src-tauri/src/db`
- Charts / tables / dashboards: `src/components/charts`, `src/components/table`, related stores
- CI / release / docs: `.github/workflows`, `docs`, packaging scripts

If another teammate is already editing the same area, coordinate before both branches drift.

## GitHub branch protection settings

Enable these settings on `main` in GitHub:

1. Require a pull request before merging
2. Require status checks to pass before merging
3. Required status check: `validate`
4. Block force pushes
5. Optionally require branches to be up to date before merge

Recommended team rule:

- require 1 reviewer when another active teammate is working in the same repo area

## Hotfix rule

Use `hotfix/<topic>` only for urgent production-blocking issues. Keep hotfixes narrow and merge them back to `main` immediately after validation.

## Stability rule

Do not mix unrelated product, CI, and release changes in the same PR unless they are tightly coupled and explicitly called out.
