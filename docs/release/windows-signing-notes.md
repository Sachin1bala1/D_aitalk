# Windows Signing Notes

Last updated: 2026-05-01

## Goal

Make Daitalk installable for general Windows users without asking them to bypass Windows trust mechanisms.

## Key distinction

There are two separate trust contexts:

### Developer builds

- built locally with Cargo and Tauri toolchains
- may trigger local machine policy issues on locked-down systems
- are not the distribution format for general users

### Release builds

- packaged for end users
- should be signed and distributed through a trusted path
- should not require toolchains or policy bypasses on user machines

## Preferred path

Preferred Windows distribution path:

- Microsoft Store with MSIX packaging

Why:

- Store distribution is the cleanest path for general-user trust
- users should install the packaged app, not a self-built executable
- this avoids conflating developer machine policy issues with end-user installation

## Outside-Store distribution

If Daitalk is distributed outside the Store later:

- use proper Windows code signing for release artifacts
- keep signing keys off developer laptops where possible
- sign only in protected CI environments or approved packaging workstations

## Signing workflow notes

- keep signing separate from ordinary development workflows
- protect certificate material with restricted access
- document who can produce signed releases
- require release approval before signing jobs run

## Build-machine rules

- do not build release artifacts from OneDrive-synced directories
- use an approved source path and a separate approved cargo target path
- verify the packaged build on a clean Windows machine after signing

## What signing does not replace

Signing is necessary for trust, but it does not replace:

- least-privilege command design
- privacy disclosure
- install/update/uninstall validation
- release CSP hardening
- auditability for sensitive actions

## Release checklist

Before a signed Windows release is considered ready:

1. packaging succeeds on an approved machine
2. version numbers and package identity are correct
3. signing succeeds with the intended certificate path
4. the signed package installs on a clean machine
5. launch and basic database workflows succeed
6. uninstall behavior is documented and verified
