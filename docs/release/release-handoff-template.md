# Release Candidate Handoff Template

Last updated: 2026-05-01

Use this template when handing a release candidate to another operator, QA reviewer, or release owner. Copy it into a release-specific ticket, issue, or markdown file and fill every field from the exact candidate being handed off.

Suggested filename:

- `release-handoff-<version>-<date>.md`

## Release identity

- Release version:
- Candidate label:
  - example: `rc1`, `rc2`, `store-submission`, `hotfix-1`
- Release owner:
- Handoff date:
- Handoff from:
- Handoff to:
- Install source:
  - `MSIX`
  - `Microsoft Store draft`
  - `signed MSI`
  - `signed EXE`
  - `internal QA artifact`
- Intended audience:
  - `internal QA`
  - `security review`
  - `release operator`
  - `Partner Center submission`

## Artifact paths

- Staged workspace path:
- Cargo target path:
- Package artifact path:
- Additional artifact paths:
  - installer:
  - bundle directory:
  - symbols or logs:
- Validation report path:
- Preflight report path:
- Screenshot or evidence folder:
- Signing evidence path:
  - certificate log, signing report, or `N/A`

## Build and environment facts

- Packaging machine or VM name:
- Windows version:
- Workspace is outside OneDrive:
  - `yes` / `no`
- Build completed on allowed packaging machine:
  - `yes` / `no`
- Exact packaging command used:
- Exact preflight command used:
- Exact validation report generation command used:

## Release readiness summary

- Packaging result:
  - `passed`
  - `failed`
  - `blocked`
- Clean-machine validation result:
  - `passed`
  - `failed`
  - `not run`
- Privacy disclosure review result:
  - `passed`
  - `failed`
  - `needs follow-up`
- Security review result:
  - `passed`
  - `failed`
  - `needs follow-up`
- Partner Center submission readiness:
  - `ready`
  - `not ready`
  - `internal only`

## Required sign-off roles

- Release owner:
  - name:
  - status: `approved` / `pending` / `blocked`
  - date:
- QA reviewer:
  - name:
  - status: `approved` / `pending` / `blocked`
  - date:
- Security reviewer:
  - name:
  - status: `approved` / `pending` / `blocked`
  - date:
- Submission operator:
  - name:
  - status: `approved` / `pending` / `blocked`
  - date:

For small teams, one person may fill more than one role, but each role should still be marked explicitly.

## Go / no-go decision

- Final decision:
  - `go`
  - `no-go`
  - `go with follow-up`
- Decision owner:
- Decision date:

### Go conditions met

- [ ] Package artifact exists at the recorded path
- [ ] Preflight report is attached and reviewed
- [ ] Validation report is attached and reviewed
- [ ] Privacy/local-data wording matches actual behavior
- [ ] No unresolved release blocker remains
- [ ] Sign-off roles are complete for this handoff target

### No-go reasons or follow-up conditions

- Blocker 1:
- Blocker 2:
- Follow-up action owner:
- Required re-test or re-package step:

## Functional smoke summary

- App launches without dev-only messaging:
  - `pass` / `fail`
- Connection dialog opens:
  - `pass` / `fail`
- Read query succeeds:
  - `pass` / `fail`
- Safety & Local Data dialog opens:
  - `pass` / `fail`
- Destructive AI actions require approval:
  - `pass` / `fail`
- Install / update / uninstall behavior matches expectation:
  - `pass` / `fail` / `not tested`

## Operator notes

- Known limitations for this candidate:
- Expected reviewer focus:
- Anything intentionally deferred to next candidate:
- Extra evidence attached:

## Recommended attachments

- Preflight markdown report
- Validation markdown report
- Screenshots folder
- Artifact hash or signing evidence, if available
- Relevant Partner Center notes
- Any release blocker log or failure screenshot

## Handoff completion check

- [ ] Paths were copied exactly, not reconstructed from memory
- [ ] Version and candidate label match the artifact filename
- [ ] The receiver knows whether this is internal QA, security review, or Store submission ready
- [ ] Go / no-go state is explicit
- [ ] Outstanding blockers have named owners
