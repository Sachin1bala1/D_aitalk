# Microsoft Store Security / Release Signoff Checklist

Last updated: 2026-05-01

## Purpose

Use this as the final go/no-go checklist before Microsoft Store submission or equivalent Windows release signoff. This is the concise gate list. Detailed procedures and wording live in the other `docs/release` documents.

## How to use this checklist

For each gate below, record one of:

- pass
- blocked
- not applicable

A release is not ready for signoff if any required gate is still `blocked`.

## Gate 1: CSP and network boundary

- production CSP is set separately from dev CSP
- production `connect-src` matches only supported release endpoints
- any localhost / Ollama allowance is an intentional release decision
- Store-facing network disclosure matches the production CSP allowlist
- no known release blocker remains around unexpected outbound destinations

Evidence:

- [microsoft-store-msix.md](./microsoft-store-msix.md)
- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)

## Gate 2: Command policy enforcement

- sensitive Tauri commands are classified and reviewed
- mutation, schema, secret, and file-sensitive commands are policy-gated
- read-only protections are enforced in the backend, not just the UI
- destructive AI actions require explicit approval before execution
- no open exception remains for high-risk command paths

Evidence:

- [../tauri-command-inventory.md](../tauri-command-inventory.md)
- [../store-readiness-audit.md](../store-readiness-audit.md)

## Gate 3: Local data and privacy controls

- Store/privacy wording accurately describes local data categories
- query history redaction behavior is still true in the current release
- users can inspect and clear the promised local data categories
- saved secrets are not described in a way that overstates protection
- saved connection metadata behavior is documented accurately

Evidence:

- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
- [store-submission-copy-pack.md](./store-submission-copy-pack.md)

## Gate 4: Auditability and user-visible safety controls

- security-relevant actions are captured in the local audit trail
- approval / reject / execute paths are auditable for destructive AI flows
- blocked policy decisions are reviewable by the user or operator
- Safety & Local Data controls are present in the release candidate
- no known mismatch remains between audit behavior and release copy

Evidence:

- [validation-report-template.md](./validation-report-template.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)

## Gate 5: Package validation

- packaging was performed from an approved packaging machine or VM
- preflight output was captured for the exact release candidate
- install, first launch, update, and uninstall were validated on a clean machine
- privacy and local-data controls were validated on the packaged app, not only in dev
- no unresolved install/update/uninstall blocker remains

Evidence:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)

## Gate 6: Signing and distribution path

- Store package identity and publisher identity are confirmed
- signing approach is confirmed for the chosen distribution path
- if distributing outside the Store, signing expectations are documented separately
- final package path, signing state, and artifact version are recorded
- release handoff packet includes the evidence required for submission or transfer

Evidence:

- [windows-signing-notes.md](./windows-signing-notes.md)
- [ci-signing-matrix.md](./ci-signing-matrix.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [release-handoff-template.md](./release-handoff-template.md)

## Required signoff bundle

Do not approve release signoff without these artifacts:

- final packaged artifact path
- preflight report
- packaging-machine manifest
- validation report
- final privacy/listing copy source
- signing confirmation or Store packaging note
- submission owner and release owner names

## Final signoff decision

Record explicitly:

- release version:
- signoff date:
- release owner:
- submission owner:
- final decision: `approved` / `blocked`
- blocking notes:

## Stop signs

Do not sign off if any of these are still true:

- production CSP is broader than the documented release network policy
- command policy coverage has unresolved high-risk gaps
- privacy text does not match actual local storage behavior
- audit trail or clear-data controls are missing from the release candidate
- packaging validation was done only in a dev environment
- signing/distribution evidence is incomplete
