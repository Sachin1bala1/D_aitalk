/**
 * LicenseKeyDialog — activate or remove a DataIQ license key.
 */
import React, { useState } from "react";
import { X, Key, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { LicenseTier } from "../../lib/hooks/useLicenseTier";

interface LicenseKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier: LicenseTier;
  onActivated: () => void;
}

function TierBadge({ tier }: { tier: LicenseTier }) {
  if (tier === "enterprise") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-yellow-500/20 border border-yellow-500/40 text-yellow-400">
        Enterprise
      </span>
    );
  }
  if (tier === "pro") {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-blue-500/20 border border-blue-500/40 text-blue-400">
        Pro
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-zinc-700/60 border border-zinc-600/40 text-zinc-400">
      Free
    </span>
  );
}

export function LicenseKeyDialog({
  open,
  onOpenChange,
  currentTier,
  onActivated,
}: LicenseKeyDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [activating, setActivating] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!open) return null;

  const handleActivate = async () => {
    if (!inputValue.trim()) {
      toast.error("Please enter a license key");
      return;
    }
    setActivating(true);
    try {
      const tier = await invoke<string>("activate_license", { key: inputValue });
      const tierDisplay: Record<string, string> = { pro: "Pro", ent: "Enterprise" };
      toast.success(`License activated — ${tierDisplay[tier] ?? tier} tier`);
      setInputValue("");
      onActivated();
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setActivating(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await invoke("remove_license");
      toast.success("License removed — reverted to Free tier");
      onActivated();
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-sm bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-[#00d2ff]" />
            <h2 className="text-sm font-bold text-white/80">License Key</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col gap-5">
          {/* Current tier */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">Current tier</span>
            <TierBadge tier={currentTier} />
          </div>

          {/* Input */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-white/40">License key</label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleActivate()}
              placeholder="PRO-XXXXXXXXXXXXXXXX"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-[#2a2a2a] text-white/80 text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-[#00d2ff]/50 transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex flex-col gap-2">
          <button
            onClick={handleActivate}
            disabled={activating}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-[#00d2ff]/10 border border-[#00d2ff]/20 text-[#00d2ff] text-xs font-semibold hover:bg-[#00d2ff]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {activating ? "Activating…" : "Activate"}
          </button>

          {currentTier !== "free" && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {removing ? "Removing…" : "Remove License"}
            </button>
          )}

          <button
            onClick={() => onOpenChange(false)}
            className="w-full px-4 py-2 rounded-lg border border-[#2a2a2a] text-white/40 text-xs hover:text-white/70 hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
