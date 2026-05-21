import React from "react";
import type { ArtifactDiffDetails } from "../../lib/artifacts/artifactDiff";

export function ArtifactRevisionDetails({
  details,
  previousLabel,
  currentLabel,
}: {
  details: ArtifactDiffDetails;
  previousLabel: string;
  currentLabel: string;
}) {
  if (details.summary.length === 0 && details.sections.length === 0) {
    return (
      <div className="mt-2 rounded border border-[#1f1f1f] bg-[#101010] px-2.5 py-2 text-[10px] font-mono text-white/35">
        No material differences between {previousLabel.toLowerCase()} and {currentLabel.toLowerCase()}.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-[#1f1f1f] bg-[#101010] px-2.5 py-2">
      <div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-white/25">
        {previousLabel} vs {currentLabel}
      </div>
      {details.summary.length > 0 && (
        <div className="flex flex-col gap-1 text-[10px] font-mono text-white/45">
          {details.summary.map((change, index) => (
            <span key={`${change}-${index}`}>{change}</span>
          ))}
        </div>
      )}
      {details.sections.length > 0 && (
        <div className="mt-2 grid gap-2">
          {details.sections.map((section) => (
            <div key={section.title} className="rounded border border-white/5 bg-black/10 px-2 py-1.5">
              <div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-white/25">
                {section.title}
              </div>
              <div className="flex flex-col gap-1 text-[10px] font-mono text-white/45">
                {section.items.map((item, index) => (
                  <span key={`${section.title}-${item}-${index}`}>{item}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
