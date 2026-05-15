'use client'; // not needed but harmless
import React, { useEffect, useState } from 'react';
import {
  FailureTraceStore,
  HarnessFailureTrace,
  HarnessVersion,
} from '../../lib/agent/harness/FailureTraceStore';
import {
  HarnessOptimizer,
  OptimizationReport,
} from '../../lib/agent/harness/HarnessOptimizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseToolsUsed(raw: string): number {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-gray-800 rounded-lg px-5 py-4 flex-1 min-w-0">
      <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-semibold text-gray-100">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HarnessDashboard() {
  const [failures, setFailures] = useState<HarnessFailureTrace[]>([]);
  const [versions, setVersions] = useState<HarnessVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<HarnessVersion | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Load data on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    Promise.all([
      FailureTraceStore.getFailures(20),
      FailureTraceStore.getVersions(),
      FailureTraceStore.getActiveVersion(),
    ])
      .then(([f, v, a]) => {
        setFailures(f);
        setVersions(v);
        setActiveVersion(a);
      })
      .catch(console.error);
  }, []);

  // -------------------------------------------------------------------------
  // Refresh versions + active version
  // -------------------------------------------------------------------------

  async function refreshVersions() {
    const [v, a] = await Promise.all([
      FailureTraceStore.getVersions(),
      FailureTraceStore.getActiveVersion(),
    ]);
    setVersions(v);
    setActiveVersion(a);
  }

  // -------------------------------------------------------------------------
  // Activate a version
  // -------------------------------------------------------------------------

  async function handleActivate(id: number) {
    try {
      await FailureTraceStore.activateVersion(id);
      await refreshVersions();
    } catch (err) {
      console.error('activateVersion failed', err);
    }
  }

  // -------------------------------------------------------------------------
  // Run optimizer
  // -------------------------------------------------------------------------

  async function handleRunOptimizer() {
    setOptimizing(true);
    setMessage(null);
    try {
      const report: OptimizationReport | null = await HarnessOptimizer.optimize(3);
      if (report === null) {
        setMessage('Not enough failure data (need 3+ traces)');
      } else {
        const tag = report.generatedVersion?.version_tag ?? 'unknown';
        setMessage(`Created version ${tag} — activate it in the Versions table below`);
        await refreshVersions();
      }
    } catch (err) {
      setMessage(`Optimizer error: ${err}`);
    } finally {
      setOptimizing(false);
    }
  }

  // -------------------------------------------------------------------------
  // Derived stats
  // -------------------------------------------------------------------------

  const successRate =
    activeVersion?.success_rate != null
      ? `${(activeVersion.success_rate * 100).toFixed(1)}%`
      : 'N/A';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6 p-6 bg-gray-900 min-h-screen text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Harness Dashboard</h1>
        <button
          onClick={handleRunOptimizer}
          disabled={optimizing}
          className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
        >
          {optimizing ? 'Running…' : 'Run Optimizer'}
        </button>
      </div>

      {/* Message toast */}
      {message && (
        <div className="rounded-md bg-gray-800 border border-gray-700 px-4 py-3 text-sm text-gray-300">
          {message}
        </div>
      )}

      {/* Stats row */}
      <div className="flex gap-4">
        <StatCard label="Total Failures" value={String(failures.length)} />
        <StatCard
          label="Active Version"
          value={activeVersion?.version_tag ?? 'None'}
        />
        <StatCard label="Success Rate" value={successRate} />
      </div>

      {/* Recent Failures */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Recent Failures
        </h2>
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          {failures.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">
              No failure traces recorded yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Question</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Tools</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Duration</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Success</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((trace) => (
                  <tr
                    key={trace.id}
                    className="border-b border-gray-700 last:border-0 hover:bg-gray-750"
                  >
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {formatDate(trace.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-xs">
                      {truncate(trace.question, 60)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {parseToolsUsed(trace.tools_used)} tools
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {formatDuration(trace.duration_ms)}
                    </td>
                    <td className="px-4 py-3">
                      {trace.final_success ? (
                        <span className="text-green-400 font-medium">✓</span>
                      ) : (
                        <span className="text-red-400 font-medium">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Versions */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Versions
        </h2>
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          {versions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">
              No versions created yet. Run the optimizer to create one.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Version</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">
                    Prompt Addition
                  </th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Success Rate</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-gray-700 last:border-0 hover:bg-gray-750"
                  >
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap font-mono text-xs">
                      {v.version_tag}
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-sm">
                      {truncate(v.system_prompt_additions, 80)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {v.success_rate != null
                        ? `${(v.success_rate * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {v.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900 text-green-300">
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => handleActivate(v.id)}
                          className="px-3 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
