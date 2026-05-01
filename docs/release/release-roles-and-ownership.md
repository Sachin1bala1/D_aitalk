# Release Roles and Ownership

Last updated: 2026-05-01

## Purpose

Use this guide to make release work explicit for a small team. It defines who owns packaging, validation, security signoff, Store submission, and post-release incident triage so release decisions do not depend on memory or chat history.

This guide is concise by design. Use it with:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
- [partner-center-evidence-packet-guide.md](./partner-center-evidence-packet-guide.md)
- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)

## Small-team role model

These roles may be combined in a small team, but they should still be named separately in the release ticket or evidence packet.

| Role | Primary ownership | Backup ownership |
| --- | --- | --- |
| Release owner | coordinates the candidate, packaging handoff, evidence bundle, and go/no-go state | backup release owner |
| QA reviewer | validates install, launch, update, uninstall, and smoke checks on the packaged build | release owner if no separate QA reviewer is available |
| Security reviewer | verifies privacy, audit, CSP/network, and command-safety claims before signoff | release owner only if no independent security reviewer exists |
| Submission owner | completes Partner Center metadata, final packet review, and Store submission | release owner |
| Incident triage owner | receives post-release incidents, classifies severity, and routes follow-up work | release owner |

If one person holds more than one role, record that explicitly. Do not leave any release role implied.

## Ownership by release stage

### 1. Packaging

Primary owner:
- Release owner

What they own:
- choose the candidate commit or version
- stage the non-OneDrive handoff workspace
- run preflight and packaging from the approved machine or VM
- capture the packaging-machine manifest and preflight report
- stop the attempt if packaging hits a machine-policy blocker such as `os error 4551`

Required evidence:
- package artifact path
- packaging-machine manifest
- preflight report

Use with:
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)

### 2. Validation

Primary owner:
- QA reviewer

What they own:
- validate the packaged build, not only a dev build
- run clean install, first launch, update, and uninstall checks
- perform smoke verification for core user flows such as DB connect, query execution, AI/provider gating, and privacy/error states
- fill the release validation report with evidence and blocker status

Required evidence:
- completed validation report
- screenshots or capture folder
- machine identity and tester identity

Use with:
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
- [validation-report-template.md](./validation-report-template.md)

### 3. Security signoff

Primary owner:
- Security reviewer

What they own:
- confirm release claims still match the shipped build
- verify privacy/local-data wording, auditability, command-policy expectations, and production CSP/network boundaries
- review any release exceptions, manual risk acceptance, or packaging-policy notes
- block signoff if product behavior and release claims disagree

Required evidence:
- completed signoff checklist
- privacy disclosure source
- any blocker or exception note

Use with:
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)

### 4. Store submission

Primary owner:
- Submission owner

What they own:
- final Store metadata values
- final listing copy and policy-facing descriptions
- last review of the internal evidence packet before Partner Center submission
- submission status and any Store review follow-up

Required evidence:
- final metadata file or approved values
- final Store copy source
- internal evidence packet

Use with:
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [partner-center-evidence-packet-guide.md](./partner-center-evidence-packet-guide.md)
- [store-submission-copy-pack.md](./store-submission-copy-pack.md)

### 5. Post-release incident triage

Primary owner:
- Incident triage owner

What they own:
- receive production issues after release
- classify whether the problem is packaging, validation escape, privacy/security mismatch, or Store-submission fallout
- assign the next action owner and response timeline
- decide whether the issue needs hotfix, documentation correction, rollback, or support guidance

Use this ownership split:
- packaging or install failures: release owner
- validation escape or user-visible defect: QA reviewer plus release owner
- privacy, audit, CSP, or policy mismatch: security reviewer
- Store listing or submission issue: submission owner

Required evidence:
- incident summary
- severity and impact
- owner for follow-up
- link to the release evidence bundle for the affected version

Use with:
- [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)
- [release-handoff-template.md](./release-handoff-template.md)

## Recommended approval chain

Use this order for a normal release:

1. Release owner confirms packaging is complete and evidence is captured.
2. QA reviewer signs off on packaged-build validation.
3. Security reviewer signs off on privacy, audit, and command-safety alignment.
4. Submission owner confirms the evidence packet is complete and submits to Partner Center.

If any step is blocked, stop the chain there and record the blocker owner explicitly.

## Minimum named owners per release

Every release record should name:

- release owner
- QA reviewer
- security reviewer
- submission owner
- post-release incident triage owner

If one person covers multiple roles, list the same name multiple times instead of collapsing the roles.

## What this guide does not replace

This guide does not replace:

- the packaging runbook
- the validation report
- the signoff checklist
- the Partner Center submission checklist

It only makes ownership explicit across those existing release artifacts.
