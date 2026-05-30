/**
 * Unified AI provider types.
 * Each provider (Claude, Gemini, OpenAI, NVIDIA) implements AIProvider.
 * AgentLoop only talks to this interface.
 */

// ── APEX reasoning types ──────────────────────────────────────────────────────

/** One competing explanation the agent considered. Probabilities across all hypotheses sum to 1.0. */
export interface Hypothesis {
  text: string;
  probability: number;
  evidence_for: string[];
  evidence_against: string[];
}

// ── Conversation history (provider-agnostic) ──────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

/** A single turn in the conversation. Tool results live in "user" turns. */
export interface ConversationTurn {
  role: "user" | "assistant";
  text?: string;
  toolCalls?: ToolCall[];     // populated on assistant turns when Claude/GPT calls a tool
  toolResults?: ToolResult[]; // populated on user turns that are responses to tool calls
}

// ── Tool schema (provider-agnostic) ──────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface UnifiedTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use";
}

export interface AIProvider {
  readonly id: ProviderID;
  readonly name: string;

  /**
   * Stream one assistant turn. Calls onToken for each text chunk.
   * Returns the full text + any tool calls once complete.
   */
  stream(params: {
    system: string;
    history: ConversationTurn[];
    model: string;
    tools: UnifiedTool[];
    onToken: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<StreamResult>;
}

// ── Provider catalog ──────────────────────────────────────────────────────────

export type ProviderID = "claude" | "gemini" | "openai" | "nvidia" | "ollama";

export interface ProviderMeta {
  id: ProviderID;
  name: string;
  icon: string; // emoji fallback
  keyPlaceholder: string;
  keyPrefix: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  /** For NVIDIA / any custom base URL provider */
  baseURL?: string;
  /** Allow user to type a custom model ID */
  allowCustomModel?: boolean;
}

export const PROVIDER_CATALOG: ProviderMeta[] = [
  {
    id: "claude",
    name: "Claude (Anthropic)",
    icon: "⬡",
    keyPlaceholder: "sk-ant-api03-...",
    keyPrefix: "sk-ant",
    defaultModel: "claude-opus-4-6",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6 (best)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (fast)" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (cheapest)" },
    ],
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    icon: "✦",
    keyPlaceholder: "AIzaSy...",
    keyPrefix: "AIza",
    defaultModel: "gemini-2.5-flash",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (best)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast, recommended)" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    icon: "◈",
    keyPlaceholder: "sk-...",
    keyPrefix: "sk-",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o", label: "GPT-4o (best)" },
      { id: "gpt-4o-mini", label: "GPT-4o mini (fast)" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { id: "o3-mini", label: "o3-mini (reasoning)" },
    ],
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    icon: "⬡",
    keyPlaceholder: "nvapi-...",
    keyPrefix: "nvapi-",
    defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
    baseURL: "https://integrate.api.nvidia.com/v1",
    allowCustomModel: true,
    models: [
      { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B (recommended)" },
      { id: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B" },
      { id: "nvidia/nemotron-4-340b-instruct", label: "Nemotron-4 340B" },
      { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
      { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
      { id: "meta/llama-3.2-3b-instruct", label: "Llama 3.2 3B (fast)" },
      { id: "mistralai/mistral-large-2-instruct", label: "Mistral Large 2" },
      { id: "mistralai/mixtral-8x7b-instruct-v0.1", label: "Mixtral 8x7B" },
      { id: "google/gemma-3-27b-it", label: "Gemma 3 27B" },
      { id: "microsoft/phi-3-medium-128k-instruct", label: "Phi-3 Medium 128K" },
      { id: "qwen/qwen3.5-397b-a17b", label: "Qwen 3.5 397B A17B (Alibaba)" },
      { id: "z-ai/glm-4-9b-chat", label: "GLM-4 9B (Z.AI)" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    icon: "⬤",
    keyPlaceholder: "(no key needed)",
    keyPrefix: "",
    defaultModel: "qwen2.5:7b",
    baseURL: "http://127.0.0.1:11434/v1",
    allowCustomModel: true,
    models: [
      { id: "qwen2.5:7b", label: "Qwen 2.5 7B (recommended)" },
      { id: "qwen2.5:14b", label: "Qwen 2.5 14B" },
      { id: "qwen2.5:32b", label: "Qwen 2.5 32B" },
      { id: "llama3.1:8b", label: "Llama 3.1 8B" },
      { id: "llama3.1:70b", label: "Llama 3.1 70B" },
      { id: "mistral-nemo:12b", label: "Mistral NeMo 12B" },
      { id: "deepseek-r1:8b", label: "DeepSeek R1 8B" },
      { id: "phi4:14b", label: "Phi-4 14B (Microsoft)" },
    ],
  },
];

// ── Settings ──────────────────────────────────────────────────────────────────
// Provider selection + model prefs are native-backed, with localStorage kept only
// as a migration/fallback path. API keys live in the OS keychain.

export interface ProviderSettings {
  activeProvider: ProviderID;
  keys: Partial<Record<ProviderID, string>>;
  models: Partial<Record<ProviderID, string>>;
}

const STORAGE_KEY = "daitalk_provider_settings";
const KEYCHAIN_PREFIX = "daitalk_";
// localStorage fallback keys — used when OS keychain is unavailable
const LS_KEY_PREFIX = "daitalk_apikey_";
const LEGACY_KEY_STORAGE: Partial<Record<ProviderID, string>> = {
  nvidia: "nvidia_api_key",
  openai: "openai_api_key",
  claude: "claude_api_key",
  gemini: "gemini_api_key",
};

let cachedSettings: ProviderSettings | null = null;

function readLegacySettings(): ProviderSettings {
  if (typeof window === "undefined") {
    return { activeProvider: "claude", keys: {}, models: {} };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProviderSettings;
      return { ...parsed, keys: {} };
    }
  } catch {}

  return { activeProvider: "claude", keys: {}, models: {} };
}

async function persistProviderPreferences(settings: ProviderSettings) {
  const { saveJsonDocument, notifyNativePersistenceFallback } = await import(
    "../persistence/NativeJsonStore"
  );
  const { keys: _keys, ...prefs } = settings;

  try {
    await saveJsonDocument(STORAGE_KEY, { ...prefs, keys: {} });
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs, keys: {} }));
    }
    notifyNativePersistenceFallback("AI provider preferences");
  }
}

/** Load provider selection + model prefs from the in-memory/native-backed cache. */
export function loadSettings(): ProviderSettings {
  if (cachedSettings) {
    return { ...cachedSettings, keys: {} };
  }

  cachedSettings = readLegacySettings();
  return { ...cachedSettings, keys: {} };
}

/** Load the canonical provider preferences from native storage when available. */
export async function ensureProviderSettingsLoaded(): Promise<ProviderSettings> {
  const legacy = readLegacySettings();
  if (cachedSettings) return { ...cachedSettings, keys: {} };

  try {
    const { loadJsonDocument } = await import("../persistence/NativeJsonStore");
    const stored = await loadJsonDocument<ProviderSettings>(STORAGE_KEY, legacy);
    cachedSettings = { ...stored, keys: {} };

    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) !== null) {
      await persistProviderPreferences(cachedSettings);
    }
  } catch {
    cachedSettings = legacy;
  }

  return { ...cachedSettings, keys: {} };
}

/** Persist provider selection + model prefs to native storage. Keys are NOT saved here. */
export function saveSettings(settings: ProviderSettings): void {
  const { keys: _keys, ...prefs } = settings;
  cachedSettings = { ...prefs, keys: {} };
  void persistProviderPreferences(cachedSettings);
}

/**
 * Load all API keys. Tries OS keychain first, falls back to localStorage.
 * Returns a partial map of providerId → key (only entries that are non-empty).
 */
export async function loadApiKeysFromKeychain(): Promise<Partial<Record<ProviderID, string>>> {
  const { DbClient } = await import("../db/DbClient");
  const ids: ProviderID[] = ["claude", "gemini", "openai", "nvidia", "ollama"];
  const results = await Promise.all(
    ids.map(async (id) => {
      let key = "";
      // 1. Try OS keychain
      try {
        key = await DbClient.getApiKey(KEYCHAIN_PREFIX + id);
      } catch {
        // keychain unavailable — fall through to localStorage
      }
      // 2. Fall back to localStorage backup
      if (!key && typeof window !== "undefined") {
        key = localStorage.getItem(LS_KEY_PREFIX + id) ?? "";
      }
      // 3. Migrate from legacy localStorage keys
      if (!key && typeof window !== "undefined") {
        const legacyStorageKey = LEGACY_KEY_STORAGE[id];
        const legacyKey = legacyStorageKey ? localStorage.getItem(legacyStorageKey) ?? "" : "";
        if (legacyKey) {
          key = legacyKey;
          // Migrate to new storage
          void saveApiKeyToKeychain(id, legacyKey).catch(() => {});
          localStorage.removeItem(legacyStorageKey!);
        }
      }
      return [id, key] as const;
    })
  );
  return Object.fromEntries(results.filter(([, k]) => k !== ""));
}

/**
 * Save a single API key. Saves to OS keychain AND localStorage backup.
 * Pass empty string to delete the key.
 */
export async function saveApiKeyToKeychain(providerId: ProviderID, key: string): Promise<void> {
  const { DbClient } = await import("../db/DbClient");
  // Always write to localStorage backup first (fast, reliable)
  if (typeof window !== "undefined") {
    if (key) {
      localStorage.setItem(LS_KEY_PREFIX + providerId, key);
    } else {
      localStorage.removeItem(LS_KEY_PREFIX + providerId);
    }
  }
  // Also write to OS keychain (more secure, may fail silently on some setups)
  try {
    await DbClient.storeApiKey(KEYCHAIN_PREFIX + providerId, key);
  } catch {
    // localStorage backup already saved — user won't lose their key
  }
}

export function getActiveModel(settings: ProviderSettings): string {
  const meta = PROVIDER_CATALOG.find((p) => p.id === settings.activeProvider)!;
  return settings.models[settings.activeProvider] ?? meta.defaultModel;
}

export function getActiveKey(settings: ProviderSettings): string {
  return settings.keys[settings.activeProvider] ?? "";
}
