import type { FullSchema, QueryHistoryRecord } from "../db/DbClient";
import type { ConnectionConfig } from "../db/DbClient";
import type { AnalysisArtifact } from "../stores/WorkspaceStore";
import type { PipelineDefinition, PipelineRunRecord } from "../pipelines/PipelineStore";
import type {
  BackgroundAgentApprovalItem,
  BackgroundAgentDefinition,
  BackgroundAgentEnvironment,
  BackgroundAgentRun,
} from "../backgroundAgents/BackgroundAgentStore";
import type { Episode } from "../memory/EpisodicMemory";
import type { WorkspaceRule } from "../memory/WorkspaceRuleStore";

export type WorkspaceSearchDocumentKind =
  | "schema_table"
  | "schema_view"
  | "schema_column"
  | "schema_index"
  | "artifact_query"
  | "artifact_chart"
  | "artifact_report"
  | "pipeline"
  | "pipeline_run"
  | "background_agent"
  | "background_environment"
  | "background_agent_run"
  | "background_agent_approval"
  | "query_history"
  | "memory_episode"
  | "workspace_rule";

export interface WorkspaceSearchDocument {
  id: string;
  kind: WorkspaceSearchDocumentKind;
  title: string;
  subtitle: string;
  body: string;
  keywords: string[];
  connectionId: string | null;
  updatedAt: number;
  action:
    | {
        type: "open_sql";
        connectionId: string;
        sql: string;
      }
    | {
        type: "open_artifact";
        artifactId: string;
        artifactKind: AnalysisArtifact["kind"];
      }
    | {
        type: "open_panel";
        panel: "pipelines" | "background_agents" | "memory" | "history" | "artifacts";
      };
  metadata?: Record<string, unknown>;
}

export interface WorkspaceSearchIndexInput {
  schemas: Record<string, FullSchema>;
  connections: ConnectionConfig[];
  artifacts: Record<string, AnalysisArtifact>;
  pipelines: PipelineDefinition[];
  pipelineRuns?: PipelineRunRecord[];
  backgroundAgents: BackgroundAgentDefinition[];
  backgroundAgentEnvironments?: BackgroundAgentEnvironment[];
  backgroundAgentRuns?: BackgroundAgentRun[];
  backgroundAgentApprovals?: BackgroundAgentApprovalItem[];
  queryHistory: QueryHistoryRecord[];
  memoryEpisodes: Episode[];
  workspaceRules?: WorkspaceRule[];
}

export interface WorkspaceSearchMatch {
  document: WorkspaceSearchDocument;
  score: number;
  snippet: string;
  reasons: string[];
  relatedDocumentIds: string[];
  relatedDocuments: Array<Pick<WorkspaceSearchDocument, "id" | "kind" | "title">>;
}

export interface WorkspaceSearchOptions {
  limit?: number;
  kinds?: WorkspaceSearchDocumentKind[];
  connectionId?: string | null;
  recentDays?: number | null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueTokens(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

function buildConnectionNameMap(connections: ConnectionConfig[]): Record<string, string> {
  return Object.fromEntries(connections.map((connection) => [connection.id, connection.display_name]));
}

function artifactKindToDocumentKind(kind: AnalysisArtifact["kind"]): WorkspaceSearchDocumentKind {
  switch (kind) {
    case "chart":
      return "artifact_chart";
    case "query":
      return "artifact_query";
    case "report":
      return "artifact_report";
  }
}

function summarizeSql(sql: string, maxLength = 180): string {
  const compact = sql.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function inferIntentBoost(
  document: WorkspaceSearchDocument,
  queryTokens: string[],
): number {
  const q = queryTokens.join(" ");
  let boost = 0;

  if (/\b(chart|plot|graph|visual|trend|dashboard)\b/.test(q)) {
    if (document.kind === "artifact_chart" || document.kind === "artifact_report") boost += 36;
    if (document.kind.startsWith("schema_")) boost -= 8;
  }

  if (/\b(report|summary|brief)\b/.test(q) && document.kind === "artifact_report") {
    boost += 42;
  }

  if (/\b(table|column|schema|index|view)\b/.test(q)) {
    if (document.kind.startsWith("schema_")) boost += 30;
    if (document.kind === "schema_table" || document.kind === "schema_column") boost += 10;
  }

  if (/\b(history|previous|earlier)\b/.test(q) && document.kind === "query_history") {
    boost += 34;
  }

  if (/\b(memory|incident|investigation|outcome|learned)\b/.test(q) && document.kind === "memory_episode") {
    boost += 34;
  }

  if (/\b(rule|preference|guideline|convention|always|never)\b/.test(q) && document.kind === "workspace_rule") {
    boost += 38;
  }

  if (/\b(agent|monitor|scheduled|cadence|background)\b/.test(q) && document.kind === "background_agent") {
    boost += 34;
  }

  if (/\b(pipeline|materialize|sync|etl|load)\b/.test(q) && document.kind === "pipeline") {
    boost += 34;
  }

  return boost;
}

function inferIntentReasons(
  document: WorkspaceSearchDocument,
  queryTokens: string[],
): string[] {
  const q = queryTokens.join(" ");
  const reasons: string[] = [];

  if (/\b(chart|plot|graph|visual|trend|dashboard)\b/.test(q)) {
    if (document.kind === "artifact_chart" || document.kind === "artifact_report") {
      reasons.push("matches visualization intent");
    }
  }

  if (/\b(report|summary|brief)\b/.test(q) && document.kind === "artifact_report") {
    reasons.push("matches report intent");
  }

  if (/\b(table|column|schema|index|view)\b/.test(q) && document.kind.startsWith("schema_")) {
    reasons.push("matches schema intent");
  }

  if (/\b(history|previous|earlier)\b/.test(q) && document.kind === "query_history") {
    reasons.push("matches history intent");
  }

  if (/\b(memory|incident|investigation|outcome|learned)\b/.test(q) && document.kind === "memory_episode") {
    reasons.push("matches investigation memory");
  }

  if (/\b(rule|preference|guideline|convention|always|never)\b/.test(q) && document.kind === "workspace_rule") {
    reasons.push("matches workspace rules");
  }

  if (/\b(agent|monitor|scheduled|cadence|background)\b/.test(q) && document.kind.startsWith("background_agent")) {
    reasons.push("matches agent intent");
  }

  if (/\b(pipeline|materialize|sync|etl|load)\b/.test(q) && document.kind.startsWith("pipeline")) {
    reasons.push("matches pipeline intent");
  }

  return reasons;
}

function inferDirectReasons(
  document: WorkspaceSearchDocument,
  queryTokens: string[],
): string[] {
  const title = normalizeText(document.title);
  const subtitle = normalizeText(document.subtitle);
  const body = normalizeText(document.body);
  const keywords = document.keywords.map(normalizeText);
  const reasons = new Set<string>();

  for (const token of queryTokens) {
    if (title === token || title.includes(token)) reasons.add("direct title match");
    else if (subtitle.includes(token)) reasons.add("direct context match");
    else if (body.includes(token)) reasons.add("direct content match");
    if (keywords.some((keyword) => keyword === token || keyword.includes(token))) {
      reasons.add("keyword match");
    }
  }

  for (const reason of inferIntentReasons(document, queryTokens)) {
    reasons.add(reason);
  }

  return [...reasons];
}

function buildSnippet(document: WorkspaceSearchDocument, queryTokens: string[]): string {
  const source = `${document.subtitle} ${document.body}`.replace(/\s+/g, " ").trim();
  if (!source) return document.subtitle;

  const lower = source.toLowerCase();
  let bestIndex = -1;
  for (const token of queryTokens) {
    const index = lower.indexOf(token.toLowerCase());
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return source.length <= 160 ? source : `${source.slice(0, 159)}â€¦`;
  }

  const start = Math.max(0, bestIndex - 40);
  const end = Math.min(source.length, bestIndex + 120);
  return `${start > 0 ? "â€¦" : ""}${source.slice(start, end).trim()}${end < source.length ? "â€¦" : ""}`;
}

function stringArrayMetadata(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function overlapCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}

function buildRelationshipGraph(
  documents: WorkspaceSearchDocument[],
): Map<string, Set<string>> {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const graph = new Map<string, Set<string>>();

  const link = (left: string, right: string) => {
    if (left === right || !byId.has(left) || !byId.has(right)) return;
    if (!graph.has(left)) graph.set(left, new Set());
    if (!graph.has(right)) graph.set(right, new Set());
    graph.get(left)!.add(right);
    graph.get(right)!.add(left);
  };

  const artifactDocIdByArtifactId = new Map<string, string>();
  const pipelineDocIdByPipelineId = new Map<string, string>();
  const pipelineRunDocIdByRunId = new Map<string, string>();
  const agentDocIdByAgentId = new Map<string, string>();
  const agentRunDocIdByRunId = new Map<string, string>();
  const sourceTableIndex = new Map<string, string[]>();
  const memoryDocs: WorkspaceSearchDocument[] = [];

  for (const document of documents) {
    const metadata = document.metadata ?? {};
    const artifactId = typeof metadata.artifactId === "string" ? metadata.artifactId : null;
    const pipelineId = typeof metadata.pipelineId === "string" ? metadata.pipelineId : null;
    const runId = typeof metadata.runId === "string" ? metadata.runId : null;
    const agentId = typeof metadata.agentId === "string" ? metadata.agentId : null;

    if (artifactId && document.kind.startsWith("artifact_")) {
      artifactDocIdByArtifactId.set(artifactId, document.id);
    }
    if (pipelineId && document.kind === "pipeline") {
      pipelineDocIdByPipelineId.set(pipelineId, document.id);
    }
    if (runId && document.kind === "pipeline_run") {
      pipelineRunDocIdByRunId.set(runId, document.id);
    }
    if (agentId && document.kind === "background_agent") {
      agentDocIdByAgentId.set(agentId, document.id);
    }
    if (runId && document.kind === "background_agent_run") {
      agentRunDocIdByRunId.set(runId, document.id);
    }

    for (const tableName of stringArrayMetadata(metadata.sourceTables)) {
      const existing = sourceTableIndex.get(tableName) ?? [];
      existing.push(document.id);
      sourceTableIndex.set(tableName, existing);
    }

    if (document.kind === "memory_episode") {
      memoryDocs.push(document);
    }
  }

  for (const document of documents) {
    const metadata = document.metadata ?? {};

    for (const artifactId of stringArrayMetadata(metadata.sourceArtifactIds)) {
      const relatedId = artifactDocIdByArtifactId.get(artifactId);
      if (relatedId) link(document.id, relatedId);
    }

    const artifactId = typeof metadata.artifactId === "string" ? metadata.artifactId : null;
    if (artifactId) {
      const relatedId = artifactDocIdByArtifactId.get(artifactId);
      if (relatedId) link(document.id, relatedId);
    }

    const lastRunArtifactId =
      typeof metadata.lastRunArtifactId === "string" ? metadata.lastRunArtifactId : null;
    if (lastRunArtifactId) {
      const relatedId = artifactDocIdByArtifactId.get(lastRunArtifactId);
      if (relatedId) link(document.id, relatedId);
    }

    const reportArtifactId =
      typeof metadata.reportArtifactId === "string" ? metadata.reportArtifactId : null;
    if (reportArtifactId) {
      const relatedId = artifactDocIdByArtifactId.get(reportArtifactId);
      if (relatedId) link(document.id, relatedId);
    }

    for (const queryArtifactId of stringArrayMetadata(metadata.queryArtifactIds)) {
      const relatedId = artifactDocIdByArtifactId.get(queryArtifactId);
      if (relatedId) link(document.id, relatedId);
    }

    const pipelineId = typeof metadata.pipelineId === "string" ? metadata.pipelineId : null;
    if (pipelineId) {
      const relatedId = pipelineDocIdByPipelineId.get(pipelineId);
      if (relatedId) link(document.id, relatedId);
    }

    const agentId = typeof metadata.agentId === "string" ? metadata.agentId : null;
    if (agentId) {
      const relatedId = agentDocIdByAgentId.get(agentId);
      if (relatedId) link(document.id, relatedId);
    }

    const runId = typeof metadata.runId === "string" ? metadata.runId : null;
    if (runId) {
      const pipelineRunDocId = pipelineRunDocIdByRunId.get(runId);
      if (pipelineRunDocId) link(document.id, pipelineRunDocId);
      const agentRunDocId = agentRunDocIdByRunId.get(runId);
      if (agentRunDocId) link(document.id, agentRunDocId);
    }

    for (const tableName of stringArrayMetadata(metadata.sourceTables)) {
      for (const relatedId of sourceTableIndex.get(tableName) ?? []) {
        link(document.id, relatedId);
      }
    }
  }

  for (const memoryDocument of memoryDocs) {
    const memoryKeywords = memoryDocument.keywords;
    for (const document of documents) {
      if (document.id === memoryDocument.id) continue;
      if (memoryDocument.connectionId && document.connectionId && memoryDocument.connectionId !== document.connectionId) {
        continue;
      }
      if (overlapCount(memoryKeywords, document.keywords) >= 2) {
        link(memoryDocument.id, document.id);
      }
    }
  }

  return graph;
}

function inferRelationshipReason(document: WorkspaceSearchDocument): string {
  switch (document.kind) {
    case "artifact_query":
    case "artifact_chart":
    case "artifact_report":
      return "linked artifact";
    case "pipeline_run":
      return "related pipeline run";
    case "pipeline":
      return "related pipeline";
    case "background_agent":
      return "related background agent";
    case "background_agent_run":
      return "related agent run";
    case "background_agent_approval":
      return "related approval";
    case "memory_episode":
      return "related investigation memory";
    case "workspace_rule":
      return "related workspace rule";
    case "query_history":
      return "related query history";
    default:
      return "related workspace object";
  }
}

function applyRelationshipBoosts(matches: WorkspaceSearchMatch[]): WorkspaceSearchMatch[] {
  const graph = buildRelationshipGraph(matches.map((match) => match.document));
  const directMatches = matches.filter((match) => match.score > 0);
  const boostedScores = new Map(matches.map((match) => [match.document.id, match.score]));
  const relatedReasons = new Map<string, Set<string>>();
  const relatedIds = new Map<string, Set<string>>();
  const byId = new Map(matches.map((match) => [match.document.id, match.document]));

  for (const match of directMatches) {
    const neighbors = graph.get(match.document.id);
    if (!neighbors || neighbors.size === 0) continue;
    const propagation = Math.min(28, match.score * 0.18);
    for (const neighborId of neighbors) {
      boostedScores.set(neighborId, (boostedScores.get(neighborId) ?? 0) + propagation);
      const neighbor = matches.find((candidate) => candidate.document.id === neighborId)?.document;
      if (!neighbor) continue;
      if (!relatedReasons.has(neighborId)) relatedReasons.set(neighborId, new Set());
      if (!relatedIds.has(neighborId)) relatedIds.set(neighborId, new Set());
      relatedReasons.get(neighborId)!.add(inferRelationshipReason(match.document));
      relatedIds.get(neighborId)!.add(match.document.id);
    }
  }

  return matches.map((match) => ({
    ...match,
    score: boostedScores.get(match.document.id) ?? match.score,
    reasons: [...new Set([...(match.reasons ?? []), ...(relatedReasons.get(match.document.id) ?? [])])],
    relatedDocumentIds: [...(relatedIds.get(match.document.id) ?? new Set<string>())],
    relatedDocuments: [...(relatedIds.get(match.document.id) ?? new Set<string>())]
      .map((id) => byId.get(id))
      .filter((document): document is WorkspaceSearchDocument => !!document)
      .map((document) => ({
        id: document.id,
        kind: document.kind,
        title: document.title,
      })),
  }));
}

function scoreDocument(document: WorkspaceSearchDocument, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const title = normalizeText(document.title);
  const subtitle = normalizeText(document.subtitle);
  const body = normalizeText(document.body);
  const keywords = document.keywords.map(normalizeText);

  let score = 0;
  for (const token of queryTokens) {
    if (title === token) score += 120;
    if (title.includes(token)) score += 60;
    if (subtitle.includes(token)) score += 24;
    if (body.includes(token)) score += 12;
    if (keywords.some((keyword) => keyword === token)) score += 32;
    if (keywords.some((keyword) => keyword.includes(token))) score += 16;
  }

  if (queryTokens.length > 1) {
    const joined = queryTokens.join(" ");
    if (title.includes(joined)) score += 40;
    if (body.includes(joined)) score += 18;
  }

  const ageHours = Math.max(0, (Date.now() - document.updatedAt) / 3_600_000);
  const recencyBoost = Math.max(0, 10 - Math.min(ageHours, 10));
  score += recencyBoost;

  if (document.kind.startsWith("artifact_")) score += 8;
  if (document.kind === "pipeline" || document.kind === "background_agent") score += 6;
  score += inferIntentBoost(document, queryTokens);

  return score;
}

export function buildSchemaDocuments(
  schemas: Record<string, FullSchema>,
  connectionNames: Record<string, string>,
): WorkspaceSearchDocument[] {
  const docs: WorkspaceSearchDocument[] = [];

  for (const [connectionId, schema] of Object.entries(schemas)) {
    const connectionName = connectionNames[connectionId] ?? connectionId;

    for (const table of schema.tables) {
      const fullName = `${table.schema}.${table.name}`;
      const tableKind =
        table.object_type === "view" || table.object_type === "materialized_view"
          ? "schema_view"
          : "schema_table";
      const limit = tableKind === "schema_view" ? 200 : 500;
      docs.push({
        id: `schema:${connectionId}:${fullName}`,
        kind: tableKind,
        title: table.name,
        subtitle: `${fullName} · ${connectionName}`,
        body: `Schema object ${fullName} on ${connectionName}. Type ${table.object_type}.`,
        keywords: uniqueTokens([table.name, table.schema, fullName, connectionName, table.object_type]),
        connectionId,
        updatedAt: Date.now(),
        action: {
          type: "open_sql",
          connectionId,
          sql: `SELECT * FROM "${table.schema}"."${table.name}" LIMIT ${limit};`,
        },
        metadata: {
          schema: table.schema,
          table: table.name,
          objectType: table.object_type,
          sourceTables: [fullName],
        },
      });

      const columns = schema.columns[fullName] ?? schema.columns[table.name] ?? [];
      for (const column of columns) {
        docs.push({
          id: `column:${connectionId}:${fullName}:${column.name}`,
          kind: "schema_column",
          title: column.name,
          subtitle: `${fullName} · ${column.type_name}`,
          body: `Column ${column.name} on ${fullName} in ${connectionName}. Type ${column.type_name}.`,
          keywords: uniqueTokens([
            column.name,
            column.type_name,
            table.name,
            table.schema,
            fullName,
            connectionName,
          ]),
          connectionId,
          updatedAt: Date.now(),
          action: {
            type: "open_sql",
            connectionId,
            sql: `SELECT "${column.name}" FROM "${table.schema}"."${table.name}" LIMIT 500;`,
          },
          metadata: {
            schema: table.schema,
            table: table.name,
            column: column.name,
            sourceTables: [fullName],
          },
        });
      }
    }

    for (const index of schema.indexes ?? []) {
      docs.push({
        id: `index:${connectionId}:${index.index_name}`,
        kind: "schema_index",
        title: index.index_name,
        subtitle: `${index.table_name} · ${connectionName}`,
        body: `Index ${index.index_name} on ${index.table_name} covering ${index.columns.join(", ")}.`,
        keywords: uniqueTokens([index.index_name, index.table_name, ...index.columns, connectionName]),
        connectionId,
        updatedAt: Date.now(),
        action: {
          type: "open_sql",
          connectionId,
          sql: `SELECT * FROM ${index.table_name} LIMIT 500;`,
        },
        metadata: {
          tableName: index.table_name,
          columns: index.columns,
          sourceTables: [index.table_name],
        },
      });
    }
  }

  return docs;
}

export function buildArtifactDocuments(
  artifacts: Record<string, AnalysisArtifact>,
): WorkspaceSearchDocument[] {
  return Object.values(artifacts).map((artifact) => {
    const body =
      artifact.kind === "report"
        ? [
            artifact.spec.title,
            artifact.spec.sections
              .map((section) => ("title" in section && typeof section.title === "string" ? section.title : section.type))
              .join(" "),
            artifact.sourceArtifactIds.join(" "),
          ].join(" ")
        : [artifact.lineage.sql, artifact.lineage.sourceTables.join(" "), String(artifact.snapshot.rowCount)].join(" ");

    const connectionId = artifact.kind === "report" ? null : artifact.lineage.connectionId;

    return {
      id: `artifact:${artifact.id}`,
      kind: artifactKindToDocumentKind(artifact.kind),
      title: artifact.name,
      subtitle:
        artifact.kind === "report"
          ? `Report artifact · ${artifact.connectionName}`
          : `${artifact.kind} artifact · ${artifact.snapshot.rowCount.toLocaleString()} rows`,
      body,
      keywords: uniqueTokens([
        artifact.name,
        artifact.kind,
        artifact.kind === "report" ? artifact.connectionName : artifact.lineage.sourceTables.join(" "),
      ]),
      connectionId,
      updatedAt: artifact.updatedAt,
      action: {
        type: "open_artifact",
        artifactId: artifact.id,
        artifactKind: artifact.kind,
      },
      metadata: {
        artifactId: artifact.id,
        sourceTables: artifact.kind === "report" ? [] : artifact.lineage.sourceTables,
        sourceArtifactIds: artifact.kind === "report" ? artifact.sourceArtifactIds : [],
      },
    };
  });
}

export function buildPipelineDocuments(
  pipelines: PipelineDefinition[],
): WorkspaceSearchDocument[] {
  return pipelines.map((pipeline) => ({
    id: `pipeline:${pipeline.id}`,
    kind: "pipeline",
    title: pipeline.name,
    subtitle: `${pipeline.targetTable} · ${pipeline.sourceConnectionId} → ${pipeline.targetConnectionId}`,
    body: `${summarizeSql(pipeline.sourceQuery)} Latest status ${pipeline.lastRunStatus ?? "never_run"} Target table ${pipeline.targetTable}.`,
    keywords: uniqueTokens([
      pipeline.name,
      pipeline.targetTable,
      pipeline.sourceConnectionId,
      pipeline.targetConnectionId,
      pipeline.lastRunStatus ?? "",
    ]),
    connectionId: pipeline.sourceConnectionId,
    updatedAt: pipeline.updatedAt,
    action: {
      type: "open_panel",
      panel: "pipelines",
    },
    metadata: {
      pipelineId: pipeline.id,
      targetTable: pipeline.targetTable,
      lastRunArtifactId: pipeline.lastRunArtifactId ?? null,
    },
  }));
}

export function buildPipelineRunDocuments(
  runs: PipelineRunRecord[],
): WorkspaceSearchDocument[] {
  return runs.map((run) => ({
    id: `pipeline-run:${run.id}`,
    kind: "pipeline_run",
    title: `Pipeline run ${run.pipelineId}`,
    subtitle: `${run.status} · ${run.targetTable}`,
    body: [
      run.pipelineId,
      run.targetTable,
      run.error ?? "",
      run.artifactId ?? "",
      run.sourceConnectionId,
      run.targetConnectionId,
    ].join(" "),
    keywords: uniqueTokens([
      run.pipelineId,
      run.status,
      run.targetTable,
      run.artifactId ?? "",
      run.sourceConnectionId,
      run.targetConnectionId,
    ]),
    connectionId: run.sourceConnectionId,
    updatedAt: run.finishedAt ?? run.startedAt,
    action: {
      type: "open_panel",
      panel: "pipelines",
    },
    metadata: {
      pipelineId: run.pipelineId,
      runId: run.id,
      artifactId: run.artifactId ?? null,
      sourceTables: [run.targetTable],
    },
  }));
}

export function buildBackgroundAgentDocuments(
  agents: BackgroundAgentDefinition[],
): WorkspaceSearchDocument[] {
  return agents.map((agent) => ({
    id: `background-agent:${agent.id}`,
    kind: "background_agent",
    title: agent.name,
    subtitle: `${agent.connectionId} · ${agent.isEnabled ? "enabled" : "disabled"}`,
    body: `${agent.prompt} ${agent.lastRunSummary ?? ""}`.trim(),
    keywords: uniqueTokens([
      agent.name,
      agent.connectionId,
      agent.lastRunStatus ?? "",
      agent.lastRunSummary ?? "",
    ]),
    connectionId: agent.connectionId,
    updatedAt: agent.updatedAt,
    action: {
      type: "open_panel",
      panel: "background_agents",
    },
    metadata: {
      agentId: agent.id,
      cadenceMinutes: agent.cadenceMinutes,
      lastRunArtifactId: agent.lastRunArtifactId ?? null,
    },
  }));
}

export function buildBackgroundAgentEnvironmentDocuments(
  environments: BackgroundAgentEnvironment[],
): WorkspaceSearchDocument[] {
  return environments.map((environment) => ({
    id: `background-environment:${environment.id}`,
    kind: "background_environment",
    title: environment.name,
    subtitle: `${environment.status} · concurrency ${environment.concurrencyLimit}`,
    body: [
      environment.description,
      environment.connectionIds.join(" "),
      environment.isEnabled ? "enabled" : "disabled",
    ].join(" "),
    keywords: uniqueTokens([
      environment.name,
      environment.description,
      environment.status,
      environment.connectionIds.join(" "),
    ]),
    connectionId: null,
    updatedAt: environment.updatedAt,
    action: {
      type: "open_panel",
      panel: "background_agents",
    },
    metadata: {
      environmentId: environment.id,
      connectionIds: environment.connectionIds,
      concurrencyLimit: environment.concurrencyLimit,
    },
  }));
}

export function buildBackgroundAgentRunDocuments(
  runs: BackgroundAgentRun[],
): WorkspaceSearchDocument[] {
  return runs.map((run) => ({
    id: `background-agent-run:${run.id}`,
    kind: "background_agent_run",
    title: `Agent run ${run.agentId}`,
    subtitle: `${run.status} · ${run.reportArtifactId ?? "no report artifact"}`,
    body: [
      run.agentId,
      run.trigger,
      run.summary ?? "",
      run.error ?? "",
      run.reportArtifactId ?? "",
      run.queryArtifactIds.join(" "),
      run.approvalIds.join(" "),
      run.events.map((event) => `${event.type} ${event.message}`).join(" "),
    ].join(" "),
    keywords: uniqueTokens([
      run.agentId,
      run.status,
      run.trigger,
      run.reportArtifactId ?? "",
      run.queryArtifactIds.join(" "),
    ]),
    connectionId: null,
    updatedAt: run.finishedAt ?? run.startedAt,
    action: {
      type: "open_panel",
      panel: "background_agents",
    },
    metadata: {
      agentId: run.agentId,
      runId: run.id,
      trigger: run.trigger,
      attemptCount: run.attemptCount,
      reportArtifactId: run.reportArtifactId ?? null,
      queryArtifactIds: run.queryArtifactIds,
      approvalIds: run.approvalIds,
    },
  }));
}

export function buildBackgroundAgentApprovalDocuments(
  approvals: BackgroundAgentApprovalItem[],
): WorkspaceSearchDocument[] {
  return approvals.map((approval) => ({
    id: `background-agent-approval:${approval.id}`,
    kind: "background_agent_approval",
    title: approval.title,
    subtitle: `${approval.status} · ${approval.risk}`,
    body: [approval.agentId, approval.runId, approval.rationale, approval.suggestedSql ?? ""].join(" "),
    keywords: uniqueTokens([
      approval.title,
      approval.status,
      approval.risk,
      approval.agentId,
      approval.runId,
    ]),
    connectionId: null,
    updatedAt: approval.resolvedAt ?? approval.createdAt,
    action: {
      type: "open_panel",
      panel: "background_agents",
    },
    metadata: {
      agentId: approval.agentId,
      runId: approval.runId,
      approvalId: approval.id,
    },
  }));
}

export function buildHistoryDocuments(history: QueryHistoryRecord[]): WorkspaceSearchDocument[] {
  return history.map((entry) => ({
    id: `query-history:${entry.query_id}`,
    kind: "query_history",
    title: entry.source_table ?? entry.source_tables[0] ?? "Query history",
    subtitle: `${entry.row_count} rows · ${entry.duration_ms} ms`,
    body: `${entry.sql} ${entry.source_tables.join(" ")} ${entry.error_message ?? ""}`.trim(),
    keywords: uniqueTokens([
      entry.source_table ?? "",
      entry.source_tables.join(" "),
      entry.success ? "success" : "error",
    ]),
    connectionId: null,
    updatedAt: Date.parse(entry.executed_at) || Date.now(),
    action: {
      type: "open_panel",
      panel: "history",
    },
    metadata: {
      queryId: entry.query_id,
      sql: entry.sql,
      success: entry.success,
      sourceTables: entry.source_tables,
    },
  }));
}

export function buildMemoryDocuments(episodes: Episode[]): WorkspaceSearchDocument[] {
  return episodes.map((episode) => ({
    id: `memory:${episode.id}`,
    kind: "memory_episode",
    title: episode.problem,
    subtitle: `${episode.toolsUsed.join(", ") || "memory"}${episode.connectionId ? ` · ${episode.connectionId}` : ""}`,
    body: `${episode.problem} ${episode.outcome ?? ""} ${JSON.stringify(episode.findings)}`,
    keywords: uniqueTokens([
      episode.problem,
      episode.outcome ?? "",
      episode.connectionId ?? "",
      episode.toolsUsed.join(" "),
    ]),
    connectionId: episode.connectionId ?? null,
    updatedAt: episode.createdAt,
    action: {
      type: "open_panel",
      panel: "memory",
    },
    metadata: {
      episodeId: episode.id,
      sessionId: episode.sessionId,
    },
  }));
}

export function buildWorkspaceRuleDocuments(rules: WorkspaceRule[]): WorkspaceSearchDocument[] {
  return rules
    .filter((rule) => rule.status === "approved" || rule.status === "suggested")
    .map((rule) => ({
      id: `workspace-rule:${rule.id}`,
      kind: "workspace_rule" as const,
      title: rule.title,
      subtitle: `${rule.kind} · ${rule.scope === "connection" ? (rule.connectionId ?? "connection") : "workspace"} · ${rule.status}`,
      body: [rule.instruction, rule.rationale ?? "", rule.evidence.join(" ")].join(" ").trim(),
      keywords: uniqueTokens([
        rule.title,
        rule.instruction,
        rule.kind,
        rule.scope,
        rule.status,
        rule.connectionId ?? "",
        rule.evidence.join(" "),
      ]),
      connectionId: rule.scope === "connection" ? rule.connectionId ?? null : null,
      updatedAt: rule.updatedAt,
      action: {
        type: "open_panel",
        panel: "memory",
      },
      metadata: {
        ruleId: rule.id,
        status: rule.status,
      },
    }));
}

export function buildWorkspaceSearchDocuments(
  input: WorkspaceSearchIndexInput,
): WorkspaceSearchDocument[] {
  const connectionNames = buildConnectionNameMap(input.connections);
  return [
    ...buildSchemaDocuments(input.schemas, connectionNames),
    ...buildArtifactDocuments(input.artifacts),
    ...buildPipelineDocuments(input.pipelines),
    ...buildPipelineRunDocuments(input.pipelineRuns ?? []),
    ...buildBackgroundAgentEnvironmentDocuments(input.backgroundAgentEnvironments ?? []),
    ...buildBackgroundAgentDocuments(input.backgroundAgents),
    ...buildBackgroundAgentRunDocuments(input.backgroundAgentRuns ?? []),
    ...buildBackgroundAgentApprovalDocuments(input.backgroundAgentApprovals ?? []),
    ...buildHistoryDocuments(input.queryHistory),
    ...buildMemoryDocuments(input.memoryEpisodes),
    ...buildWorkspaceRuleDocuments(input.workspaceRules ?? []),
  ];
}

export function buildWorkspaceSearchSegments(
  input: WorkspaceSearchIndexInput,
): Record<
  "schema" | "artifacts" | "pipelines" | "backgroundAgents" | "history" | "memory",
  WorkspaceSearchDocument[]
> {
  const connectionNames = buildConnectionNameMap(input.connections);
  return {
    schema: buildSchemaDocuments(input.schemas, connectionNames),
    artifacts: buildArtifactDocuments(input.artifacts),
    pipelines: [
      ...buildPipelineDocuments(input.pipelines),
      ...buildPipelineRunDocuments(input.pipelineRuns ?? []),
    ],
    backgroundAgents: [
      ...buildBackgroundAgentEnvironmentDocuments(input.backgroundAgentEnvironments ?? []),
      ...buildBackgroundAgentDocuments(input.backgroundAgents),
      ...buildBackgroundAgentRunDocuments(input.backgroundAgentRuns ?? []),
      ...buildBackgroundAgentApprovalDocuments(input.backgroundAgentApprovals ?? []),
    ],
    history: buildHistoryDocuments(input.queryHistory),
    memory: [
      ...buildMemoryDocuments(input.memoryEpisodes),
      ...buildWorkspaceRuleDocuments(input.workspaceRules ?? []),
    ],
  };
}

export function searchWorkspaceDocuments(
  documents: WorkspaceSearchDocument[],
  query: string,
  options: number | WorkspaceSearchOptions = 40,
): WorkspaceSearchMatch[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const normalizedOptions: WorkspaceSearchOptions =
    typeof options === "number" ? { limit: options } : options;
  const limit = normalizedOptions.limit ?? 40;
  const cutoffTime =
    normalizedOptions.recentDays && normalizedOptions.recentDays > 0
      ? Date.now() - normalizedOptions.recentDays * 86_400_000
      : null;

  const candidateMatches = documents
    .filter((document) => {
      if (
        normalizedOptions.kinds &&
        normalizedOptions.kinds.length > 0 &&
        !normalizedOptions.kinds.includes(document.kind)
      ) {
        return false;
      }
      if (
        normalizedOptions.connectionId !== undefined &&
        normalizedOptions.connectionId !== null &&
        document.connectionId !== normalizedOptions.connectionId
      ) {
        return false;
      }
      if (cutoffTime && document.updatedAt < cutoffTime) {
        return false;
      }
      return true;
    })
    .map((document) => ({
      document,
      score: scoreDocument(document, queryTokens),
      snippet: buildSnippet(document, queryTokens),
      reasons: inferDirectReasons(document, queryTokens),
      relatedDocumentIds: [],
      relatedDocuments: [],
    }));

  return applyRelationshipBoosts(candidateMatches)
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || right.document.updatedAt - left.document.updatedAt)
    .slice(0, limit);
}
