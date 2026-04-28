import React, { useState, useEffect } from "react";
import { Database, X, Link2, Trash2, History, Wifi, Terminal, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { DbClient, ConnectionConfig, DbDriver } from "../../lib/db/DbClient";
import { loadSavedConnections, removeConnection } from "../../lib/db/ConnectionStore";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (connectionId: string, config: ConnectionConfig) => void;
}

const DRIVER_OPTIONS: { value: DbDriver; label: string; placeholder: string; group: string }[] = [
  // ── SQL ───────────────────────────────────────────────────────────────────
  {
    value: "postgres",
    label: "PostgreSQL",
    placeholder: "postgresql://user:pass@localhost:5432/dbname",
    group: "SQL",
  },
  {
    value: "timescaledb",
    label: "TimescaleDB",
    placeholder: "postgresql://user:pass@localhost:5432/dbname",
    group: "SQL",
  },
  {
    value: "mysql",
    label: "MySQL / MariaDB",
    placeholder: "mysql://user:pass@localhost:3306/dbname",
    group: "SQL",
  },
  {
    value: "sqlite",
    label: "SQLite",
    placeholder: "sqlite:///path/to/database.db",
    group: "SQL",
  },
  {
    value: "mssql",
    label: "SQL Server (MSSQL)",
    placeholder: "mssql://user:pass@localhost:1433/dbname",
    group: "SQL",
  },
  // ── NoSQL ─────────────────────────────────────────────────────────────────
  {
    value: "mongodb",
    label: "MongoDB",
    placeholder: "mongodb://user:pass@localhost:27017/mydb",
    group: "NoSQL",
  },
  {
    value: "redis",
    label: "Redis",
    placeholder: "redis://localhost:6379",
    group: "NoSQL",
  },
  {
    value: "clickhouse",
    label: "ClickHouse",
    placeholder: "http://user:pass@localhost:8123/default",
    group: "NoSQL",
  },
];

// ── URL auto-parser ────────────────────────────────────────────────────────────

const SCHEME_TO_DRIVER: Record<string, DbDriver> = {
  postgres:     "postgres",
  postgresql:   "postgres",
  timescaledb:  "timescaledb",
  mysql:        "mysql",
  mariadb:      "mysql",
  sqlite:       "sqlite",
  sqlite3:      "sqlite",
  mssql:        "mssql",
  sqlserver:    "mssql",
  mongodb:      "mongodb",
  mongodb_srv:  "mongodb",
  redis:        "redis",
  rediss:       "redis",
  clickhouse:   "clickhouse",
  http:         "clickhouse",
  https:        "clickhouse",
};

interface ParsedUrl {
  driver: DbDriver;
  suggestedName: string;
}

function parseConnectionUrl(raw: string): ParsedUrl | null {
  try {
    const colonIdx = raw.indexOf("://");
    if (colonIdx < 1) return null;
    const scheme = raw.slice(0, colonIdx).toLowerCase().replace(/-/g, "_").replace(/\+/g, "_");
    const detectedDriver = SCHEME_TO_DRIVER[scheme];
    if (!detectedDriver) return null;

    // Extract host + dbname for display name: skip user:pass@
    const afterScheme = raw.slice(colonIdx + 3);
    const withoutCreds = afterScheme.replace(/^[^@]*@/, "");
    const hostAndPath = withoutCreds.split("?")[0];
    const slashIdx = hostAndPath.indexOf("/");
    const host = slashIdx > -1 ? hostAndPath.slice(0, slashIdx).replace(/:\d+$/, "") : hostAndPath;
    const db = slashIdx > -1 ? hostAndPath.slice(slashIdx + 1).split("/")[0] : "";
    const suggestedName = db ? `${host}/${db}` : host;

    return { driver: detectedDriver, suggestedName };
  } catch {
    return null;
  }
}

// ── SSH types ──────────────────────────────────────────────────────────────────

type SshAuthMethod = "password" | "key";

interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: { type: "password"; password: string } | { type: "key"; key_path: string; passphrase: string | null };
}

function buildSshConfig(
  host: string,
  port: string,
  username: string,
  authMethod: SshAuthMethod,
  password: string,
  keyPath: string,
  keyPassphrase: string,
): SshConfig {
  return {
    host,
    port: parseInt(port, 10) || 22,
    username,
    auth:
      authMethod === "password"
        ? { type: "password", password }
        : { type: "key", key_path: keyPath, passphrase: keyPassphrase || null },
  };
}

// Tauri serde expects SshAuth as an internally-tagged object:
//   { type: "password", password: "..." }
//   { type: "key", key_path: "...", passphrase: null }
// The SshConfig interface already uses this format, so pass it through unchanged.
function toTauriSshConfig(cfg: SshConfig) {
  return {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    auth:
      cfg.auth.type === "password"
        ? { type: "password", password: cfg.auth.password }
        : { type: "key", key_path: (cfg.auth as any).key_path, passphrase: (cfg.auth as any).passphrase },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectionDialog({ open, onOpenChange, onConnect }: ConnectionDialogProps) {
  const [connectionString, setConnectionString] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [driver, setDriver] = useState<DbDriver>("postgres");
  const [isConnecting, setIsConnecting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [savedConns, setSavedConns] = useState<ConnectionConfig[]>([]);
  // tracks whether user manually changed driver/name so auto-parse doesn't override
  const [driverManual, setDriverManual] = useState(false);
  const [nameManual, setNameManual] = useState(false);

  // ── SSH state ────────────────────────────────────────────────────────────
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshExpanded, setSshExpanded] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshAuthMethod, setSshAuthMethod] = useState<SshAuthMethod>("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState("");
  const [sshTestStatus, setSshTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [sshTestMessage, setSshTestMessage] = useState("");

  useEffect(() => {
    if (open) {
      setSavedConns(loadSavedConnections());
      // Reset manual flags when dialog reopens
      setDriverManual(false);
      setNameManual(false);
    }
  }, [open]);

  const handleConnectionStringChange = (value: string) => {
    setConnectionString(value);
    setTestStatus("idle");
    const parsed = parseConnectionUrl(value.trim());
    if (parsed) {
      if (!driverManual) setDriver(parsed.driver);
      if (!nameManual && !displayName) setDisplayName(parsed.suggestedName);
    }
  };

  const selectedDriver = DRIVER_OPTIONS.find((d) => d.value === driver)!;

  const handleQuickConnect = async (config: ConnectionConfig) => {
    setIsConnecting(true);
    try {
      await DbClient.connect(config);
      onConnect(config.id, config);
      toast.success(`Connected to ${config.display_name}`);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message ?? "Reconnection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRemoveSaved = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeConnection(id);
    setSavedConns((s) => s.filter((c) => c.id !== id));
  };

  const buildConfig = (): ConnectionConfig => {
    const base: ConnectionConfig = {
      id: `conn-${Date.now()}`,
      display_name: displayName || selectedDriver.label,
      driver,
      connection_string: connectionString,
      pool_min: 1,
      pool_max: 10,
    };
    if (sshEnabled && sshHost && sshUsername) {
      (base as any).ssh = toTauriSshConfig(
        buildSshConfig(sshHost, sshPort, sshUsername, sshAuthMethod, sshPassword, sshKeyPath, sshKeyPassphrase)
      );
    }
    return base;
  };

  const handleTestConnection = async () => {
    if (!connectionString) return;
    setTestStatus("testing");
    const config = buildConfig();
    try {
      await DbClient.connect(config);
      await DbClient.ping(config.id);
      await DbClient.disconnect(config.id);
      setTestStatus("ok");
      toast.success("Connection successful");
    } catch (error: any) {
      setTestStatus("fail");
      toast.error(error.message ?? "Connection test failed");
    }
  };

  const handleConnect = async () => {
    if (!connectionString) return;
    setIsConnecting(true);
    const config = buildConfig();
    try {
      await DbClient.connect(config);
      onConnect(config.id, config);
      toast.success(`Connected to ${config.display_name}`);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message ?? "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTestSsh = async () => {
    if (!sshHost || !sshUsername) return;
    setSshTestStatus("testing");
    setSshTestMessage("");
    try {
      const sshCfg = toTauriSshConfig(
        buildSshConfig(sshHost, sshPort, sshUsername, sshAuthMethod, sshPassword, sshKeyPath, sshKeyPassphrase)
      );
      const result = await invoke<string>("test_ssh_tunnel", { sshConfig: sshCfg });
      setSshTestStatus("ok");
      setSshTestMessage(result);
      toast.success(result);
    } catch (error: any) {
      setSshTestStatus("fail");
      const msg = typeof error === "string" ? error : (error?.message ?? "SSH tunnel test failed");
      setSshTestMessage(msg);
      toast.error(msg);
    }
  };

  const handleSshToggle = (checked: boolean) => {
    setSshEnabled(checked);
    if (checked) setSshExpanded(true);
    setSshTestStatus("idle");
    setSshTestMessage("");
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="relative w-full max-w-md bg-[#0d0d0d] border border-[#262626] rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-[#262626] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#00d2ff]/10 rounded-lg flex items-center justify-center">
                  <Database className="w-5 h-5 text-[#00d2ff]" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Connect Database</h2>
                  <p className="text-xs text-white/40">SQL + NoSQL — all major databases</p>
                </div>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="text-white/30 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Saved connections */}
              {savedConns.length > 0 && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-white/50">
                    <History className="w-3 h-3" /> Saved Connections
                  </label>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {savedConns.map((conn) => (
                      <button
                        key={conn.id}
                        onClick={() => handleQuickConnect(conn)}
                        disabled={isConnecting}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#262626] hover:border-[#00d2ff]/30 text-left transition-colors group disabled:opacity-40"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white/80 truncate">{conn.display_name}</p>
                          <p className="text-[10px] text-white/25 font-mono truncate">{conn.driver} · {conn.connection_string.replace(/:[^:@]+@/, ":***@")}</p>
                        </div>
                        <button
                          onClick={(e) => handleRemoveSaved(conn.id, e)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded text-white/20 hover:text-red-400 transition-all"
                          title="Remove saved connection"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </button>
                    ))}
                  </div>
                  <div className="h-px bg-[#262626] mt-3" />
                </div>
              )}

              {/* Driver selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">
                  Database Type
                </label>
                <select
                  value={driver}
                  onChange={(e) => { setDriver(e.target.value as DbDriver); setDriverManual(true); }}
                  className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#00d2ff] text-white"
                >
                  {(["SQL", "NoSQL"] as const).map((group) => (
                    <optgroup key={group} label={group}>
                      {DRIVER_OPTIONS.filter((o) => o.group === group).map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Display name */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">
                  Connection Name (optional)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setNameManual(true); }}
                  placeholder={selectedDriver.label}
                  className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#00d2ff]"
                />
              </div>

              {/* Connection string */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">
                    Connection String
                  </label>
                  {connectionString && parseConnectionUrl(connectionString.trim()) && (
                    <span className="text-[9px] font-mono text-[#00d2ff]/50 bg-[#00d2ff]/5 border border-[#00d2ff]/10 rounded px-1.5 py-0.5">
                      auto-detected
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
                  <input
                    type="text"
                    value={connectionString}
                    onChange={(e) => handleConnectionStringChange(e.target.value)}
                    placeholder={selectedDriver.placeholder}
                    className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#00d2ff]"
                    onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  />
                </div>
              </div>

              {/* ── SSH Tunnel section ────────────────────────────────────── */}
              <div className="rounded-lg border border-[#262626] overflow-hidden">
                {/* Header row — toggle + collapse chevron */}
                <button
                  type="button"
                  onClick={() => setSshExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#1a1a1a] hover:bg-[#222] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-white/40" />
                    <span className="text-xs font-bold text-white/60">SSH Tunnel</span>
                    {sshEnabled && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#00d2ff]/10 text-[#00d2ff] font-bold border border-[#00d2ff]/20">
                        ON
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Toggle switch */}
                    <div
                      role="switch"
                      aria-checked={sshEnabled}
                      onClick={(e) => { e.stopPropagation(); handleSshToggle(!sshEnabled); }}
                      className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                        sshEnabled ? "bg-[#00d2ff]" : "bg-[#333]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          sshEnabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </div>
                    {sshExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-white/30" />
                      : <ChevronRight className="w-3.5 h-3.5 text-white/30" />
                    }
                  </div>
                </button>

                {/* Expanded fields */}
                <AnimatePresence>
                  {sshExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 py-3 space-y-3 border-t border-[#262626]">
                        {/* SSH Host + Port */}
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                              SSH Host
                            </label>
                            <input
                              type="text"
                              value={sshHost}
                              onChange={(e) => { setSshHost(e.target.value); setSshTestStatus("idle"); }}
                              placeholder="bastion.example.com"
                              className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                            />
                          </div>
                          <div className="w-20 space-y-1">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                              Port
                            </label>
                            <input
                              type="text"
                              value={sshPort}
                              onChange={(e) => { setSshPort(e.target.value); setSshTestStatus("idle"); }}
                              placeholder="22"
                              className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                            />
                          </div>
                        </div>

                        {/* SSH Username */}
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                            SSH Username
                          </label>
                          <input
                            type="text"
                            value={sshUsername}
                            onChange={(e) => { setSshUsername(e.target.value); setSshTestStatus("idle"); }}
                            placeholder="ubuntu"
                            className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                          />
                        </div>

                        {/* Auth method radio */}
                        <div className="flex gap-4">
                          {(["password", "key"] as SshAuthMethod[]).map((m) => (
                            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="ssh-auth"
                                value={m}
                                checked={sshAuthMethod === m}
                                onChange={() => { setSshAuthMethod(m); setSshTestStatus("idle"); }}
                                className="accent-[#00d2ff]"
                              />
                              <span className="text-xs text-white/60 capitalize">{m === "key" ? "Private Key" : "Password"}</span>
                            </label>
                          ))}
                        </div>

                        {/* Password or Key path */}
                        {sshAuthMethod === "password" ? (
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                              SSH Password
                            </label>
                            <input
                              type="password"
                              value={sshPassword}
                              onChange={(e) => { setSshPassword(e.target.value); setSshTestStatus("idle"); }}
                              placeholder="••••••••"
                              className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                            />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                                Key File Path
                              </label>
                              <input
                                type="text"
                                value={sshKeyPath}
                                onChange={(e) => { setSshKeyPath(e.target.value); setSshTestStatus("idle"); }}
                                placeholder="~/.ssh/id_rsa"
                                className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                                Passphrase (optional)
                              </label>
                              <input
                                type="password"
                                value={sshKeyPassphrase}
                                onChange={(e) => { setSshKeyPassphrase(e.target.value); setSshTestStatus("idle"); }}
                                placeholder="leave blank if none"
                                className="w-full bg-[#111] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00d2ff]"
                              />
                            </div>
                          </div>
                        )}

                        {/* Test SSH button + result */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleTestSsh}
                            disabled={!sshHost || !sshUsername || sshTestStatus === "testing"}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors disabled:opacity-40 ${
                              sshTestStatus === "ok"
                                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                                : sshTestStatus === "fail"
                                ? "border-red-500/40 text-red-400 bg-red-500/5"
                                : "border-[#262626] text-white/40 hover:text-white hover:border-[#00d2ff]/40"
                            }`}
                          >
                            <Wifi className="w-3 h-3" />
                            {sshTestStatus === "testing" ? "Testing…" : sshTestStatus === "ok" ? "OK" : sshTestStatus === "fail" ? "Failed" : "Test SSH"}
                          </button>
                          {sshTestMessage && (
                            <span className={`text-[10px] font-mono truncate max-w-[160px] ${sshTestStatus === "ok" ? "text-emerald-400/70" : "text-red-400/70"}`}>
                              {sshTestMessage}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={!connectionString || isConnecting || testStatus === "testing"}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-bold transition-colors disabled:opacity-40 ${
                    testStatus === "ok"
                      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                      : testStatus === "fail"
                      ? "border-red-500/40 text-red-400 bg-red-500/5"
                      : "border-[#262626] text-white/40 hover:text-white hover:border-[#00d2ff]/40"
                  }`}
                  title="Test connection without saving"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  {testStatus === "testing" ? "Testing…" : testStatus === "ok" ? "OK" : testStatus === "fail" ? "Failed" : "Test"}
                </button>
                <button
                  onClick={() => onOpenChange(false)}
                  className="px-3 py-2.5 rounded-lg border border-[#262626] text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnect}
                  disabled={!connectionString || isConnecting}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[#00d2ff] text-black text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isConnecting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
