# Privacy Disclosure Checklist

Last updated: 2026-05-01

## Goal

Ensure Daitalk's Windows release accurately discloses what data is stored locally, what is redacted, what users can clear, and which network destinations may be contacted during normal use.

## Release claims that must be true

Before shipping or submitting to the Store, the team should be able to truthfully state:

- database access happens only in the desktop app
- plaintext API keys are not exposed through a general renderer readback flow
- destructive AI actions require explicit approval before execution
- local history and audit data can be inspected and cleared by the user
- stored query history redacts string literals before persistence

## Store-facing privacy summary template

Use this as the short-form listing or in-app privacy summary, then tailor only for tone and character limits:

> Daitalk stores query history, local analytics, benchmark records, security audit events, and saved connection metadata on the device so the app can restore workspaces, provide local intelligence features, and show recent activity. Query history redacts string literals before storage. Saved provider keys are stored in the operating system's secure credential storage rather than ordinary history tables. Users can review and clear local history, telemetry, benchmarks, and security audit data from the app's Safety & Local Data controls.

## Store-facing local-data wording templates

### What is stored locally

Use this when the Store listing or privacy page asks what data the app saves on-device:

> Daitalk stores local query history, visualization and intelligence telemetry, benchmark records, security audit events, and saved connection metadata on the device. This data is used for local workspace continuity, analytics features, benchmarking, and security/audit visibility.

### What is redacted

Use this when describing query-history protection:

> Daitalk redacts string literals before storing query history locally. This reduces the chance that sensitive values entered directly into queries are persisted in plain form inside the local history store.

### What users can clear

Use this for Settings or listing text about user controls:

> Users can inspect and clear local query history, local telemetry, benchmark records, and security audit data from the app. These controls are available in Safety & Local Data. Clearing one category is intended to remove only that category, not unrelated local data.

### Saved credentials and secrets

Use this when describing provider/API keys and connection secrets:

> Saved provider keys are stored using operating-system secure credential storage. Non-secret connection metadata may be stored locally so saved connection entries can be shown in the app, but ordinary local history tables are not used as a plaintext secret store.

### Desktop-only database access

Use this if the submission or support copy needs to explain the browser/dev-preview limitation:

> Native database access is available in the installed desktop application. Browser preview mode is for UI development and preview only and does not provide native database connectivity.

## Store-facing network disclosure template

Use this for privacy text or support copy that explains outbound connections:

> Daitalk may connect to user-configured databases and, when AI features are enabled by the user, to configured AI providers. Current supported network destinations may include local Ollama endpoints on `localhost` / `127.0.0.1`, OpenAI (`api.openai.com`), Anthropic (`api.anthropic.com`), Google Gemini (`generativelanguage.googleapis.com`), and NVIDIA hosted inference (`integrate.api.nvidia.com`). If these features are not configured or used, those provider requests are not required for normal local app operation.

## Local data inventory

Validate the wording for each category below.

### Query history

- stored locally: yes
- expected contents:
  - query text with string literals redacted before persistence
  - execution metadata
- user clear control exists: yes
- suggested disclosure wording:
  - "Query history is stored locally to restore recent work. String literals are redacted before storage."

### Visualization telemetry

- stored locally: yes
- expected contents:
  - query-linked visualization events
  - chart/view interactions used for local intelligence features
- user clear control exists: yes
- suggested disclosure wording:
  - "Visualization activity used for local analytics features is stored on-device and can be cleared by the user."

### Parameter hotspots / intelligence telemetry

- stored locally: yes
- expected contents:
  - local intelligence and affinity observations
- user clear control exists: yes, as part of telemetry clearing
- suggested disclosure wording:
  - "Local intelligence observations are stored on-device to support analysis features and can be cleared by the user."

### Benchmarks

- stored locally: yes
- expected contents:
  - benchmark records
  - benchmark context metadata
- user clear control exists: yes
- suggested disclosure wording:
  - "Benchmark results and benchmark context are stored locally and can be cleared by the user."

### Security audit events

- stored locally: yes
- expected contents:
  - policy denials
  - approval state changes
  - blocked file/secret actions
- user clear control exists: yes
- suggested disclosure wording:
  - "Security audit events are stored locally to help users review approvals, denials, and blocked actions."

### Saved connection metadata

- stored locally: yes
- expected contents:
  - non-secret metadata needed to restore saved connection entries
- secrets location:
  - operating-system secure credential storage, not ordinary app history tables
- user clear/reset behavior documented: still needs final release wording
- suggested disclosure wording:
  - "Saved connection entries may store non-secret metadata locally. Secrets are intended to remain in secure OS-managed credential storage."

## Submission-ready bullet list template

Use this when Partner Center or support materials need a short, scannable list:

- Stores query history, local telemetry, benchmarks, audit events, and connection metadata on-device
- Redacts string literals before storing query history
- Stores provider keys in operating-system secure credential storage
- Lets users review and clear local history, telemetry, benchmarks, and audit data
- Contacts only configured databases and supported AI providers that the user enables

## Disclosure copy checklist

The release listing, privacy text, or in-app help should cover:

- what data is stored only on-device
- what is redacted before local persistence
- what can be cleared from the app
- that provider/API keys are stored securely on-device
- what external AI providers or local inference endpoints may be contacted
- that browser preview mode does not provide native database access

## Retention checklist

Decide and document whether each category has:

- manual clear only
- default age-based retention
- configurable retention

Recommended minimum policy to define before release:

- query history retention
- security audit retention
- benchmark retention
- saved connection metadata reset behavior

## Verification checklist

Before release:

1. open the in-app Safety & Local Data controls
2. record the exact labels shown to the user
3. compare those labels against the Store/privacy wording
4. verify each clear action removes the promised category
5. verify clearing one category does not silently remove unrelated categories
6. verify the app remains functional after each clear operation
7. confirm the listed provider endpoints still match the production CSP allowlist

## Submission warning signs

Do not finalize privacy wording if any of these remain true:

- storage categories are undocumented
- redaction behavior is unclear
- "clear local data" wording does not match actual behavior
- secrets or connection credentials are still exposed beyond the intended boundary
- listed provider endpoints do not match the actual production networking configuration
