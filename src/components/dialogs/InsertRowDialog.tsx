/**
 * InsertRowDialog — form to INSERT a new row into the current table.
 * Uses QueryManager to determine the target table and its column metadata.
 * Generates and executes an INSERT SQL statement.
 */
import React, { useState, useEffect } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { DbClient } from "../../lib/db/DbClient";
import { QueryManager } from "../../lib/table/QueryManager";
import { rowStore } from "../../lib/table/RowStore";
import type { ColumnMeta } from "../../lib/db/DbClient";

interface InsertRowDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function sqlLiteralForInsert(val: string, col: ColumnMeta): string {
  const trimmed = val.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return "NULL";
  const kind = col.display_type?.kind;
  if (kind === "boolean") return trimmed.toLowerCase() === "true" ? "TRUE" : "FALSE";
  if (kind === "integer") { const n = parseInt(trimmed, 10); if (!isNaN(n)) return String(n); }
  if (kind === "float") { const n = parseFloat(trimmed); if (!isNaN(n)) return String(n); }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function InsertRowDialog({ open, onClose, onSuccess }: InsertRowDialogProps) {
  const columns = rowStore.columns;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset values when opened
  useEffect(() => {
    if (open) setValues({});
  }, [open]);

  const tableInfo = QueryManager.getBaseTable();
  const connectionId = QueryManager.getConnectionId();

  const editableCols = columns.filter((c) => !c.is_primary_key || c.display_type?.kind !== "integer");

  const handleInsert = async () => {
    if (!tableInfo || !connectionId) {
      toast.error("Run a simple SELECT from a single table first");
      return;
    }
    setSaving(true);
    try {
      const colNames = editableCols
        .filter((c) => (values[c.name] ?? "").trim() !== "")
        .map((c) => `"${c.name}"`);
      const vals = editableCols
        .filter((c) => (values[c.name] ?? "").trim() !== "")
        .map((c) => sqlLiteralForInsert(values[c.name] ?? "", c));

      if (colNames.length === 0) {
        toast.error("Enter at least one value");
        setSaving(false);
        return;
      }

      const sql = `INSERT INTO "${tableInfo.schema}"."${tableInfo.table}" (${colNames.join(", ")}) VALUES (${vals.join(", ")})`;
      await DbClient.execute(connectionId, sql);
      toast.success("Row inserted");
      onClose();
      onSuccess?.();
      await QueryManager.refresh();
    } catch (e: any) {
      toast.error(`Insert failed: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="relative w-full max-w-lg max-h-[80vh] flex flex-col bg-[#0d0d0d] border border-[#262626] rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#262626] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <Plus className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white/80">Insert Row</h2>
                  <p className="text-[11px] text-white/30 font-mono">
                    {tableInfo ? `${tableInfo.schema}.${tableInfo.table}` : "No table selected"}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 text-white/20 hover:text-white/60 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Fields */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {editableCols.length === 0 ? (
                <p className="text-xs text-white/30 font-mono text-center py-8">
                  No editable columns found — run a SELECT from a single table first.
                </p>
              ) : (
                editableCols.map((col) => (
                  <div key={col.name} className="flex items-start gap-3">
                    <div className="w-36 shrink-0 pt-1.5">
                      <span className="text-[11px] font-mono text-white/60 truncate block">{col.name}</span>
                      <span className="text-[9px] font-mono text-white/25 truncate block">{col.type_name}</span>
                    </div>
                    <input
                      type="text"
                      placeholder={col.is_primary_key ? "auto" : "NULL"}
                      value={values[col.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleInsert(); }}
                      className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#1a1a1a] bg-[#0a0a0a] shrink-0">
              <span className="text-[10px] text-white/20 font-mono">Ctrl+Enter to insert · leave blank = NULL</span>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleInsert}
                  disabled={saving || !tableInfo}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition-colors disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Insert
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
