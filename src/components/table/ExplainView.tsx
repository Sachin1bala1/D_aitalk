/**
 * ExplainView — renders PostgreSQL EXPLAIN (ANALYZE) text output as a
 * collapsible, cost-annotated tree.
 *
 * Parses lines like:
 *   ->  Seq Scan on orders  (cost=0.00..18.50 rows=850 width=36)
 *                           (actual time=0.012..0.038 rows=850 loops=1)
 *
 * Color-codes nodes by relative cost.
 */
import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown as ChevronDownIcon, Lightbulb, Copy } from "lucide-react";
import { toast } from "sonner";

interface PlanNode {
  id: number;
  indent: number;
  nodeType: string;     // "Seq Scan", "Hash Join", etc.
  relation: string;     // "on orders" or ""
  estCost: number | null;
  estRows: number | null;
  actTime: number | null;
  actRows: number | null;
  loops: number | null;
  rawLine: string;
  extra: string[];      // continuation lines
  children: PlanNode[];
}

// ── Parser ────────────────────────────────────────────────────────────────────

const NODE_RE = /^(\s*(?:->|)?\s*)(.+?)\s+\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)/;
const ACTUAL_RE = /actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)/;
const RELATION_RE = /\bon\s+([\w."]+)/i;

function parseExplain(text: string): PlanNode[] {
  const lines = text.split("\n");
  const roots: PlanNode[] = [];
  const stack: PlanNode[] = [];
  let idSeq = 0;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const nodeMatch = NODE_RE.exec(rawLine);
    if (!nodeMatch) {
      // Continuation / actual time line — attach to top of stack
      if (stack.length > 0) {
        const actMatch = ACTUAL_RE.exec(rawLine);
        const top = stack[stack.length - 1];
        if (actMatch) {
          top.actTime = parseFloat(actMatch[2]);
          top.actRows = parseInt(actMatch[3]);
          top.loops = parseInt(actMatch[4]);
        } else {
          top.extra.push(rawLine.trim());
        }
      }
      continue;
    }

    const indent = (nodeMatch[1].match(/\s/g) ?? []).length;
    const typeAndRel = nodeMatch[2].trim();
    const relMatch = RELATION_RE.exec(typeAndRel);
    const relation = relMatch ? relMatch[0] : "";
    const nodeType = typeAndRel.replace(RELATION_RE, "").replace(/^\s*->\s*/, "").trim();
    const estCost = parseFloat(nodeMatch[4]);
    const estRows = parseInt(nodeMatch[5]);

    const node: PlanNode = {
      id: idSeq++,
      indent,
      nodeType,
      relation,
      estCost,
      estRows,
      actTime: null,
      actRows: null,
      loops: null,
      rawLine,
      extra: [],
      children: [],
    };

    // Pop stack to find parent
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

// ── Cost coloring ─────────────────────────────────────────────────────────────

function costColor(cost: number | null, maxCost: number): string {
  if (cost === null || maxCost === 0) return "text-white/50";
  const ratio = cost / maxCost;
  if (ratio > 0.7) return "text-red-400";
  if (ratio > 0.3) return "text-amber-400";
  return "text-emerald-400/80";
}

function findMaxCost(nodes: PlanNode[]): number {
  let max = 0;
  for (const n of nodes) {
    if (n.estCost !== null && n.estCost > max) max = n.estCost;
    const childMax = findMaxCost(n.children);
    if (childMax > max) max = childMax;
  }
  return max;
}

// ── Tree node component ───────────────────────────────────────────────────────

function PlanNodeRow({
  node,
  maxCost,
  depth,
}: {
  node: PlanNode;
  maxCost: number;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const cc = costColor(node.estCost, maxCost);

  const slowRatio = node.actTime !== null && maxCost > 0
    ? Math.min(1, (node.actTime / maxCost) * 2)
    : 0;

  return (
    <>
      <div
        className="flex items-start gap-1.5 py-1 px-2 hover:bg-white/[0.03] rounded group cursor-pointer"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        {/* Toggle */}
        <span className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/20">
          {hasChildren
            ? open
              ? <ChevronDownIcon className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            : <span className="w-3.5 h-3.5 block" />}
        </span>

        {/* Cost bar */}
        {node.estCost !== null && (
          <div className="w-16 shrink-0 mt-1.5">
            <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  slowRatio > 0.7 ? "bg-red-500/70" :
                  slowRatio > 0.3 ? "bg-amber-500/70" :
                  "bg-emerald-500/60"
                }`}
                style={{ width: `${Math.max(4, slowRatio * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Node type */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold text-white/80">
              {node.nodeType}
            </span>
            {node.relation && (
              <span className="text-[10px] text-[#00d2ff]/60 font-mono">{node.relation}</span>
            )}
          </div>
          {node.extra.length > 0 && (
            <p className="text-[9px] text-white/25 font-mono truncate mt-0.5">{node.extra.join(" ")}</p>
          )}
        </div>

        {/* Stats */}
        <div className="text-right shrink-0 space-y-0.5">
          {node.estCost !== null && (
            <div className={`text-[10px] font-mono ${cc}`}>
              cost={node.estCost.toFixed(2)}
            </div>
          )}
          {node.actTime !== null && (
            <div className="text-[9px] font-mono text-white/35">
              {node.actTime.toFixed(3)}ms
              {node.actRows !== null && ` · ${node.actRows.toLocaleString()} rows`}
            </div>
          )}
          {node.estRows !== null && node.actRows === null && (
            <div className="text-[9px] font-mono text-white/25">
              ~{node.estRows.toLocaleString()} rows
            </div>
          )}
        </div>
      </div>

      {open && node.children.map((child) => (
        <PlanNodeRow key={child.id} node={child} maxCost={maxCost} depth={depth + 1} />
      ))}
    </>
  );
}

// ── Index suggestions ─────────────────────────────────────────────────────────

interface Suggestion {
  type: "seq_scan" | "rows_removed" | "nested_loop";
  message: string;
  sql?: string;
}

function collectSuggestions(nodes: PlanNode[], maxCost: number): Suggestion[] {
  const suggestions: Suggestion[] = [];

  function walk(n: PlanNode) {
    // Seq scan on large tables → suggest index
    if (
      n.nodeType.includes("Seq Scan") &&
      n.relation &&
      n.estRows !== null &&
      n.estRows > 10_000 &&
      n.estCost !== null &&
      n.estCost / Math.max(maxCost, 1) > 0.2
    ) {
      const tableMatch = n.relation.match(/on\s+([\w."]+)/i);
      const table = tableMatch ? tableMatch[1].replace(/"/g, "") : "table";
      const filterLine = n.extra.find((e) => e.startsWith("Filter:"));
      const colMatch = filterLine?.match(/\(([^)]+)\s*[=<>]/);
      const col = colMatch ? colMatch[1].trim().replace(/"/g, "") : null;
      suggestions.push({
        type: "seq_scan",
        message: `Sequential scan on ${table} (${n.estRows.toLocaleString()} rows est.) — consider an index`,
        sql: col
          ? `CREATE INDEX CONCURRENTLY ON ${table} (${col});`
          : `CREATE INDEX CONCURRENTLY ON ${table} (<filter_column>);`,
      });
    }

    // Nested loop with high row estimates → suggest hash join
    if (n.nodeType.includes("Nested Loop") && n.actTime !== null && n.actTime > 100) {
      suggestions.push({
        type: "nested_loop",
        message: `Nested Loop took ${n.actTime.toFixed(1)}ms — consider SET enable_nestloop=off or add join index`,
      });
    }

    for (const c of n.children) walk(c);
  }

  for (const n of nodes) walk(n);
  return suggestions;
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ExplainViewProps {
  /** Raw rows from EXPLAIN output — each row has a single text column */
  rows: Record<string, unknown>[];
}

export function ExplainView({ rows }: ExplainViewProps) {
  const text = useMemo(() => {
    // EXPLAIN rows typically have one column ("QUERY PLAN")
    return rows
      .map((r) => Object.values(r)[0])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v))
      .join("\n");
  }, [rows]);

  const nodes = useMemo(() => parseExplain(text), [text]);
  const maxCost = useMemo(() => findMaxCost(nodes), [nodes]);
  const suggestions = useMemo(() => collectSuggestions(nodes, maxCost), [nodes, maxCost]);

  if (nodes.length === 0) {
    return (
      <div className="p-4 text-xs text-white/30 font-mono whitespace-pre">{text}</div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#1a1a1a] text-[9px] text-white/25 uppercase tracking-widest shrink-0">
        <span className="w-3.5" />
        <span className="w-16">Cost</span>
        <span className="flex-1">Node</span>
        <span>Stats</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.map((n) => (
          <PlanNodeRow key={n.id} node={n} maxCost={maxCost} depth={0} />
        ))}
      </div>
      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="border-t border-[#1a1a1a] px-3 py-2 space-y-1.5 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-amber-400/60 mb-1">
            <Lightbulb className="w-3 h-3" />
            <span>{suggestions.length} suggestion{suggestions.length > 1 ? "s" : ""}</span>
          </div>
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/15 rounded-lg px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-amber-300/80">{s.message}</p>
                {s.sql && (
                  <code className="text-[9px] font-mono text-white/40 block mt-0.5 truncate">{s.sql}</code>
                )}
              </div>
              {s.sql && (
                <button
                  onClick={() => { navigator.clipboard.writeText(s.sql!); toast.success("Copied to clipboard"); }}
                  className="shrink-0 p-0.5 text-white/20 hover:text-white/60 transition-colors mt-0.5"
                  title="Copy SQL"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-[#1a1a1a] text-[9px] text-white/20 flex gap-4 shrink-0">
        <span><span className="text-red-400 font-bold">■</span> High cost</span>
        <span><span className="text-amber-400 font-bold">■</span> Medium</span>
        <span><span className="text-emerald-400 font-bold">■</span> Low</span>
        <span className="ml-auto">Click nodes to collapse</span>
      </div>
    </div>
  );
}
