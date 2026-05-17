import type { FullSchema, QueryHistoryRecord } from "../db/DbClient";
import type { ConnectionConfig } from "../db/DbClient";
import type { AnalysisArtifact } from "../stores/WorkspaceStore";
import type { PipelineDefinition } from "../pipelines/PipelineStore";
import type { BackgroundAgentDefinition } from "../backgroundAgents/BackgroundAgentStore";
import type { Episode } from "../memory/EpisodicMemory";

export type WorkspaceSearchDocumentKind =
  | "schema_table"
  | "schema_view"
  | "schema_column"
  | "schema_index"
  | "artifact_query"
  | "artifact_chart"
  | "artifact_report"
  | "pipeline"
  | "background_agent"
  | "query_history"
  | "memory_episode";

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
  backgroundAgents: BackgroundAgentDefinition[];
  queryHistory: QueryHistoryRecord[];
  memoryEpisodes: Episode[];
}

export interface WorkspaceSearchMatch {
  document: WorkspaceSearchDocument;
  score: number;
  snippet: string;
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

  if (/\b(agent|monitor|scheduled|cadence|background)\b/.test(q) && document.kind === "background_agent") {
    boost += 34;
  }

  if (/\b(pipeline|materialize|sync|etl|load)\b/.test(q) && document.kind === "pipeline") {
    boost += 34;
  }

  return boost;
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

export function buildWorkspaceSearchDocuments(
  input: WorkspaceSearchIndexInput,
): WorkspaceSearchDocument[] {
  const connectionNames = buildConnectionNameMap(input.connections);
  return [
    ...buildSchemaDocuments(input.schemas, connectionNames),
    ...buildArtifactDocuments(input.artifacts),
    ...buildPipelineDocuments(input.pipelines),
    ...buildBackgroundAgentDocuments(input.backgroundAgents),
    ...buildHistoryDocuments(input.queryHistory),
    ...buildMemoryDocuments(input.memoryEpisodes),
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
    pipelines: buildPipelineDocuments(input.pipelines),
    backgroundAgents: buildBackgroundAgentDocuments(input.backgroundAgents),
    history: buildHistoryDocuments(input.queryHistory),
    memory: buildMemoryDocuments(input.memoryEpisodes),
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

  return documents
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
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || right.document.updatedAt - left.document.updatedAt)
    .slice(0, limit);
}
