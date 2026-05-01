# Release Readiness Docs

This folder contains packaging and privacy readiness artifacts for Windows release work that do not overlap command-surface or code-level security reviews.

Use these documents together with the higher-level audit in [../store-readiness-audit.md](../store-readiness-audit.md) and the build-machine notes in [../windows-release-build.md](../windows-release-build.md).

## Contents

- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)
  - concise failure triage for packaging, validation, and signoff blockers such as `os error 4551`, OneDrive paths, missing `signtool`, missing bundle output, and privacy mismatches
- [release-roles-and-ownership.md](./release-roles-and-ownership.md)
  - concise small-team ownership map for packaging, validation, security signoff, Store submission, and post-release incident triage
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
  - concise final go/no-go gate list for security, privacy, packaging, and distribution signoff
- [windows-end-user-trust-guide.md](./windows-end-user-trust-guide.md)
  - concise end-user install trust model for Microsoft Store and signed direct-download releases, including what users should never be asked to bypass
- [microsoft-store-msix.md](./microsoft-store-msix.md)
  - Microsoft Store submission and MSIX packaging readiness
- [microsoft-store-candidate-smoke-guide.md](./microsoft-store-candidate-smoke-guide.md)
  - fastest post-install manual checks for a packaged Store candidate: first launch, no dev hints, connection dialog, read query, Safety & Local Data, and AI approval gating
- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
  - required Windows machine / VM profile for successful packaging without Application Control failures
- [packaging-machine-acceptance-checklist.md](./packaging-machine-acceptance-checklist.md)
  - concise go/no-go checklist for deciding whether a Windows machine is acceptable for final desktop packaging and signing readiness
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)
  - practical first-time setup and acceptance checklist for a dedicated Windows packaging VM
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
  - exact operator flow for moving a staged workspace onto the packaging machine, regenerating reports, and executing the build
- [release-execution-runbook.md](./release-execution-runbook.md)
  - step-by-step operator workflow for packaging, validation, and sign-off
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
  - concrete metadata and submission preparation checklist for Microsoft Partner Center
- [partner-center-evidence-packet-guide.md](./partner-center-evidence-packet-guide.md)
  - concise guide for assembling the final internal evidence packet before Partner Center submission
- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
  - privacy disclosure and local-data wording checklist
- [store-submission-copy-pack.md](./store-submission-copy-pack.md)
  - concise Microsoft Store listing and disclosure drafting copy aligned to the current implementation
- [store-metadata.template.json](./store-metadata.template.json)
  - starter metadata file for support URL, privacy policy URL, contact email, and short description before final submission
  - copy this to `store-metadata.json`; Store-profile validation now expects the real file, not just the template
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
  - clean install, update, repair, and uninstall verification
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
  - release-acceptance matrix for OS/install-source coverage, first-launch checks, DB/AI validation, privacy checks, and evidence expectations
- [windows-signing-notes.md](./windows-signing-notes.md)
  - signing expectations for Store and non-Store Windows distribution
- [ci-signing-matrix.md](./ci-signing-matrix.md)
  - practical CI, secret, protected-environment, and decision-gate model for Windows release operations
- [validation-report-template.md](./validation-report-template.md)
  - reusable evidence template for install/update/uninstall and Store sign-off
- [release-handoff-template.md](./release-handoff-template.md)
  - reusable handoff packet template for moving a release candidate between operators, QA, security review, and submission owners

## Scope

These docs are intended to answer:

- What are the final release signoff gates before Microsoft Store submission?
- What should the release owner do first when packaging or validation fails?
- What must be ready before packaging Daitalk for Windows users?
- Is this exact machine acceptable for final desktop release packaging right now?
- What kind of Windows machine or VM is actually acceptable for packaging?
- What privacy and local-data claims need to be true at submission time?
- What install/update/uninstall behaviors need verification on a clean machine?
- What signing path is appropriate for Store and outside-Store distribution?

They intentionally do **not** replace:

- Tauri command sensitivity inventory
- code-level policy enforcement reviews
- app architecture or threat-model documents

## Supporting scripts

The release scripts under [../../scripts](../../scripts) are intended to make release preparation repeatable:

- `windows-release-preflight.ps1`
  - checks that the workspace, release docs, tools, and optional bundle artifacts are in a reasonable state before a packaging run
- `release-handoff.ps1`
  - stages a fresh packaging workspace, captures the packaging-machine manifest, and writes a preflight report in one pass
- `init-store-metadata.ps1`
  - copies the Store metadata template into `docs/release/store-metadata.json` so final support/privacy/contact values can be filled in
- `validate-release-config.ps1`
  - validates Tauri/package release settings, production CSP rules, and Store-facing release doc readiness before packaging
- `new-release-validation-report.ps1`
  - creates a dated markdown evidence report from the validation template
- `collect-packaging-machine-manifest.ps1`
  - captures the packaging machine environment, tool versions, and target-path expectations into a reusable manifest

## Fastest safe workflow

Use this sequence when you want the shortest path to a release-ready evidence bundle:

1. Generate a fresh non-OneDrive packaging handoff workspace
2. Initialize and fill final Store metadata
3. Validate release config and Store-facing metadata
4. Build/package the release artifact from that workspace
5. Generate a validation report for that exact build
6. Run the Microsoft Store candidate smoke guide first, then the broader clean-machine install/update/uninstall checklist while filling the report live
7. Complete the Partner Center and privacy checklists
8. Attach the preflight output, validation report, screenshots, and package path to the release ticket

Suggested commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-handoff.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\init-store-metadata.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-release-config.ps1 -WriteReport
powershell -ExecutionPolicy Bypass -File .\scripts\new-release-validation-report.ps1 -Version 0.1.0 -ReleaseOwner "Owner Name"
```

## Recommended evidence bundle

For each candidate release, keep these artifacts together:

- one preflight report
- one packaging-machine manifest
- one validation report
- the final packaged artifact path
- screenshot source list or capture folder
- signing confirmation, if applicable
- Partner Center submission notes

Store them under a release-specific folder or ticket so sign-off does not depend on chat history or memory.
