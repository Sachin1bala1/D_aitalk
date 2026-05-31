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
  ensureProviderSettingsLoaded,
  loadSettings,
  saveSettings,
  loadApiKeysFromKeychain,
  saveApiKeyToKeychain,
  type ProviderID,
  type ProviderSettings,
} from "../../lib/ai/types";
import { startGoogleOAuthFlow, loadGeminiOAuthToken, disconnectGoogleAccount } from "../../lib/auth/googleOAuth";
import { KeySetupWizard } from "./KeySetupWizard";

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
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Load API keys from OS keychain when dialog opens
  useEffect(() => {
    if (!open) return;
    ensureProviderSettingsLoaded()
      .then((loaded) => {
        setSettings((current) => ({ ...loaded, keys: current.keys }));
      })
      .catch(() => {});
    loadApiKeysFromKeychain().then((keys) => {
      setSettings((s) => ({ ...s, keys }));
    }).catch(() => {});
    loadGeminiOAuthToken().then((token) => {
      setGoogleConnected(!!token);
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

  const handleGoogleSignIn = async () => {
    setGoogleSigningIn(true);
    try {
      await startGoogleOAuthFlow();
      setGoogleConnected(true);
      setActiveProvider("gemini");
    } catch (e: any) {
      console.error("Google Sign-In failed:", e);
    } finally {
      setGoogleSigningIn(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    await disconnectGoogleAccount();
    setGoogleConnected(false);
  };

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
              Keys are stored in the OS keychain — never sent to Daitalk servers.
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
                {hasKey && (
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
            <div className="flex flex-col gap-3">
              {/* Google Sign-In — Gemini tab only */}
              {settings.activeProvider === "gemini" && (
                <div>
                  {googleConnected ? (
                    <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-lg px-4 py-3 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs text-emerald-400 flex-1">Signed in with Google</span>
                      <button
                        onClick={handleGoogleDisconnect}
                        className="text-[10px] text-white/30 hover:text-red-400 transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={googleSigningIn}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white text-gray-900 font-semibold text-xs hover:bg-gray-100 disabled:opacity-60 transition-all"
                    >
                      {googleSigningIn ? (
                        <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      )}
                      Sign in with Google
                    </button>
                  )}
                  <div className="flex items-center gap-2 my-1">
                    <div className="flex-1 h-px bg-[#2a2a2a]" />
                    <span className="text-[10px] text-white/20">or enter API key</span>
                    <div className="flex-1 h-px bg-[#2a2a2a]" />
                  </div>
                </div>
              )}

              {/* API Key input */}
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
                {activeKey && activeMeta.keyPrefix && (() => {
                  const prefixes = Array.isArray(activeMeta.keyPrefix)
                    ? activeMeta.keyPrefix
                    : [activeMeta.keyPrefix];
                  const valid = prefixes.length === 0 || prefixes.some((p) => activeKey.startsWith(p));
                  if (valid) return null;
                  return (
                    <p className="mt-1 text-xs text-amber-400/70">
                      Key should start with {prefixes.map((p) => `"${p}"`).join(" or ")}
                    </p>
                  );
                })()}
                {/* Wizard shortcut for Claude / OpenAI */}
                {(settings.activeProvider === "claude" || settings.activeProvider === "openai") && !activeKey && (
                  <button
                    onClick={() => setWizardOpen(true)}
                    className="mt-1 text-[11px] text-[#00d2ff]/60 hover:text-[#00d2ff] transition-colors"
                  >
                    Set up with wizard →
                  </button>
                )}
              </div>
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
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${isOllama || activeKey ? "text-emerald-400" : "text-white/20"}`} />
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
            disabled={saving || (!isOllama && !activeKey)}
            className="flex-1 py-2 rounded-lg bg-[#00d2ff] text-black font-bold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving…" : "Save & Use"}
          </button>
        </div>
      </div>

      <KeySetupWizard
        open={wizardOpen}
        providerId={settings.activeProvider}
        onSave={(id, key) => {
          setKey(id, key);
          setWizardOpen(false);
        }}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}
