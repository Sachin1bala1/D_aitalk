/**
 * AboutDialog — shows DataIQ version, build year, license tier, and update check stub.
 */
import React, { useEffect, useState } from "react";
import { X, Database, RefreshCw, Key } from "lucide-react";
import { toast } from "sonner";
import { useLicenseTier } from "../../lib/hooks/useLicenseTier";
import { LicenseKeyDialog } from "./LicenseKeyDialog";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [version, setVersion] = useState<string>("…");
  const [showLicense, setShowLicense] = useState(false);
  const { tier, refresh } = useLicenseTier();

  useEffect(() => {
    if (!open) return;
    import("@tauri-apps/api/app")
      .then((mod) => mod.getVersion())
      .then((v) => setVersion(v))
      .catch(() => setVersion("0.1.0"));
  }, [open]);

  if (!open) return null;

  const buildYear = new Date().getFullYear();

  const tierLabel =
    tier === "enterprise" ? "Enterprise" : tier === "pro" ? "Pro" : "Free";

  const tierBadgeClass =
    tier === "enterprise"
      ? "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-yellow-500/20 border border-yellow-500/40 text-yellow-400"
      : tier === "pro"
      ? "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-blue-500/20 border border-blue-500/40 text-blue-400"
      : "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-zinc-700/60 border border-zinc-600/40 text-zinc-400";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
        <div className="relative w-full max-w-sm bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#00d2ff]" />
              <h2 className="text-sm font-bold text-white/80">About DataIQ</h2>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
            {/* Logo + title */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#00d2ff]/10 border border-[#00d2ff]/20 flex items-center justify-center">
                <Database className="w-6 h-6 text-[#00d2ff]" />
              </div>
              <div className="text-left">
                <p className="text-lg font-bold text-white">DataIQ</p>
                <p className="text-[10px] text-white/30 uppercase tracking-widest">Intelligent Data Operations</p>
              </div>
            </div>

            {/* Version info */}
            <div className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded-lg px-4 py-3 space-y-1.5 text-left">
              <div className="flex justify-between text-xs">
                <span className="text-white/30">Version</span>
                <span className="font-mono text-white/70">{version}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/30">Build year</span>
                <span className="font-mono text-white/70">{buildYear}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-white/30">License</span>
                <span className={tierBadgeClass}>{tierLabel}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 flex flex-col gap-2">
            <button
              onClick={() => setShowLicense(true)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-white/[0.04] border border-[#2a2a2a] text-white/60 text-xs font-semibold hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Manage License
            </button>
            <button
              onClick={() => toast.info("You're on the latest version")}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-[#00d2ff]/10 border border-[#00d2ff]/20 text-[#00d2ff] text-xs font-semibold hover:bg-[#00d2ff]/20 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check for updates
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="w-full px-4 py-2 rounded-lg border border-[#2a2a2a] text-white/40 text-xs hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <LicenseKeyDialog
        open={showLicense}
        onOpenChange={setShowLicense}
        currentTier={tier}
        onActivated={refresh}
      />
    </>
  );
}
