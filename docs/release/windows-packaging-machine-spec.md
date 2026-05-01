# Windows Packaging Machine / VM Spec

Last updated: 2026-05-01

## Purpose

This document defines the minimum acceptable Windows environment for producing Daitalk release bundles and explains the exact blocker observed on the current developer machine.

Use this together with:

- [packaging-machine-acceptance-checklist.md](./packaging-machine-acceptance-checklist.md)
- [release-execution-runbook.md](./release-execution-runbook.md)
- [microsoft-store-msix.md](./microsoft-store-msix.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [../../docs/tauri-upgrade-impact-audit.md](../tauri-upgrade-impact-audit.md)

## Why this matters

The repository is now structurally ready for release packaging, but release creation still fails on the current development machine because Windows Application Control blocks Cargo-generated Rust build-script executables.

Observed failure class:

- Rust compilation proceeds
- frontend production build succeeds
- bundle creation reaches native dependency build steps
- generated `build-script-build` binaries are blocked with `os error 4551`

This is a packaging environment issue, not a source-code layout issue.

## Required machine profile

### Recommended baseline

- Windows 11 Pro or Enterprise x64
- local administrator available for packaging setup
- non-OneDrive local working path
- stable internet access for dependency restore and provider verification

### Required toolchain

- Node.js `24.x` or repo-approved release line
- npm `11.x`
- Rust stable MSVC toolchain
- Visual Studio Build Tools 2022
- WebView2 runtime
- PowerShell 5.1+ or PowerShell 7+

### Required workspace layout

Recommended paths:

- staged workspace:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2`
- cargo target:
  - `C:\Users\<user>\Dev\Daitalk\target`

Avoid:

- OneDrive-synced folders
- Desktop/Documents paths managed by sync tools
- protected root paths that need elevation for normal work

## Application Control requirement

### Packaging machine must allow:

- `cargo.exe`
- `rustc.exe`
- generated Rust build scripts under the chosen Cargo target directory
- generated release bundle helper binaries under the same tree

### Minimum acceptable policy outcome

The following commands must run without Application Control blocking generated child binaries:

```powershell
cd C:\Users\<user>\Dev\Daitalk\daitalk-v2
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport
powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1 -SkipLint -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

If these fail with `os error 4551`, the machine is not a valid packaging machine yet.

## Recommended VM option

If the primary workstation is policy-restricted, use a dedicated Windows VM.

Recommended VM profile:

- 4+ CPU cores
- 16 GB RAM minimum
- 60+ GB free disk
- Windows 11 image
- snapshot taken after toolchain install but before release packaging

Why a VM is a good fit:

- clean packaging environment
- repeatable install/update tests
- isolation from corporate endpoint controls if allowed
- easier rollback between release candidates

## Packaging machine checklist

Before first use:

- install Node/npm
- install Rust MSVC toolchain
- install Visual Studio Build Tools
- install WebView2 runtime
- confirm `cargo`, `rustc`, `npm`, and `signtool` if needed
- confirm build workspace is outside OneDrive
- confirm Application Control does not block Cargo child executables

Before each release:

- stage workspace with `npm run release:stage`
- run release preflight with report output
- verify version, privacy docs, and command inventory are current
- run secure build
- capture artifact paths and evidence

## If using Microsoft Store only

For a Store-only distribution path:

- code-signing of the final Store-distributed package is handled through Microsoft Store packaging flow
- local signing tools may be optional depending on your exact submission workflow

Still required:

- successful local bundle/MSIX creation
- successful clean install lifecycle validation
- accurate privacy and local-data disclosure

## If distributing outside the Store too

Additional requirements:

- `signtool.exe`
- release certificate access
- signing process controls
- post-sign verification on a clean machine

## Current blocker summary

Current developer machine status:

- staging to `C:\Users\sachi\Dev\Daitalk\daitalk-v2` works
- release preflight passes from staged path
- secure build still fails when Windows blocks generated Cargo build scripts

Conclusion:

- the next successful release build requires either:
  - a packaging machine with more permissive or properly allowlisted Application Control policy, or
  - a dedicated VM configured for Rust/Tauri packaging

## Recommended next action

1. create or identify one valid packaging machine or VM
2. move staged workspace there
3. run release preflight
4. run secure build with a user-owned Cargo target path
5. continue with install/update/uninstall validation
