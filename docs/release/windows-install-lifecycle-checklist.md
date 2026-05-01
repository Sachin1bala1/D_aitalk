# Windows Install, Update, and Uninstall Checklist

Last updated: 2026-05-01

## Goal

Validate the full Windows application lifecycle for Daitalk on a clean machine, not a developer workstation with toolchains already installed.

## Test environment

Use at least one clean Windows 11 machine or disposable VM with:

- no Rust toolchain
- no Node.js requirement for end-user install
- normal Windows security defaults
- a standard user account for installation testing where possible

Record:

- Windows version
- install source: Store or packaged MSIX
- app version
- test date
- tester name
- machine or VM identifier

## Clean install checklist

### Installation

- install succeeds without requiring Cargo, Node.js, or admin-only developer tooling
- install does not require disabling Smart App Control, Defender, or Code Integrity
- app shortcut and Start menu entry are created as expected
- app icons and display name are correct

### First launch

- app launches without crash or blank screen
- desktop-only messaging is clear where relevant
- connection dialog opens correctly
- local-data / safety controls are reachable
- no developer-only warnings or localhost references appear in release UI

### Functional smoke test

For the fastest post-install release check, run [microsoft-store-candidate-smoke-guide.md](./microsoft-store-candidate-smoke-guide.md) first, then continue with the broader lifecycle checks below.

- create or load a test connection
- run a read-only query
- open dashboard or table result views
- confirm AI panel behavior is sensible if provider keys are not configured
- confirm destructive AI actions require approval instead of executing immediately

For each section above, capture:

- pass/fail
- a screenshot if user-visible behavior matters
- exact error text if it fails
- whether the behavior matches current release disclosures

## Update checklist

Validate update behavior from an older packaged build to a newer one:

- existing install is detected correctly
- update completes without manual cleanup
- app launches after update
- saved settings that should persist still persist
- security policy settings still behave correctly after update
- local audit/history storage remains readable or migrates cleanly
- version shown to the user is updated

## Repair / reinstall checklist

If the chosen packaging path supports repair or reinstall:

- repair does not remove expected user data unless documented
- reinstall on top of an existing install does not corrupt local storage
- app still launches and loads local data controls correctly

## Uninstall checklist

- uninstall completes successfully
- app binaries are removed
- Start menu entries are removed
- documented residual user data behavior is accurate
- if local app data remains intentionally, that is documented clearly

## Regression watch items

Pay close attention to:

- WebView2 dependency issues
- broken file associations or Start menu entries
- release CSP differences from dev behavior
- missing icons or branding assets
- failures caused by release-only code paths
- privacy controls not matching packaged behavior

## Release sign-off

Do not mark a Windows release ready until at least one clean-machine pass confirms:

1. install works
2. update works
3. uninstall works
4. core query UI works
5. safety/privacy controls are visible and functional

If any section fails, link the failure back to:

- validation report blocker entry
- screenshot or log evidence
- owner for follow-up
