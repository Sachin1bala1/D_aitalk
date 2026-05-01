# Windows Packaging VM Setup Checklist

Last updated: 2026-05-01

## Purpose

This checklist turns the higher-level packaging guidance into a practical VM setup sequence for the first Windows release machine.

Use this together with:

- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
- [release-execution-runbook.md](./release-execution-runbook.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
- [ci-signing-matrix.md](./ci-signing-matrix.md)

## Intended outcome

By the end of this checklist, the VM should be ready to:

- stage the release workspace outside OneDrive
- run release preflight successfully
- execute Rust/Tauri build scripts without `os error 4551`
- produce release artifacts from the current packaging scripts
- serve as a repeatable packaging baseline for future releases

## Recommended VM baseline

### Minimum acceptable profile

- 4 vCPU
- 16 GB RAM
- 80 GB virtual disk
- Windows 11 Pro or Enterprise x64
- local administrator available during setup

### Preferred profile for repeatable release work

- 8 vCPU
- 16 to 32 GB RAM
- 120 GB virtual disk
- Windows 11 Pro or Enterprise x64
- VM platform with snapshot support

## Required paths

Use stable local paths from the start.

Recommended:

- VM workspace root:
  - `C:\Users\<user>\Dev\Daitalk`
- staged repo:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2`
- Cargo target:
  - `C:\Users\<user>\Dev\Daitalk\target`
- release evidence:
  - `C:\Users\<user>\Dev\Daitalk\release-evidence`

Avoid:

- OneDrive-backed folders
- `Desktop`
- `Documents`
- removable/network-synced locations

## Setup sequence

### 1. Create the VM

- provision the VM with the preferred baseline if possible
- enable snapshots/checkpoints
- create a named local admin-capable user for release work
- assign a clear machine name, for example:
  - `DAITALK-PKG-01`

### 2. Bring the OS to a known state

- install current Windows updates
- reboot until no pending update remains
- record:
  - Windows edition
  - Windows version
  - OS build number

Recommended update policy after baseline setup:

- allow security updates
- do not begin packaging during a pending-update state
- do not allow surprise restarts during a release window

### 3. Install required tooling

- Node.js repo-approved line
- npm matching the installed Node release
- Rust stable MSVC toolchain
- Visual Studio Build Tools 2022
- WebView2 runtime
- PowerShell 5.1+ or PowerShell 7+
- Git

Optional, depending on distribution path:

- `signtool.exe`
- certificate access tooling

### 4. Create the working directories

- create `C:\Users\<user>\Dev\Daitalk`
- create `C:\Users\<user>\Dev\Daitalk\release-evidence`
- confirm the chosen Cargo target path is writable without elevation

### 5. Verify policy suitability

The VM is not acceptable if Windows blocks Cargo-generated helper binaries.

Before first release use, the following must be true:

- `cargo.exe` runs normally
- `rustc.exe` runs normally
- Rust-generated `build-script-build.exe` binaries can execute under the chosen target path

### 6. Stage the repo into the VM workspace

From the checked-out repo, use the current staging workflow so the packaging copy is isolated from daily development state.

Expected staged path:

- `C:\Users\<user>\Dev\Daitalk\daitalk-v2`

### 7. Run release preflight

From the staged workspace:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport
```

Do not continue until preflight:

- completes successfully
- reports the workspace outside OneDrive
- sees the expected release docs
- does not reveal a missing core toolchain

### 8. Run the first packaging smoke build

From the staged workspace:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1 -SkipLint -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

Success criteria for this step:

- frontend production build completes
- Rust build scripts are not blocked
- package generation starts or completes normally
- no `os error 4551` appears

### 9. Capture the baseline snapshot

Take a VM snapshot only after:

- the OS is updated
- tools are installed
- the staging path is validated
- preflight passes
- the first packaging smoke build passes

Recommended snapshot names:

- `baseline-after-tooling`
- `baseline-after-first-successful-package`

## Snapshot points

Use at least these checkpoints:

1. `fresh-os`
   - optional, before tool install
2. `baseline-after-tooling`
   - after Node, Rust, Build Tools, WebView2, Git, and PowerShell are ready
3. `baseline-after-policy-validation`
   - after confirming Cargo child binaries are not blocked
4. `baseline-after-first-successful-package`
   - after one successful secure build

## Update policy

For the packaging VM:

- do not auto-apply major toolchain changes during an active release cycle
- pin Node/Rust usage to the release-approved versions for that cycle
- apply Windows and tool updates between releases, not mid-release
- after significant updates, rerun:
  - preflight
  - one packaging smoke build

## Acceptance criteria before first release use

The VM is approved for first release use only when all items below are true:

- Windows version and build recorded
- required tools installed
- workspace path is outside OneDrive
- Cargo target path is outside OneDrive
- `windows-release-preflight.ps1 -WriteReport` succeeds
- `windows-secure-build.ps1` runs without Application Control blocking Rust-generated child binaries
- one release artifact set is produced successfully
- at least one baseline snapshot exists after successful packaging
- release evidence folder exists and is writable

## Evidence to capture

Keep these records for the initial VM certification:

- screenshot or export of Windows version/build
- tool version output for Node, npm, Rust, Cargo, and PowerShell
- preflight report path
- first successful build log path
- artifact output path
- snapshot names taken
- machine name and primary operator

## Fail / do-not-use conditions

Do not use the VM for release packaging if any of the following is true:

- build scripts fail with `os error 4551`
- workspace or target path is still inside OneDrive
- Build Tools or WebView2 are missing
- packaging requires elevation for ordinary file writes
- the VM has pending restart or update state during release work

## Handoff note

Once this checklist passes, the VM can be treated as the standard packaging machine and used with:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
