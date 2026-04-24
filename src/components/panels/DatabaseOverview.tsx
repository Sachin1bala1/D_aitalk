/**
 * DatabaseOverview — at-a-glance database health panel.
 *
 * Shows for PostgreSQL:
 * - Total DB size (pg_database_size)
 * - Table count + top tables by estimated row count
 * - Cache hit ratio (pg_stat_bgwriter)
 * - Active / idle connections (pg_stat_activity)
 * - Longest running query
 *
 * For other drivers: shows table count + top tables from schema.
 */
import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, Database, Table2, Zap, Wifi, AlertTriangle } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { DbClient } from "../../lib/db/DbClient";
import { toast } from "sonner";

interface OverviewData {
  dbSize: string | null;
  tableCount: number;
  topTables: { name: string; rows: number | null; size?: string }[];
  cacheHitRatio: number | null;
  activeConnections: number | null;
  idleConnections: number | null;
  longestQuery: { pid: number; duration: string; query: string } | null;
}

function Stat({
  label,
  value,
  icon: Icon,
  color = "text-white/60",
  sublabel,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.FC<{ className?: string }>;
  color?: string;
  sublabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a]">
      <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold">{label}</p>
        <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
        {sublabel && <p className="text-[9px] text-white/20 font-mono mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

function CacheBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-bold font-mono ${pct >= 95 ? "text-emerald-400" : pct >= 80 ? "text-amber-400" : "text-red-400"}`}>
        {pct}%
      </span>
      <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 95 ? "bg-emerald-500/70" : pct >= 80 ? "bg-amber-500/70" : "bg-red-500/70"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function DatabaseOverview() {
  const { activeConnectionId, connections, schemas } = useWorkspaceStore();
  const activeConn = connections.find((c) => c.id === activeConnectionId);
  const activeSchema = activeConnectionId ? schemas[activeConnectionId] : null;
  const isPostgres = activeConn?.driver === "postgres" || activeConn?.driver === "timescaledb";

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const load = async () => {
    if (!activeConnectionId) return;
    setLoading(true);
    setError(null);
    abortRef.current = false;

    try {
      if (isPostgres) {
        // DB size
        const sizeRes = await DbClient.query(activeConnectionId, "SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
        const dbSize = (sizeRes[0]?.["size"] as string) ?? null;

        // Cache hit ratio
        let cacheHitRatio: number | null = null;
        try {
          const cacheRes = await DbClient.query(
            activeConnectionId,
            `SELECT round(
               sum(blks_hit)::numeric / NULLIF(sum(blks_hit) + sum(blks_read), 0) * 100, 2
             ) AS ratio FROM pg_stat_database WHERE datname = current_database()`
          );
          const ratioVal = cacheRes[0]?.["ratio"];
          if (ratioVal !== null && ratioVal !== undefined) {
            cacheHitRatio = parseFloat(String(ratioVal)) / 100;
          }
        } catch { /* non-critical */ }

        // Connections
        let activeConnections: number | null = null;
        let idleConnections: number | null = null;
        try {
          const connRes = await DbClient.query(
            activeConnectionId,
            `SELECT state, count(*)::int AS cnt FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`
          );
          for (const row of connRes) {
            const cnt = row["cnt"] as number;
            if (row["state"] === "active") activeConnections = cnt;
            else if (row["state"] === "idle") idleConnections = cnt;
          }
        } catch { /* non-critical */ }

        // Longest running query
        let longestQuery: OverviewData["longestQuery"] = null;
        try {
          const lqRes = await DbClient.query(
            activeConnectionId,
            `SELECT pid, query_start, now() - query_start AS duration, left(query, 120) AS query
             FROM pg_stat_activity
             WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%'
             ORDER BY duration DESC LIMIT 1`
          );
          if (lqRes[0]) {
            longestQuery = {
              pid: lqRes[0]["pid"] as number,
              duration: String(lqRes[0]["duration"] ?? "").split(".")[0],
              query: String(lqRes[0]["query"] ?? ""),
            };
          }
        } catch { /* non-critical */ }

        // Top tables by row estimate + size
        const topTables: OverviewData["topTables"] = [];
        try {
          const tabRes = await DbClient.query(
            activeConnectionId,
            `SELECT schemaname || '.' || relname AS name,
                    n_live_tup::bigint AS rows,
                    pg_size_pretty(pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(relname))) AS size
             FROM pg_stat_user_tables
             ORDER BY n_live_tup DESC LIMIT 10`
          );
          for (const r of tabRes) {
            topTables.push({
              name: String(r["name"]),
              rows: r["rows"] != null ? Number(r["rows"]) : null,
              size: String(r["size"] ?? ""),
            });
          }
        } catch { /* non-critical */ }

        if (!abortRef.current) {
          setData({
            dbSize,
            tableCount: activeSchema?.tables.length ?? 0,
            topTables,
            cacheHitRatio,
            activeConnections,
            idleConnections,
            longestQuery,
          });
        }
      } else {
        // Non-postgres: schema only
        const tables = activeSchema?.tables ?? [];
        const topTables = [...tables]
          .sort((a, b) => (b.row_estimate ?? 0) - (a.row_estimate ?? 0))
          .slice(0, 10)
          .map((t) => ({ name: `${t.schema}.${t.name}`, rows: t.row_estimate }));

        if (!abortRef.current) {
          setData({
            dbSize: null,
            tableCount: tables.length,
            topTables,
            cacheHitRatio: null,
            activeConnections: null,
            idleConnections: null,
            longestQuery: null,
          });
        }
      }
    } catch (e: any) {
      if (!abortRef.current) setError(e.message ?? "Failed to load overview");
    } finally {
      if (!abortRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (activeConnectionId) load();
    return () => { abortRef.current = true; };
  }, [activeConnectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeConnectionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-white/25">No active connection</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold">Overview</p>
          <p className="text-xs text-[#00d2ff]/70 font-mono truncate">{activeConn?.display_name}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded text-white/20 hover:text-white/60 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="flex items-start gap-2 mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-red-300/80 font-mono break-all">{error}</p>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-white/20 font-mono">Loading overview…</p>
          </div>
        )}

        {data && (
          <>
            {/* Top stats */}
            {data.dbSize && (
              <Stat
                icon={Database}
                label="Database Size"
                value={data.dbSize}
                color="text-[#00d2ff]"
              />
            )}
            <Stat
              icon={Table2}
              label="Tables"
              value={data.tableCount.toLocaleString()}
              color="text-white/70"
              sublabel={`${activeConn?.driver} · ${activeConn?.connection_string.replace(/:[^:@]+@/, ":***@").slice(0, 40)}`}
            />
            {data.cacheHitRatio !== null && (
              <div className="px-4 py-3 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Zap className={`w-3.5 h-3.5 ${data.cacheHitRatio >= 0.95 ? "text-emerald-400" : data.cacheHitRatio >= 0.8 ? "text-amber-400" : "text-red-400"}`} />
                  </div>
                  <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold">Cache Hit Ratio</p>
                </div>
                <CacheBar ratio={data.cacheHitRatio} />
                {data.cacheHitRatio < 0.8 && (
                  <p className="text-[9px] text-red-400/60 mt-1 font-mono">
                    Low cache hit — consider increasing shared_buffers
                  </p>
                )}
              </div>
            )}
            {(data.activeConnections !== null || data.idleConnections !== null) && (
              <Stat
                icon={Wifi}
                label="Connections"
                value={`${data.activeConnections ?? 0} active · ${data.idleConnections ?? 0} idle`}
                color="text-white/60"
              />
            )}

            {/* Longest running query */}
            {data.longestQuery && (
              <div className="px-4 py-3 border-b border-[#1a1a1a]">
                <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold mb-2">Longest Active Query</p>
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-mono text-amber-400/60">PID {data.longestQuery.pid}</span>
                    <span className="text-[9px] font-mono text-amber-400/80 font-bold">{data.longestQuery.duration}</span>
                  </div>
                  <p className="text-[9px] font-mono text-white/40 break-all leading-relaxed line-clamp-3">
                    {data.longestQuery.query}
                  </p>
                </div>
              </div>
            )}

            {/* Top tables */}
            {data.topTables.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold mb-2">
                  Top Tables by Row Count
                </p>
                <div className="space-y-1">
                  {data.topTables.map((t, i) => {
                    const maxRows = data.topTables[0]?.rows ?? 1;
                    const pct = maxRows && t.rows ? Math.max(4, (t.rows / maxRows) * 100) : 4;
                    return (
                      <div key={t.name} className="flex items-center gap-2">
                        <span className="text-[8px] text-white/20 font-mono w-3 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-[9px] font-mono text-white/55 truncate flex-1">{t.name}</span>
                            <span className="text-[9px] font-mono text-white/30 shrink-0">
                              {t.rows != null ? (
                                t.rows >= 1_000_000
                                  ? (t.rows / 1_000_000).toFixed(1) + "M"
                                  : t.rows >= 1000
                                  ? (t.rows / 1000).toFixed(0) + "K"
                                  : t.rows.toLocaleString()
                              ) : "—"}
                              {t.size ? ` · ${t.size}` : ""}
                            </span>
                          </div>
                          <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#00d2ff]/30 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
