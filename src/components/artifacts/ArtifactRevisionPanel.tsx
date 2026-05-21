import React from "react";
import { Clock3, Copy, GitCommitHorizontal, RotateCcw } from "lucide-react";
import type { ArtifactRevision } from "../../lib/stores/WorkspaceStore";
import { summarizeLatestArtifactRevisionDiff } from "../../lib/artifacts/artifactDiff";

export function formatRevisionTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ArtifactRevisionPanel({
  revisions,
  selectedRevision,
  selectedRecordedAt,
  onSelectRevision,
  onClearSelection,
  hasUncommittedChanges,
  onRestoreAsDraft,
  onDuplicateRevision,
}: {
  revisions: ArtifactRevision[];
  selectedRevision?: ArtifactRevision | null;
  selectedRecordedAt?: number | null;
  onSelectRevision?: (revision: ArtifactRevision) => void;
  onClearSelection?: () => void;
  hasUncommittedChanges?: boolean;
  onRestoreAsDraft?: (revision: ArtifactRevision) => void;
  onDuplicateRevision?: (revision: ArtifactRevision) => void;
}) {
  const latestChanges = summarizeLatestArtifactRevisionDiff(revisions);
  const recentRevisions = revisions.slice(-5).reverse();

  return (
    <div className="mt-3 flex flex-col gap-2 text-[10px] text-white/35">
      <div className="flex items-center gap-1.5">
        <GitCommitHorizontal className="w-3 h-3 shrink-0" />
        <span className="font-mono uppercase tracking-widest">Revisions</span>
        {selectedRecordedAt && onClearSelection && (
          <button
            type="button"
            onClick={onClearSelection}
            className="ml-auto inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/45 transition hover:border-white/20 hover:text-white/70"
          >
            <RotateCcw className="h-3 w-3" />
            View Current
          </button>
        )}
      </div>
      {hasUncommittedChanges && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[9px] font-mono uppercase tracking-widest text-amber-300/70">
          Current draft has uncommitted changes
        </div>
      )}
      {selectedRevision && (onRestoreAsDraft || onDuplicateRevision) && (
        <div className="flex flex-wrap gap-2">
          {onRestoreAsDraft && (
            <button
              type="button"
              onClick={() => onRestoreAsDraft(selectedRevision)}
              className="inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-cyan-300/70 hover:text-cyan-200"
            >
              <RotateCcw className="h-3 w-3" />
              Restore As Draft
            </button>
          )}
          {onDuplicateRevision && (
            <button
              type="button"
              onClick={() => onDuplicateRevision(selectedRevision)}
              className="inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-white/45 hover:text-white/70"
            >
              <Copy className="h-3 w-3" />
              Duplicate
            </button>
          )}
        </div>
      )}
      {latestChanges.length > 0 && (
        <div className="rounded border border-[#1f1f1f] bg-[#101010] px-2.5 py-2">
          <div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-white/25">
            Latest Changes
          </div>
          <div className="flex flex-col gap-1">
            {latestChanges.map((change, index) => (
              <span key={`${change}-${index}`} className="font-mono text-white/45">
                {change}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {recentRevisions.length === 0 ? (
          <span className="font-mono text-white/20">No revisions recorded</span>
        ) : (
          recentRevisions.map((revision, index) => (
            <button
              type="button"
              key={`${revision.artifactId}-${revision.recordedAt}-${index}`}
              onClick={() => onSelectRevision?.(revision)}
              className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition ${
                selectedRecordedAt === revision.recordedAt
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-[#1f1f1f] bg-[#101010] hover:border-white/15 hover:text-white/55"
              }`}
            >
              <span className="font-mono text-white/45">
                Rev {revisions.length - index}
              </span>
              <span className="inline-flex items-center gap-1 text-white/30">
                <Clock3 className="w-3 h-3" />
                {formatRevisionTimestamp(revision.recordedAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
