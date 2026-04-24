/**
 * LargeValueModal — displays the full content of a truncated cell value.
 * Opens when user clicks on a JSON, text, or long string cell.
 */
import React, { useState } from "react";
import { X, Copy, Check, WrapText } from "lucide-react";

interface Props {
  value: unknown;
  columnName: string;
  onClose: () => void;
}

export function LargeValueModal({ value, columnName, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [prettyPrint, setPrettyPrint] = useState(true);

  const rawStr = value === null || value === undefined
    ? "null"
    : typeof value === "object"
    ? JSON.stringify(value)
    : String(value);

  const isJson = typeof value === "object" && value !== null;

  const displayStr = isJson && prettyPrint
    ? (() => { try { return JSON.stringify(value, null, 2); } catch { return rawStr; } })()
    : rawStr;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[80vh] bg-[#111] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a] shrink-0">
          <div>
            <p className="text-xs font-bold text-white">{columnName}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{rawStr.length.toLocaleString()} characters</p>
          </div>
          <div className="flex items-center gap-2">
            {isJson && (
              <button
                onClick={() => setPrettyPrint((v) => !v)}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${
                  prettyPrint ? "border-[#00d2ff]/30 text-[#00d2ff]/70" : "border-[#2a2a2a] text-white/30"
                }`}
                title="Toggle pretty print"
              >
                <WrapText className="w-3 h-3" /> Pretty
              </button>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#2a2a2a] text-white/40 hover:text-white transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <pre className="text-xs text-white/80 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {displayStr}
          </pre>
        </div>
      </div>
    </div>
  );
}
