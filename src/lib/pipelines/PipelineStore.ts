import { DbClient } from "../db/DbClient";
import { createQueryArtifact } from "../artifacts/queryArtifacts";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { QueryResults } from "../stores/WorkspaceStore";
import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

export type PipelineRunStatus = "queued" | "running" | "success" | "failed";
export type PipelineRunTrigger = "manual" | "scheduled" | "retry";

export type PipelineStep =
  | {
      id: string;
      type: "query";
      name: string;
      connectionId: string;
      sql: string;
    }
  | {
      id: string;
      type: "assert_row_count";
      name: string;
      sourceStepId: string;
      minRows?: number | null;
      maxRows?: number | null;
      failOnEmpty?: boolean;
    }
  | {
      id: string;
      type: "materialize";
      name: string;
      sourceStepId: string;
      targetConnectionId: string;
      targetTable: string;
      writeMode: "replace";
    };

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
  cadenceMinutes: number | null;
  isEnabled: boolean;
  steps: PipelineStep[];
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number | null;
  lastRunStatus?: PipelineRunStatus | null;
  lastRunRowCount?: number | null;
  lastRunArtifactId?: string | null;
  lastRunError?: string | null;
}

export interface PipelineStepRunRecord {
  stepId: string;
  stepType: PipelineStep["type"];
  name: string;
  status: "running" | "success" | "failed" | "skipped";
  startedAt: number;
  finishedAt?: number | null;
  rowCount?: number | null;
  artifactId?: string | null;
  message?: string | null;
  error?: string | null;
}

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  trigger: PipelineRunTrigger;
  startedAt: number;
  finishedAt?: number | null;
  rowCount?: number | null;
  artifactId?: string | null;
  error?: string | null;
  summary?: string | null;
  targetTable: string;
  sourceConnectionId: string;
  targetConnectionId: string;
  stepRuns: PipelineStepRunRecord[];
}

interface PipelineDocument {
  version: 2;
  pipelines: PipelineDefinition[];
  runs: Record<string, PipelineRunRecord[]>;
}

const DOC_KEY = "pipelines";
const LEGACY_KEY = "daitalk_pipelines";

const DEFAULT_DOCUMENT: PipelineDocument = {
  version: 2,
  pipelines: [],
  runs: {},
};

let pipelineCache: PipelineDocument | null = null;
const listeners = new Set<() => void>();
const inFlightPipelines = new Set<string>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function createStepId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultSteps(input: {
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
}): PipelineStep[] {
  const queryStepId = createStepId("pipeline-step-query");
  return [
    {
      id: queryStepId,
      type: "query",
      name: "Query source dataset",
      connectionId: input.sourceConnectionId,
      sql: input.sourceQuery.trim(),
    },
    {
      id: createStepId("pipeline-step-materialize"),
      type: "materialize",
      name: "Materialize target table",
      sourceStepId: queryStepId,
      targetConnectionId: input.targetConnectionId,
      targetTable: input.targetTable.trim(),
      writeMode: "replace",
    },
  ];
}

function normalizeStep(step: PipelineStep): PipelineStep {
  if (step.type === "query") {
    return {
      ...step,
      id: step.id || createStepId("pipeline-step-query"),
      name: step.name?.trim() || "Query source dataset",
      sql: step.sql.trim(),
    };
  }

  if (step.type === "assert_row_count") {
    return {
      ...step,
      id: step.id || createStepId("pipeline-step-assert"),
      name: step.name?.trim() || "Validate row count",
      minRows: step.minRows ?? null,
      maxRows: step.maxRows ?? null,
      failOnEmpty: step.failOnEmpty ?? true,
    };
  }

  return {
    ...step,
    id: step.id || createStepId("pipeline-step-materialize"),
    name: step.name?.trim() || "Materialize target table",
    targetTable: step.targetTable.trim(),
    writeMode: "replace",
  };
}

function normalizePipeline(def: Partial<PipelineDefinition>): PipelineDefinition {
  const now = Date.now();
  const sourceConnectionId = def.sourceConnectionId ?? "";
  const sourceQuery = def.sourceQuery?.trim() ?? "";
  const targetConnectionId = def.targetConnectionId ?? "";
  const targetTable = def.targetTable?.trim() ?? "";
  const steps =
    def.steps && def.steps.length > 0
      ? def.steps.map((step) => normalizeStep(step))
      : createDefaultSteps({
          sourceConnectionId,
          sourceQuery,
          targetConnectionId,
          targetTable,
        });

  return {
    id: def.id ?? `pipeline-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: def.name?.trim() || "Pipeline",
    description: def.description?.trim() || "",
    sourceConnectionId,
    sourceQuery,
    targetConnectionId,
    targetTable,
    cadenceMinutes:
      typeof def.cadenceMinutes === "number" && def.cadenceMinutes > 0
        ? def.cadenceMinutes
        : null,
    isEnabled: def.isEnabled ?? false,
    steps,
    createdAt: def.createdAt ?? now,
    updatedAt: def.updatedAt ?? now,
    lastRunAt: def.lastRunAt ?? null,
    lastRunStatus: def.lastRunStatus ?? null,
    lastRunRowCount: def.lastRunRowCount ?? null,
    lastRunArtifactId: def.lastRunArtifactId ?? null,
    lastRunError: def.lastRunError ?? null,
  };
}

function normalizeRun(run: Partial<PipelineRunRecord>, pipeline: PipelineDefinition): PipelineRunRecord {
  return {
    id: run.id ?? `pipeline-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pipelineId: run.pipelineId ?? pipeline.id,
    status: run.status ?? "queued",
    trigger: run.trigger ?? "manual",
    startedAt: run.startedAt ?? Date.now(),
    finishedAt: run.finishedAt ?? null,
    rowCount: run.rowCount ?? null,
    artifactId: run.artifactId ?? null,
    error: run.error ?? null,
    summary: run.summary ?? null,
    targetTable: run.targetTable ?? pipeline.targetTable,
    sourceConnectionId: run.sourceConnectionId ?? pipeline.sourceConnectionId,
    targetConnectionId: run.targetConnectionId ?? pipeline.targetConnectionId,
    stepRuns: (run.stepRuns ?? []).map((stepRun) => ({
      ...stepRun,
      finishedAt: stepRun.finishedAt ?? null,
      rowCount: stepRun.rowCount ?? null,
      artifactId: stepRun.artifactId ?? null,
      message: stepRun.message ?? null,
      error: stepRun.error ?? null,
    })),
  };
}

function cloneDocument(doc: PipelineDocument): PipelineDocument {
  return {
    version: 2,
    pipelines: doc.pipelines.map((pipeline) => ({
      ...pipeline,
      steps: pipeline.steps.map((step) => ({ ...step })),
    })),
    runs: Object.fromEntries(
      Object.entries(doc.runs).map(([pipelineId, runs]) => [
        pipelineId,
        runs.map((run) => ({
          ...run,
          stepRuns: run.stepRuns.map((stepRun) => ({ ...stepRun })),
        })),
      ]),
    ),
  };
}

function loadLegacyDocument(): PipelineDocument {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PipelineDocument>;
      return normalizeDocument(parsed);
    }
  } catch {}
  return cloneDocument(DEFAULT_DOCUMENT);
}

function normalizeDocument(doc: Partial<PipelineDocument>): PipelineDocument {
  const pipelines = (doc.pipelines ?? []).map((pipeline) => normalizePipeline(pipeline));
  const pipelineMap = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline]));
  return {
    version: 2,
    pipelines,
    runs: Object.fromEntries(
      Object.entries(doc.runs ?? {}).map(([pipelineId, runs]) => [
        pipelineId,
        (runs ?? []).map((run) => normalizeRun(run, pipelineMap.get(run.pipelineId ?? pipelineId) ?? normalizePipeline({
          id: pipelineId,
          name: "Recovered pipeline",
          sourceConnectionId: "",
          sourceQuery: "",
          targetConnectionId: "",
          targetTable: "",
          steps: [],
        }))),
      ]),
    ),
  };
}

function setCache(doc: PipelineDocument) {
  pipelineCache = cloneDocument(doc);
  notifyListeners();
}

function getCache(): PipelineDocument {
  if (!pipelineCache) {
    pipelineCache = normalizeDocument(loadLegacyDocument());
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
  const normalized = normalizeDocument(doc);
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

export function getPipelineDefinition(pipelineId: string): PipelineDefinition | null {
  return getCache().pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null;
}

export function getPipelineRuns(pipelineId: string): PipelineRunRecord[] {
  return getCache().runs[pipelineId] ?? [];
}

export function hasOpenPipelineRun(pipelineId: string): boolean {
  return getPipelineRuns(pipelineId).some((run) => run.status === "queued" || run.status === "running");
}

export async function createPipelineDefinition(input: {
  name: string;
  sourceConnectionId: string;
  sourceQuery: string;
  targetConnectionId: string;
  targetTable: string;
  description?: string;
  cadenceMinutes?: number | null;
  isEnabled?: boolean;
  steps?: PipelineStep[];
}): Promise<PipelineDefinition> {
  const pipeline = normalizePipeline({
    name: input.name,
    description: input.description ?? "",
    sourceConnectionId: input.sourceConnectionId,
    sourceQuery: input.sourceQuery,
    targetConnectionId: input.targetConnectionId,
    targetTable: input.targetTable,
    cadenceMinutes: input.cadenceMinutes ?? null,
    isEnabled: input.isEnabled ?? false,
    steps: input.steps,
  });

  await updateDocument((current) => ({
    ...current,
    pipelines: [pipeline, ...current.pipelines],
  }));

  return pipeline;
}

export async function updatePipelineDefinition(
  pipelineId: string,
  changes: Partial<
    Pick<
      PipelineDefinition,
      "name" | "description" | "cadenceMinutes" | "isEnabled" | "sourceConnectionId" | "sourceQuery" | "targetConnectionId" | "targetTable" | "steps"
    >
  >,
): Promise<void> {
  await updateDocument((current) => ({
    ...current,
    pipelines: current.pipelines.map((pipeline) =>
      pipeline.id === pipelineId
        ? normalizePipeline({
            ...pipeline,
            ...changes,
            updatedAt: Date.now(),
          })
        : pipeline,
    ),
  }));
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
      (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
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
  targetConnectionId: string,
  targetTable: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const tableRef = quoteTableReference(targetTable);
  const firstRow = rows[0] ?? null;

  if (!firstRow) {
    await DbClient.execute(targetConnectionId, `DELETE FROM ${tableRef};`);
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
    targetConnectionId,
    `CREATE TABLE IF NOT EXISTS ${tableRef} (${columnDefinitions});`,
  );
  await DbClient.execute(targetConnectionId, `DELETE FROM ${tableRef};`);

  const columnSql = columns.map((column) => quoteIdentifier(column)).join(", ");
  const chunkSize = 100;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const valuesSql = chunk
      .map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`)
      .join(", ");
    await DbClient.execute(
      targetConnectionId,
      `INSERT INTO ${tableRef} (${columnSql}) VALUES ${valuesSql};`,
    );
  }
}

function recordArtifactForPipelineQuery(
  pipeline: PipelineDefinition,
  stepId: string,
  rows: Record<string, unknown>[],
  elapsedMs: number,
  sql: string,
): string | null {
  const results = createQueryResultsFromRows(rows, elapsedMs, `${pipeline.id}:${stepId}`, []);
  const artifact = createQueryArtifact({
    name: `${pipeline.name} ${stepId} ${new Date().toLocaleString()}`,
    results,
    sql,
    connectionId: pipeline.sourceConnectionId,
    sourceTabId: null,
  });
  useWorkspaceStore.getState().commitArtifactRevision(artifact);
  return artifact.id;
}

function buildStepRun(step: PipelineStep): PipelineStepRunRecord {
  return {
    stepId: step.id,
    stepType: step.type,
    name: step.name,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    rowCount: null,
    artifactId: null,
    message: null,
    error: null,
  };
}

type StepDatasetState = {
  rows: Record<string, unknown>[];
  artifactId: string | null;
};

async function setPipelineRunState(
  pipelineId: string,
  runId: string,
  updater: (run: PipelineRunRecord) => PipelineRunRecord,
): Promise<void> {
  await updateDocument((doc) => ({
    ...doc,
    runs: {
      ...doc.runs,
      [pipelineId]: (doc.runs[pipelineId] ?? []).map((run) => (run.id === runId ? updater(run) : run)),
    },
  }));
}

function summarizePipelineRun(run: PipelineRunRecord): string {
  const successfulSteps = run.stepRuns.filter((step) => step.status === "success").length;
  if (run.status === "success") {
    return `${successfulSteps} step${successfulSteps === 1 ? "" : "s"} succeeded; ${run.rowCount ?? 0} row${run.rowCount === 1 ? "" : "s"} materialized.`;
  }
  if (run.status === "failed") {
    return run.error ?? "Pipeline run failed.";
  }
  return "Pipeline queued.";
}

export async function runPipelineDefinition(
  pipelineId: string,
  options?: { trigger?: PipelineRunTrigger },
): Promise<PipelineRunRecord> {
  const pipeline = getPipelineDefinition(pipelineId);
  if (!pipeline) {
    throw new Error("Pipeline not found");
  }
  if (hasOpenPipelineRun(pipelineId)) {
    const existing = getPipelineRuns(pipelineId).find((run) => run.status === "queued" || run.status === "running");
    if (existing) return existing;
  }

  const run: PipelineRunRecord = {
    id: `pipeline-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pipelineId,
    status: "queued",
    trigger: options?.trigger ?? "manual",
    startedAt: Date.now(),
    finishedAt: null,
    rowCount: null,
    artifactId: null,
    error: null,
    summary: "Pipeline queued.",
    targetTable: pipeline.targetTable,
    sourceConnectionId: pipeline.sourceConnectionId,
    targetConnectionId: pipeline.targetConnectionId,
    stepRuns: [],
  };

  await updateDocument((doc) => ({
    ...doc,
    runs: {
      ...doc.runs,
      [pipelineId]: [run, ...(doc.runs[pipelineId] ?? [])].slice(0, 25),
    },
    pipelines: doc.pipelines.map((entry) =>
      entry.id === pipelineId
        ? {
            ...entry,
            updatedAt: Date.now(),
            lastRunAt: run.startedAt,
            lastRunStatus: "queued",
            lastRunError: null,
          }
        : entry,
    ),
  }));

  if (inFlightPipelines.has(pipelineId)) {
    return getPipelineRuns(pipelineId)[0] ?? run;
  }

  inFlightPipelines.add(pipelineId);
  try {
    await setPipelineRunState(pipelineId, run.id, (current) => ({
      ...current,
      status: "running",
      summary: "Pipeline running.",
    }));

    const datasets = new Map<string, StepDatasetState>();
    let finalArtifactId: string | null = null;
    let finalRowCount: number | null = null;

    for (const step of pipeline.steps) {
      const stepRun = buildStepRun(step);
      await setPipelineRunState(pipelineId, run.id, (current) => ({
        ...current,
        stepRuns: [...current.stepRuns, stepRun],
      }));

      try {
        if (step.type === "query") {
          const startedAt = Date.now();
          const rows = await DbClient.query(step.connectionId, step.sql);
          const elapsedMs = Date.now() - startedAt;
          const artifactId = recordArtifactForPipelineQuery(pipeline, step.id, rows, elapsedMs, step.sql);
          datasets.set(step.id, { rows, artifactId });
          finalArtifactId = artifactId;
          finalRowCount = rows.length;
          await setPipelineRunState(pipelineId, run.id, (current) => ({
            ...current,
            stepRuns: current.stepRuns.map((entry) =>
              entry.stepId === step.id
                ? {
                    ...entry,
                    status: "success",
                    finishedAt: Date.now(),
                    rowCount: rows.length,
                    artifactId,
                    message: `${rows.length} row${rows.length === 1 ? "" : "s"} queried.`,
                  }
                : entry,
            ),
          }));
          continue;
        }

        if (step.type === "assert_row_count") {
          const dataset = datasets.get(step.sourceStepId);
          const rows = dataset?.rows ?? [];
          const rowCount = rows.length;
          const failure =
            (step.failOnEmpty && rowCount === 0) ||
            (typeof step.minRows === "number" && rowCount < step.minRows) ||
            (typeof step.maxRows === "number" && rowCount > step.maxRows);

          if (failure) {
            const error =
              step.failOnEmpty && rowCount === 0
                ? "Assertion failed: query returned no rows."
                : typeof step.minRows === "number" && rowCount < step.minRows
                  ? `Assertion failed: expected at least ${step.minRows} row(s), got ${rowCount}.`
                  : `Assertion failed: expected at most ${step.maxRows} row(s), got ${rowCount}.`;
            await setPipelineRunState(pipelineId, run.id, (current) => ({
              ...current,
              stepRuns: current.stepRuns.map((entry) =>
                entry.stepId === step.id
                  ? {
                      ...entry,
                      status: "failed",
                      finishedAt: Date.now(),
                      rowCount,
                      error,
                    }
                  : entry,
              ),
            }));
            throw new Error(error);
          }

          await setPipelineRunState(pipelineId, run.id, (current) => ({
            ...current,
            stepRuns: current.stepRuns.map((entry) =>
              entry.stepId === step.id
                ? {
                    ...entry,
                    status: "success",
                    finishedAt: Date.now(),
                    rowCount,
                    message: `Assertion passed at ${rowCount} row(s).`,
                  }
                : entry,
            ),
          }));
          continue;
        }

        if (step.type === "materialize") {
          const dataset = datasets.get(step.sourceStepId);
          if (!dataset) {
            throw new Error(`Materialize step "${step.name}" is missing source step output.`);
          }
          await materializeRowsToTarget(step.targetConnectionId, step.targetTable, dataset.rows);
          finalArtifactId = dataset.artifactId;
          finalRowCount = dataset.rows.length;
          await setPipelineRunState(pipelineId, run.id, (current) => ({
            ...current,
            stepRuns: current.stepRuns.map((entry) =>
              entry.stepId === step.id
                ? {
                    ...entry,
                    status: "success",
                    finishedAt: Date.now(),
                    rowCount: dataset.rows.length,
                    artifactId: dataset.artifactId,
                    message: `${dataset.rows.length} row${dataset.rows.length === 1 ? "" : "s"} materialized to ${step.targetTable}.`,
                  }
                : entry,
            ),
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Pipeline step failed";
        await setPipelineRunState(pipelineId, run.id, (current) => ({
          ...current,
          stepRuns: current.stepRuns.map((entry) =>
            entry.stepId === step.id && entry.status === "running"
              ? {
                  ...entry,
                  status: "failed",
                  finishedAt: Date.now(),
                  error: message,
                }
              : entry,
          ),
        }));
        throw error;
      }
    }

    const completedRun = {
      ...(getPipelineRuns(pipelineId).find((entry) => entry.id === run.id) ?? run),
      status: "success" as const,
      finishedAt: Date.now(),
      rowCount: finalRowCount,
      artifactId: finalArtifactId,
      error: null,
    };
    completedRun.summary = summarizePipelineRun(completedRun);

    await updateDocument((doc) => ({
      ...doc,
      pipelines: doc.pipelines.map((entry) =>
        entry.id === pipelineId
          ? {
              ...entry,
              updatedAt: Date.now(),
              lastRunAt: completedRun.finishedAt,
              lastRunStatus: "success",
              lastRunRowCount: finalRowCount,
              lastRunArtifactId: finalArtifactId,
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
    const currentRun = getPipelineRuns(pipelineId).find((entry) => entry.id === run.id) ?? run;
    const failedRun: PipelineRunRecord = {
      ...currentRun,
      status: "failed",
      finishedAt: Date.now(),
      error: message,
      summary: message,
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
  } finally {
    inFlightPipelines.delete(pipelineId);
  }
}

export async function runDuePipelineDefinitions(now = Date.now()): Promise<void> {
  await ensurePipelinesLoaded();
  const due = listPipelines().filter((pipeline) => {
    if (!pipeline.isEnabled || !pipeline.cadenceMinutes || pipeline.cadenceMinutes <= 0) return false;
    if (hasOpenPipelineRun(pipeline.id)) return false;
    if (!pipeline.lastRunAt) return true;
    return now - pipeline.lastRunAt >= pipeline.cadenceMinutes * 60_000;
  });

  for (const pipeline of due) {
    void runPipelineDefinition(pipeline.id, { trigger: "scheduled" });
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
