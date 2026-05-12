# Windows Build Requirements

This project is a Windows-first desktop app built with Tauri, Rust, Node.js, and native database dependencies. Local builds and GitHub Actions Windows builds must satisfy the requirements below.

## Required toolchain

- Rust stable
- Target: `x86_64-pc-windows-msvc`
- Node.js `22`
- npm with lockfile-based install
- Visual Studio Build Tools / MSVC C++ toolchain
- Windows SDK available through the Visual Studio toolchain

For local Rust setup:

```powershell
rustup update stable
rustup default stable-x86_64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc
```

## Required Windows environment

Windows builds should run inside an initialized MSVC developer environment.

In GitHub Actions, this repo uses:

- `ilammy/msvc-dev-cmd@v1`

That is required because native crates and Windows desktop dependencies may expect `cl.exe`, `link.exe`, SDK paths, and other MSVC environment variables to already be configured.

## Native dependency notes

This repo includes crates that increase Windows build complexity:

- `tauri`
- `ssh2`
- `sqlx` with `sqlite`
- `ring`
- `libsqlite3-sys`
- `libssh2-sys`

These can fail on CI even when pure Rust code is unchanged if the runner environment is not prepared correctly.

## CI requirements

The Windows GitHub Actions jobs should keep these safeguards:

- initialize MSVC developer shell
- install `x86_64-pc-windows-msvc`
- use a short `CARGO_TARGET_DIR`
- install Perl for native crate build scripts
- emit enough diagnostics to expose the first real Rust error on failure

Current workflow expectations:

- validation workflow uses a short target dir for `cargo check`
- Windows release workflow initializes the same Rust/MSVC environment

## Optional defensive dependency

The workflows also install WebView2. This is primarily a defensive Windows desktop setup step. It is more relevant for full Windows app build and runtime confidence than for plain `cargo check`, but keeping it in CI is acceptable.

## Local validation commands

From the project root:

```powershell
npm ci
npm run build
```

From `src-tauri`:

```powershell
cargo check
cargo build
```

## Failure triage order

When Windows CI fails:

1. Check whether the failed step is actually `cargo check` or an earlier setup step.
2. Read the first Rust `error:` block, not just the final `exit code 1`.
3. Distinguish between:
   - Rust code errors
   - native crate build errors
   - MSVC / SDK environment issues
   - path length or runner-image issues
4. Only change dependency features after the first real error identifies the failing crate or subsystem.

## Stability rule

Do not change saved connection behavior, AI provider persistence behavior, or application runtime logic as part of Windows CI troubleshooting unless the compiler error proves those code paths are the cause.
