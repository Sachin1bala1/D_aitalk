import React, { useEffect, useState } from "react";
import { Database, HardDrive, Clock } from "lucide-react";

interface WelcomeScreenProps {
  onConnect: (driver: string) => void;
  onOpenFile: () => void;
  onDismiss: () => void;
}

const DB_CARDS = [
  {
    driver: "postgresql",
    name: "PostgreSQL",
    icon: Database,
    tagline: "The world's most advanced open source database",
  },
  {
    driver: "mysql",
    name: "MySQL / MariaDB",
    icon: Database,
    tagline: "The world's most popular open source database",
  },
  {
    driver: "sqlite",
    name: "SQLite",
    icon: HardDrive,
    tagline: "Connect a local .db file — no server needed",
  },
  {
    driver: "timescaledb",
    name: "TimescaleDB",
    icon: Clock,
    tagline: "Time-series data for industrial and IoT applications",
  },
] as const;

export function WelcomeScreen({ onConnect, onOpenFile, onDismiss }: WelcomeScreenProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("daitalk_onboarding_dismissed")) {
      setVisible(false);
    } else {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    localStorage.setItem("daitalk_onboarding_dismissed", "1");
    onDismiss();
  };

  return (
    <div className="fixed inset-0 bg-[#080808] z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 w-full max-w-2xl px-6">
        {/* Logo + tagline */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl font-bold text-[#00d2ff]">DataIQ</span>
          <span className="text-white/50 text-sm">Your AI-powered data operations platform</span>
        </div>

        {/* Quick connect cards */}
        <div className="grid grid-cols-2 gap-4 w-full">
          {DB_CARDS.map(({ driver, name, icon: Icon, tagline }) => (
            <div
              key={driver}
              className="flex flex-col gap-3 p-4 rounded-lg border border-[#262626] bg-[#0d0d0d] hover:border-[#00d2ff]/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5 text-[#00d2ff]" />
                <span className="font-semibold text-white text-sm">{name}</span>
              </div>
              <p className="text-white/40 text-xs leading-relaxed">{tagline}</p>
              <button
                onClick={() => onConnect(driver)}
                className="mt-auto px-3 py-1.5 rounded bg-[#00d2ff] text-black text-xs font-bold hover:opacity-90 transition-opacity self-start"
              >
                Connect
              </button>
            </div>
          ))}
        </div>

        {/* Open file */}
        <button
          onClick={onOpenFile}
          className="text-sm text-white/50 hover:text-white/80 border border-[#262626] hover:border-[#444] px-4 py-2 rounded transition-colors"
        >
          Or open a file
        </button>
      </div>

      {/* Skip link — bottom-right */}
      <button
        onClick={handleDismiss}
        className="absolute bottom-6 right-6 text-xs text-white/30 hover:text-white/60 transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}
