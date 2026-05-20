# Startup Transport Hardening Plan

## Goal

Prevent the Windows WebView message pipe from saturating during app startup and keep the desktop shell responsive before any background automation begins.

## Problems Found

1. The app launches scheduled background agents and pipelines immediately after workspace restore.
2. Those detached jobs use the same query/event transport path as the interactive UI.
3. On Windows, that can flood the WebView `PostMessage` channel before the app is fully interactive.
4. The result is terminal spam like `PostMessage failed ... 0x80070718` and a sluggish startup experience.

## Fix Strategy

### Phase 1: Transport Backpressure
- Reduce streaming burst size by payload bytes as well as row count.
- Add a tiny post-batch pause on Windows so the WebView queue can drain.

### Phase 2: Startup Quiet Period
- Do not run scheduled background agents or pipelines immediately on launch.
- Let the workspace restore and connection recovery finish first.
- Defer the first scheduled detached run until the app has been stable for a short quiet period.

### Phase 3: Future Internal Query Path
- Add a non-streaming internal query command for background agents and pipelines so detached work does not share the UI event channel.
- Keep streaming only for interactive table/result surfaces.

## Success Criteria

- Launching `npm run tauri:dev` no longer floods PowerShell with `PostMessage failed`.
- The app becomes interactive before detached jobs begin.
- Scheduled automation still runs, but only after startup is settled.
