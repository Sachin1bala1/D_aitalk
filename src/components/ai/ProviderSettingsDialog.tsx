/**
 * ProviderSettingsDialog — configure AI provider, API key, and model.
 *
 * Shows all four providers (Claude, Gemini, OpenAI, NVIDIA NIM).
 * Active provider selection + per-provider key + model dropdown.
 * NVIDIA allows free-text model entry in addition to presets.
 */
import React, { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle2, ExternalLink } from "lucide-react";
import {
  PROVIDER_CATALOG,
  loadSettings,
  saveSettings,
  loadApiKeyPresenceFromKeychain,
  saveApiKeyToKeychain,
  type ProviderID,
  type ProviderSettings,
} from "../../lib/ai/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (settings: ProviderSettings) => void;
}

const PROVIDER_DOCS: Record<ProviderID, string> = {
  claude: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  nvidia: "https://build.nvidia.com",
  ollama: "https://ollama.com/download",
};

const PROVIDER_LINK_LABEL: Partial<Record<ProviderID, string>> = {
  ollama: "Download Ollama",
};

export function ProviderSettingsDialog({ open, onClose, onSave }: Props) {
  const [settings, setSettings] = useState<ProviderSettings>(loadSettings);
  const [showKeys, setShowKeys] = useState<Partial<Record<ProviderID, boolean>>>({});
  const [storedKeyPresence, setStoredKeyPresence] = useState<Partial<Record<ProviderID, boolean>>>({});
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);

  // Load API-key presence from OS keychain when dialog opens.
  useEffect(() => {
    if (!open) return;
    loadApiKeyPresenceFromKeychain().then((presence) => {
      setStoredKeyPresence(presence);
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const activeMeta = PROVIDER_CATALOG.find((p) => p.id === settings.activeProvider)!;
  const activeModel = settings.models[settings.activeProvider] ?? activeMeta.defaultModel;
  const activeKey = settings.keys[settings.activeProvider] ?? "";

  const setActiveProvider = (id: ProviderID) =>
    setSettings((s) => ({ ...s, activeProvider: id }));

  const setKey = (id: ProviderID, key: string) =>
    setSettings((s) => ({ ...s, keys: { ...s.keys, [id]: key } }));

  const setModel = (id: ProviderID, model: string) =>
    setSettings((s) => ({ ...s, models: { ...s.models, [id]: model } }));

  const isOllama = settings.activeProvider === "ollama";

  const handleSave = async () => {
    setSaving(true);
    let finalSettings = settings;
    // Apply custom model for providers that allow it
    if (activeMeta.allowCustomModel && customModel.trim()) {
      finalSettings = {
        ...settings,
        models: { ...settings.models, [settings.activeProvider]: customModel.trim() },
      };
    }
    // Save model/provider prefs to localStorage (non-sensitive)
    saveSettings(finalSettings);
    // Save each API key to the OS keychain
    await Promise.allSettled(
      (Object.entries(finalSettings.keys) as [ProviderID, string][]).map(
        ([id, key]) => saveApiKeyToKeychain(id, key)
      )
    );
    setSaving(false);
    onSave(finalSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-[520px] max-h-[90vh] overflow-y-auto bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] shrink-0">
          <div>
            <h2 className="text-sm font-bold text-white">AI Provider Settings</h2>
            <p className="text-xs text-white/30 mt-0.5">
              Keys stay in the OS keychain. External providers still receive prompts and query context; use Ollama for local-only inference.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Provider tabs */}
        <div className="flex gap-1 px-6 pt-4 shrink-0">
          {PROVIDER_CATALOG.map((p) => {
            const hasKey = !!(settings.keys[p.id] ?? "");
            const hasStoredKey = !!storedKeyPresence[p.id];
            const isActive = settings.activeProvider === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProvider(p.id)}
                className={`flex-1 py-2 px-1 rounded-lg text-[11px] font-bold transition-all border ${
                  isActive
                    ? "bg-[#00d2ff]/10 text-[#00d2ff] border-[#00d2ff]/30"
                    : "text-white/40 border-transparent hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <span className="block text-base leading-none mb-1">{p.icon}</span>
                <span className="truncate block">{p.id === "nvidia" ? "NVIDIA" : p.id.charAt(0).toUpperCase() + p.id.slice(1)}</span>
                {(hasKey || hasStoredKey) && (
                  <span className="block mt-0.5 text-emerald-400/80 text-[9px]">✓ key set</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Provider config */}
        <div className="px-6 pt-5 pb-6 flex flex-col gap-5">
          {isOllama ? (
            /* Ollama: no API key — show status / instructions instead */
            <div className="bg-[#1a1a1a] rounded-lg px-4 py-3 border border-[#2a2a2a]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                  Local Inference (No Key Required)
                </span>
                <a
                  href={PROVIDER_DOCS.ollama}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] text-[#00d2ff]/70 hover:text-[#00d2ff] transition-colors"
                >
                  Download Ollama <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                Ollama must be running locally at{" "}
                <code className="text-white/70 font-mono text-[11px]">http://127.0.0.1:11434</code>.
                Pull a model with:{" "}
                <code className="text-white/70 font-mono text-[11px]">ollama pull qwen2.5:7b</code>
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                  {activeMeta.name} API Key
                </label>
                <a
                  href={PROVIDER_DOCS[settings.activeProvider]}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] text-[#00d2ff]/70 hover:text-[#00d2ff] transition-colors"
                >
                  {PROVIDER_LINK_LABEL[settings.activeProvider] ?? "Get key"}{" "}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <div className="relative">
                <input
                  type={showKeys[settings.activeProvider] ? "text" : "password"}
                  value={activeKey}
                  onChange={(e) => setKey(settings.activeProvider, e.target.value)}
                  placeholder={activeMeta.keyPlaceholder}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 pr-10 py-2.5 text-sm text-white focus:outline-none focus:border-[#00d2ff] font-mono"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowKeys((s) => ({ ...s, [settings.activeProvider]: !s[settings.activeProvider] }))
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showKeys[settings.activeProvider] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {activeKey && activeMeta.keyPrefix && !activeKey.startsWith(activeMeta.keyPrefix) && (
                <p className="mt-1 text-xs text-amber-400/70">
                  Key should start with "{activeMeta.keyPrefix}"
                </p>
              )}
            </div>
          )}

          {/* Model selector */}
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-1.5">
              Model
            </label>
            <select
              value={activeMeta.models.some((m) => m.id === activeModel) ? activeModel : "__custom__"}
              onChange={(e) => {
                if (e.target.value !== "__custom__") {
                  setModel(settings.activeProvider, e.target.value);
                  setCustomModel("");
                }
              }}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00d2ff] appearance-none"
            >
              {activeMeta.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {activeMeta.allowCustomModel && (
                <option value="__custom__">Custom model ID…</option>
              )}
            </select>

            {/* Custom model input for NVIDIA */}
            {activeMeta.allowCustomModel && (
              <div className="mt-2">
                <input
                  type="text"
                  value={customModel || (activeMeta.models.some((m) => m.id === activeModel) ? "" : activeModel)}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    if (e.target.value) setModel(settings.activeProvider, e.target.value);
                  }}
                  placeholder="e.g. z-ai/glm-4-9b-chat or any model from build.nvidia.com"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-[#00d2ff] font-mono placeholder:text-white/20"
                />
                <p className="mt-1 text-[10px] text-white/25">
                  Find model IDs at{" "}
                  <a
                    href="https://build.nvidia.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00d2ff]/60 hover:text-[#00d2ff]"
                  >
                    build.nvidia.com
                  </a>
                  {" "}— use the API name shown on each model card.
                </p>
              </div>
            )}
          </div>

          {/* Active provider summary */}
          <div className="bg-[#1a1a1a] rounded-lg px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${isOllama || activeKey || storedKeyPresence[settings.activeProvider] ? "text-emerald-400" : "text-white/20"}`} />
            <div className="min-w-0">
              <p className="text-xs text-white/60">
                Active provider:{" "}
                <span className="text-white font-semibold">{activeMeta.name}</span>
              </p>
              <p className="text-[10px] text-white/30 font-mono truncate mt-0.5">
                {settings.models[settings.activeProvider] ?? activeMeta.defaultModel}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2a2a] text-white/40 hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!isOllama && !activeKey && !storedKeyPresence[settings.activeProvider])}
            className="flex-1 py-2 rounded-lg bg-[#00d2ff] text-black font-bold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving…" : "Save & Use"}
          </button>
        </div>
      </div>
    </div>
  );
}
