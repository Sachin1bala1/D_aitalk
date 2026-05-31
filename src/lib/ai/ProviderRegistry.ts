/**
 * ProviderRegistry — factory that returns the active AIProvider instance.
 * Reads from ProviderSettings (localStorage). Caches instances per key+model.
 */
import { ClaudeProvider } from "./providers/ClaudeProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { OllamaProvider } from "./providers/OllamaProvider";
import type { AIProvider, ProviderSettings } from "./types";
import { PROVIDER_CATALOG } from "./types";

export function getProvider(settings: ProviderSettings): AIProvider | null {
  const { activeProvider, keys } = settings;

  if (activeProvider === "ollama") return new OllamaProvider();

  const apiKey = keys[activeProvider] ?? "";

  if (activeProvider === "gemini") {
    // OAuth access token takes priority over API key
    const accessToken = (keys as Record<string, string | undefined>)["gemini_access_token"];
    if (accessToken) return new GeminiProvider({ accessToken });
    if (apiKey) return new GeminiProvider({ apiKey });
    return null;
  }

  if (!apiKey) return null;

  const meta = PROVIDER_CATALOG.find((p) => p.id === activeProvider);

  switch (activeProvider) {
    case "claude":
      return new ClaudeProvider(apiKey);
    case "openai":
      return new OpenAIProvider(apiKey, "openai");
    case "nvidia":
      return new OpenAIProvider(apiKey, "nvidia", meta?.baseURL);
    default:
      return null;
  }
}
