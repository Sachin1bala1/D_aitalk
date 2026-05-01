# Windows End-User Trust Guide

Last updated: 2026-05-01

## Purpose

Use this guide to keep the Windows release path focused on what end users should experience at install time.

This is not a developer-build guide. It is the concise trust model for packaged desktop releases.

## The rule

End users should install a packaged release, not a self-built binary.

They should not need to:

- install Rust, Cargo, Node.js, or Tauri
- run a terminal command
- disable Smart App Control
- bypass Defender or Application Control prompts
- approve unsigned binaries from a developer workspace

If any of those are required, the release is not ready for general Windows users.

## Trusted Windows install paths

### Path 1: Microsoft Store

This is the preferred trust path for general users.

Expected user experience:

- user installs from Microsoft Store
- Windows treats the app as a normal packaged Store app
- install and launch do not depend on developer toolchains
- users are not asked to bypass local security policy just to run the app

Release owner requirements:

- produce a Store-compatible packaged artifact
- keep Store metadata and privacy disclosures accurate
- validate install, first launch, update, and uninstall on a clean machine
- keep the evidence packet for the exact candidate submitted

Primary supporting docs:

- [microsoft-store-msix.md](./microsoft-store-msix.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [partner-center-evidence-packet-guide.md](./partner-center-evidence-packet-guide.md)

### Path 2: Signed direct download

Use this only if the app is intentionally distributed outside the Microsoft Store.

Expected user experience:

- user downloads a signed installer or package
- installer identity matches the intended publisher
- install does not require a manual security bypass
- launch does not depend on developer tools or local build outputs

Release owner requirements:

- sign the intended release artifact through the approved signing path
- protect signing material and keep it off ordinary developer machines where possible
- validate the signed package on a clean Windows machine
- keep signing confirmation with the rest of the release evidence

Primary supporting docs:

- [windows-signing-notes.md](./windows-signing-notes.md)
- [ci-signing-matrix.md](./ci-signing-matrix.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)

## What users should not need to bypass

For end-user installs, the following should never be part of the release instructions:

- disable Smart App Control
- add WDAC or AppLocker exceptions
- whitelist Cargo target directories
- run from a OneDrive-synced source tree
- use a packaging VM or developer workstation workaround

Those are release engineering or packaging machine concerns, not end-user steps.

If a release guide tells users to do any of those things, it is describing a dev-build escape hatch, not a production-ready Windows install path.

## What can still be true internally

These may still exist behind the scenes without affecting end-user trust:

- packaging happens on a dedicated VM or approved Windows workstation
- preflight, manifest, and validation reports are generated during release
- signing or Store submission is limited to specific operators
- packaging machines have stricter rules than user machines

That is normal. End users should not see or need any of it.

## Evidence the release owner must keep

For every Windows release candidate, keep these artifacts together:

1. exact packaged artifact path
2. packaging-machine manifest
3. preflight report
4. validation report
5. clean-machine smoke or lifecycle evidence
6. final Store or distribution metadata source
7. signing confirmation or Store packaging note
8. final signoff record with named owners

Use these docs as the evidence bundle sources:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [validation-report-template.md](./validation-report-template.md)
- [partner-center-evidence-packet-guide.md](./partner-center-evidence-packet-guide.md)
- [release-handoff-template.md](./release-handoff-template.md)

## Fast release-owner check

Before calling the Windows release trustworthy for end users, confirm:

1. the app installs from the intended packaged artifact, not from a dev build
2. the package launches on a clean Windows machine without a bypass step
3. privacy and local-data wording still matches the shipped build
4. destructive or sensitive in-app actions still respect the release safety controls
5. release evidence is complete enough that someone else could audit the decision later

If any of those fail, stop and fix the release path before distribution.
