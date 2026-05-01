# Packaging Machine Acceptance Checklist

Last updated: 2026-05-01

## Purpose

Use this checklist right before final desktop release packaging to decide whether the Windows packaging machine is acceptable for Daitalk release creation and signing work.

This is the short go/no-go checklist. Use the broader docs for setup and deeper troubleshooting:

- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [windows-signing-notes.md](./windows-signing-notes.md)
- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)

## Intended outcome

By the end of this checklist, the release owner should know one of two things:

- the machine is acceptable for final desktop packaging and signing readiness checks
- the machine is not acceptable and packaging must stop

## Allowed environment

The packaging machine is acceptable only if all of the following are true:

- Windows 11 Pro or Enterprise x64 is installed
- the operator has local admin available for release setup if needed
- the working repo path is local and outside OneDrive
- the Cargo target path is local and outside OneDrive
- ordinary packaging work does not require elevation for file writes
- the machine is not in a pending restart or mid-update state

Recommended paths:

- workspace:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2`
- Cargo target:
  - `C:\Users\<user>\Dev\Daitalk\target`

Do not accept these paths for final packaging:

- `Desktop`
- `Documents`
- OneDrive-synced folders
- removable or network-synced folders

## Required tools

All of these must be installed and callable from PowerShell:

- `node`
- `npm`
- `cargo`
- `rustc`
- Visual Studio Build Tools 2022
- WebView2 runtime
- PowerShell 5.1+ or PowerShell 7+

Required version evidence should be captured with the packaging-machine manifest before packaging.

## Signing prerequisites

For Microsoft Store packaging only:

- Store package identity is finalized
- release owner knows whether local signing is not required for the chosen Store path
- final Store metadata is filled and validated

For outside-Store or dual-distribution packaging:

- `signtool.exe` is available
- certificate access is available on the approved packaging machine or protected signing environment
- signing owner and release owner are identified
- signing material is not being pulled ad hoc from an ordinary developer laptop

## Must-pass checks before packaging

All of the following must pass before the final packaging command is allowed to run:

1. Packaging-machine manifest generation succeeds

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\collect-packaging-machine-manifest.ps1 -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

2. Release preflight succeeds for the exact staged workspace

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport -CargoTargetDir "C:\Users\<user>\Dev\Daitalk\target"
```

3. Release config validation succeeds for the intended release profile

Store build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-release-config.ps1 -ReleaseProfile store -WriteReport
```

Default desktop release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-release-config.ps1 -WriteReport
```

4. If signing is part of the current release path, signing prerequisites are confirmed before packaging starts

5. The machine has already demonstrated that Cargo-generated helper binaries can execute under the chosen target path

## Stop immediately if any of these happen

Do not continue packaging on this machine if any of the following is true:

- `os error 4551` appears anywhere in the build flow
- Windows Application Control, App Control, Smart App Control, WDAC, or AppLocker blocks Cargo-generated child binaries
- the workspace or Cargo target path is still inside OneDrive
- `cargo`, `rustc`, `node`, or `npm` is missing
- Build Tools or WebView2 are missing
- Store metadata or required release docs are incomplete for the intended profile
- signing is required but `signtool.exe`, certificate access, or signing ownership is not ready
- the machine requires elevation for normal package-output writes

If any stop condition is hit, move to:

- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)
- [wdac-applocker-exception-request-template.md](./wdac-applocker-exception-request-template.md)
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)

## Final acceptance decision

Record one outcome before packaging:

- `accepted for final packaging`
- `blocked; do not package here`

Minimum evidence to retain:

- workspace path
- Cargo target path
- packaging-machine manifest path
- preflight report path
- release-config validation report path
- machine name
- Windows version/build
- release owner
- signing owner, if applicable

