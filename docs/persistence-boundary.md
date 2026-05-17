# Persistence Boundary

Last updated: 2026-05-17
Status: Active production behavior

## Goal

Keep product-critical state in native Tauri-backed storage, while limiting browser `localStorage` to migration and narrow device-local fallback behavior.

## Native-backed canonical state

The following are the source of truth in desktop builds:

- workspace session snapshots
- artifacts, revisions, and artifact heads
- AI session state and task checkpoints
- query history
- snippets
- chart presets
- pipeline definitions and runs
- background-agent definitions, runs, approvals, and environments
- workspace rules
- user tools
- app preferences
  - onboarding dismissed
  - onboarding tour completed
  - object-properties panel height
- provider/model preferences

Persistence path:

- frontend JSON helpers in [src/lib/persistence/NativeJsonStore.ts](C:/Users/sachi/OneDrive/Desktop/Daitalk/daitalk-v2/daitalk-v2/src/lib/persistence/NativeJsonStore.ts)
- Tauri commands in [src-tauri/src/commands/persistence.rs](C:/Users/sachi/OneDrive/Desktop/Daitalk/daitalk-v2/daitalk-v2/src-tauri/src/commands/persistence.rs)

## Keychain-only state

Secrets do not use app JSON storage:

- AI provider API keys
- database credentials stored through the credential/keychain flows

## Allowed `localStorage` usage

`localStorage` is now limited to:

1. legacy migration input
   - older saved preferences
   - older provider settings
   - older store payloads that are upgraded into native storage

2. degraded fallback when native persistence is unavailable
   - the app emits a warning through `notifyNativePersistenceFallback(...)`
   - fallback is best-effort, not the preferred production path

## Trust model

- restored query tabs may represent snapshots until rerun
- restored interrupted AI work is resumed as checkpointed context, not live execution
- native persistence failures should degrade visibly rather than silently

## Practical rule

If a feature is important to a user after an app restart, it should be native-backed unless it is a secret that belongs in the keychain.
