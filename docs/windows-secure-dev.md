# Windows Secure Dev And Release

This app is a Tauri desktop application. End users should install a signed release build. They should not run `npm`, `cargo`, or `tauri dev`.

## Goals

- Keep developer builds compatible with Windows security controls.
- Keep secrets out of browser storage and plaintext config files.
- Ship signed installers that run without Node.js or Rust installed.

## Approved Paths

Do not develop from OneDrive-synced folders.

Recommended paths:

- Source: `C:\Dev\Daitalk\daitalk-v2`
- Cargo target: `C:\DevBuild\DaitalkTarget`

## Developer Workstation Requirements

- Node.js LTS
- Rust MSVC toolchain via `rustup`
- Visual Studio C++ build tools
- Tauri prerequisites for Windows

Verify:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## Windows Security Policy Guidance

Allow these only on approved developer workstations:

- `rustup`, `cargo`, `rustc`
- the Rust MSVC toolchain directory under `%USERPROFILE%\.rustup\toolchains\...`
- the approved Cargo target directory
- Node.js, Git, and VS Code

Do not allow blanket execution from all user-writable folders.

## Safe Dev Session

Use a shell with an explicit target directory outside synced folders:

```powershell
$env:CARGO_TARGET_DIR = "C:\DevBuild\DaitalkTarget"
npm run tauri:dev
```

If Windows Application Control blocks Cargo build scripts, the machine policy must allow execution from the approved target directory. This is required for local Tauri development.

## Release Model

Use CI or a dedicated build machine to produce installers:

```powershell
npm ci
npm run tauri:build
```

Release requirements:

- build on an approved machine
- sign the installer and executable
- publish only signed artifacts
- users install the signed package

## Data Handling Rules

- DB connection secrets: OS keychain only
- API keys: OS keychain only
- query history: session only unless a secure native store is designed
- AI chat transcripts: session only unless explicitly persisted
- prefer `ollama` for local-only inference when data isolation is required

## Operational Notes

- `npm run dev` is frontend-only and is not a valid database workflow for this app
- `npm run tauri:dev` is the correct local desktop workflow
- for enterprise deployment, treat local dev and end-user installation as separate paths
