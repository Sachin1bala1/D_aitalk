# Microsoft Store Candidate Smoke Guide

Last updated: 2026-05-01

## Goal

Provide the fastest manual validation path for a packaged Microsoft Store candidate after install on a clean Windows machine.

Use this guide for the first packaged-app confidence pass. Use the broader documents for full release evidence and lifecycle coverage:

- [windows-install-lifecycle-checklist.md](./windows-install-lifecycle-checklist.md)
- [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
- [validation-report-template.md](./validation-report-template.md)

## Scope

This smoke pass covers only the highest-signal release checks:

1. first launch succeeds
2. no developer-only hints appear
3. the connection dialog opens
4. a read query succeeds
5. Safety & Local Data controls are reachable
6. an AI-driven destructive action still requires approval

It is intentionally short. Do not treat it as a replacement for update, uninstall, or full privacy validation.

## Preconditions

- test the packaged desktop app, not `tauri dev`
- use a clean Windows machine or disposable VM
- install from the Store-equivalent candidate path or final MSIX candidate
- have one safe test database available
- have one AI provider configured only if the candidate is expected to support AI during validation

## Fast smoke flow

### 1. Launch the installed app

Expected result:

- app opens without crash or blank screen
- branding and window title look like a release build
- no developer console, Vite URL, localhost banner, or dev-only warning is visible

Stop here if:

- the app crashes
- the UI is blank
- any obvious dev-time hint appears in the release UI

Evidence:

- one screenshot of the first successful launch
- exact error text if launch fails

### 2. Open the connection dialog

Expected result:

- the connection dialog opens cleanly
- release UI text looks user-facing, not developer-facing
- no browser-mode or dev-mode hint appears in the packaged desktop app

Evidence:

- screenshot of the open connection dialog

### 3. Connect and run one read query

Recommended minimum query:

```sql
SELECT 1 AS smoke_test;
```

If your release-safe test database requires a real table, use a simple read-only query instead.

Expected result:

- connection succeeds
- query executes successfully
- result rows render in the normal results UI
- no mutation prompt appears for a read query

Evidence:

- screenshot of the successful query result
- note of the exact query used

### 4. Open Safety & Local Data

Expected result:

- the Safety & Local Data surface is reachable from the packaged app
- local-data counts load
- recent audit data loads if present
- the UI does not look like a hidden debug-only tool

Optional quick follow-up:

- test one low-risk clear action only if the release plan expects this during smoke validation

Evidence:

- screenshot of the Safety & Local Data dialog
- note whether counts loaded successfully

### 5. Confirm AI destructive approval behavior

Goal:

- verify that a risky AI-assisted action does not execute immediately

Recommended approach:

- use the AI panel to request a clearly destructive action such as deleting rows or making a schema-changing change in the test context
- do not approve execution yet

Expected result:

- the action is queued, blocked, or presented for explicit approval
- it does not execute immediately on its own

If AI is intentionally unavailable in this candidate:

- record that the feature is unavailable
- verify the unavailable state is clear and safe

Evidence:

- screenshot of the approval queue, approval-required state, or safe unavailable message
- short note describing the prompt or action requested

## Pass / fail rule

Mark the smoke pass as failed if any of these are true:

- first launch fails
- dev-only hints appear in the packaged release UI
- the connection dialog does not open
- the read query fails for app reasons rather than test-environment issues
- Safety & Local Data is unreachable
- a destructive AI action executes without explicit approval

## Minimum evidence bundle for this smoke pass

- first-launch screenshot
- connection-dialog screenshot
- successful read-query screenshot
- Safety & Local Data screenshot
- AI approval-state screenshot or safe-unavailable screenshot
- exact query used
- exact test machine identity
- candidate artifact version

## Where to record results

- enter the result into the active validation report
- map the candidate and machine coverage in [clean-machine-validation-matrix.md](./clean-machine-validation-matrix.md)
- if any step fails, classify it with [release-blocker-triage-guide.md](./release-blocker-triage-guide.md)
