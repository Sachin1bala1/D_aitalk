import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";
import type { WorkspaceSearchIndexInput, WorkspaceSearchDocument } from "./workspaceSemanticIndex";
import { buildWorkspaceSearchSegments } from "./workspaceSemanticIndex";

type SearchSegmentKey =
  | "schema"
  | "artifacts"
  | "pipelines"
  | "backgroundAgents"
  | "history"
  | "memory";

interface WorkspaceSearchSnapshotDocument {
  version: 1;
  savedAt: number;
  fingerprints: Record<SearchSegmentKey, string>;
  segments: Record<SearchSegmentKey, WorkspaceSearchDocument[]>;
}

const DOC_KEY = "workspace_search_snapshot";
const DEFAULT_SNAPSHOT: WorkspaceSearchSnapshotDocument = {
  version: 1,
  savedAt: 0,
  fingerprints: {
    schema: "",
    artifacts: "",
    pipelines: "",
    backgroundAgents: "",
    history: "",
    memory: "",
  },
  segments: {
    schema: [],
    artifacts: [],
    pipelines: [],
    backgroundAgents: [],
    history: [],
    memory: [],
  },
};

let snapshotCache: WorkspaceSearchSnapshotDocument | null = null;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function computeFingerprints(input: WorkspaceSearchIndexInput): Record<SearchSegmentKey, string> {
  return {
    schema: stableStringify({
      connections: input.connections.map((connection) => ({
        id: connection.id,
        display_name: connection.display_name,
      })),
      schemas: Object.entries(input.schemas).map(([connectionId, schema]) => ({
        connectionId,
        tables: schema.tables.map((table) => ({
          schema: table.schema,
          name: table.name,
          object_type: table.object_type,
        })),
        columns: Object.entries(schema.columns).map(([key, columns]) => ({
          key,
          columns: columns.map((column) => ({
            name: column.name,
            type_name: column.type_name,
          })),
        })),
        indexes: schema.indexes.map((index) => ({
          index_name: index.index_name,
          table_name: index.table_name,
          columns: index.columns,
        })),
      })),
    }),
    artifacts: stableStringify(
      Object.values(input.artifacts).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        updatedAt: artifact.updatedAt,
        payload:
          artifact.kind === "report"
            ? {
                sourceArtifactIds: artifact.sourceArtifactIds,
                sectionBindings: artifact.sectionBindings,
                title: artifact.spec.title,
              }
            : {
                sql: artifact.lineage.sql,
                sourceTables: artifact.lineage.sourceTables,
                rowCount: artifact.snapshot.rowCount,
              },
      })),
    ),
    pipelines: stableStringify(
      {
        pipelines: input.pipelines.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          updatedAt: pipeline.updatedAt,
          targetTable: pipeline.targetTable,
          lastRunStatus: pipeline.lastRunStatus ?? null,
        })),
        runs: (input.pipelineRuns ?? []).map((run) => ({
          id: run.id,
          pipelineId: run.pipelineId,
          status: run.status,
          finishedAt: run.finishedAt ?? null,
          artifactId: run.artifactId ?? null,
        })),
      },
    ),
    backgroundAgents: stableStringify(
      {
        agents: input.backgroundAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          environmentId: agent.environmentId,
          updatedAt: agent.updatedAt,
          lastRunStatus: agent.lastRunStatus,
          lastRunSummary: agent.lastRunSummary,
        })),
        environments: (input.backgroundAgentEnvironments ?? []).map((environment) => ({
          id: environment.id,
          name: environment.name,
          status: environment.status,
          concurrencyLimit: environment.concurrencyLimit,
          connectionIds: environment.connectionIds,
          updatedAt: environment.updatedAt,
        })),
        runs: (input.backgroundAgentRuns ?? []).map((run) => ({
          id: run.id,
          agentId: run.agentId,
          environmentId: run.environmentId,
          status: run.status,
          trigger: run.trigger,
          attemptCount: run.attemptCount,
          finishedAt: run.finishedAt ?? null,
          reportArtifactId: run.reportArtifactId ?? null,
          events: run.events.map((event) => ({
            type: event.type,
            at: event.at,
            message: event.message,
          })),
        })),
        approvals: (input.backgroundAgentApprovals ?? []).map((approval) => ({
          id: approval.id,
          agentId: approval.agentId,
          runId: approval.runId,
          status: approval.status,
          risk: approval.risk,
          resolvedAt: approval.resolvedAt ?? null,
        })),
      },
    ),
    history: stableStringify(
      input.queryHistory.map((entry) => ({
        query_id: entry.query_id,
        sql: entry.sql,
        executed_at: entry.executed_at,
        success: entry.success,
      })),
    ),
    memory: stableStringify(
      {
        episodes: input.memoryEpisodes.map((episode) => ({
          id: episode.id,
          problem: episode.problem,
          outcome: episode.outcome ?? null,
          createdAt: episode.createdAt,
        })),
        rules: (input.workspaceRules ?? []).map((rule) => ({
          id: rule.id,
          title: rule.title,
          instruction: rule.instruction,
          status: rule.status,
          updatedAt: rule.updatedAt,
          connectionId: rule.connectionId ?? null,
        })),
      },
    ),
  };
}

function cloneSnapshot(snapshot: WorkspaceSearchSnapshotDocument): WorkspaceSearchSnapshotDocument {
  return {
    version: 1,
    savedAt: snapshot.savedAt,
    fingerprints: { ...snapshot.fingerprints },
    segments: {
      schema: [...snapshot.segments.schema],
      artifacts: [...snapshot.segments.artifacts],
      pipelines: [...snapshot.segments.pipelines],
      backgroundAgents: [...snapshot.segments.backgroundAgents],
      history: [...snapshot.segments.history],
      memory: [...snapshot.segments.memory],
    },
  };
}

export async function loadWorkspaceSearchSnapshot(): Promise<WorkspaceSearchSnapshotDocument> {
  if (snapshotCache) {
    return cloneSnapshot(snapshotCache);
  }
  const loaded = await loadJsonDocument<WorkspaceSearchSnapshotDocument>(DOC_KEY, DEFAULT_SNAPSHOT);
  const normalized: WorkspaceSearchSnapshotDocument = {
    version: 1,
    savedAt: loaded.savedAt ?? 0,
    fingerprints: { ...DEFAULT_SNAPSHOT.fingerprints, ...(loaded.fingerprints ?? {}) },
    segments: { ...DEFAULT_SNAPSHOT.segments, ...(loaded.segments ?? {}) },
  };
  snapshotCache = normalized;
  return cloneSnapshot(normalized);
}

export async function rebuildWorkspaceSearchSnapshot(
  input: WorkspaceSearchIndexInput,
): Promise<{
  documents: WorkspaceSearchDocument[];
  rebuiltSegments: SearchSegmentKey[];
  snapshot: WorkspaceSearchSnapshotDocument;
}> {
  const existing = await loadWorkspaceSearchSnapshot();
  const fingerprints = computeFingerprints(input);
  const next = cloneSnapshot(existing);
  const rebuiltSegments: SearchSegmentKey[] = [];
  const freshSegments = buildWorkspaceSearchSegments(input);

  (Object.keys(freshSegments) as SearchSegmentKey[]).forEach((key) => {
    if (existing.fingerprints[key] !== fingerprints[key]) {
      next.segments[key] = freshSegments[key];
      next.fingerprints[key] = fingerprints[key];
      rebuiltSegments.push(key);
    }
  });

  if (rebuiltSegments.length > 0 || !snapshotCache) {
    next.savedAt = Date.now();
    snapshotCache = cloneSnapshot(next);
    try {
      await saveJsonDocument(DOC_KEY, next);
    } catch {
      notifyNativePersistenceFallback("Workspace search index");
    }
  }

  return {
    documents: [
      ...next.segments.schema,
      ...next.segments.artifacts,
      ...next.segments.pipelines,
      ...next.segments.backgroundAgents,
      ...next.segments.history,
      ...next.segments.memory,
    ],
    rebuiltSegments,
    snapshot: next,
  };
}

export function __resetWorkspaceSearchSnapshotStoreForTests() {
  snapshotCache = null;
}
