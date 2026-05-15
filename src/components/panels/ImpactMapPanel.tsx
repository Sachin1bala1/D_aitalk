import React from 'react';
import { useWorkspaceStore } from '../../lib/stores/WorkspaceStore';

export function ImpactMapPanel() {
  const impactMap = useWorkspaceStore(s => s.impactMapResolution);

  if (!impactMap) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        No impact map — run a query in Plan Mode to see pre-execution analysis.
      </div>
    );
  }

  const riskColors: Record<string, string> = {
    safe: 'text-green-400',
    caution: 'text-yellow-400',
    destructive: 'text-red-400',
  };

  return (
    <div className="p-4 space-y-4 text-sm text-gray-200">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Impact Map</span>
        <span className={`text-xs px-2 py-0.5 rounded-full bg-gray-700 ${riskColors[impactMap.overallRisk] ?? 'text-gray-400'}`}>
          {impactMap.overallRisk}
        </span>
      </div>
      <p className="text-gray-400">{impactMap.summary}</p>

      {/* Nodes */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Affected Objects ({impactMap.nodes.length})</div>
        <div className="space-y-1">
          {impactMap.nodes.map(node => (
            <div key={node.id} className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1">
              <span className="text-xs text-gray-500 w-16 shrink-0">{node.type}</span>
              <span className="font-mono text-xs">{node.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Edges */}
      {impactMap.edges.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Operations ({impactMap.edges.length})</div>
          <div className="space-y-1">
            {impactMap.edges.map((edge, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-gray-400">{edge.from}</span>
                <span className={`px-1.5 py-0.5 rounded ${riskColors[edge.riskLevel] ?? 'text-gray-400'} bg-gray-800`}>
                  {edge.edgeType}
                </span>
                <span className="font-mono text-gray-400">{edge.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
