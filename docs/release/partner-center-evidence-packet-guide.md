# Partner Center Evidence Packet Guide

Last updated: 2026-05-01

## Purpose

Use this guide to assemble the final internal evidence packet for a Microsoft Partner Center submission. This packet is the release-side proof bundle that shows the candidate was packaged, validated, reviewed, and approved before submission.

This guide is intentionally concise. Use it together with:

- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [release-execution-runbook.md](./release-execution-runbook.md)

## What this packet is

The evidence packet is the internal submission bundle that should be attached to the release ticket, handoff record, or controlled release folder before the Partner Center operator starts the final submission.

It should answer four questions without relying on terminal scrollback or chat history:

1. What exact build is being submitted?
2. Was that build packaged and validated on an acceptable Windows machine?
3. Do the privacy, audit, and safety claims still match the build?
4. Who approved submission?

## Packet owner and signoff roles

These roles may be combined in a small team, but they must still be named explicitly.

| Role | Required for packet closeout | What they confirm |
| --- | --- | --- |
| Release owner | Yes | the candidate version, artifact path, and release decision are correct |
| QA reviewer | Yes | install, launch, update, uninstall, and smoke validation were completed |
| Security reviewer | Yes | privacy, audit, CSP/network, and command-safety claims are still true |
| Submission owner / Partner Center operator | Yes | Store metadata is complete and the final packet is sufficient to submit |

If a role is not used for a given release, record `not applicable` with a reason. Do not leave the role implied.

## Exact artifacts to include

Attach or link these exact artifacts in the packet.

### Required

1. Final package artifact path
   - exact MSIX or Store candidate artifact path
   - include version and candidate label
2. Packaging-machine manifest
   - latest `docs/release/reports/packaging-machine-manifest-*.md`
3. Preflight report
   - latest `docs/release/reports/preflight-*.md`
4. Validation report
   - release-specific report created from [validation-report-template.md](./validation-report-template.md)
5. Screenshot or evidence folder path
   - install, launch, update, uninstall, and user-visible validation captures
6. Final Store copy source
   - final source path or frozen excerpt derived from [store-submission-copy-pack.md](./store-submission-copy-pack.md)
7. Privacy/disclosure source
   - completed notes or final source tied to [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
8. Signoff record
   - names, dates, and status for release owner, QA reviewer, security reviewer, and submission owner

### Required when applicable

- signing confirmation or signing report
  - required for non-Store signed distribution
  - include when Store submission workflow also uses local signing evidence
- source-machine handoff evidence
  - include source preflight and source manifest when packaging moved across machines
- blocker log or exception note
  - include any explicit risk acceptance, packaging exception, or WDAC/AppLocker handling note

## What to attach to Partner Center vs keep internal

### Attach to the internal release packet

- package artifact path
- packaging-machine manifest
- preflight report
- validation report
- screenshot/evidence folder path
- signing evidence if used
- privacy/listing copy source
- final signoff record

### Use during Partner Center submission

- final app name and descriptions
- screenshots and listing assets
- support URL
- privacy policy URL
- release notes / what's new
- any required disclosure text

The packaging-machine manifest, preflight report, and most internal validation notes are usually internal release evidence, not public Store listing content.

## Recommended packet folder shape

Use one release-specific folder, ticket, or handoff record that contains or links to everything in one place.

Suggested layout:

```text
release-<version>-<candidate>/
  package-path.txt
  signoff.md
  submission-notes.md
  screenshots/
  reports/
    packaging-machine-manifest-<timestamp>.md
    preflight-<timestamp>.md
    validation-report-<version>-<timestamp>.md
```

If your team stores evidence in a ticket instead of a filesystem folder, keep the same logical grouping and copy the exact paths.

## Assembly order

Build the packet in this order:

1. Freeze the candidate identity
   - version
   - candidate label
   - package artifact path
2. Attach packaging evidence
   - packaging-machine manifest
   - preflight report
3. Attach validation evidence
   - validation report
   - screenshot/evidence folder
4. Attach submission-facing copy sources
   - final listing copy source
   - privacy/disclosure source
5. Record signoff names and statuses
6. Mark final packet state as:
   - `ready for Partner Center`
   - `blocked`
   - `internal review only`

Do not wait until submission day to reconstruct paths or screenshots from memory.

## Minimum signoff block

Copy this into the release ticket or handoff note:

```md
- Release version:
- Candidate label:
- Package artifact path:
- Preflight report path:
- Packaging-machine manifest path:
- Validation report path:
- Screenshot/evidence folder:
- Final listing copy source:
- Final privacy/disclosure source:

- Release owner: <name> | approved / pending / blocked | <date>
- QA reviewer: <name> | approved / pending / blocked | <date>
- Security reviewer: <name> | approved / pending / blocked | <date>
- Submission owner: <name> | approved / pending / blocked | <date>

- Final packet state: ready for Partner Center / blocked / internal review only
- Blocking notes:
```

## Packet completion criteria

The evidence packet is complete only when:

- the artifact path points to the exact candidate being submitted
- the preflight and manifest were generated for the relevant packaging machine/workspace
- validation was performed against the packaged build, not only dev mode
- privacy and Store copy sources are frozen for this candidate
- all required signoff roles are explicitly named
- no unresolved blocker remains hidden outside the packet

## Related documents

- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
- [release-handoff-template.md](./release-handoff-template.md)
- [validation-report-template.md](./validation-report-template.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
