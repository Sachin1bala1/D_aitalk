import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Brain,
  Bot,
  Clock3,
  Columns,
  FolderSearch,
  Key,
  Layers,
  Rows3,
  Search,
  Table,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import type { ConnectionConfig, FullSchema, QueryHistoryRecord } from "../../lib/db/DbClient";
import { ensureHistoryLoaded, loadHistory, subscribeHistoryStore } from "../history/QueryHistory";
import {
  ensureBackgroundAgentsLoaded,
  listBackgroundAgentEnvironments,
  getBackgroundAgentRuns,
  listBackgroundAgents,
  listBackgroundAgentApprovals,
  subscribeBackgroundAgents,
} from "../../lib/backgroundAgents/BackgroundAgentStore";
import { EpisodicMemory, type Episode } from "../../lib/memory/EpisodicMemory";
import {
  ensurePipelinesLoaded,
  getPipelineRuns,
  listPipelines,
  subscribePipelines,
} from "../../lib/pipelines/PipelineStore";
import { useWorkspaceRuleStore } from "../../lib/memory/WorkspaceRuleStore";
import { useWorkspaceStore, type WorkspacePanel } from "../../lib/stores/WorkspaceStore";
import {
  searchWorkspaceDocuments,
  type WorkspaceSearchDocument,
  type WorkspaceSearchDocumentKind,
  type WorkspaceSearchMatch,
} from "../../lib/search/workspaceSemanticIndex";
import {
  loadWorkspaceSearchSnapshot,
  rebuildWorkspaceSearchSnapshot,
} from "../../lib/search/WorkspaceSearchSnapshotStore";

interface Props {
  schemas: Record<string, FullSchema>;
  connections: ConnectionConfig[];
  onNavigate: (connectionId: string, sql: string) => void;
  onSelectPanel: (panel: WorkspacePanel) => void;
}

const KIND_ICON: Record<WorkspaceSearchDocument["kind"], React.ReactNode> = {
  schema_table: <Table className="w-3 h-3 text-cyan-400/70 shrink-0" />,
  schema_view: <Layers className="w-3 h-3 text-purple-400/70 shrink-0" />,
  schema_column: <Columns className="w-3 h-3 text-white/30 shrink-0" />,
  schema_index: <Key className="w-3 h-3 text-amber-400/70 shrink-0" />,
  artifact_query: <Rows3 className="w-3 h-3 text-emerald-400/70 shrink-0" />,
  artifact_chart: <BarChart3 className="w-3 h-3 text-cyan-400/70 shrink-0" />,
  artifact_report: <FolderSearch className="w-3 h-3 text-fuchsia-400/70 shrink-0" />,
  pipeline: <Workflow className="w-3 h-3 text-amber-300/70 shrink-0" />,
  background_agent: <Bot className="w-3 h-3 text-cyan-300/70 shrink-0" />,
  background_environment: <Layers className="w-3 h-3 text-cyan-400/70 shrink-0" />,
  background_agent_run: <Bot className="w-3 h-3 text-cyan-200/70 shrink-0" />,
  background_agent_approval: <Bot className="w-3 h-3 text-amber-300/70 shrink-0" />,
  query_history: <Clock3 className="w-3 h-3 text-white/35 shrink-0" />,
  memory_episode: <Search className="w-3 h-3 text-lime-300/70 shrink-0" />,
  workspace_rule: <Brain className="w-3 h-3 text-amber-300/70 shrink-0" />,
  pipeline_run: <Workflow className="w-3 h-3 text-amber-200/70 shrink-0" />,
};

function mapLegacyHistoryToQueryHistory(entries: ReturnType<typeof loadHistory>): QueryHistoryRecord[] {
  return entries.map((entry) => ({
    query_id: entry.id,
    sql: entry.sql,
    source_table: null,
    source_tables: [],
    row_count: entry.rowCount,
    duration_ms: entry.elapsedMs,
    success: !entry.error,
    error_message: entry.error ?? null,
    executed_at: new Date(entry.timestamp).toISOString(),
  }));
}

function formatKind(kind: WorkspaceSearchDocument["kind"]) {
  return kind.replace(/_/g, " ");
}

function relatedGroupLabel(kind: WorkspaceSearchDocument["kind"]) {
  if (kind.startsWith("artifact_")) return "Artifacts";
  if (kind === "pipeline" || kind === "pipeline_run") return "Pipelines";
  if (
    kind === "background_agent" ||
    kind === "background_environment" ||
    kind === "background_agent_run" ||
    kind === "background_agent_approval"
  ) {
    return "Agents";
  }
  if (kind === "memory_episode" || kind === "workspace_rule") return "Memory";
  if (kind === "query_history") return "History";
  return "Workspace";
}

const FILTER_KIND_OPTIONS: Array<{ label: string; value: WorkspaceSearchDocumentKind | "all" }> = [
  { label: "All", value: "all" },
  { label: "Schema", value: "schema_table" },
  { label: "Artifacts", value: "artifact_report" },
  { label: "Pipelines", value: "pipeline" },
  { label: "Agents", value: "background_agent" },
  { label: "History", value: "query_history" },
  { label: "Memory", value: "memory_episode" },
];

export function WorkspaceSearchPanel({ schemas, connections, onNavigate, onSelectPanel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<WorkspaceSearchDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<WorkspaceSearchDocumentKind | "all">("all");
  const [connectionFilter, setConnectionFilter] = useState<string>("all");
  const [recentFilter, setRecentFilter] = useState<string>("all");
  const {
    artifacts,
    createArtifactChartTab,
    createArtifactQueryTab,
    createArtifactReportTab,
  } = useWorkspaceStore();
  const ensureRulesLoaded = useWorkspaceRuleStore((state) => state.ensureLoaded);
  const workspaceRules = useWorkspaceRuleStore((state) => state.rules);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadWorkspaceSearchSnapshot().then((snapshot) => {
      if (cancelled) return;
      setDocuments([
        ...snapshot.segments.schema,
        ...snapshot.segments.artifacts,
        ...snapshot.segments.pipelines,
        ...snapshot.segments.backgroundAgents,
        ...snapshot.segments.history,
        ...snapshot.segments.memory,
      ]);
      setIsLoading(false);
    });

    const rebuild = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          ensureHistoryLoaded(),
          ensurePipelinesLoaded(),
          ensureBackgroundAgentsLoaded(),
          ensureRulesLoaded(),
        ]);
        const [memoryEpisodes] = await Promise.all([
          EpisodicMemory.getRecent(100).catch(() => [] as Episode[]),
        ]);
        if (cancelled) return;
        const { documents: docs } = await rebuildWorkspaceSearchSnapshot({
          schemas,
          connections,
          artifacts,
          pipelines: listPipelines(),
          pipelineRuns: listPipelines().flatMap((pipeline) => getPipelineRuns(pipeline.id)),
          backgroundAgents: listBackgroundAgents(),
          backgroundAgentEnvironments: listBackgroundAgentEnvironments(),
          backgroundAgentRuns: listBackgroundAgents().flatMap((agent) => getBackgroundAgentRuns(agent.id)),
          backgroundAgentApprovals: listBackgroundAgentApprovals(),
          queryHistory: mapLegacyHistoryToQueryHistory(loadHistory()),
          memoryEpisodes,
          workspaceRules,
        });
        if (cancelled) return;
        setDocuments(docs);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void rebuild();
    const unsubscribePipelines = subscribePipelines(() => {
      void rebuild();
    });
    const unsubscribeAgents = subscribeBackgroundAgents(() => {
      void rebuild();
    });
    const unsubscribeHistory = subscribeHistoryStore(() => {
      void rebuild();
    });
    return () => {
      cancelled = true;
      unsubscribePipelines();
      unsubscribeAgents();
      unsubscribeHistory();
    };
  }, [schemas, connections, artifacts, ensureRulesLoaded, workspaceRules]);

  const results = useMemo<WorkspaceSearchMatch[]>(() => {
    if (query.trim().length < 2) return [];
    const kinds =
      kindFilter === "all"
        ? undefined
        : kindFilter === "schema_table"
          ? (["schema_table", "schema_view", "schema_column", "schema_index"] as WorkspaceSearchDocumentKind[])
          : kindFilter === "artifact_report"
            ? (["artifact_query", "artifact_chart", "artifact_report"] as WorkspaceSearchDocumentKind[])
            : kindFilter === "pipeline"
              ? (["pipeline", "pipeline_run"] as WorkspaceSearchDocumentKind[])
              : kindFilter === "background_agent"
                ? ([
                    "background_agent",
                    "background_environment",
                    "background_agent_run",
                    "background_agent_approval",
                  ] as WorkspaceSearchDocumentKind[])
            : kindFilter === "memory_episode"
              ? (["memory_episode", "workspace_rule"] as WorkspaceSearchDocumentKind[])
              : [kindFilter];
    return searchWorkspaceDocuments(documents, query, {
      limit: 80,
      kinds,
      connectionId: connectionFilter === "all" ? null : connectionFilter,
      recentDays:
        recentFilter === "7" ? 7 : recentFilter === "30" ? 30 : null,
    });
  }, [documents, query, kindFilter, connectionFilter, recentFilter]);

  const handleOpenArtifact = (artifactId: string, artifactKind: "chart" | "query" | "report") => {
    const artifact = artifacts[artifactId];
    if (!artifact) {
      toast.error("Artifact no longer exists");
      return;
    }

    if (artifactKind === "chart") {
      if (artifact.kind !== "chart") {
        toast.error("Artifact type mismatch");
        return;
      }
      createArtifactChartTab({
        id: `artifact-chart-tab-${artifactId}-${Date.now()}`,
        artifactId,
        title: artifact.name,
        connectionId: artifact.lineage.connectionId,
        sql: artifact.lineage.sql,
        queryResults: null,
        isExecuting: false,
      });
      return;
    }

    if (artifactKind === "query") {
      if (artifact.kind !== "query") {
        toast.error("Artifact type mismatch");
        return;
      }
      createArtifactQueryTab({
        id: `artifact-query-tab-${artifactId}-${Date.now()}`,
        artifactId,
        title: artifact.name,
        connectionId: artifact.lineage.connectionId,
        sql: artifact.lineage.sql,
        queryResults: null,
        isExecuting: false,
      });
      return;
    }

    createArtifactReportTab({
      id: `artifact-report-tab-${artifactId}-${Date.now()}`,
      artifactId,
      title: artifact.name,
      connectionId: null,
      sql: "",
      queryResults: null,
      isExecuting: false,
    });
  };

  const handleSelect = (document: WorkspaceSearchDocument) => {
    switch (document.action.type) {
      case "open_sql":
        onNavigate(document.action.connectionId, document.action.sql);
        return;
      case "open_artifact":
        handleOpenArtifact(document.action.artifactId, document.action.artifactKind);
        onSelectPanel("artifacts");
        return;
      case "open_panel":
        onSelectPanel(document.action.panel);
        return;
    }
  };

  const openDocument = (documentId: string) => {
    const related = documents.find((candidate) => candidate.id === documentId);
    if (!related) {
      toast.error("Related object is no longer available");
      return;
    }
    handleSelect(related);
  };

  return (
    <div className="flex flex-col h-full" data-testid="workspace-search-panel">
      <div className="p-3 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-[#111] border border-[#262626] focus-within:border-[#00d2ff]/40 transition-colors">
          <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspace objects, memory, pipelines…"
            className="flex-1 bg-transparent text-xs text-white/70 focus:outline-none placeholder:text-white/20"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-white/20 hover:text-white/50 text-xs"
            >
              ×
            </button>
          )}
        </div>
        {query.length > 0 && query.length < 2 && (
          <p className="text-[9px] text-white/20 px-1 pt-1">Type at least 2 characters</p>
        )}
        {results.length > 0 && (
          <p className="text-[9px] text-white/25 px-1 pt-1">
            {results.length} result{results.length !== 1 ? "s" : ""} across workspace
          </p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as WorkspaceSearchDocumentKind | "all")}
            className="bg-[#111] border border-[#262626] rounded px-2 py-1 text-[10px] text-white/60"
          >
            {FILTER_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={connectionFilter}
            onChange={(event) => setConnectionFilter(event.target.value)}
            className="bg-[#111] border border-[#262626] rounded px-2 py-1 text-[10px] text-white/60"
          >
            <option value="all">All connections</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.display_name}
              </option>
            ))}
          </select>
          <select
            value={recentFilter}
            onChange={(event) => setRecentFilter(event.target.value)}
            className="bg-[#111] border border-[#262626] rounded px-2 py-1 text-[10px] text-white/60"
          >
            <option value="all">Any time</option>
            <option value="7">Last 7d</option>
            <option value="30">Last 30d</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-10 text-[10px] font-mono text-white/20">
            Building workspace index…
          </div>
        )}

        {!isLoading && query.length >= 2 && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/20 gap-2">
            <Search className="w-6 h-6" />
            <span className="text-xs">No workspace results for "{query}"</span>
          </div>
        )}

        {results.map(({ document, score, snippet, reasons, relatedDocumentIds, relatedDocuments }) => {
          const groupedRelated = relatedDocuments.reduce<Record<string, typeof relatedDocuments>>((acc, related) => {
            const label = relatedGroupLabel(related.kind);
            acc[label] = [...(acc[label] ?? []), related];
            return acc;
          }, {});

          return (
          <button
            key={document.id}
            onClick={() => handleSelect(document)}
            className="w-full flex items-start gap-2.5 px-4 py-2 hover:bg-white/[0.04] transition-colors text-left group"
          >
            {KIND_ICON[document.kind]}
            <div className="flex-1 min-w-0">
              <span className="text-xs text-white/70 group-hover:text-white truncate block">
                {document.title}
              </span>
              <span className="text-[9px] text-white/25 font-mono truncate block">
                {document.subtitle}
              </span>
              <span className="text-[9px] text-white/20 line-clamp-2 block mt-1">
                {snippet}
              </span>
              {reasons.length > 0 && (
                <div className="mt-1">
                  <div className="text-[8px] uppercase tracking-widest text-white/18">Why This Matched</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {reasons.slice(0, 3).map((reason) => (
                      <span
                        key={reason}
                        className="rounded border border-[#2a2a2a] bg-white/[0.02] px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-white/35"
                      >
                        {reason}
                      </span>
                    ))}
                    {relatedDocumentIds.length > 0 && (
                      <span className="rounded border border-cyan-500/20 bg-cyan-500/5 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-cyan-300/50">
                        {relatedDocumentIds.length} related
                      </span>
                    )}
                  </div>
                </div>
              )}
              {relatedDocuments.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[8px] uppercase tracking-widest text-white/18">Connected To</div>
                  {Object.entries(groupedRelated).slice(0, 3).map(([label, items]) => (
                    <div key={label} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[8px] uppercase tracking-widest text-cyan-300/40">{label}</span>
                      {items.slice(0, 3).map((related) => (
                        <button
                          key={related.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            openDocument(related.id);
                          }}
                          className="rounded border border-[#2a2a2a] bg-[#111] px-1.5 py-0.5 text-[8px] text-white/45 hover:text-cyan-300/70 transition-colors"
                          title={related.kind}
                        >
                          {related.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className="text-[8px] text-white/15 uppercase">{formatKind(document.kind)}</span>
              <span className="text-[8px] text-cyan-300/35 font-mono">{Math.round(score)}</span>
            </div>
          </button>
        )})}

        {!isLoading && query.length < 2 && (
          <div className="p-4 space-y-3 text-xs text-white/30">
            <p className="font-medium text-white/40">Search the full workspace</p>
            <ul className="space-y-1.5 text-[11px]">
              <li>· Tables, views, columns, and indexes</li>
              <li>· Saved query, chart, and report artifacts</li>
              <li>· Pipelines and background agents</li>
              <li>· Query history, prior memory episodes, and workspace rules</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
