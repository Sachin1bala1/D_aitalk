# Release Blocker Triage Guide

Last updated: 2026-05-01

## Purpose

Use this guide when packaging, validation, or signoff work fails and you need a fast answer to:

- is this a machine blocker, packaging blocker, or signoff blocker?
- should the operator retry, move machines, or stop the release?
- which existing release doc should they use next?

This is a triage page, not a full runbook. Use it together with:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)

## Fast classification

Use this order:

1. If the error mentions `os error 4551`, App Control, Smart App Control, WDAC, or blocked `build-script-build.exe`, treat it as a packaging-machine policy blocker.
2. If the workspace or Cargo target is under OneDrive, treat it as a workspace-location blocker.
3. If preflight warns that `signtool.exe` is missing, decide whether signing is required for this exact release step before continuing.
4. If the build completes but expected bundle files are missing, treat it as a packaging output blocker.
5. If packaging succeeds but privacy text, local-data behavior, or signoff evidence does not match, treat it as a release-signoff blocker.

## Common blockers

| Blocker | Typical signal | What it means | Retry on same machine? | Next action |
| --- | --- | --- | --- | --- |
| Windows App Control / `os error 4551` | `os error 4551`, blocked `build-script-build.exe`, App Control / Smart App Control message | The packaging machine cannot run generated Rust build artifacts | No | Move to an approved packaging VM or request policy exception |
| OneDrive workspace or target path | preflight warns workspace is under OneDrive, paths include `OneDrive`, file lock/copy churn around synced folders | The build path is not suitable for release packaging | No | Restage to a local non-OneDrive path and rerun preflight |
| Missing `signtool.exe` | preflight shows `[WARN] signtool.exe not found` | Signing tools are missing on this machine | Sometimes | Continue only for unsigned Store-prep steps; stop if the current release step requires signing |
| Missing bundle artifacts | build or preflight completes but no `.msix`, `.msixbundle`, `.msi`, or `.exe` appears under `target\\release\\bundle` | Packaging did not produce releasable artifacts yet | Sometimes | Verify the build command, inspect bundle path, rerun preflight with bundle checks, then stop if artifacts are still absent |
| Privacy or signoff mismatch | release copy disagrees with packaged behavior, audit/privacy controls missing, signoff checklist blocked | The product behavior and release claims are out of sync | No | Fix the docs or the app behavior before submission |

## Triage playbooks

### 1. `os error 4551` / App Control / WDAC / Smart App Control

Symptoms:

- `os error 4551`
- `build-script-build.exe` blocked
- Windows Application Control or Smart App Control message

Interpretation:

- this is an environment policy failure
- this is not a normal app-code regression
- repeated build retries on the same blocked machine are low value

Do now:

1. Stop the current packaging attempt.
2. Save the terminal output and current report paths.
3. Confirm the workspace and Cargo target are already outside OneDrive.
4. Move the handoff workspace to an approved packaging VM or machine.
5. If the machine should be allowed, use the policy exception request template.

Use next:

- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)
- [windows-packaging-vm-setup-checklist.md](./windows-packaging-vm-setup-checklist.md)
- [wdac-applocker-exception-request-template.md](./wdac-applocker-exception-request-template.md)
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)

Release decision:

- blocked until packaging runs on an approved machine

### 2. OneDrive path issues

Symptoms:

- workspace path includes `OneDrive`
- Cargo target path includes `OneDrive`
- preflight warns about OneDrive-backed paths
- staged handoff is still under `Desktop` or a synced documents folder

Interpretation:

- the release workspace is in the wrong place
- even if the build starts, this remains a packaging risk

Do now:

1. Stop building from the synced path.
2. Restage the candidate to a local path such as `C:\Users\<user>\Dev\Daitalk\...`.
3. Regenerate the packaging-machine manifest and preflight report from the new location.

Use next:

- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [windows-packaging-machine-spec.md](./windows-packaging-machine-spec.md)

Release decision:

- blocked until the candidate is rebuilt from a non-OneDrive path

### 3. Missing `signtool.exe`

Symptoms:

- preflight warning for `signtool.exe`
- signing step cannot start

Interpretation:

- the machine is missing signing tooling
- this may be acceptable before signing, but not during a signing-required release step

Do now:

1. Determine whether the current step requires signing now.
2. If the current step is Store-prep packaging only, record the warning and continue.
3. If the current step includes signing, stop and move to a signing-capable machine or fix the toolchain there.

Use next:

- [windows-signing-notes.md](./windows-signing-notes.md)
- [ci-signing-matrix.md](./ci-signing-matrix.md)
- [microsoft-store-msix.md](./microsoft-store-msix.md)

Release decision:

- warning if signing is not yet required
- blocked if signing is required in the current step

### 4. Missing bundle artifacts

Symptoms:

- secure build returns without expected package files
- `target\release\bundle` is absent or empty
- preflight with bundle checks fails

Interpretation:

- packaging did not produce distributable output
- signoff and clean-machine validation should not continue

Do now:

1. Confirm the exact `CargoTargetDir` used for the build.
2. Check the expected bundle directory under that target path.
3. Rerun preflight with bundle verification after the build attempt.
4. If artifacts are still missing, treat the release as blocked and inspect build logs before retrying.

Use next:

- [release-execution-runbook.md](./release-execution-runbook.md)
- [packaging-handoff-guide.md](./packaging-handoff-guide.md)
- [validation-report-template.md](./validation-report-template.md)

Release decision:

- blocked until at least one expected release artifact exists and is recorded

### 5. Privacy or signoff mismatches

Symptoms:

- privacy wording does not match actual local-data behavior
- signoff checklist still has blocked gates
- packaged app behavior differs from release copy or audit expectations

Interpretation:

- release evidence is incomplete or inaccurate
- submission should stop even if packaging succeeded

Do now:

1. Identify whether the mismatch is documentation-only or product-behavior-related.
2. If the app behavior changed, fix the app or downgrade the release.
3. If the docs are stale, update the submission/privacy copy before signoff.
4. Re-run the signoff checklist and attach corrected evidence.

Use next:

- [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
- [store-submission-copy-pack.md](./store-submission-copy-pack.md)
- [microsoft-store-signoff-checklist.md](./microsoft-store-signoff-checklist.md)
- [partner-center-submission-checklist.md](./partner-center-submission-checklist.md)

Release decision:

- blocked until product behavior, privacy text, and signoff evidence agree

## When to stop retrying

Stop retrying the same step immediately if:

- `os error 4551` appears again on the same machine
- the workspace is still under OneDrive
- required signing tools are missing for a signing-required step
- no bundle artifacts are produced after a completed packaging attempt
- signoff remains blocked because docs and packaged behavior disagree

At that point, switch from "retry build" to "fix environment" or "fix release evidence".

## Minimum evidence to collect for every blocker

Keep these with the release candidate:

- exact command that was run
- workspace path
- Cargo target path
- terminal error text
- most recent preflight report path
- most recent packaging-machine manifest path
- artifact path if any bundle files were produced

This keeps escalation and handoff work fast and prevents re-triaging from memory.
