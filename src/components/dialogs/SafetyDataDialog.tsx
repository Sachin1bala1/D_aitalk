import React, { useEffect, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Settings2, Shield, Trash2, X } from "lucide-react";

import {
  DbClient,
  type LocalDataStats,
  type SecurityAuditRecord,
} from "../../lib/db/DbClient";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ClearScope = "query_history" | "telemetry" | "benchmarks" | "security_audit" | "all";

const EMPTY_STATS: LocalDataStats = {
  query_history_count: 0,
  visualization_count: 0,
  benchmark_count: 0,
  hotspot_count: 0,
  security_audit_count: 0,
};

const CLEAR_ACTIONS: {
  scope: ClearScope;
  label: string;
  description: string;
}[] = [
  {
    scope: "query_history",
    label: "Clear Query History",
    description: "Deletes stored query execution history and lineage records.",
  },
  {
    scope: "telemetry",
    label: "Clear Telemetry",
    description: "Deletes visualization events and parameter hotspot observations.",
  },
  {
    scope: "benchmarks",
    label: "Clear Benchmarks",
    description: "Deletes stored benchmark snapshots and benchmark context records.",
  },
  {
    scope: "security_audit",
    label: "Clear Security Audit",
    description: "Deletes locally stored policy, approval, and safety audit records.",
  },
];

export function SafetyDataDialog({ open, onClose }: Props) {
  const [stats, setStats] = useState<LocalDataStats>(EMPTY_STATS);
  const [audit, setAudit] = useState<SecurityAuditRecord[]>([]);
  const [auditEventTypes, setAuditEventTypes] = useState<string[]>([]);
  const [auditOutcomes, setAuditOutcomes] = useState<string[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearingScope, setClearingScope] = useState<ClearScope | null>(null);
  const [exporting, setExporting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextStats, nextAudit, nextEventTypes, nextOutcomes] = await Promise.all([
        DbClient.getLocalDataStats(),
        DbClient.getSecurityAudit({
          event_type: eventTypeFilter || null,
          outcome: outcomeFilter || null,
          limit: 50,
        }),
        DbClient.getSecurityAuditEventTypes(),
        DbClient.getSecurityAuditOutcomes(),
      ]);
      setStats(nextStats);
      setAudit(nextAudit);
      setAuditEventTypes(nextEventTypes);
      setAuditOutcomes(nextOutcomes);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load safety data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, eventTypeFilter, outcomeFilter]);

  const handleClear = async (scope: ClearScope) => {
    const confirmed = window.confirm(
      scope === "all"
        ? "Clear all local history, telemetry, benchmarks, and security audit data?"
        : `Clear stored local data for ${scope.replace("_", " ")}?`
    );
    if (!confirmed) return;

    setClearingScope(scope);
    try {
      await DbClient.clearLocalData(scope);
      await DbClient.recordSecurityAudit({
        event_type: "local_data_reset",
        outcome: "cleared",
        details_json: { scope },
      }).catch(() => {});
      toast.success(scope === "all" ? "Cleared all local data" : `Cleared ${scope.replace("_", " ")}`);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to clear local data");
    } finally {
      setClearingScope(null);
    }
  };

  const handleExportAudit = async () => {
    if (audit.length === 0) {
      toast.error("No audit events to export");
      return;
    }

    setExporting(true);
    try {
      const payload = {
        exported_at: new Date().toISOString(),
        filters: {
          event_type: eventTypeFilter || null,
          outcome: outcomeFilter || null,
        },
        count: audit.length,
        events: audit,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `daitalk-security-audit-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Exported current audit view");
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to export audit events");
    } finally {
      setExporting(false);
    }
  };

  const handleExportSupportBundle = async () => {
    setExporting(true);
    try {
      const [health, localDataStats, securityAudit, workspaceSession, queryConcurrency] =
        await Promise.all([
          DbClient.healthCheck().catch(() => null),
          DbClient.getLocalDataStats().catch(() => null),
          DbClient.getSecurityAudit({ limit: 100 }).catch(() => []),
          DbClient.loadWorkspaceSession().catch(() => null),
          DbClient.getQueryConcurrencyStatus().catch(() => null),
        ]);

      const payload = {
        exported_at: new Date().toISOString(),
        app_health: health,
        local_data_stats: localDataStats,
        query_concurrency: queryConcurrency,
        workspace_session_present: Boolean(workspaceSession),
        workspace_session_preview: workspaceSession ? JSON.parse(workspaceSession) : null,
        recent_security_audit: securityAudit,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `daitalk-support-bundle-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Exported support bundle");
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to export support bundle");
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[86vh] overflow-y-auto bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#00d2ff]" />
            <div>
              <h2 className="text-sm font-bold">Safety & Local Data</h2>
              <p className="text-[11px] text-white/40 mt-1">
                Review what this app stores locally, inspect recent security audit events, and clear stored data.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          <section className="rounded-xl border border-[#262626] bg-[#0d0d0d] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/70">Local Storage Summary</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="Query History" value={stats.query_history_count} />
              <StatCard label="Visualizations" value={stats.visualization_count} />
              <StatCard label="Benchmarks" value={stats.benchmark_count} />
              <StatCard label="Hotspots" value={stats.hotspot_count} />
              <StatCard label="Audit Events" value={stats.security_audit_count} />
            </div>
            <p className="mt-3 text-[11px] text-white/45 leading-relaxed">
              Query history is stored with string literals redacted. Security audit events record policy denials,
              approval decisions, and other safety-relevant actions locally on this device.
            </p>
          </section>

          <section className="rounded-xl border border-[#262626] bg-[#0d0d0d] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/70">Clear Local Data</h3>
            </div>
            <div className="space-y-2">
              {CLEAR_ACTIONS.map((action) => (
                <div
                  key={action.scope}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[#1f1f1f] bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white/85">{action.label}</div>
                    <div className="text-[11px] text-white/45">{action.description}</div>
                  </div>
                  <button
                    onClick={() => handleClear(action.scope)}
                    disabled={clearingScope !== null}
                    className="shrink-0 px-2.5 py-1 rounded border border-red-500/30 bg-red-500/10 text-[11px] font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                  >
                    {clearingScope === action.scope ? "Clearing..." : "Clear"}
                  </button>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-amber-300">Full reset</div>
                  <p className="text-[11px] text-amber-100/70">
                    Use this before demos, support exports, or Store certification testing on a clean profile.
                  </p>
                  <button
                    onClick={() => handleClear("all")}
                    disabled={clearingScope !== null}
                    className="px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                  >
                    {clearingScope === "all" ? "Clearing..." : "Clear Everything"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[#262626] bg-[#0d0d0d] p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/70">Recent Security Audit</h3>
                <p className="text-[11px] text-white/40 mt-1">
                  Most recent safety-relevant events recorded locally by the desktop app.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/35">{audit.length} shown</span>
                <button
                  onClick={handleExportAudit}
                  disabled={exporting || loading || audit.length === 0}
                  className="inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-black/20 px-2 py-1 text-[10px] font-bold text-white/70 hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {exporting ? "Exporting..." : "Export JSON"}
                </button>
                <button
                  onClick={handleExportSupportBundle}
                  disabled={exporting || loading}
                  className="inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-black/20 px-2 py-1 text-[10px] font-bold text-cyan-300/80 hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {exporting ? "Exporting..." : "Support Bundle"}
                </button>
              </div>
            </div>
            <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">Event Type</span>
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#2a2a2a] bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-[#00d2ff]/50"
                >
                  <option value="">All event types</option>
                  {auditEventTypes.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">Outcome</span>
                <select
                  value={outcomeFilter}
                  onChange={(e) => setOutcomeFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#2a2a2a] bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-[#00d2ff]/50"
                >
                  <option value="">All outcomes</option>
                  {auditOutcomes.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {outcome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {audit.length === 0 ? (
                <div className="text-xs text-white/35 rounded-lg border border-dashed border-[#2a2a2a] px-3 py-4">
                  No audit events match the current filter.
                </div>
              ) : (
                audit.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[#1f1f1f] bg-black/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white/85">{entry.event_type}</div>
                        <div className="text-[10px] text-white/40">{entry.created_at}</div>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#00d2ff]">
                        {entry.outcome}
                      </span>
                    </div>
                    <pre className="mt-2 text-[10px] font-mono text-white/45 whitespace-pre-wrap break-words">
                      {JSON.stringify(entry.details_json, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-black/20 px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</div>
      <div className="mt-2 text-lg font-bold text-white">{value.toLocaleString()}</div>
    </div>
  );
}
