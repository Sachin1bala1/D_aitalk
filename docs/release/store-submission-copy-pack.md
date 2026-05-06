# Store Submission Copy Pack

Last updated: 2026-05-01

## Purpose

Use this document as a drafting pack for Microsoft Store listing text, Partner Center notes, and closely related release copy.

This copy is intentionally:

- concise
- production-oriented
- aligned with the current implementation
- written to avoid promising unsupported browser-mode behavior

Adjust only for character limits, tone, or final product positioning. Do not broaden claims unless the implementation changes first.

## Positioning guardrails

Keep these points true in any final submission text:

- Daitalk is a desktop-first database and analysis application
- native database access is available in the installed desktop app, not browser preview mode
- AI-assisted features are optional and provider-dependent
- destructive AI-assisted actions require user approval before execution
- local history, telemetry, benchmark, and audit data can be reviewed and cleared by the user

## Short description options

Use one of these for short Store-facing descriptions, then trim for character limits if required.

### Option A

> Desktop SQL and database analysis workspace with AI-assisted workflows, schema tools, dashboards, and local safety controls.

### Option B

> Explore databases, run SQL, inspect schema, build dashboards, and use optional AI assistance in a desktop-first workspace.

### Option C

> A Windows desktop database workspace for SQL, schema exploration, AI-assisted analysis, dashboards, and local audit controls.

## Long description building blocks

Use these as modular bullets or paragraph inputs for the full Store listing.

### Product summary

> Daitalk is a desktop database workspace for running SQL, exploring schemas, reviewing results, building dashboards, and using optional AI-assisted analysis tools. It is designed for local desktop use rather than browser-only database access.

### Core capabilities

- Connect to supported databases from the desktop app
- Run SQL queries and inspect results in a workspace built for iterative analysis
- Explore schemas, table structure, and related metadata
- Build dashboard tabs from query results for reusable visual analysis
- Use optional AI-assisted workflows to help draft or organize analysis tasks

### Safety-oriented capabilities

- Supports read-only connections for safer exploration
- Requires explicit approval before destructive AI-assisted actions execute
- Records local security audit events for important denials, approvals, and blocked actions
- Lets users inspect and clear local history, telemetry, benchmarks, and audit data

### Desktop-first wording

> Native database connectivity is available in the installed desktop application. Browser preview mode is intended for UI development and preview only and does not provide native database access.

## Privacy-facing summary text

Use this in Store privacy fields, support copy, or in-app release notes where a compact privacy explanation is required.

> Daitalk stores query history, local analytics and telemetry, benchmark records, security audit events, and saved connection metadata on the device so the app can restore workspaces and provide local analysis features. Query history redacts string literals before storage. Saved provider keys are stored using operating-system secure credential storage rather than ordinary history tables. Users can review and clear local history, telemetry, benchmark, and audit data from the app's Safety & Local Data controls.

## Desktop-only limitations copy

Use this wherever submission, support, or release notes need an explicit limitation statement.

### Browser preview limitation

> Browser preview mode does not include native database connectivity. Database access is available in the installed desktop application.

### Desktop requirement wording

> Some core capabilities, including native database access and other OS-integrated desktop behavior, require the Windows desktop app and are not available in browser preview mode.

## AI, provider, and network disclosure wording

Use these blocks when Store submission or product copy needs to explain optional AI behavior.

### AI feature summary

> Daitalk includes optional AI-assisted features that can help organize or draft analysis tasks. These features are not required for general local app use.

### Provider/network disclosure

> When AI features are enabled by the user, Daitalk may contact supported AI providers or local inference endpoints. Current supported destinations may include local Ollama endpoints on `localhost` or `127.0.0.1`, OpenAI (`api.openai.com`), Anthropic (`api.anthropic.com`), Google Gemini (`generativelanguage.googleapis.com`), and NVIDIA hosted inference (`integrate.api.nvidia.com`).

### User-control wording

> AI-assisted actions that could change data or schema are intended to require explicit user approval before execution.

### Non-AI fallback wording

> Daitalk can still be used for local SQL, schema exploration, and result review without configuring hosted AI providers.

## Submission-ready bullet list

Use this when you need a compact scannable section in Partner Center notes or listing support text.

- Desktop-first SQL and database analysis workspace
- Native database access available in the installed Windows app
- Optional AI-assisted workflows with approval for destructive actions
- Local query history, telemetry, benchmarks, and audit visibility
- Local data review and clearing controls included in the app
- Hosted AI provider access is optional and user-configured

## Copy that should not be used

Do not claim any of the following unless the implementation changes first:

- browser mode supports native database access
- all app features work offline regardless of provider configuration
- AI features execute destructive changes automatically
- no local activity data is stored on-device
- the app never contacts external services under any configuration

## Final submission checklist for copy owners

Before freezing Store text:

1. Confirm the final copy still matches [privacy-disclosure-checklist.md](./privacy-disclosure-checklist.md)
2. Confirm listed provider endpoints still match the production CSP allowlist
3. Confirm desktop-only limitations are stated wherever browser-preview confusion would matter
4. Confirm no copy implies destructive AI execution without approval
5. Confirm no copy promises unsupported data handling or retention behavior
