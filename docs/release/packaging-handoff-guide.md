# Packaging Machine Handoff Guide

Last updated: 2026-05-01

## Purpose

Use this guide when a staged Daitalk workspace is being moved from a developer machine onto the Windows packaging VM or packaging workstation that will produce the release bundle.

This is the operator-facing bridge between:

- the staged workspace
- the packaging machine manifest
- the preflight report
- the secure build command

Use this together with:

- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)
- [release-execution-runbook.md](./release-execution-runbook.md)
- [release-handoff-template.md](./release-handoff-template.md)

## Inputs you should already have

Before starting on the packaging machine, make sure the handoff includes:

- a staged workspace folder
  - preferred example:
    - `C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff`
- a known Cargo target path for packaging
  - preferred example:
    - `C:\Users\<user>\Dev\Daitalk\target`
- any existing release evidence already produced on the source machine
  - `docs\release\reports\preflight-*.md`
  - `docs\release\reports\packaging-machine-manifest-*.md`
- the intended release version or candidate label
- the handoff record built from [release-handoff-template.md](./release-handoff-template.md)

If the staged workspace does not already contain `docs\release\reports`, that is acceptable. You will regenerate the machine-specific reports on the packaging machine.

## Expected directory layout on the packaging machine

Recommended layout:

- workspace:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff`
- Cargo target:
  - `C:\Users\<user>\Dev\Daitalk\target`
- reports:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff\docs\release\reports`

Do not package from:

- OneDrive paths
- `Desktop`
- `Documents`
- removable or network-synced folders

## Step 1: Place the staged workspace on the packaging machine

Copy the staged workspace folder to a local non-OneDrive path on the packaging machine.

Example destination:

- `C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff`

After copying, open PowerShell and change into that folder:

```powershell
cd C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff
```

Quick sanity checks:

```powershell
Test-Path .\package.json
Test-Path .\scripts\windows-secure-build.ps1
Test-Path .\docs\release\README.md
```

Expected result:

- all three commands return `True`

If any return `False`, stop and request a corrected staged workspace.

## Step 2: Generate the packaging-machine manifest on the target machine

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\collect-packaging-machine-manifest.ps1 -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

Expected console output:

- a final line similar to:
  - `Packaging machine manifest written: C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff\docs\release\reports\packaging-machine-manifest-2026-05-01-111724.md`

What this means:

- the packaging machine identity, OS, toolchain presence, and path assumptions are now recorded for this exact machine

If the script fails:

- do not continue to packaging
- resolve missing `cargo`, `rustc`, `node`, or path issues first

## Step 3: Run release preflight in the staged workspace

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

Expected console output includes:

- `Windows release preflight`
- `RepoRoot=C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff`
- `CargoTargetDir=C:\Users\<user>\Dev\Daitalk\target`
- multiple `[PASS]` and possibly `[WARN]` lines
- a final line similar to:
  - `Preflight report written: C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff\docs\release\reports\preflight-2026-05-01-111742.md`

Expected warnings that may still be acceptable before the first build:

- `signtool.exe` not found
  - acceptable for Store-only packaging paths
- bundle directory or bundle artifacts not present yet
  - acceptable before the first successful build

Stop and fix before proceeding if preflight shows any of these conditions:

- workspace is under OneDrive
- `cargo` is missing
- `npm` is missing
- core release docs are missing from `docs\release`

## Step 4: Compare source-machine and packaging-machine reports

If the handoff already included source-machine reports, compare them to the newly generated target-machine reports.

Use the source reports to answer:

- what machine originally staged the candidate?
- was the source path outside OneDrive?
- did the source machine already hit policy issues?

Use the target-machine reports to answer:

- is this machine actually suitable for packaging?
- are the current workspace and Cargo target paths correct?
- do local tool versions look reasonable for release work?

Minimum files to retain in the evidence bundle:

- source preflight report, if one was handed off
- source packaging-machine manifest, if one was handed off
- target preflight report
- target packaging-machine manifest

The packaging-machine reports are machine-specific and should not be reused across machines without regeneration.

## Step 5: Run the secure build on the packaging machine

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1 -SkipLint -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

Expected early console output:

- `Using CARGO_TARGET_DIR=C:\Users\<user>\Dev\Daitalk\target`

Expected build flow:

1. `npm ci`
2. `npm run tauri:build`
3. Tauri/Rust bundle generation

Successful outcome:

- the command exits successfully
- bundle artifacts are created under:
  - `C:\Users\<user>\Dev\Daitalk\target\release\bundle`

Verify artifacts:

```powershell
Get-ChildItem C:\Users\<user>\Dev\Daitalk\target\release\bundle -Recurse -File | Where-Object {
  $_.Extension -in ".msix", ".msixbundle", ".msi", ".exe"
}
```

Expected result:

- one or more release artifact files are listed

## Step 6: Recognize the known packaging blocker immediately

If the build fails with either of these signals:

- `os error 4551`
- Windows Application Control, App Control, or Smart App Control blocking `build-script-build.exe`

then the machine is not yet a valid packaging machine for Daitalk.

Treat this as an environment blocker, not a code failure.

Do not keep retrying the build on the same machine until policy is fixed or the build is moved to a valid packaging VM.

Use these docs next:

- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
- [wdac-applocker-exception-request-template.md](./wdac-applocker-exception-request-template.md)
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)

## Step 7: Record the exact artifact and report paths

After a successful build, record all of the following in the handoff packet:

- staged workspace path
- Cargo target path
- manifest report path
- preflight report path
- bundle artifact path
- machine name
- Windows version/build
- exact secure-build command used

Use [release-handoff-template.md](./release-handoff-template.md) for this.

## Step 8: Continue into validation and submission work

After packaging succeeds, continue with:

1. [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
2. [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
3. [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)

Recommended next commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-release-validation-report.ps1 -Version 0.1.0 -ReleaseOwner "Owner Name"
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport -RequireBundleArtifacts -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

Expected result of the second command:

- the new preflight report should now show bundle directory and bundle artifacts as present

## Fast operator checklist

Use this condensed checklist during a live handoff:

1. Copy staged workspace to `C:\Users\<user>\Dev\Daitalk\daitalk-v2-handoff`
2. `cd` into the staged workspace
3. Generate packaging-machine manifest
4. Run release preflight with `-WriteReport`
5. Review warnings and confirm the machine is outside OneDrive
6. Run secure build with explicit `-CargoTargetDir`
7. Verify artifact files exist under `target\release\bundle`
8. Capture report paths and artifact paths into the handoff record
9. Continue to install/update/uninstall validation

## Files that should travel with the release candidate

When handing the candidate forward to QA, security review, or Partner Center prep, include:

- the staged workspace path
- the built artifact path
- the target-machine preflight report
- the target-machine packaging manifest
- any source-machine preflight/manifest provided in the handoff
- the validation report once created
- screenshots or failure logs, if any

This keeps the release packet reproducible even when the packaging machine changes.
