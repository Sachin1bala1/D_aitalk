/**
 * ReportPreview — scrollable HTML preview of a ReportSpec.
 * Renders sections in order with a dark print-preview look.
 */
import React from "react";
import type { ReportSpec, ReportSection } from "../../lib/reports/ReportBuilder";

interface ReportPreviewProps {
  spec: ReportSpec;
}

function TitlePageSection({ spec }: { spec: ReportSpec }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[220px] py-10 px-6 text-center border-b border-zinc-700">
      <h1 className="text-2xl font-bold text-[#00d2ff] mb-4 leading-tight">{spec.title}</h1>
      <p className="text-sm text-white/60 mb-1">{spec.author}</p>
      <p className="text-sm text-white/40 mb-1">{spec.date}</p>
      <p className="text-xs text-white/30 font-mono">{spec.connectionName}</p>
    </div>
  );
}

function ExecutiveSummarySection({ section }: { section: Extract<ReportSection, { type: 'executive_summary' }> }) {
  return (
    <div className="px-6 py-5 border-b border-zinc-700">
      <h2 className="text-base font-semibold text-[#00d2ff] mb-3">Executive Summary</h2>
      {section.bullets.length > 0 ? (
        <ul className="list-disc list-inside space-y-1.5">
          {section.bullets.map((b, i) => (
            <li key={`bullet-${i}`} className="text-sm text-white/70 leading-relaxed">{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white/40 italic">No summary available.</p>
      )}
    </div>
  );
}

function AnalysisSectionView({ section }: { section: Extract<ReportSection, { type: 'analysis' }> }) {
  return (
    <div className="px-6 py-5 border-b border-zinc-700">
      <h3 className="text-sm font-semibold text-[#00d2ff] mb-3 font-mono uppercase tracking-wide">
        {section.title}
      </h3>
      {section.chartDataUrl ? (
        <img
          src={section.chartDataUrl}
          alt={`Chart: ${section.title}`}
          className="max-w-full rounded mb-3 border border-zinc-700"
        />
      ) : null}
      {section.findings ? (
        <p className="text-sm text-white/70 leading-relaxed mb-2">{section.findings}</p>
      ) : null}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Confidence</span>
        <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden max-w-[120px]">
          <div
            className="h-full bg-[#00d2ff] rounded-full"
            style={{ width: `${Math.round(section.confidence * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-white/50 font-mono">{Math.round(section.confidence * 100)}%</span>
      </div>
    </div>
  );
}

function DataTableSection({ section }: { section: Extract<ReportSection, { type: 'data_table' }> }) {
  return (
    <div className="px-6 py-5 border-b border-zinc-700">
      {section.title && (
        <h3 className="text-sm font-semibold text-[#00d2ff] mb-3 font-mono uppercase tracking-wide">{section.title}</h3>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-600">
              {section.columns.map((col, i) => (
                <th key={`col-${i}`} className="text-left px-3 py-2 text-white/50 font-mono font-semibold whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, ri) => (
              <tr key={`row-${ri}`} className="border-b border-zinc-800 hover:bg-white/[0.03]">
                {row.map((cell, ci) => (
                  <td key={`cell-${ri}-${ci}`} className="px-3 py-2 text-white/60 font-mono">
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecommendationsSection({ section }: { section: Extract<ReportSection, { type: 'recommendations' }> }) {
  const priorityColor = (p: string) => {
    if (p === "high") return "text-red-400";
    if (p === "medium") return "text-amber-400";
    return "text-emerald-400";
  };

  return (
    <div className="px-6 py-5 border-b border-zinc-700">
      <h2 className="text-base font-semibold text-[#00d2ff] mb-3">Recommendations</h2>
      <ul className="space-y-2">
        {section.items.map((item, i) => (
          <li key={`rec-${i}`} className="flex gap-3 items-start text-sm">
            <span className={`font-bold uppercase text-[10px] font-mono mt-0.5 min-w-[48px] ${priorityColor(item.priority)}`}>
              {item.priority}
            </span>
            <span className="text-white/70 leading-relaxed">{item.action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportPreview({ spec }: ReportPreviewProps) {
  return (
    <div className="bg-zinc-900 text-white rounded-lg overflow-y-auto max-h-[60vh] border border-zinc-700 text-sm">
      {spec.sections.map((section, i) => {
        switch (section.type) {
          case "title_page":
            return <TitlePageSection key={`s-${i}`} spec={spec} />;
          case "executive_summary":
            return <ExecutiveSummarySection key={`s-${i}`} section={section} />;
          case "analysis":
            return <AnalysisSectionView key={`s-${i}`} section={section} />;
          case "data_table":
            return <DataTableSection key={`s-${i}`} section={section} />;
          case "recommendations":
            return <RecommendationsSection key={`s-${i}`} section={section} />;
        }
      })}
    </div>
  );
}
