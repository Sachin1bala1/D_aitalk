/**
 * SessionMonitor — shows live pg_stat_activity for the active PostgreSQL connection.
 * Auto-refreshes every 5s. Allows killing a backend pid.
 * Non-Postgres connections show a friendly "not supported" message.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, XCircle, Loader2 } from "lucide-react";
import { DbClient } from "../../lib/db/DbClient";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { QueryBatch } from "../../lib/db/DbClient";

interface Session {
  pid: number;
  usename: string;
  application_name: string;
  client_addr: string;
  state: string;
  wait_event_type: string | null;
  wait_event: string | null;
  query: string;
  duration_ms: number | null;
}

const SESSION_SQL = `
SELECT
  pid,
  usename,
  application_name,
  client_addr::text,
  state,
  wait_event_type,
  wait_event,
  LEFT(query, 120) AS query,
  EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000 AS duration_ms
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
ORDER BY duration_ms DESC NULLS LAST
LIMIT 100
`.trim();

const KILL_SQL = (pid: number) => `SELECT pg_terminate_backend(${pid})`;

export function SessionMonitor() {
  const { activeConnectionId, connections } = useWorkspaceStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const activeConn = connections.find((c) => c.id === activeConnectionId);
  const isPostgres = activeConn?.driver === "postgres" || activeConn?.driver === "timescaledb";

  const fetchSessions = useCallback(async () => {
    if (!activeConnectionId || !isPostgres) return;
    setLoading(true);
    setError(null);

    try {
      const queryId = await DbClient.executeStreaming(activeConnectionId, SESSION_SQL);
      const rows: Session[] = [];

      const unlisten = await listen<QueryBatch>("query_batch", (event) => {
        const batch = event.payload;
        if (batch.query_id !== queryId) return;

        if (batch.error) {
          setError(batch.error);
          setLoading(false);
          unlisten();
          return;
        }

        for (const row of batch.rows) {
          rows.push({
            pid: Number(row["pid"]),
            usename: String(row["usename"] ?? ""),
            application_name: String(row["application_name"] ?? ""),
            client_addr: String(row["client_addr"] ?? ""),
            state: String(row["state"] ?? ""),
            wait_event_type: row["wait_event_type"] != null ? String(row["wait_event_type"]) : null,
            wait_event: row["wait_event"] != null ? String(row["wait_event"]) : null,
            query: String(row["query"] ?? ""),
            duration_ms: row["duration_ms"] != null ? Number(row["duration_ms"]) : null,
          });
        }

        if (batch.is_final) {
          setSessions(rows);
          setLoading(false);
          setLastRefresh(new Date());
          unlisten();
        }
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setLoading(false);
    }
  }, [activeConnectionId, isPostgres]);

  // Initial load + auto-refresh every 5s
  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  const handleKill = async (pid: number) => {
    if (!activeConnectionId) return;
    try {
      await DbClient.executeStreaming(activeConnectionId, KILL_SQL(pid));
      toast.success(`Terminated backend PID ${pid}`);
      setTimeout(fetchSessions, 500);
    } catch (e: any) {
      toast.error(`Failed to terminate PID ${pid}: ${e?.message}`);
    }
  };

  const stateColor = (state: string) => {
    if (state === "active") return "text-emerald-400";
    if (state === "idle in transaction") return "text-amber-400";
    if (state === "idle") return "text-white/30";
    return "text-white/50";
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  };

  if (!isPostgres) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
        <Activity className="w-8 h-8" />
        <p className="text-xs font-mono">Session monitor requires PostgreSQL</p>
        {activeConn && (
          <p className="text-[10px] font-mono text-white/15">Current: {activeConn.driver}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2 text-white/40">
          <Activity className="w-3.5 h-3.5" />
          <span className="font-mono font-bold text-white/60">Sessions</span>
          {sessions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[10px] font-mono text-white/30">
              {sessions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] font-mono text-white/20">
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchSessions}
            disabled={loading}
            className="p-1 text-white/20 hover:text-white/60 transition-colors disabled:opacity-40"
            title="Refresh now"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-mono text-[10px]">
          {error}
        </div>
      )}

      {/* Sessions table */}
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 && !loading && !error && (
          <div className="flex items-center justify-center h-24 text-white/20 font-mono text-[10px]">
            No active sessions
          </div>
        )}
        {sessions.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#1a1a1a] sticky top-0 bg-[#0d0d0d]">
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">PID</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">User</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">App</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">State</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">Duration</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">Wait</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-mono text-white/30 font-normal">Query</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.pid}
                  className="border-b border-[#111] hover:bg-white/[0.02] group"
                >
                  <td className="px-3 py-1.5 font-mono text-white/40 text-[10px]">{s.pid}</td>
                  <td className="px-3 py-1.5 font-mono text-white/60 text-[10px]">{s.usename || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-white/40 text-[10px] max-w-[80px] truncate">{s.application_name || "—"}</td>
                  <td className={`px-3 py-1.5 font-mono text-[10px] ${stateColor(s.state)}`}>{s.state || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-white/50 text-[10px]">{formatDuration(s.duration_ms)}</td>
                  <td className="px-3 py-1.5 font-mono text-amber-400/60 text-[10px]">
                    {s.wait_event ? `${s.wait_event_type}/${s.wait_event}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-white/30 text-[10px] max-w-[200px] truncate" title={s.query}>
                    {s.query || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => handleKill(s.pid)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-red-500/50 hover:text-red-400 transition-all"
                      title={`Terminate PID ${s.pid}`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
