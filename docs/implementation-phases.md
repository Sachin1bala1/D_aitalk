# Daitalk Implementation Phases

This file turns the cleanup and stabilization plan into an execution order that preserves current frontend and backend behavior.

## Phase 1: Secure Dev And Repo Cleanup

Status: completed in this workspace

- remove obsolete MinGW/MSYS linker overrides
- add secure Windows dev guidance
- add a secure Tauri dev wrapper script
- remove unused Tauri shell plugin dependency
- remove generated build output from the workspace

Artifacts:

- `.cargo/config.toml`
- `docs/windows-secure-dev.md`
- `scripts/windows-secure-dev.ps1`
- `package.json`

## Phase 2: Functional Stabilization

Goal: make the app reliably runnable on approved developer and build machines.

Tasks:

- move source out of OneDrive-synced paths
- set an approved `CARGO_TARGET_DIR`
- validate `npm run tauri:dev:secure` on a machine where Windows Application Control allows Cargo build scripts
- verify all Tauri prerequisites on a clean Windows workstation
- produce one successful local desktop build

Blocking issue in current environment:

- Windows Application Control is blocking Rust-generated build executables

## Phase 3: Secret And Data Handling Hardening

Goal: keep all current features while reducing local data leakage.

Tasks:

- complete native-only connection persistence with secrets in OS keychain
- keep query history session-only by default
- keep AI chat history session-only by default
- keep snippets session-only by default unless a secure native store is added
- audit logs and error messages for secret redaction

## Phase 4: Release Engineering

Goal: make the app installable on any user machine without Node.js or Rust.

Status: in progress in this workspace

Tasks:

- add CI for Windows Tauri builds
- sign executables and installers
- publish signed installers only
- test installer on clean Windows machines
- document upgrade and rollback behavior

Artifacts:

- `.github/workflows/windows-release.yml`
- `docs/windows-release-build.md`
- `scripts/windows-secure-build.ps1`
- `scripts/sign-windows-artifacts.ps1`
- `package.json`

## Phase 5: Scalability Refactor Without Feature Loss

Goal: keep the same frontend/backend features while making the codebase easier to extend.

Tasks:

- formalize frontend module boundaries:
  - db
  - ai
  - editor
  - schema
  - history
  - settings
- formalize Rust command boundaries by domain
- add contract tests for frontend/backend DTOs
- add smoke tests for connection, schema load, query execution, and persistence
- trim unused dependencies after import audit

## Done Criteria

The app is considered ready when:

- developers can run `npm run tauri:dev:secure` on approved machines
- CI can build signed installers
- end users can install and run the signed package without dev tooling
- secrets are not stored in plaintext browser storage
- current user-facing features still work
