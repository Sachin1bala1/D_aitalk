/**
 * ReportPanel — slide-over Sheet for configuring and exporting a report.
 * Allows title/author overrides, format selection (PDF / PPTX / Both),
 * section filtering, optional preview, and one-click export.
 */
import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { ReportPreview } from "./ReportPreview";
import {
  buildFromSession,
  exportToPDF,
  exportToPPTX,
} from "../../lib/reports/ReportBuilder";
import type { AnalysisSession, ReportSpec } from "../../lib/reports/ReportBuilder";
import { captureChart } from "../../lib/reports/chartCapture";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = "PDF" | "PPTX" | "Both";

interface ReportPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AnalysisSession | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportPanel({ open, onOpenChange, session }: ReportPanelProps) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [format, setFormat] = useState<ExportFormat>("PDF");
  const [enabledSections, setEnabledSections] = useState<boolean[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSpec, setPreviewSpec] = useState<ReportSpec | null>(null);

  // Sync form fields when session changes
  useEffect(() => {
    if (session) {
      setTitle(session.userQuestion.slice(0, 80));
      setAuthor("");
      setEnabledSections(session.sections.map(() => true));
    } else {
      setTitle("");
      setAuthor("");
      setEnabledSections([]);
    }
    setShowPreview(false);
    setPreviewSpec(null);
  }, [session]);

  const toggleSection = (index: number) => {
    setEnabledSections((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const buildSpec = (): ReportSpec => {
    if (!session) {
      return { title: "", author: "", date: "", connectionName: "", sections: [] };
    }
    const base = buildFromSession(session);
    let analysisIndex = 0;
    const filteredSections = base.sections.filter((s) => {
      if (s.type === "analysis") {
        const enabled = enabledSections[analysisIndex] ?? true;
        analysisIndex++;
        return enabled;
      }
      return true;
    });
    return {
      ...base,
      title: title || base.title,
      author: author || base.author,
      sections: filteredSections,
    };
  };

  const handlePreview = () => {
    const spec = buildSpec();
    setPreviewSpec(spec);
    setShowPreview(true);
  };

  const handleExport = async () => {
    if (!session) return;
    setIsExporting(true);
    try {
      const spec = buildSpec();

      // Capture charts — chartId travels with each spec section (no parallel-index fragility)
      for (let i = 0; i < spec.sections.length; i++) {
        const s = spec.sections[i];
        if (s.type === "analysis" && s.chartId) {
          const dataUrl = await captureChart(s.chartId);
          if (dataUrl) {
            spec.sections[i] = { ...s, chartDataUrl: dataUrl };
          }
        }
      }

      if (format === "PDF") {
        exportToPDF(spec);
      } else if (format === "PPTX") {
        await exportToPPTX(spec);
      } else {
        // Both
        exportToPDF(spec);
        await exportToPPTX(spec);
      }

      toast.success("Report exported!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Export failed: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const formats: ExportFormat[] = ["PDF", "PPTX", "Both"];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-[#0d0d0d] border-l border-[#1e1e1e] text-white overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-[#1e1e1e] shrink-0">
          <SheetTitle className="text-white text-base font-semibold">Export Report</SheetTitle>
        </SheetHeader>

        {!session ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-white/30 px-5 py-10">
            <p className="text-sm text-center">
              No analysis session yet. Ask APEX to analyze some data first.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-5 py-5 overflow-y-auto flex-1">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                Report Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-[#00d2ff] placeholder:text-white/20"
                placeholder="Enter report title…"
              />
            </div>

            {/* Author */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                Author
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={80}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-[#00d2ff] placeholder:text-white/20"
                placeholder="Your name…"
              />
            </div>

            {/* Format selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                Format
              </label>
              <div className="flex gap-2">
                {formats.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`flex-1 py-2 rounded-md text-xs font-semibold border transition-colors ${
                      format === f
                        ? "bg-[#00d2ff] text-black border-[#00d2ff]"
                        : "bg-[#1a1a1a] text-white/50 border-[#2a2a2a] hover:border-[#444] hover:text-white/70"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Section checkboxes */}
            {session.sections.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                  Include Sections
                </label>
                <div className="flex flex-col gap-1.5 bg-[#111] rounded-md p-3 border border-[#1e1e1e]">
                  {session.sections.map((section, i) => (
                    <label
                      key={i}
                      className="flex items-center gap-2.5 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={enabledSections[i] ?? true}
                        onChange={() => toggleSection(i)}
                        className="w-3.5 h-3.5 accent-[#00d2ff] cursor-pointer"
                      />
                      <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors font-mono">
                        {section.toolName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            {showPreview && previewSpec && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                  Preview
                </label>
                <ReportPreview spec={previewSpec} />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 mt-auto pt-2">
              <button
                onClick={handlePreview}
                className="flex-1 py-2 rounded-md text-xs font-semibold bg-[#1a1a1a] border border-[#2a2a2a] text-white/60 hover:text-white/80 hover:border-[#444] transition-colors"
              >
                Preview
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex-1 py-2 rounded-md text-xs font-semibold bg-[#00d2ff] text-black hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-opacity"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  "Export"
                )}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
