# Tauri Upgrade Impact Audit

## Scope

This note audits the current Tauri package state in this repo and explains the release impact of upgrading before a Windows production/MSIX push.

It is intentionally limited to the Tauri stack:

- JavaScript packages: `@tauri-apps/api`, `@tauri-apps/cli`
- Rust crates: `tauri`, `tauri-build`
- Important resolved internals visible in `Cargo.lock`: `tauri-runtime`, `tauri-utils`

## Current vs latest

### JavaScript side

Declared ranges in [package.json](../package.json):

- `@tauri-apps/api`: `^2`
- `@tauri-apps/cli`: `^2`

Resolved versions in [package-lock.json](../package-lock.json):

- `@tauri-apps/api`: `2.10.1`
- `@tauri-apps/cli`: `2.10.1`

Current npm latest checked during this audit:

- `@tauri-apps/api`: `2.11.0`
- `@tauri-apps/cli`: `2.11.0`

### Rust side

Declared ranges in [src-tauri/Cargo.toml](../src-tauri/Cargo.toml):

- `tauri = { version = "2", features = [] }`
- `tauri-build = { version = "2", features = [] }`

Resolved versions in [src-tauri/Cargo.lock](../src-tauri/Cargo.lock):

- `tauri`: `2.10.3`
- `tauri-build`: `2.5.6`
- `tauri-runtime`: `2.10.1`
- `tauri-utils`: `2.8.3`

Current crates.io latest checked during this audit:

- `tauri`: `2.11.0`
- `tauri-build`: `2.6.0`
- `tauri-runtime`: `2.11.0`
- `tauri-utils`: `2.9.0`

## What is actually outdated

The repo is not stuck on an old major release. It is on recent Tauri `2.x`, but the lockfiles are behind the latest available patch/minor line:

- JS lockfile is one release behind: `2.10.1 -> 2.11.0`
- Rust runtime/core is also behind:
  - `tauri 2.10.3 -> 2.11.0`
  - `tauri-build 2.5.6 -> 2.6.0`
  - `tauri-runtime 2.10.1 -> 2.11.0`
  - `tauri-utils 2.8.3 -> 2.9.0`

This is a moderate release-readiness gap, not a crisis.

## Why it matters for release

### 1. Release packaging confidence

Tauri CLI, build crate, and runtime should be kept reasonably aligned before Windows packaging and Store submission. Mismatch across JS tooling and Rust runtime is not automatically broken, but it increases the chance of:

- packaging regressions surfacing late
- build metadata changes between local/dev and bundle builds
- avoidable friction during MSIX or installer generation

### 2. Windows-specific runtime stability

Tauri upgrades often pull through changes in lower-level Windows integration layers. Even patch/minor updates can affect:

- window creation and sizing behavior
- WebView2 interaction
- path/resource resolution
- permission/capability handling
- build-time config interpretation

For a Store-oriented release, being one current patch line behind is not ideal when the upgrade cost is still relatively contained.

### 3. Security and hardening posture

This repo is already investing in CSP, command policy, auditability, and release hardening. Staying current on the Tauri line matters because framework updates can include:

- security hardening fixes
- capability/config correctness fixes
- bundling fixes that affect signed Windows distribution

Even when there is no visible app-level feature need, framework currency helps reduce avoidable release risk.

## Expected risk areas when upgrading

### Low-risk areas

- `@tauri-apps/api` patch/minor within Tauri `2.x`
- `@tauri-apps/cli` patch/minor within Tauri `2.x`
- `tauri-build` update where config shape is already valid

These are still worth testing, but they are the safest part of the upgrade.

### Medium-risk areas

- `tauri` runtime bump from `2.10.x` to `2.11.0`
- transitive `tauri-runtime` / `tauri-utils` movement

Likely things to re-check:

- command invocation and event streaming
- CSP behavior in dev vs production
- bundle generation
- window startup behavior
- file/path handling and local data paths

### Higher-risk release-only areas

These are not likely to break during `cargo check`, but can break during bundle validation:

- MSIX / installer generation
- icons/resources inclusion
- signing pipeline expectations
- capability enforcement differences between dev and packaged app

## Recommended upgrade order

### Step 1. Upgrade the JS tooling pair together

Upgrade together:

- `@tauri-apps/api`
- `@tauri-apps/cli`

Why first:

- smallest blast radius
- quick signal on whether frontend/runtime bindings still behave cleanly
- easiest to validate with `npm install`, `npm exec tauri info`, and normal type/build checks

### Step 2. Upgrade `tauri` and `tauri-build` together

Then update:

- `tauri`
- `tauri-build`

Why second:

- these are the Rust-side release-critical pieces
- they should move as a pair for packaging confidence

### Step 3. Refresh lockfiles and validate the resolved transitive set

After explicit version refresh:

- inspect `package-lock.json`
- inspect `src-tauri/Cargo.lock`
- confirm resolved versions moved to the expected `2.11.x` / `2.6.x` line

### Step 4. Run release-focused validation, not just dev validation

Minimum validation after upgrade:

- `npm exec tsc -- --noEmit`
- `npm run build`
- `cargo check`
- `npm exec tauri info`
- release preflight script
- one packaged Windows bundle/MSIX pass from a non-OneDrive release path

## Recommended release stance

Before final Store packaging, this repo should be upgraded to the latest stable Tauri `2.x` line that is current at release time, unless a specific upgrade regression is found.

Given the current delta, the recommended near-term target is:

- JS: `@tauri-apps/api` and `@tauri-apps/cli` to `2.11.0`
- Rust: `tauri` to `2.11.0`, `tauri-build` to `2.6.0`

## Bottom line

The repo is close, not badly outdated. The gap is mostly:

- resolved lockfiles lagging the current Tauri patch/minor line
- release risk accumulating if packaging starts before the framework stack is refreshed

Recommended action:

1. do the Tauri package refresh before final Windows release packaging
2. validate both dev and packaged flows
3. treat bundle/MSIX validation as the real gate, not just `cargo check`
