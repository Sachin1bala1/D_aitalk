/**
 * ERDiagram — Entity-Relationship diagram rendered with React Flow.
 *
 * Reads tables and foreign keys from FullSchema and renders:
 * - Table nodes with column lists, PK/FK badges
 * - FK edges with labels
 * - Smart layout: connected components clustered together, isolated tables in grid
 * - Filter: "connected only" toggle shows only FK-linked tables
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FullSchema } from "../../lib/db/DbClient";
import { Filter, LayoutGrid } from "lucide-react";

// ── Table Node ────────────────────────────────────────────────────────────────

interface ColDef { name: string; type: string; isPk: boolean; isFk: boolean }

function TableNode({ data }: { data: { label: string; schema: string; columns: ColDef[]; rowEstimate: number | null } }) {
  return (
    <div className="bg-[#161616] border border-[#2a2a2a] rounded-lg overflow-hidden min-w-[200px] max-w-[240px] shadow-2xl">
      <Handle type="target" position={Position.Left} className="!bg-[#00d2ff] !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-[#00d2ff] !w-2 !h-2 !border-0" />
      {/* Header */}
      <div className="bg-[#00d2ff]/10 border-b border-[#262626] px-3 py-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold text-[#00d2ff] font-mono truncate flex-1">{data.label}</span>
        {data.schema !== "public" && (
          <span className="text-[8px] text-white/25 font-mono shrink-0">{data.schema}</span>
        )}
        {data.rowEstimate !== null && (
          <span className="text-[8px] text-white/20 font-mono shrink-0">
            ~{data.rowEstimate >= 1_000_000 ? (data.rowEstimate / 1_000_000).toFixed(1) + "M" : data.rowEstimate >= 1000 ? (data.rowEstimate / 1000).toFixed(0) + "K" : data.rowEstimate}
          </span>
        )}
      </div>
      {/* Columns */}
      <div className="px-2 py-1">
        {data.columns.slice(0, 14).map((col) => (
          <div key={col.name} className="flex items-center gap-1.5 py-0.5">
            {col.isPk ? (
              <span className="text-[7px] text-amber-400 font-bold w-4 shrink-0 text-center leading-none border border-amber-500/30 rounded px-0.5 py-px">PK</span>
            ) : col.isFk ? (
              <span className="text-[7px] text-[#00d2ff]/60 font-bold w-4 shrink-0 text-center leading-none border border-[#00d2ff]/20 rounded px-0.5 py-px">FK</span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="text-[10px] text-white/65 font-mono truncate flex-1">{col.name}</span>
            <span className="text-[8px] text-white/20 font-mono shrink-0">{col.type.split("(")[0].split(" ")[0]}</span>
          </div>
        ))}
        {data.columns.length > 14 && (
          <div className="text-[9px] text-white/20 py-0.5 pl-5">
            +{data.columns.length - 14} more
          </div>
        )}
      </div>
    </div>
  );
}

const NODE_TYPES = { table: TableNode };

// ── Smart Layout ──────────────────────────────────────────────────────────────

/**
 * Build connected components using union-find, then arrange each cluster
 * as a tight grid. Isolated tables go in a separate section.
 */
function smartLayout(
  tableKeys: string[],
  edges: Edge[]
): Record<string, { x: number; y: number }> {
  // Union-find
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (parent[x] === undefined) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string) => { parent[find(a)] = find(b); };

  for (const e of edges) { union(e.source, e.target); }

  // Group by component
  const groups: Record<string, string[]> = {};
  for (const key of tableKeys) {
    const root = find(key);
    if (!groups[root]) groups[root] = [];
    groups[root].push(key);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const COL_W = 260, ROW_H = 280;
  let clusterY = 0;

  // Sort clusters: largest first
  const clusters = Object.values(groups).sort((a, b) => b.length - a.length);

  for (const cluster of clusters) {
    const cols = Math.ceil(Math.sqrt(cluster.length));
    cluster.forEach((key, i) => {
      positions[key] = {
        x: (i % cols) * COL_W,
        y: clusterY + Math.floor(i / cols) * ROW_H,
      };
    });
    const rows = Math.ceil(cluster.length / cols);
    clusterY += rows * ROW_H + 60; // gap between clusters
  }

  return positions;
}

// ── Schema → Nodes + Edges ────────────────────────────────────────────────────

function buildNodesAndEdges(
  schema: FullSchema,
  connectedOnly: boolean
): { nodes: Node[]; edges: Edge[] } {
  // Determine FK-connected table keys
  const connectedKeys = new Set<string>();
  for (const fk of schema.foreign_keys) {
    connectedKeys.add(fk.from_table);
    connectedKeys.add(fk.to_table);
  }

  // Also mark FK columns
  const fkColMap: Record<string, Set<string>> = {};
  for (const fk of schema.foreign_keys) {
    if (!fkColMap[fk.from_table]) fkColMap[fk.from_table] = new Set();
    fkColMap[fk.from_table].add(fk.from_column);
  }

  const filteredTables = connectedOnly
    ? schema.tables.filter((t) => connectedKeys.has(`${t.schema}.${t.name}`) || connectedKeys.has(t.name))
    : schema.tables;

  // Build edges first (for layout)
  const edges: Edge[] = schema.foreign_keys.map((fk, i) => ({
    id: `fk-${i}`,
    source: connectedKeys.has(fk.from_table) ? fk.from_table : `${filteredTables.find(t => t.name === fk.from_table.split(".").pop())?.schema ?? "public"}.${fk.from_table.split(".").pop()}`,
    target: connectedKeys.has(fk.to_table) ? fk.to_table : `${filteredTables.find(t => t.name === fk.to_table.split(".").pop())?.schema ?? "public"}.${fk.to_table.split(".").pop()}`,
    label: `${fk.from_column} → ${fk.to_column}`,
    labelStyle: { fontSize: 8, fill: "#ffffff35" },
    labelBgStyle: { fill: "#111", fillOpacity: 0.8 },
    style: { stroke: "#00d2ff40", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#00d2ff50", width: 10, height: 10 },
    type: "smoothstep",
  }));

  const tableKeys = filteredTables.map((t) => `${t.schema}.${t.name}`);
  const positions = smartLayout(tableKeys, edges);

  const nodes: Node[] = filteredTables.map((t) => {
    const key = `${t.schema}.${t.name}`;
    const cols = (schema.columns[key] ?? schema.columns[t.name] ?? []).map((c) => ({
      name: c.name,
      type: c.type_name,
      isPk: c.is_primary_key,
      isFk: fkColMap[key]?.has(c.name) ?? fkColMap[t.name]?.has(c.name) ?? false,
    }));

    const pos = positions[key] ?? { x: 0, y: 0 };
    return {
      id: key,
      type: "table",
      position: pos,
      data: {
        label: t.name,
        schema: t.schema,
        columns: cols,
        rowEstimate: t.row_estimate,
      },
    };
  });

  return { nodes, edges };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  schema: FullSchema | null;
}

export function ERDiagram({ schema }: Props) {
  const [connectedOnly, setConnectedOnly] = useState(false);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => (schema ? buildNodesAndEdges(schema, connectedOnly) : { nodes: [], edges: [] }),
    [schema, connectedOnly]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  if (!schema) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-3 opacity-20">⬡</div>
          <p className="text-xs text-white/25">Connect a database to view the ER diagram</p>
        </div>
      </div>
    );
  }

  if (schema.tables.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-white/25">No tables found in schema</p>
      </div>
    );
  }

  const fkCount = schema.foreign_keys.length;
  const connectedCount = new Set(
    schema.foreign_keys.flatMap((fk) => [fk.from_table, fk.to_table])
  ).size;

  return (
    <div className="h-full w-full bg-[#0a0a0a] relative">
      {/* Toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
        <button
          onClick={() => setConnectedOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider border transition-colors ${
            connectedOnly
              ? "bg-[#00d2ff]/10 border-[#00d2ff]/30 text-[#00d2ff]"
              : "bg-[#111] border-[#2a2a2a] text-white/40 hover:text-white/70"
          }`}
          title={connectedOnly ? "Show all tables" : "Show FK-connected tables only"}
        >
          <Filter className="w-2.5 h-2.5" />
          {connectedOnly ? `${connectedCount} linked` : "All tables"}
        </button>
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#111] border border-[#2a2a2a] text-[9px] font-mono text-white/25">
          <LayoutGrid className="w-2.5 h-2.5" />
          {nodes.length} · {fkCount} FK
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1a1a" gap={20} size={1} />
        <Controls
          style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8 }}
          showInteractive={false}
        />
        <MiniMap
          style={{ background: "#111", border: "1px solid #2a2a2a" }}
          nodeColor={(n) => (n.data as any).isPk ? "#f59e0b30" : "#00d2ff18"}
          maskColor="rgba(0,0,0,0.65)"
        />
      </ReactFlow>
    </div>
  );
}
