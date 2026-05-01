/**
 * FileImportDialog — import CSV or Parquet files into DuckDB.
 *
 * The user picks a file (or drag-drops onto the dropzone), gives it a
 * table name, and clicks Import. The file is registered as a DuckDB view
 * and a SELECT preview is immediately executed so results appear in
 * VirtualTable.
 */
import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, FileText, Table2, Database } from "lucide-react";
import { toast } from "sonner";
import { DbClient } from "../../lib/db/DbClient";

interface FileImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (sql: string) => void; // called with SELECT to preview the table
}

function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")          // strip extension
    .replace(/[^a-zA-Z0-9_]/g, "_")   // non-alphanumeric → _
    .replace(/^(\d)/, "_$1")           // can't start with digit
    .toLowerCase();
}

export function FileImportDialog({ open, onOpenChange, onImported }: FileImportDialogProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const acceptFile = (f: File) => {
    setFile(f);
    setTableName(slugify(f.name));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const handleImport = async () => {
    if (!file || !tableName.trim()) return;
    setIsImporting(true);

    // Tauri can read paths from the webview; on Windows the file.name
    // doesn't give us a full path — but we can pass the File object via
    // DataTransfer. For Tauri WebView we use webkitRelativePath or path.
    // The simplest approach: read the file as ArrayBuffer and pass via
    // duckdb_load_* with a temp path. Since Tauri's webview exposes
    // file paths via window.__TAURI_INTERNALS__ on drop, we access it
    // from the native path if available.
    const nativePath: string | undefined = (file as any).path;

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const path = nativePath;

      if (!path) {
        await DbClient.recordSecurityAudit({
          event_type: "local_file_access",
          outcome: "blocked",
          details_json: {
            reason: "missing_native_path",
            file_name: file.name,
          },
        }).catch(() => {});
        toast.error("This import requires a native file path. Re-select the file from a local disk location.");
        setIsImporting(false);
        return;
      }

      if (ext === "parquet") {
        await DbClient.duckdbLoadParquet(path, tableName.trim());
      } else if (ext === "csv" || ext === "tsv" || ext === "txt") {
        await DbClient.duckdbLoadCsv(path, tableName.trim());
      } else {
        toast.error(`Unsupported file type: .${ext}. Use .parquet or .csv`);
        setIsImporting(false);
        return;
      }

      toast.success(`Imported "${tableName}" — ready to query`);
      onImported(`SELECT * FROM "${tableName.trim()}" LIMIT 1000;`);
      onOpenChange(false);
      setFile(null);
      setTableName("");
    } catch (e: any) {
      toast.error(`Import failed: ${e.message ?? "unknown error"}`);
    } finally {
      setIsImporting(false);
    }
  };

  const fileExt = file?.name.split(".").pop()?.toLowerCase();
  const isSupported = fileExt === "parquet" || fileExt === "csv" || fileExt === "tsv";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="relative w-full max-w-md bg-[#0d0d0d] border border-[#262626] rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="p-5 border-b border-[#262626] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-500/10 rounded-lg flex items-center justify-center">
                  <Database className="w-4.5 h-4.5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Import File into DuckDB</h2>
                  <p className="text-[11px] text-white/40">CSV, TSV, or Parquet — analyzed locally</p>
                </div>
              </div>
              <button onClick={() => onOpenChange(false)} className="text-white/30 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Drop zone */}
              <div
                ref={dropRef}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className={`rounded-lg border-2 border-dashed transition-colors p-6 text-center ${
                  isDragging
                    ? "border-amber-500/60 bg-amber-500/5"
                    : file
                    ? "border-[#00d2ff]/40 bg-[#00d2ff]/5"
                    : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                }`}
              >
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-[#00d2ff]/10 flex items-center justify-center">
                      {fileExt === "parquet" ? (
                        <Table2 className="w-5 h-5 text-[#00d2ff]" />
                      ) : (
                        <FileText className="w-5 h-5 text-[#00d2ff]" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-white/80">{file.name}</p>
                    <p className="text-[11px] text-white/30">
                      {(file.size / 1024).toFixed(1)} KB · {fileExt?.toUpperCase()}
                      {!isSupported && (
                        <span className="text-red-400 ml-2">⚠ Unsupported format</span>
                      )}
                    </p>
                    <button
                      onClick={() => { setFile(null); setTableName(""); }}
                      className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      Choose different file
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center gap-3 cursor-pointer">
                    <Upload className="w-8 h-8 text-white/20" />
                    <div>
                      <p className="text-sm text-white/50">
                        Drop a file here or{" "}
                        <span className="text-[#00d2ff] hover:underline">browse</span>
                      </p>
                      <p className="text-[11px] text-white/25 mt-1">.csv · .tsv · .parquet</p>
                    </div>
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.parquet"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Table name */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">
                  DuckDB Table Name
                </label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="my_table"
                  className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#00d2ff] text-white"
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                />
                <p className="text-[10px] text-white/25">
                  Query with: <code className="text-amber-400/60">SELECT * FROM "{tableName || "table"}"</code>
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => onOpenChange(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[#262626] text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!file || !tableName.trim() || !isSupported || isImporting}
                  className="flex-[2] px-4 py-2.5 rounded-lg bg-amber-500 text-black text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isImporting ? "Importing…" : "Import & Preview"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
