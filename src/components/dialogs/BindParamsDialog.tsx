/**
 * BindParamsDialog — collects values for SQL bind parameters before execution.
 * Detects $1/$2/... (PostgreSQL positional) and :name (named) patterns.
 * Returns substituted SQL with literals on confirm.
 */
import React, { useState, useEffect } from "react";
import { X, Play, Variable } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface BindParamsDialogProps {
  open: boolean;
  sql: string;
  onConfirm: (substitutedSql: string) => void;
  onCancel: () => void;
}

interface Param {
  placeholder: string; // "$1" or ":name"
  key: string;         // "1" or "name"
  kind: "positional" | "named";
}

export function detectParams(sql: string): Param[] {
  const seen = new Set<string>();
  const params: Param[] = [];

  // Named params :foo (not inside strings — simple heuristic: skip :// for URLs)
  const namedRe = /:([a-zA-Z_]\w*)/g;
  let m;
  while ((m = namedRe.exec(sql)) !== null) {
    const key = m[1];
    if (!seen.has(`:${key}`)) {
      seen.add(`:${key}`);
      params.push({ placeholder: `:${key}`, key, kind: "named" });
    }
  }

  // Positional $1..$99
  const posRe = /\$(\d+)/g;
  const positional: number[] = [];
  while ((m = posRe.exec(sql)) !== null) {
    const n = parseInt(m[1], 10);
    if (!positional.includes(n)) positional.push(n);
  }
  positional.sort((a, b) => a - b).forEach((n) => {
    if (!seen.has(`$${n}`)) {
      seen.add(`$${n}`);
      params.push({ placeholder: `$${n}`, key: String(n), kind: "positional" });
    }
  });

  return params;
}

export function substituteParams(sql: string, params: Param[], values: Record<string, string>): string {
  let result = sql;
  // Replace longest placeholders first to avoid partial matches
  const sorted = [...params].sort((a, b) => b.placeholder.length - a.placeholder.length);
  for (const p of sorted) {
    const raw = values[p.key] ?? "";
    // Quote strings unless they look numeric or NULL
    const isNumeric = /^-?\d+(\.\d+)?$/.test(raw.trim());
    const isNull = raw.trim().toUpperCase() === "NULL";
    const literal = isNull ? "NULL" : isNumeric ? raw.trim() : `'${raw.replace(/'/g, "''")}'`;
    // Escape the placeholder for regex
    const escaped = p.placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), literal);
  }
  return result;
}

export function BindParamsDialog({ open, sql, onConfirm, onCancel }: BindParamsDialogProps) {
  const params = detectParams(sql);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setValues({});
  }, [open, sql]);

  const handleConfirm = () => {
    const substituted = substituteParams(sql, params, values);
    onConfirm(substituted);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleConfirm();
    if (e.key === "Escape") onCancel();
  };

  if (params.length === 0) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onKeyDown={handleKeyDown}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="relative w-full max-w-md bg-[#0d0d0d] border border-[#262626] rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#262626]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-500/10 rounded-lg flex items-center justify-center">
                  <Variable className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white/80">Bind Parameters</h2>
                  <p className="text-[11px] text-white/30 font-mono">{params.length} parameter{params.length !== 1 ? "s" : ""} detected</p>
                </div>
              </div>
              <button onClick={onCancel} className="p-1.5 text-white/20 hover:text-white/60 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Params */}
            <div className="px-5 py-4 space-y-3">
              {params.map((p) => (
                <div key={p.key} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[11px] font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded px-2 py-1 text-center">
                    {p.placeholder}
                  </span>
                  <input
                    autoFocus={p === params[0]}
                    type="text"
                    placeholder="value (NULL for null)"
                    value={values[p.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                    className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#1a1a1a] bg-[#0a0a0a]">
              <span className="text-[10px] text-white/20 font-mono">Ctrl+Enter to run</span>
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#00d2ff]/10 hover:bg-[#00d2ff]/20 text-[#00d2ff] text-xs font-bold transition-colors"
                >
                  <Play className="w-3 h-3" /> Run
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
