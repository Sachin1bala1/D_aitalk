# Windows Release Execution Runbook

Last updated: 2026-05-01

## Goal

Turn the Store-readiness documentation into an execution sequence that a release owner can follow on a Windows packaging machine.

## Output of this runbook

By the end of a successful run, the team should have:

- a release preflight result
- a packaged Windows release artifact set
- a completed validation report
- a prepared Microsoft Partner Center submission packet
- a clear go/no-go decision for release
- a retained evidence bundle that can be rechecked later without rerunning the release

## Roles

- Release owner
  - runs the packaging sequence and collects evidence
- Security reviewer
  - confirms privacy, audit, and sensitive-command expectations still match the release
- QA reviewer
  - runs clean-machine install, update, and uninstall checks

The same person can hold more than one role for small teams, but the checklist should still be filled from each perspective.

For the concise ownership map across packaging, validation, security signoff, Store submission, and post-release incident triage, use [release-roles-and-ownership.md](./release-roles-and-ownership.md).

## Step 1: Prepare the build machine

- confirm the machine passes [packaging-machine-acceptance-checklist.md](./packaging-machine-acceptance-checklist.md)
- use a non-OneDrive workspace path
- use a dedicated Cargo target path
- confirm the machine has the required packaging tools
- confirm the machine has access to signing material only if the release path requires it
- if the release candidate arrived from another machine, follow [packaging-handoff-guide.md](./packaging-handoff-guide.md) before running the build

Recommended commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1 -WriteReport
```

Do not continue if the preflight reports missing core tooling or obviously wrong workspace conditions.

## Step 2: Confirm release inputs

Before building, verify:

- app version is final for this release
- package identity and display name are final
- release notes input is ready
- privacy disclosure text matches current app behavior
- release CSP and command-surface reviews are complete

Required documents:

- [microsoft-store-msix.md](./microsoft-store-msix.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)

## Step 3: Build and package

Run the packaging path from the approved release machine.

Suggested sequence:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1
```

If signing is part of the current distribution path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1 -Sign
```

After packaging:

- record the exact bundle output path
- record the package version produced
- record whether MSIX, MSI, EXE, or multiple artifact types were produced

## Step 4: Create the validation report

Create a release evidence file before testing so evidence stays tied to one exact build.

Suggested command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-release-validation-report.ps1 -Version 0.1.0 -ReleaseOwner "Owner Name"
```

The report should be filled during the clean-machine pass, not after memory-based reconstruction.

At this point, record:

- generated report path
- target machine or VM identity
- exact artifact path that will be installed

## Step 5: Run clean-machine validation

On a clean Windows machine or disposable VM:

- install the package
- launch the app without developer tools
- run the functional smoke path
- test update and uninstall paths if available in the current cycle

Use:

- [microsoft-store-candidate-smoke-guide.md](./microsoft-store-candidate-smoke-guide.md)
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
- the generated validation report from Step 4

Start with the short Store-candidate smoke guide, then continue with the broader lifecycle checklist.

Minimum smoke path:

1. launch the app
2. confirm no dev-only URLs or messages appear
3. open a connection dialog
4. run a read query
5. confirm safety/local-data controls are reachable
6. confirm destructive AI actions require approval

Capture evidence while testing, not afterward:

- screenshots for install success, first launch, and uninstall result
- exact error text for any blocker
- whether the observed behavior matches the privacy/local-data disclosures
- whether the app uses only the intended release artifact and not any dev-time path

## Step 6: Prepare Partner Center submission

Complete the submission checklist and gather:

- descriptions
- screenshots
- support URL
- privacy policy URL
- release notes
- any required age/content declarations

Use:

- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)

If packaging or validation fails during any step, triage it first with:

- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)

## Step 7: Final sign-off

Do not call the release ready until all of the following are true:

- packaging completed successfully
- validation report is filled and attached to the release
- privacy disclosure text has been reviewed against actual app behavior
- signing expectations for the chosen path are satisfied
- submission metadata is complete

## Exit criteria

Release is ready for Microsoft Store submission only when:

1. the build artifact is packaged successfully
2. the clean-machine validation pass is complete
3. the Partner Center checklist is complete
4. no unresolved release blocker remains in the validation report

## Recommended release folder contents

Keep each release review in one place, for example:

- package artifact path
- preflight report
- validation report
- screenshots folder
- signing notes
- submission text draft
