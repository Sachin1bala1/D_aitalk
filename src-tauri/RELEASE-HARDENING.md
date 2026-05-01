## Release hardening notes

This directory intentionally separates development and production CSP behavior.

- `app.security.devCsp`
  - allows the Vite dev server (`http://localhost:1420`, `ws://localhost:1420`)
  - keeps the same packaged-app provider endpoints as production
  - keeps local Ollama connectivity available in development
- `app.security.csp`
  - removes the dev server origins
  - keeps only packaged-app origins plus the app's current runtime network dependencies

Current production `connect-src` assumptions:

- `'self'`
- local Ollama on `http://127.0.0.1:11434` and `http://localhost:11434`
- Tauri IPC hosts
- OpenAI API on `https://api.openai.com`
- Anthropic API on `https://api.anthropic.com`
- Gemini Developer API on `https://generativelanguage.googleapis.com`
- NVIDIA NIM on `https://integrate.api.nvidia.com`

Audit basis for the current production allowlist:

- `src/lib/ai/providers/OpenAIProvider.ts`
  - uses the OpenAI SDK default host `https://api.openai.com/v1`
- `src/lib/ai/providers/ClaudeProvider.ts`
  - uses the Anthropic SDK default host `https://api.anthropic.com`
- `src/lib/ai/providers/GeminiProvider.ts`
  - uses `@google/genai`; the installed SDK defaults to `https://generativelanguage.googleapis.com`
- `src/lib/ai/types.ts`
  - hardcodes NVIDIA NIM to `https://integrate.api.nvidia.com/v1`
  - hardcodes Ollama to `http://127.0.0.1:11434/v1`

Remaining production-network decisions:

- If the app later adds Vertex AI / Google Cloud-hosted Gemini, the CSP will need additional Google API hosts such as `aiplatform.googleapis.com`.
- If any provider flow adds browser-initiated uploads, files, or websocket transports, those exact origins must be reviewed before widening `connect-src`.

Release checklist before Store submission:

1. Re-test packaged builds after any CSP change, especially OpenAI, Anthropic, Gemini, NVIDIA, and local Ollama provider flows.
2. Keep `app.security.capabilities` explicit so new capability files are not included by accident.
3. Re-run this allowlist audit whenever a provider base URL changes or a new remote integration lands.
4. Keep downgrade installs disabled unless there is a deliberate servicing reason to allow them.
