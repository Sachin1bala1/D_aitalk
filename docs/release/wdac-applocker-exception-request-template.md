# Daitalk Packaging Workflow Exception Request Template

Use this template when requesting a Windows Application Control, WDAC, or AppLocker exception for the Daitalk Windows packaging workflow on a controlled build machine.

This is intended for:
- internal IT or endpoint security administrators
- managed Windows developer workstations
- dedicated Windows packaging VMs

This is **not** a request to broadly disable Windows security controls. The goal is a narrow allow policy that permits the Daitalk packaging workflow to complete while keeping the machine protected.

## Why This Exception Is Needed

The Daitalk Windows packaging workflow currently fails on machines with strict Application Control policy during Rust/Tauri build execution.

Observed failure:

- Cargo and Rust compilation proceed normally
- The build then attempts to execute generated Rust build helper binaries
- Windows blocks those generated binaries with:
  - `os error 4551`
  - `An Application Control policy has blocked this file`

This has been observed specifically during generated `build-script-build.exe` execution inside the Cargo target directory.

## Minimum Policy Outcome Required

The minimum required outcome is:

- allow the Daitalk packaging workflow to run Rust/Cargo-generated build helper executables on the approved build machine
- allow final Daitalk packaging artifacts to be built from the approved workspace and target directory
- do **not** require globally disabling WDAC, AppLocker, or Smart App Control across the machine estate

If the machine is managed under WDAC or AppLocker, the requested outcome is a targeted allow policy for the approved toolchain and output locations.

## Recommended Scope

This exception should be scoped as narrowly as possible:

- only on the approved build workstation or packaging VM
- only for the approved packaging user account or build identity, if supported
- only for the approved Rust toolchain executables
- only for the approved Daitalk workspace and Cargo target/output paths

Recommended approved build paths:

- Workspace:
  - `C:\Users\<user>\Dev\Daitalk\daitalk-v2`
- Cargo target/output:
  - `C:\Users\<user>\Dev\Daitalk\target`

Avoid approving broad user-profile paths or unrelated repositories.

## Requested Allowances

The packaging workflow needs a policy outcome equivalent to the following high-level allowances.

### 1. Rust toolchain executables

Allow execution of the approved Rust toolchain programs used to build Daitalk, such as:

- `cargo.exe`
- `rustc.exe`
- related Rust toolchain helpers required by Cargo during build

Typical location:

- `C:\Users\<user>\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\`

If the organization standardizes Rust through another path, approve the managed toolchain location actually used on the packaging machine.

### 2. Cargo-generated build helper binaries

Allow execution of Cargo-generated build helper binaries within the approved target directory, including but not limited to:

- `build-script-build.exe`
- other generated Rust crate build helpers emitted under `target\debug\build\...`
- equivalent generated executables under release build paths when packaging

High-level target area:

- `C:\Users\<user>\Dev\Daitalk\target\**`

This is the most important allowance. Without it, the build fails with the observed `os error 4551` block.

### 3. Final Daitalk packaging executables and bundle tooling

Allow execution of:

- the generated Daitalk desktop executable during packaging validation
- Tauri/Rust bundle generation steps that emit or inspect application binaries
- any approved signing and artifact inspection tools used in the packaging process

This should still be limited to the approved Daitalk workspace and target/output paths.

## Optional Preferred Policy Shape

If the security platform supports it, prefer one or more of:

- publisher or signed-toolchain allow rules for the approved Rust toolchain
- path-scoped allow rules for the approved Cargo target directory
- dedicated packaging VM policy separate from general end-user workstation policy
- build-user-scoped allow rules instead of machine-wide broad exceptions

If publisher-based trust is not available for generated build helpers, a path-scoped allow on the dedicated packaging target directory is the practical fallback.

## Explicit Non-Goals

This request does **not** ask for:

- organization-wide disabling of WDAC or AppLocker
- unrestricted execution from all user profile directories
- blanket allow rules for arbitrary unsigned executables
- broad whitelisting of all developer workstations

## Suggested Admin Request Email / Ticket

Subject:

`Request: Targeted WDAC/AppLocker exception for Daitalk Windows packaging workflow`

Body:

```text
We need a targeted Windows Application Control exception for the Daitalk Windows packaging workflow on an approved build machine.

Current issue:
- The Daitalk Rust/Tauri packaging workflow compiles successfully until Cargo attempts to run generated Rust build helper binaries.
- Windows blocks those generated build helpers with:
  - os error 4551
  - "An Application Control policy has blocked this file"
- The observed block occurs on generated build-script-build.exe files inside the Cargo target directory.

Minimum outcome required:
- Allow the approved Rust toolchain and Cargo-generated build helper executables to run on the approved Daitalk packaging machine.
- Allow final Daitalk packaging binaries to be built and validated from the approved workspace and target/output path.

Requested scope:
- Limit the exception to the approved build machine or packaging VM
- Limit it to the approved packaging user/build identity if supported
- Limit it to the approved Rust toolchain path and Daitalk workspace/target paths

Requested high-level allowances:
1. Allow Rust toolchain executables used for build:
   - cargo.exe
   - rustc.exe
   - required Rust build helpers in the approved toolchain location

2. Allow Cargo-generated build helper executables under the approved target path, including:
   - build-script-build.exe
   - other generated helpers under target\debug\build\... and equivalent release/package paths

3. Allow final Daitalk packaging executables and bundle validation steps to run from the approved workspace/target paths.

Approved paths:
- Workspace: C:\Users\<user>\Dev\Daitalk\daitalk-v2
- Target/output: C:\Users\<user>\Dev\Daitalk\target

This request is intended as a narrow packaging exception, not a broad reduction of endpoint protections.
```

## Evidence To Attach

When opening the request, attach:

- terminal output showing the `os error 4551` failure
- the path of the blocked generated executable, if available
- the approved packaging workspace path
- the approved Cargo target path
- the release preflight report from the Daitalk release workflow, if available

## Approval Check Before Use

Before using the exception on a real release run, confirm:

- the approved packaging machine is not using OneDrive as the active release workspace
- the Rust toolchain path matches the request
- the Cargo target path matches the request
- the exception is limited to packaging use, not general unrestricted development execution

## Related Daitalk Release Docs

See also:

- `docs/release/windows-packaging-machine-spec.md`
- `docs/release/release-execution-runbook.md`
- `docs/release/ci-signing-matrix.md`
- `docs/release/windows-signing-notes.md`
