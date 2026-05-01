# Clean-Machine Validation Matrix

Last updated: 2026-05-01

## Goal

Use this matrix to decide whether a Windows release candidate has enough clean-machine coverage to be accepted for Microsoft Store or side-loaded Windows distribution testing.

This document complements:

- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
- [validation-report-template.md](./validation-report-template.md)
- [release-execution-runbook.md](./release-execution-runbook.md)

The checklist answers "what to do on a machine." This matrix answers "which machine and release combinations must be covered before sign-off."

## Required matrix axes

Every release candidate should be mapped across these axes:

- OS version
- install source
- first launch outcome
- database connection smoke test
- AI provider smoke test
- audit and privacy controls
- update behavior
- uninstall behavior
- evidence completeness

## Minimum release-acceptance coverage

| Axis | Minimum coverage | Required result |
| --- | --- | --- |
| OS version | 1 clean Windows 11 machine or VM | Pass |
| Install source | 1 Store-equivalent MSIX path and 1 local packaged MSIX path if both are supported | Pass or explicitly waived |
| First launch | 1 pass per install source | Pass |
| DB connect | 1 successful read-only connection on packaged desktop app | Pass |
| AI provider checks | 1 no-key behavior check and 1 configured-provider smoke test if a provider is release-supported | Pass or feature intentionally unavailable |
| Audit/privacy checks | 1 verification of Safety & Local Data visibility, counts, filters, clear actions, and export behavior | Pass |
| Update | 1 older-to-newer packaged upgrade path | Pass before release |
| Uninstall | 1 uninstall pass for the final candidate | Pass before release |
| Evidence | screenshots, versioned validation report, package path, tester identity, machine identity | Complete |

## Validation matrix template

Use this table for each release candidate.

| Candidate | OS version | Install source | First launch | DB connect | AI provider check | Audit/privacy | Update | Uninstall | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vX.Y.Z-rc1` | Windows 11 23H2 | Packaged MSIX | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Name | Open |
| `vX.Y.Z-rc1` | Windows 11 24H2 | Microsoft Store sandbox or Store-equivalent path | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Name | Open |

## OS version expectations

Recommended baseline coverage:

- Windows 11 23H2 or later
- Windows 11 24H2 if that is your main release target

If you intend to support Windows 10, add a separate matrix row and do not infer compatibility from Windows 11 passes.

Record for each machine:

- full Windows version
- build number if available
- VM or physical-machine identifier
- whether the machine uses default Windows security settings

## Install source coverage

Use a separate row for each install path you intend to support:

- Microsoft Store submission-equivalent MSIX
- packaged MSIX installed outside the Store
- any signed direct-distribution installer, if later supported

Do not mark release readiness using only a dev-machine `tauri dev` run. Clean-machine acceptance must be based on packaged artifacts.

## First launch checks

First-launch acceptance should confirm:

- install completes without developer tooling
- app opens without crash, blank screen, or WebView bootstrap issue
- release branding and app identity are correct
- desktop-only wording is correct
- no dev-only `localhost` or build-path messaging appears

Evidence expectation:

- one screenshot of the app after first successful launch
- exact error text if launch fails

## Database connection checks

Database smoke coverage should include at least one successful packaged-app connection and one successful read query.

Recommended minimum:

- connect to a release-safe test database
- run a read-only query
- confirm results render in table or dashboard
- confirm a read-only connection blocks mutation if `read_only` is enabled

Evidence expectation:

- screenshot of connected state
- query text or identifier used for smoke validation
- any policy-denial message for read-only mutation blocking

## AI provider checks

AI validation should cover both safe failure behavior and configured-provider success behavior.

Minimum checks:

- no-key path:
  - open the AI panel with no provider key configured
  - verify the app fails clearly and safely
- configured-provider path:
  - use one release-supported provider
  - verify a simple request succeeds
  - confirm destructive actions are queued for approval instead of auto-running

Evidence expectation:

- screenshot or log of no-key messaging
- screenshot or short transcript of one successful provider response
- screenshot of approval queue behavior for a risky action

## Audit and privacy checks

Validate the productized privacy surface, not only backend behavior.

Minimum checks:

- open Safety & Local Data
- confirm local-data counts load
- confirm audit entries load
- confirm audit filtering by event type and outcome works
- confirm JSON export works for the current filtered view
- confirm at least one clear action works as documented in release notes

Evidence expectation:

- screenshot of Safety & Local Data dialog
- exported JSON sample path or evidence note
- note describing which clear action was tested

## Update checks

Update coverage must use packaged builds, not source rebuilds.

Minimum checks:

- install older packaged build
- update to candidate build
- confirm app launches after update
- confirm expected settings/data persist
- confirm local audit/history/telemetry schema still reads cleanly

Evidence expectation:

- source and target version numbers
- screenshot of post-update launch
- note on whether local data persisted as expected

## Uninstall checks

Uninstall acceptance should verify the documented residual-data behavior matches reality.

Minimum checks:

- uninstall succeeds
- app shortcuts are removed
- binaries are removed
- residual local data matches release disclosure text

Evidence expectation:

- screenshot or note of uninstall success
- note describing whether local data remained and whether that was expected

## Evidence completeness rules

Do not mark a matrix row `Pass` unless it has:

- tester name
- machine or VM identifier
- candidate version
- install source
- screenshot or explicit evidence note for user-visible checks
- exact error text for any failed sub-check
- link or path to the validation report

Recommended evidence bundle per candidate:

- preflight report
- validation report
- screenshots folder
- packaged artifact path
- signing status note

## Exit criteria

A release candidate is ready for Windows acceptance only when:

1. every supported install source has at least one clean-machine pass
2. first launch, DB connect, audit/privacy, update, and uninstall all pass
3. AI behavior is either validated or intentionally declared unavailable
4. evidence is complete enough for another reviewer to retrace the result

If any row is blocked, keep the row open and link the blocker into the release validation report rather than marking partial success as complete.
