# Secure Windows Release Build

This document defines the release path for Daitalk on approved Windows build machines. End users should install signed packages only. They should not run `npm`, `cargo`, or `tauri dev`.

## Goals

- build installers on approved machines only
- keep build output out of OneDrive and other synced folders
- produce signed Windows artifacts
- make builds reproducible in CI and on dedicated packaging workstations

## Build Machine Requirements

- Windows 11 or Windows Server runner with Microsoft Defender and Windows Application Control configured for approved build paths
- Node.js 22.x
- Rust stable with the MSVC toolchain
- WebView2 runtime
- Visual Studio C++ build tools for Tauri/Rust native dependencies
- `signtool.exe` available for signing on release machines

Recommended paths:

- source: `C:\Dev\Daitalk\daitalk-v2`
- cargo target: `C:\DevBuild\DaitalkTarget`

Do not run release builds from OneDrive-synced folders.

## Local Release Build

Run this on an approved build machine:

```powershell
$env:CARGO_TARGET_DIR = "C:\DevBuild\DaitalkTarget"
npm run tauri:build:secure
```

To sign artifacts after the build, set the signing thumbprint and run:

```powershell
$env:WINDOWS_SIGN_CERT_SHA1 = "<certificate-thumbprint>"
npm run tauri:build:secure -- -Sign
```

Artifacts are emitted under:

```text
<CARGO_TARGET_DIR>\release\bundle\
```

## CI Release Strategy

Use CI to build unsigned artifacts by default. Restrict signing to protected branches, tags, or dedicated release environments with certificate access.

Expected CI secrets:

- `WINDOWS_CERT_BASE64`: base64-encoded PFX certificate
- `WINDOWS_CERT_PASSWORD`: password for the PFX
- `WINDOWS_SIGN_CERT_SHA1`: certificate thumbprint used by `signtool`

Recommended controls:

- require branch protection for release branches
- require environment approvals for signing jobs
- keep signing secrets unavailable to pull-request workflows
- publish only signed `.exe` and `.msi` artifacts

## Verification Checklist

- `npm run lint` passes
- `npm run tauri:build:ci` completes on CI
- generated `.exe` and `.msi` are signed on release jobs
- installer runs on a clean Windows machine without Node.js or Rust installed
- application starts, connects to a test database, and loads schema/query views
