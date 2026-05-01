# Microsoft Store and MSIX Readiness

Last updated: 2026-05-01

## Goal

Package Daitalk as a Windows-friendly desktop app that installs cleanly for general users through the Microsoft Store, without asking users to bypass Windows security controls.

## Release principle

Developer build behavior and Store install behavior are different:

- local `cargo` and `tauri dev` outputs are subject to local machine policy
- Microsoft Store packages should be distributed as signed MSIX artifacts
- end users should install the packaged release, not run developer toolchains

## Readiness gate

Before Store submission, all of the following should be true:

1. release packaging works on an approved Windows build machine
2. the app has a stable product identity and versioning strategy
3. privacy disclosures match actual on-device storage behavior
4. desktop-only behavior is clearly documented
5. release CSP and network permissions are production-tight
6. install, update, repair, and uninstall flows are validated on a clean machine

## MSIX packaging checklist

### Package identity

- choose final app display name
- choose stable package identity / publisher identity
- confirm versioning strategy:
  - semantic app version
  - monotonic package version for Store submission
- confirm icons and visual assets exist in Store-ready sizes

### Build output

- release build completes on a non-OneDrive approved path
- bundle output is reproducible from a clean checkout
- package does not depend on developer-only localhost endpoints
- package does not require Node.js or Rust on the target machine

### Tauri / Windows packaging review

- verify bundle format includes MSIX or a Store-compatible packaging path
- confirm WebView2 dependency behavior is acceptable for Store users
- verify app capabilities requested are minimal and justified
- verify app does not expose dev tooling or debug-only menus in release

### Submission metadata

- short description ready
- long description ready
- screenshots ready
- support URL ready
- privacy policy URL ready if required by Store listing
- release notes / “what’s new” process defined

## Pre-submission validation

Run this on a clean Windows machine or disposable VM:

1. install the packaged build
2. launch without developer tools installed
3. verify first-run experience
4. connect to a test database
5. run a read-only query
6. verify desktop-only features behave correctly
7. verify local-data controls are visible and functional
8. verify uninstall removes app binaries and leaves only explicitly documented user data

## Store submission blockers

Do not submit while any of these are unresolved:

- production CSP still includes dev localhost entries
- privacy disclosure text is incomplete or inaccurate
- app requests capabilities not clearly justified
- install/update/uninstall path is untested
- a release build still depends on manual Windows security bypasses

## Store acceptance notes

Expected user experience for general users:

- download from Microsoft Store
- install without Rust/Node/Cargo
- launch without Smart App Control or Defender bypass prompts
- use the app without needing special machine policy changes

If that is not true on a clean Windows machine, the app is not release-ready.
