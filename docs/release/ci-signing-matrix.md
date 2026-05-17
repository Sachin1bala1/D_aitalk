# Windows CI and Signing Matrix

Last updated: 2026-05-01

## Goal

Define a practical release-operations split for Windows packaging so Daitalk can be built, signed, validated, and submitted without spreading signing authority or release secrets too broadly.

This document stays aligned with the current PowerShell release flow:

- `scripts/windows-release-preflight.ps1`
- `scripts/windows-secure-build.ps1`
- `scripts/sign-windows-artifacts.ps1`
- `scripts/new-release-validation-report.ps1`

It does **not** require a specific CI vendor. Treat the environment names and stages below as the minimum structure a CI/CD system, protected build workstation, or hybrid release process should implement.

## Operating model

Use separate environments for:

1. ordinary development verification
2. release preflight and packaging
3. signing
4. clean-machine validation
5. Store submission

Do not combine signing, packaging, and submission into one unrestricted operator session.

## Environment matrix

| Stage | Suggested environment name | Runs from | Primary scripts | Secrets allowed | Who should have access | Decision gate |
| --- | --- | --- | --- | --- | --- | --- |
| Dev verification | `dev-checks` | developer machine or normal CI | `npm run lint`, `npm test`, `cargo check`, `cargo test --lib` | none | all engineers | code is buildable, type-safe, and covered by the minimum automated gates |
| Release preflight | `release-preflight` | approved Windows packaging workspace, non-OneDrive | `windows-release-preflight.ps1 -WriteReport` | none | release owner, backup release owner | workspace, docs, tools, and artifact paths are acceptable |
| Unsigned packaging | `release-build` | approved Windows packaging machine or protected Windows runner | `windows-secure-build.ps1` | none by default | release owner, release engineering | release artifact builds successfully and matches intended version |
| Signing | `release-signing` | protected Windows environment only | `windows-secure-build.ps1 -Sign` or `sign-windows-artifacts.ps1` | signing certificate reference, timestamp access | minimum number of release managers; no general developer access | only approved release candidates can be signed |
| Validation | `release-validation` | clean Windows VM or test machine | `new-release-validation-report.ps1` plus install lifecycle checklist | none | QA reviewer, release owner | install, launch, update, and uninstall are verified |
| Submission | `store-submit` | Partner Center operator session | release docs and evidence bundle | Partner Center credentials only | release owner or publishing owner | all required evidence and policy reviews are complete |

## Required environment variables

These variables are already implied by the current scripts and should be treated as the release baseline.

| Variable | Required in | Secret | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `CARGO_TARGET_DIR` | `release-build`, `release-signing` | no | keeps bundle output in an approved path | the scripts default this if not supplied, but CI should set it explicitly |
| `WINDOWS_SIGN_CERT_SHA1` | `release-signing` only | sensitive operational data | identifies the certificate used by `signtool.exe` | required by `sign-windows-artifacts.ps1`; do not expose in developer environments |

## Secret-handling rules

### Allowed in ordinary CI

- no signing certificate material
- no Partner Center credentials
- no release-publisher credentials

Ordinary CI should prove the app builds and passes checks. It should not be able to mint trusted Windows artifacts.

### Allowed in signing

- certificate thumbprint via `WINDOWS_SIGN_CERT_SHA1`
- access to the certificate store or signing provider already installed on the protected machine

The current signing script uses `signtool.exe sign /sha1 ...`, which means the private key should remain managed by the Windows certificate store, HSM-backed provider, or approved signing service on the protected machine. Do not export private keys into repo files, unprotected environment variables, or general-purpose developer laptops.

### Allowed in submission

- Partner Center credentials
- release notes and listing assets

Partner Center credentials should not be shared with the signing environment unless the same operator role is explicitly approved to both sign and submit.

## Protected-environment guidance

### `release-build`

Requirements:

- Windows machine or Windows CI runner
- non-OneDrive workspace path
- approved `CARGO_TARGET_DIR`
- Rust, Node, npm, and Tauri packaging prerequisites installed
- no signing secrets required

Recommended restriction:

- only release owners and release engineering can trigger packaging jobs from release branches or release tags

### `release-signing`

Requirements:

- all `release-build` requirements
- `signtool.exe` present
- certificate material available through an approved machine or provider
- `WINDOWS_SIGN_CERT_SHA1` configured

Recommended restriction:

- require protected environment approval before the signing step runs
- do not allow signing from pull requests or unreviewed branches
- do not allow ad hoc signing from developer feature branches

### `release-validation`

Requirements:

- clean machine or disposable VM
- no developer toolchain assumptions
- access to the signed artifact and validation report template

Recommended restriction:

- validation should be run by someone other than the packager when possible

## Role access model

Use the smallest practical set of release roles.

### Engineers

Should have:

- source access
- normal CI access
- local build/test access

Should not have by default:

- signing environment access
- Store submission credentials

### Release owner

Should have:

- preflight and release-build access
- access to release evidence bundle
- permission to request signing and submission

May have:

- signing access, but only if your team is small and this is explicitly approved

### Security reviewer

Should have:

- read access to release evidence
- access to policy, privacy, and command-surface review docs

Should not need:

- direct signing access

### QA reviewer

Should have:

- access to artifacts and validation templates
- clean-machine execution access

Should not need:

- signing secrets

### Publisher / Partner Center operator

Should have:

- submission credential access
- final listing asset access

Should not need:

- certificate private-key access if signing is already complete

## Release-stage decision gates

Use explicit go/no-go gates. Do not carry the release forward just because the previous step completed.

### Gate 1: Preflight pass

Must be true:

- required docs exist
- workspace is not the final release build under OneDrive
- core tooling is present
- warnings are understood and accepted or fixed

Block release if:

- preflight identifies missing core tooling
- required release docs are missing
- packaging workspace or artifact path is obviously wrong

### Gate 2: Unsigned package pass

Must be true:

- `windows-secure-build.ps1` completes
- artifact path is recorded
- version and identity match the release plan

Block release if:

- packaging only works on a developer-specific machine state
- output version does not match the release plan
- release package still depends on dev-only URLs or settings

### Gate 3: Signing approval

Must be true:

- release candidate was reviewed
- signing request is tied to one exact artifact set
- signing environment approval is granted

Block release if:

- artifact provenance is unclear
- the build has not been validated as the intended release candidate
- the signer cannot verify which exact package is being signed

### Gate 4: Validation pass

Must be true:

- clean install works
- first launch works without developer tools
- safety and local-data controls are present
- update/uninstall behavior is captured for the release cycle

Block release if:

- clean-machine install fails
- release behavior differs from privacy or safety disclosures
- desktop-only behavior is unclear or misleading

### Gate 5: Submission approval

Must be true:

- Partner Center checklist is complete
- privacy disclosure wording matches real behavior
- screenshots and metadata come from a release-quality build
- final evidence bundle is attached to the release ticket

Block release if:

- listing claims are ahead of implementation
- security/privacy reviewers still have open blockers
- submission depends on undocumented manual steps

## Recommended CI/CD split

If you later automate this in CI, keep the split below:

1. `check`
   - type-check, lint, Rust compile, tests
2. `release-preflight`
   - docs/tooling/workspace verification
3. `release-build`
   - unsigned package generation
4. `release-sign`
   - protected environment only
5. `release-validate`
   - manual or semi-manual clean-machine evidence capture
6. `release-submit`
   - manual approval and Store submission

The current scripts already support this separation. Do not collapse them into one single all-powerful job.

## Minimum evidence retained per release

For each shipped build, keep:

- preflight report
- artifact path and version
- signing confirmation
- validation report
- install/update/uninstall screenshots or evidence references
- Partner Center submission notes
- final decision record: approved, blocked, or deferred

That evidence bundle should be sufficient for a later audit without depending on terminal scrollback or chat history.
