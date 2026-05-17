import { DbClient } from "../db/DbClient";
import { createQueryArtifact } from "../artifacts/queryArtifacts";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { QueryResults } from "../stores/WorkspaceStore";
import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

export type PipelineRunStatus = "running" | "success" | "failed";

export interface PipelineDefinition {
  id: string;
  name: string;
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number | null;
  lastRunStatus?: PipelineRunStatus | null;
  lastRunRowCount?: number | null;
  lastRunArtifactId?: string | null;
  lastRunError?: string | null;
}

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  startedAt: number;
  finishedAt?: number | null;
  rowCount?: number | null;
  artifactId?: string | null;
  error?: string | null;
  targetTable: string;
  sourceConnectionId: string;
  targetConnectionId: string;
}

interface PipelineDocument {
  version: 1;
  pipelines: PipelineDefinition[];
  runs: Record<string, PipelineRunRecord[]>;
}

const DOC_KEY = "pipelines";
const LEGACY_KEY = "daitalk_pipelines";

const DEFAULT_DOCUMENT: PipelineDocument = {
  version: 1,
  pipelines: [],
  runs: {},
};

let pipelineCache: PipelineDocument | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function cloneDocument(doc: PipelineDocument): PipelineDocument {
  return {
    version: 1,
    pipelines: [...doc.pipelines],
    runs: Object.fromEntries(
      Object.entries(doc.runs).map(([pipelineId, runs]) => [pipelineId, [...runs]]),
    ),
  };
}

function loadLegacyDocument(): PipelineDocument {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PipelineDocument;
      return {
        version: 1,
        pipelines: parsed.pipelines ?? [],
        runs: parsed.runs ?? {},
      };
    }
  } catch {}
  return cloneDocument(DEFAULT_DOCUMENT);
}

function setCache(doc: PipelineDocument) {
  pipelineCache = cloneDocument(doc);
  notifyListeners();
}

function getCache(): PipelineDocument {
  if (!pipelineCache) {
    pipelineCache = loadLegacyDocument();
  }
  return cloneDocument(pipelineCache);
}

async function persistDocument(doc: PipelineDocument): Promise<void> {
  try {
    await saveJsonDocument(DOC_KEY, doc);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    notifyNativePersistenceFallback("Pipelines");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(doc));
  }
}

async function updateDocument(
  updater: (current: PipelineDocument) => PipelineDocument,
): Promise<PipelineDocument> {
  const next = updater(getCache());
  setCache(next);
  await persistDocument(next);
  return cloneDocument(next);
}

export async function ensurePipelinesLoaded(): Promise<PipelineDocument> {
  const fallback = loadLegacyDocument();
  const doc = await loadJsonDocument<PipelineDocument>(DOC_KEY, fallback);
  const normalized: PipelineDocument = {
    version: 1,
    pipelines: doc.pipelines ?? [],
    runs: doc.runs ?? {},
  };
  setCache(normalized);
  if (doc === fallback) {
    await persistDocument(normalized);
  }
  return cloneDocument(normalized);
}

export function subscribePipelines(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listPipelines(): PipelineDefinition[] {
  return getCache().pipelines;
}

export function getPipelineRuns(pipelineId: string): PipelineRunRecord[] {
  return getCache().runs[pipelineId] ?? [];
}

export async function createPipelineDefinition(input: {
  name: string;
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
}): Promise<PipelineDefinition> {
  const pipeline: PipelineDefinition = {
    id: `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    sourceConnectionId: input.sourceConnectionId,
    sourceQuery: input.sourceQuery.trim(),
    targetConnectionId: input.targetConnectionId,
    targetTable: input.targetTable.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: null,
    lastRunStatus: null,
    lastRunRowCount: null,
    lastRunArtifactId: null,
    lastRunError: null,
  };

  await updateDocument((current) => ({
    ...current,
    pipelines: [pipeline, ...current.pipelines],
  }));

  return pipeline;
}

export async function deletePipelineDefinition(pipelineId: string): Promise<void> {
  await updateDocument((current) => {
    const nextRuns = { ...current.runs };
    delete nextRuns[pipelineId];
    return {
      ...current,
      pipelines: current.pipelines.filter((pipeline) => pipeline.id !== pipelineId),
      runs: nextRuns,
    };
  });
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function quoteTableReference(raw: string): string {
  return raw
    .split(".")
    .filter((part) => part.trim().length > 0)
    .map((part) => quoteIdentifier(part.trim()))
    .join(".");
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inferSqlType(values: unknown[]): string {
  const nonNull = values.filter((value) => value !== null && value !== undefined);
  if (nonNull.length === 0) return "TEXT";

  if (nonNull.every((value) => typeof value === "boolean")) return "BOOLEAN";
  if (nonNull.every((value) => typeof value === "number" && Number.isInteger(value))) return "INTEGER";
  if (nonNull.every((value) => typeof value === "number")) return "DOUBLE PRECISION";
  if (
    nonNull.every(
      (value) =>
        typeof value === "string" &&
        !Number.isNaN(Date.parse(value)),
    )
  ) {
    return "TIMESTAMP";
  }

  return "TEXT";
}

function buildFieldMetadata(rows: Record<string, unknown>[]): { name: string }[] {
  const firstRow = rows[0];
  return firstRow ? Object.keys(firstRow).map((name) => ({ name })) : [];
}

function createQueryResultsFromRows(
  rows: Record<string, unknown>[],
  elapsedMs: number,
  queryId: string,
  sourceTables: string[],
): QueryResults {
  return {
    rows,
    fields: buildFieldMetadata(rows),
    rowCount: rows.length,
    elapsedMs,
    queryId,
    source_tables: sourceTables,
  };
}

async function materializeRowsToTarget(
  pipeline: PipelineDefinition,
  rows: Record<string, unknown>[],
): Promise<void> {
  const tableRef = quoteTableReference(pipeline.targetTable);
  const firstRow = rows[0] ?? null;

  if (!firstRow) {
    await DbClient.execute(pipeline.targetConnectionId, `DELETE FROM ${tableRef};`);
    return;
  }

  const columns = Object.keys(firstRow);
  const columnDefinitions = columns
    .map((column) => {
      const values = rows.map((row) => row[column]);
      return `${quoteIdentifier(column)} ${inferSqlType(values)}`;
    })
    .join(", ");

  await DbClient.execute(
    pipeline.targetConnectionId,
    `CREATE TABLE IF NOT EXISTS ${tableRef} (${columnDefinitions});`,
  );
  await DbClient.execute(pipeline.targetConnectionId, `DELETE FROM ${tableRef};`);

  const columnSql = columns.map((column) => quoteIdentifier(column)).join(", ");
  const chunkSize = 100;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const valuesSql = chunk
      .map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`)
      .join(", ");
    await DbClient.execute(
      pipeline.targetConnectionId,
      `INSERT INTO ${tableRef} (${columnSql}) VALUES ${valuesSql};`,
    );
  }
}

function recordArtifactForPipelineRun(
  pipeline: PipelineDefinition,
  runId: string,
  rows: Record<string, unknown>[],
  elapsedMs: number,
): string | null {
  const results = createQueryResultsFromRows(rows, elapsedMs, runId, []);
  const artifact = createQueryArtifact({
    name: `${pipeline.name} run ${new Date().toLocaleString()}`,
    results,
    sql: pipeline.sourceQuery,
    connectionId: pipeline.sourceConnectionId,
    sourceTabId: null,
  });
  useWorkspaceStore.getState().commitArtifactRevision(artifact);
  return artifact.id;
}

export async function runPipelineDefinition(pipelineId: string): Promise<PipelineRunRecord> {
  const current = getCache();
  const pipeline = current.pipelines.find((entry) => entry.id === pipelineId);
  if (!pipeline) {
    throw new Error("Pipeline not found");
  }

  const run: PipelineRunRecord = {
    id: `pipeline-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pipelineId,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    rowCount: null,
    artifactId: null,
    error: null,
    targetTable: pipeline.targetTable,
    sourceConnectionId: pipeline.sourceConnectionId,
    targetConnectionId: pipeline.targetConnectionId,
  };

  await updateDocument((doc) => ({
    ...doc,
    runs: {
      ...doc.runs,
      [pipelineId]: [run, ...(doc.runs[pipelineId] ?? [])].slice(0, 25),
    },
  }));

  try {
    const startedAt = Date.now();
    const rows = await DbClient.query(pipeline.sourceConnectionId, pipeline.sourceQuery);
    await materializeRowsToTarget(pipeline, rows);
    const elapsedMs = Date.now() - startedAt;
    const artifactId = recordArtifactForPipelineRun(pipeline, run.id, rows, elapsedMs);

    const completedRun: PipelineRunRecord = {
      ...run,
      status: "success",
      finishedAt: Date.now(),
      rowCount: rows.length,
      artifactId,
      error: null,
    };

    await updateDocument((doc) => ({
      ...doc,
      pipelines: doc.pipelines.map((entry) =>
        entry.id === pipelineId
          ? {
              ...entry,
              updatedAt: Date.now(),
              lastRunAt: completedRun.finishedAt,
              lastRunStatus: "success",
              lastRunRowCount: rows.length,
              lastRunArtifactId: artifactId,
              lastRunError: null,
            }
          : entry,
      ),
      runs: {
        ...doc.runs,
        [pipelineId]: (doc.runs[pipelineId] ?? []).map((entry) =>
          entry.id === run.id ? completedRun : entry,
        ),
      },
    }));

    return completedRun;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline run failed";
    const failedRun: PipelineRunRecord = {
      ...run,
      status: "failed",
      finishedAt: Date.now(),
      error: message,
    };

    await updateDocument((doc) => ({
      ...doc,
      pipelines: doc.pipelines.map((entry) =>
        entry.id === pipelineId
          ? {
              ...entry,
              updatedAt: Date.now(),
              lastRunAt: failedRun.finishedAt,
              lastRunStatus: "failed",
              lastRunRowCount: null,
              lastRunArtifactId: null,
              lastRunError: message,
            }
          : entry,
      ),
      runs: {
        ...doc.runs,
        [pipelineId]: (doc.runs[pipelineId] ?? []).map((entry) =>
          entry.id === run.id ? failedRun : entry,
        ),
      },
    }));

    throw error;
  }
}

export function inspectPipelines() {
  const doc = getCache();
  return {
    pipelines: doc.pipelines.map((pipeline) => ({
      ...pipeline,
      runCount: doc.runs[pipeline.id]?.length ?? 0,
      latestRun: doc.runs[pipeline.id]?.[0] ?? null,
    })),
  };
}
