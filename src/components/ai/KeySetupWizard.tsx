/**
 * KeySetupWizard — 3-step guided wizard for entering API keys.
 * Step 1: Open provider console.
 * Step 2: Clipboard auto-detects valid key (ring turns green).
 * Step 3: Confirm saves to keychain.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, ExternalLink, CheckCircle2 } from "lucide-react";
import { PROVIDER_CATALOG, saveApiKeyToKeychain, type ProviderID } from "../../lib/ai/types";

const PROVIDER_DOCS: Record<string, string> = {
  claude: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

interface Props {
  open: boolean;
  providerId: ProviderID;
  onSave: (providerId: ProviderID, key: string) => void;
  onClose: () => void;
}

export function KeySetupWizard({ open, providerId, onSave, onClose }: Props) {
  const meta = PROVIDER_CATALOG.find((p) => p.id === providerId);
  const [detectedKey, setDetectedKey] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [clipboardDenied, setClipboardDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<number | null>(null);

  const activeKey = detectedKey || manualKey;
  const prefixes = meta?.keyPrefix
    ? Array.isArray(meta.keyPrefix) ? meta.keyPrefix : [meta.keyPrefix]
    : [];
  const isValidKey = prefixes.length === 0 || prefixes.some((p) => activeKey.startsWith(p));

  const pollClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const valid =
        text.trim().length > 10 &&
        (prefixes.length === 0 || prefixes.some((p) => text.trim().startsWith(p)));
      if (valid) setDetectedKey(text.trim());
    } catch {
      setClipboardDenied(true);
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [prefixes]);

  useEffect(() => {
    if (!open) {
      setDetectedKey("");
      setManualKey("");
      setClipboardDenied(false);
      return;
    }
    void pollClipboard();
    pollRef.current = window.setInterval(pollClipboard, 500);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [open, pollClipboard]);

  if (!open || !meta) return null;

  const openConsole = async () => {
    const url = PROVIDER_DOCS[providerId];
    if (!url) return;
    try {
      const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
      await shellOpen(url);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const handleConfirm = async () => {
    if (!activeKey || !isValidKey) return;
    setSaving(true);
    await saveApiKeyToKeychain(providerId, activeKey);
    setSaving(false);
    onSave(providerId, activeKey);
    onClose();
  };

  const ringColor = detectedKey
    ? "border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
    : "border-white/10";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-[460px] bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <div>
            <h2 className="text-sm font-bold text-white">Set up {meta.name}</h2>
            <p className="text-xs text-white/30 mt-0.5">3-step guided setup</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Step 1 */}
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[#00d2ff]/10 text-[#00d2ff] text-xs font-bold flex items-center justify-center shrink-0">
              1
            </span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Open API key page</p>
              <button
                onClick={openConsole}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white text-xs transition-colors"
              >
                Open {meta.name} Console <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[#00d2ff]/10 text-[#00d2ff] text-xs font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Copy your API key</p>
              {clipboardDenied ? (
                <div>
                  <p className="text-xs text-white/40 mb-2">
                    Clipboard access denied — paste your key below:
                  </p>
                  <input
                    type="password"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value)}
                    placeholder={`Paste ${meta.keyPlaceholder}`}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00d2ff] font-mono"
                  />
                </div>
              ) : (
                <div className={`rounded-lg border-2 px-4 py-3 transition-all ${ringColor}`}>
                  {detectedKey ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs text-emerald-400 font-medium">Key detected</span>
                      <span className="text-xs text-white/40 font-mono ml-auto">
                        ···{detectedKey.slice(-4)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-white/30 text-center">
                      Watching clipboard for{" "}
                      {prefixes.map((p) => `"${p}"`).join(" or ")} key…
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <span
              className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                activeKey && isValidKey
                  ? "bg-[#00d2ff]/10 text-[#00d2ff]"
                  : "bg-white/5 text-white/20"
              }`}
            >
              3
            </span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium mb-2">Confirm</p>
              <button
                onClick={handleConfirm}
                disabled={!activeKey || !isValidKey || saving}
                className="w-full py-2 rounded-lg bg-[#00d2ff] text-black font-bold text-sm hover:opacity-90 disabled:opacity-30 transition-opacity"
              >
                {saving ? "Saving…" : "Save & Use"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
