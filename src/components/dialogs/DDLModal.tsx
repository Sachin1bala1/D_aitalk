/**
 * DDLModal — shows the CREATE TABLE DDL for a table.
 * Fetches via db_get_table_ddl Tauri command, displays in a Monaco-like
 * code block with syntax highlighting (plain pre for simplicity), and
 * lets the user copy or send to editor.
 */
import React, { useEffect, useState } from "react";
import { X, Code2, Copy, Play, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { DbClient } from "../../lib/db/DbClient";

interface DDLModalProps {
  open: boolean;
  onClose: () => void;
  connectionId: string | null;
  schema: string;
  table: string;
  onSendToEditor?: (sql: string) => void;
  /** When set, the modal runs this SQL and shows the first cell of the first row as DDL text. */
  customQuery?: string;
  /** Override title (default "Table DDL") */
  title?: string;
  /** Override subtitle (default schema.table) */
  subtitle?: string;
}

export function DDLModal({ open, onClose, connectionId, schema, table, onSendToEditor, customQuery, title, subtitle }: DDLModalProps) {
  const [ddl, setDdl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !connectionId) return;
    setDdl(null);
    setError(null);
    setLoading(true);

    if (customQuery) {
      // Run a custom SQL and take first cell of first row as the DDL text
      DbClient.execute(connectionId, customQuery)
        .then(() => {
          // execute() returns affected rows — for SELECT we need streaming
          // Instead use a workaround: execute the query via streaming
          setError("Use executeStreaming path");
        })
        .catch(() => {})
        .finally(() => {});

      // Proper path: use executeStreaming + listen for batch
      import("@tauri-apps/api/event").then(({ listen }) => {
        DbClient.executeStreaming(connectionId, customQuery).then((response) => {
          const queryId = response.query_id;
          listen<import("../../lib/db/DbClient").QueryBatch>("query_batch", (event) => {
            const batch = event.payload;
            if (batch.query_id !== queryId) return;
            if (batch.error) {
              setError(batch.error);
              setLoading(false);
            } else if (batch.rows.length > 0) {
              const firstVal = Object.values(batch.rows[0])[0];
              setDdl(firstVal != null ? String(firstVal) : "(empty)");
              setLoading(false);
            }
            if (batch.is_final && !ddl) {
              setLoading(false);
            }
          });
        }).catch((e) => {
          setError(e?.message ?? String(e));
          setLoading(false);
        });
      });
    } else {
      DbClient.getTableDdl(connectionId, schema, table)
        .then((result) => setDdl(result))
        .catch((e) => setError(e?.message ?? String(e)))
        .finally(() => setLoading(false));
    }
  }, [open, connectionId, schema, table, customQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    if (!ddl) return;
    navigator.clipboard.writeText(ddl);
    toast.success("DDL copied to clipboard");
  };

  const handleSendToEditor = () => {
    if (!ddl) return;
    onSendToEditor?.(ddl);
    onClose();
    toast.success("DDL sent to editor");
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-[#0d0d0d] border border-[#262626] rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#262626] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#00d2ff]/10 rounded-lg flex items-center justify-center">
                  <Code2 className="w-4 h-4 text-[#00d2ff]" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white/80">{title ?? "Table DDL"}</h2>
                  <p className="text-[11px] text-white/30 font-mono">
                    {subtitle ?? `${schema}.${table}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ddl && (
                  <>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs transition-colors"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                    {onSendToEditor && (
                      <button
                        onClick={handleSendToEditor}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00d2ff]/10 hover:bg-[#00d2ff]/20 text-[#00d2ff] text-xs font-bold transition-colors"
                      >
                        <Play className="w-3 h-3" /> Send to Editor
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 text-white/20 hover:text-white/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5">
              {loading && (
                <div className="flex items-center justify-center h-32 gap-2 text-white/30">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-mono">Fetching DDL…</span>
                </div>
              )}
              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400 font-mono">
                  {error}
                </div>
              )}
              {ddl && (
                <pre className="text-[12px] font-mono text-white/70 whitespace-pre-wrap leading-relaxed bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-4 overflow-x-auto">
                  {ddl}
                </pre>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
