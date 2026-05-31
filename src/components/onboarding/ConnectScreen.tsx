/**
 * ConnectScreen — first-run AI provider setup.
 * Shown when no AI provider is configured.
 * Three paths: Google Sign-In (Gemini), API Key Wizard (Claude/OpenAI), Skip.
 */
import React, { useState } from "react";
import { CheckCircle2, Key } from "lucide-react";
import { startGoogleOAuthFlow } from "../../lib/auth/googleOAuth";
import { saveSettings, loadSettings, type ProviderID } from "../../lib/ai/types";
import { KeySetupWizard } from "../ai/KeySetupWizard";

interface Props {
  onComplete: () => void;
}

type Status = "idle" | "google_loading" | "google_done" | "google_error";

export function ConnectScreen({ onComplete }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [googleError, setGoogleError] = useState("");
  const [wizardProvider, setWizardProvider] = useState<ProviderID>("claude");
  const [wizardOpen, setWizardOpen] = useState(false);

  const isTauri =
    typeof window !== "undefined" && typeof (window as any).__TAURI__ !== "undefined";

  const handleGoogleSignIn = async () => {
    setStatus("google_loading");
    setGoogleError("");
    try {
      await startGoogleOAuthFlow();
      setStatus("google_done");
      const settings = loadSettings();
      saveSettings({ ...settings, activeProvider: "gemini" });
      setTimeout(onComplete, 1000);
    } catch (e: any) {
      setGoogleError(e?.message ?? "Sign-in failed");
      setStatus("google_error");
    }
  };

  const openWizard = (id: ProviderID) => {
    setWizardProvider(id);
    setWizardOpen(true);
  };

  const handleWizardSave = (id: ProviderID, _key: string) => {
    const settings = loadSettings();
    saveSettings({ ...settings, activeProvider: id });
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-[#080808] z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 bg-[#00d2ff] rounded-xl flex items-center justify-center mb-1">
            <span className="text-black font-black text-xl">D</span>
          </div>
          <span className="text-2xl font-bold text-white">Welcome to Daitalk</span>
          <span className="text-white/40 text-sm text-center">
            Connect an AI provider to get started.
            <br />Your keys are stored locally — never sent to our servers.
          </span>
        </div>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-3">
          {isTauri ? (
            <button
              onClick={handleGoogleSignIn}
              disabled={status === "google_loading" || status === "google_done"}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-gray-900 font-semibold text-sm hover:bg-gray-100 disabled:opacity-60 transition-all shadow-lg"
            >
              {status === "google_loading" ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
              ) : status === "google_done" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {status === "google_done" ? "Connected!" : "Sign in with Google"}
              <span className="ml-auto text-xs text-gray-400 font-normal">Gemini</span>
            </button>
          ) : (
            <div className="w-full px-4 py-3 rounded-xl border border-[#2a2a2a] text-white/30 text-sm text-center">
              Google Sign-In requires the desktop app
            </div>
          )}

          {googleError && (
            <p className="text-xs text-red-400/80 text-center">{googleError}</p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#262626]" />
            <span className="text-xs text-white/20">or</span>
            <div className="flex-1 h-px bg-[#262626]" />
          </div>

          {/* API Key Wizard buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => openWizard("claude")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Claude key
            </button>
            <button
              onClick={() => openWizard("openai")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              OpenAI key
            </button>
            <button
              onClick={() => openWizard("gemini")}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] text-white/60 hover:text-white hover:border-[#444] text-xs font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Gemini key
            </button>
          </div>
        </div>
      </div>

      {/* Skip */}
      <button
        onClick={onComplete}
        className="absolute bottom-6 right-6 text-xs text-white/25 hover:text-white/50 transition-colors"
      >
        Skip for now →
      </button>

      <KeySetupWizard
        open={wizardOpen}
        providerId={wizardProvider}
        onSave={handleWizardSave}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}
