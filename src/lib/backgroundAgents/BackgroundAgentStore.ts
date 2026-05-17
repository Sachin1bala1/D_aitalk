import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

export type BackgroundAgentRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "approval_required"
  | "cancelled";

export type BackgroundAgentRunTrigger = "manual" | "scheduled" | "retry";
export type BackgroundAgentEnvironmentStatus = "idle" | "active" | "paused";

export type BackgroundAgentRunEventType =
  | "queued"
  | "started"
  | "sql_executed"
  | "approval_queued"
  | "report_created"
  | "retrying"
  | "completed"
  | "failed"
  | "takeover_requested"
  | "deferred_by_environment";

export interface BackgroundAgentRunEvent {
  id: string;
  at: number;
  type: BackgroundAgentRunEventType;
  level: "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export type BackgroundAgentApprovalStatus = "pending" | "approved" | "rejected";

export interface BackgroundAgentEnvironment {
  id: string;
  name: string;
  description: string;
  connectionIds: string[];
  concurrencyLimit: number;
  isEnabled: boolean;
  status: BackgroundAgentEnvironmentStatus;
  createdAt: number;
  updatedAt: number;
  lastDispatchAt: number | null;
  lastHeartbeatAt: number | null;
}

export interface BackgroundAgentDefinition {
  id: string;
  name: string;
  prompt: string;
  connectionId: string;
  environmentId: string;
  cadenceMinutes: number | null;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastRunStatus: BackgroundAgentRunStatus | null;
  lastRunArtifactId: string | null;
  lastRunSummary: string | null;
}

export interface BackgroundAgentApprovalItem {
  id: string;
  agentId: string;
  runId: string;
  title: string;
  rationale: string;
  risk: "caution" | "destructive";
  suggestedSql?: string;
  status: BackgroundAgentApprovalStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export interface BackgroundAgentRun {
  id: string;
  agentId: string;
  environmentId: string;
  status: BackgroundAgentRunStatus;
  trigger: BackgroundAgentRunTrigger;
  startedAt: number;
  finishedAt: number | null;
  lastHeartbeatAt: number | null;
  summary: string | null;
  error: string | null;
  reportArtifactId: string | null;
  queryArtifactIds: string[];
  approvalIds: string[];
  attemptCount: number;
  maxAttempts: number;
  retryOfRunId: string | null;
  takeoverRequestedAt: number | null;
  takeoverPrompt: string | null;
  events: BackgroundAgentRunEvent[];
}

interface BackgroundAgentDocument {
  version: 3;
  agents: BackgroundAgentDefinition[];
  environments: BackgroundAgentEnvironment[];
  runs: Record<string, BackgroundAgentRun[]>;
  approvals: BackgroundAgentApprovalItem[];
}

const DOC_KEY = "background_analysis_agents";
const LEGACY_KEY = "daitalk_background_analysis_agents";
export const DEFAULT_BACKGROUND_ENVIRONMENT_ID = "background-env-local-default";

const DEFAULT_DOCUMENT: BackgroundAgentDocument = {
  version: 3,
  agents: [],
  environments: [],
  runs: {},
  approvals: [],
};

let cache: BackgroundAgentDocument | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function createRunEvent(args: {
  at?: number;
  type: BackgroundAgentRunEventType;
  level?: BackgroundAgentRunEvent["level"];
  message: string;
  metadata?: Record<string, unknown>;
}): BackgroundAgentRunEvent {
  return {
    id: `background-agent-run-event-${args.at ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: args.at ?? Date.now(),
    type: args.type,
    level: args.level ?? "info",
    message: args.message,
    metadata: args.metadata ? { ...args.metadata } : undefined,
  };
}

function buildDefaultEnvironment(now = Date.now(), connectionIds: string[] = []): BackgroundAgentEnvironment {
  return {
    id: DEFAULT_BACKGROUND_ENVIRONMENT_ID,
    name: "Local Default",
    description: "Default local detached execution environment.",
    connectionIds: [...new Set(connectionIds)],
    concurrencyLimit: 1,
    isEnabled: true,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    lastDispatchAt: null,
    lastHeartbeatAt: null,
  };
}

function normalizeRunEvent(
  event: Partial<BackgroundAgentRunEvent>,
  fallbackType: BackgroundAgentRunEventType,
): BackgroundAgentRunEvent {
  return {
    id: event.id ?? `background-agent-run-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: event.at ?? Date.now(),
    type: event.type ?? fallbackType,
    level: event.level ?? "info",
    message: event.message ?? "",
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

function normalizeEnvironment(environment: Partial<BackgroundAgentEnvironment>): BackgroundAgentEnvironment {
  const now = Date.now();
  return {
    id: environment.id ?? `background-env-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: environment.name?.trim() || "Execution Environment",
    description: environment.description?.trim() || "",
    connectionIds: [...new Set(environment.connectionIds ?? [])],
    concurrencyLimit:
      typeof environment.concurrencyLimit === "number" && environment.concurrencyLimit > 0
        ? Math.max(1, Math.floor(environment.concurrencyLimit))
        : 1,
    isEnabled: environment.isEnabled ?? true,
    status: environment.status ?? "idle",
    createdAt: environment.createdAt ?? now,
    updatedAt: environment.updatedAt ?? now,
    lastDispatchAt: environment.lastDispatchAt ?? null,
    lastHeartbeatAt: environment.lastHeartbeatAt ?? null,
  };
}

function normalizeRun(run: Partial<BackgroundAgentRun>): BackgroundAgentRun {
  const startedAt = run.startedAt ?? Date.now();
  return {
    id: run.id ?? `background-agent-run-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: run.agentId ?? "",
    environmentId: run.environmentId ?? DEFAULT_BACKGROUND_ENVIRONMENT_ID,
    status: run.status ?? "queued",
    trigger: run.trigger ?? "manual",
    startedAt,
    finishedAt: run.finishedAt ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt ?? null,
    summary: run.summary ?? null,
    error: run.error ?? null,
    reportArtifactId: run.reportArtifactId ?? null,
    queryArtifactIds: run.queryArtifactIds ?? [],
    approvalIds: run.approvalIds ?? [],
    attemptCount: run.attemptCount ?? 0,
    maxAttempts: run.maxAttempts ?? 1,
    retryOfRunId: run.retryOfRunId ?? null,
    takeoverRequestedAt: run.takeoverRequestedAt ?? null,
    takeoverPrompt: run.takeoverPrompt ?? null,
    events: (run.events ?? []).map((event, index) =>
      normalizeRunEvent(event, index === 0 ? "queued" : "started"),
    ),
  };
}

function normalizeDocument(document: Partial<BackgroundAgentDocument>): BackgroundAgentDocument {
  const rawAgents = document.agents ?? [];
  const rawRuns = document.runs ?? {};
  const connectionIds = rawAgents.map((agent) => agent.connectionId).filter((id): id is string => !!id);
  const normalizedEnvironments = (document.environments ?? []).map((environment) =>
    normalizeEnvironment(environment),
  );
  const defaultEnvironment =
    normalizedEnvironments.find((environment) => environment.id === DEFAULT_BACKGROUND_ENVIRONMENT_ID) ??
    buildDefaultEnvironment(Date.now(), connectionIds);
  const environments = [
    defaultEnvironment,
    ...normalizedEnvironments.filter((environment) => environment.id !== DEFAULT_BACKGROUND_ENVIRONMENT_ID),
  ];
  const environmentIds = new Set(environments.map((environment) => environment.id));
  const agents = rawAgents.map((agent) => ({
    ...agent,
    environmentId:
      agent.environmentId && environmentIds.has(agent.environmentId)
        ? agent.environmentId
        : DEFAULT_BACKGROUND_ENVIRONMENT_ID,
  }));
  const agentEnvironmentById = new Map(agents.map((agent) => [agent.id, agent.environmentId]));

  return {
    version: 3,
    agents,
    environments,
    runs: Object.fromEntries(
      Object.entries(rawRuns).map(([agentId, runs]) => [
        agentId,
        (runs ?? []).map((run) =>
          normalizeRun({
            ...run,
            agentId: run.agentId ?? agentId,
            environmentId:
              run.environmentId ??
              agentEnvironmentById.get(run.agentId ?? agentId) ??
              DEFAULT_BACKGROUND_ENVIRONMENT_ID,
          }),
        ),
      ]),
    ),
    approvals: document.approvals ?? [],
  };
}

function cloneDocument(document: BackgroundAgentDocument): BackgroundAgentDocument {
  return {
    version: 3,
    agents: [...document.agents],
    environments: document.environments.map((environment) => ({
      ...environment,
      connectionIds: [...environment.connectionIds],
    })),
    runs: Object.fromEntries(
      Object.entries(document.runs).map(([agentId, runs]) => [
        agentId,
        runs.map((run) => ({
          ...run,
          queryArtifactIds: [...run.queryArtifactIds],
          approvalIds: [...run.approvalIds],
          events: run.events.map((event) => ({
            ...event,
            metadata: event.metadata ? { ...event.metadata } : undefined,
          })),
        })),
      ]),
    ),
    approvals: [...document.approvals],
  };
}

function loadLegacyDocument(): BackgroundAgentDocument {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return cloneDocument(DEFAULT_DOCUMENT);
    const parsed = JSON.parse(raw) as Partial<BackgroundAgentDocument>;
    return normalizeDocument(parsed);
  } catch {
    return cloneDocument(DEFAULT_DOCUMENT);
  }
}

function getCache(): BackgroundAgentDocument {
  if (!cache) {
    cache = normalizeDocument(loadLegacyDocument());
  }
  return cloneDocument(cache);
}

function setCache(document: BackgroundAgentDocument) {
  cache = cloneDocument(document);
  emit();
}

async function persistDocument(document: BackgroundAgentDocument): Promise<void> {
  try {
    await saveJsonDocument(DOC_KEY, document);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    notifyNativePersistenceFallback("Background analysis agents");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(document));
  }
}

async function updateDocument(
  updater: (document: BackgroundAgentDocument) => BackgroundAgentDocument,
): Promise<BackgroundAgentDocument> {
  const next = updater(getCache());
  setCache(next);
  await persistDocument(next);
  return cloneDocument(next);
}

function deriveEnvironmentStatus(
  document: BackgroundAgentDocument,
  environment: BackgroundAgentEnvironment,
  excludingRunId?: string,
): BackgroundAgentEnvironmentStatus {
  if (!environment.isEnabled) return "paused";
  const hasRunning = Object.values(document.runs)
    .flatMap((runs) => runs)
    .some(
      (run) =>
        run.environmentId === environment.id &&
        run.id !== excludingRunId &&
        run.status === "running",
    );
  return hasRunning ? "active" : "idle";
}

export async function ensureBackgroundAgentsLoaded(): Promise<BackgroundAgentDocument> {
  const fallback = loadLegacyDocument();
  const document = await loadJsonDocument<BackgroundAgentDocument>(DOC_KEY, fallback);
  const normalized = normalizeDocument(document);
  setCache(normalized);
  if (document === fallback) {
    await persistDocument(normalized);
  }
  return cloneDocument(normalized);
}

export function subscribeBackgroundAgents(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listBackgroundAgents(): BackgroundAgentDefinition[] {
  return getCache().agents;
}

export function getBackgroundAgent(agentId: string): BackgroundAgentDefinition | null {
  return getCache().agents.find((agent) => agent.id === agentId) ?? null;
}

export function listBackgroundAgentEnvironments(): BackgroundAgentEnvironment[] {
  return getCache().environments;
}

export function getBackgroundAgentEnvironment(environmentId: string): BackgroundAgentEnvironment | null {
  return getCache().environments.find((environment) => environment.id === environmentId) ?? null;
}

export function getBackgroundAgentRuns(agentId: string): BackgroundAgentRun[] {
  return getCache().runs[agentId] ?? [];
}

export function getBackgroundAgentRun(agentId: string, runId: string): BackgroundAgentRun | null {
  return getBackgroundAgentRuns(agentId).find((run) => run.id === runId) ?? null;
}

export function listAllBackgroundAgentRuns(): BackgroundAgentRun[] {
  return Object.values(getCache().runs)
    .flatMap((runs) => runs)
    .sort((left, right) => right.startedAt - left.startedAt);
}

export function listQueuedBackgroundAgentRuns(environmentId?: string): BackgroundAgentRun[] {
  return listAllBackgroundAgentRuns().filter(
    (run) => run.status === "queued" && (!environmentId || run.environmentId === environmentId),
  );
}

export function listBackgroundAgentApprovals(agentId?: string): BackgroundAgentApprovalItem[] {
  const approvals = getCache().approvals;
  return agentId ? approvals.filter((approval) => approval.agentId === agentId) : approvals;
}

export function hasOpenBackgroundAgentRun(agentId: string): boolean {
  return getBackgroundAgentRuns(agentId).some((run) => run.status === "queued" || run.status === "running");
}

export async function createBackgroundAgent(input: {
  name: string;
  prompt: string;
  connectionId: string;
  environmentId?: string | null;
  cadenceMinutes: number | null;
  isEnabled: boolean;
}): Promise<BackgroundAgentDefinition> {
  const now = Date.now();
  const agent: BackgroundAgentDefinition = {
    id: `background-agent-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    connectionId: input.connectionId,
    environmentId: input.environmentId?.trim() || DEFAULT_BACKGROUND_ENVIRONMENT_ID,
    cadenceMinutes: input.cadenceMinutes && input.cadenceMinutes > 0 ? input.cadenceMinutes : null,
    isEnabled: input.isEnabled,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunArtifactId: null,
    lastRunSummary: null,
  };

  await updateDocument((document) => ({
    ...document,
    agents: [agent, ...document.agents],
    environments: document.environments.map((environment) =>
      environment.id === agent.environmentId && !environment.connectionIds.includes(agent.connectionId)
        ? {
            ...environment,
            connectionIds: [...environment.connectionIds, agent.connectionId],
            updatedAt: now,
          }
        : environment,
    ),
  }));

  return agent;
}

export async function updateBackgroundAgent(
  agentId: string,
  changes: Partial<
    Pick<
      BackgroundAgentDefinition,
      "name" | "prompt" | "connectionId" | "environmentId" | "cadenceMinutes" | "isEnabled"
    >
  >,
): Promise<void> {
  await updateDocument((document) => ({
    ...document,
    agents: document.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            ...changes,
            environmentId: changes.environmentId?.trim() || agent.environmentId,
            cadenceMinutes:
              changes.cadenceMinutes !== undefined
                ? changes.cadenceMinutes && changes.cadenceMinutes > 0
                  ? changes.cadenceMinutes
                  : null
                : agent.cadenceMinutes,
            updatedAt: Date.now(),
          }
        : agent,
    ),
  }));
}

export async function deleteBackgroundAgent(agentId: string): Promise<void> {
  await updateDocument((document) => {
    const runs = { ...document.runs };
    delete runs[agentId];
    return {
      ...document,
      agents: document.agents.filter((agent) => agent.id !== agentId),
      runs,
      approvals: document.approvals.filter((approval) => approval.agentId !== agentId),
    };
  });
}

export async function createBackgroundAgentEnvironment(input: {
  name: string;
  description?: string;
  connectionIds: string[];
  concurrencyLimit?: number;
  isEnabled?: boolean;
}): Promise<BackgroundAgentEnvironment> {
  const now = Date.now();
  const environment = normalizeEnvironment({
    id: `background-env-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description ?? "",
    connectionIds: input.connectionIds,
    concurrencyLimit: input.concurrencyLimit ?? 1,
    isEnabled: input.isEnabled ?? true,
    status: input.isEnabled === false ? "paused" : "idle",
    createdAt: now,
    updatedAt: now,
  });

  await updateDocument((document) => ({
    ...document,
    environments: [environment, ...document.environments],
  }));

  return environment;
}

export async function updateBackgroundAgentEnvironment(
  environmentId: string,
  changes: Partial<
    Pick<
      BackgroundAgentEnvironment,
      "name" | "description" | "connectionIds" | "concurrencyLimit" | "isEnabled" | "status"
    >
  >,
): Promise<void> {
  await updateDocument((document) => ({
    ...document,
    environments: document.environments.map((environment) => {
      if (environment.id !== environmentId) return environment;
      const isDisabled = typeof changes.isEnabled === "boolean" && changes.isEnabled === false;
      return normalizeEnvironment({
        ...environment,
        ...changes,
        updatedAt: Date.now(),
        status: isDisabled
          ? "paused"
          : changes.status ?? (environment.status === "paused" && !isDisabled ? "idle" : environment.status),
      });
    }),
  }));
}

export async function deleteBackgroundAgentEnvironment(environmentId: string): Promise<void> {
  if (environmentId === DEFAULT_BACKGROUND_ENVIRONMENT_ID) {
    throw new Error("The default environment cannot be deleted.");
  }

  await updateDocument((document) => {
    if (document.agents.some((agent) => agent.environmentId === environmentId)) {
      throw new Error("Reassign agents before deleting this environment.");
    }
    return {
      ...document,
      environments: document.environments.filter((environment) => environment.id !== environmentId),
    };
  });
}

export async function recordBackgroundAgentRunStart(
  agentId: string,
  options?: {
    trigger?: BackgroundAgentRunTrigger;
    maxAttempts?: number;
    retryOfRunId?: string | null;
    environmentId?: string | null;
  },
): Promise<BackgroundAgentRun> {
  return recordBackgroundAgentRunQueued(agentId, options);
}

export async function recordBackgroundAgentRunQueued(
  agentId: string,
  options?: {
    trigger?: BackgroundAgentRunTrigger;
    maxAttempts?: number;
    retryOfRunId?: string | null;
    environmentId?: string | null;
  },
): Promise<BackgroundAgentRun> {
  const now = Date.now();
  const environmentId =
    options?.environmentId?.trim() ||
    getBackgroundAgent(agentId)?.environmentId ||
    DEFAULT_BACKGROUND_ENVIRONMENT_ID;

  const run: BackgroundAgentRun = {
    id: `background-agent-run-${now}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    environmentId,
    status: "queued",
    trigger: options?.trigger ?? "manual",
    startedAt: now,
    finishedAt: null,
    lastHeartbeatAt: null,
    summary: null,
    error: null,
    reportArtifactId: null,
    queryArtifactIds: [],
    approvalIds: [],
    attemptCount: 0,
    maxAttempts: options?.maxAttempts ?? 1,
    retryOfRunId: options?.retryOfRunId ?? null,
    takeoverRequestedAt: null,
    takeoverPrompt: null,
    events: [
      createRunEvent({
        at: now,
        type: "queued",
        level: "info",
        message: `Run queued via ${options?.trigger ?? "manual"} trigger.`,
        metadata: {
          trigger: options?.trigger ?? "manual",
          maxAttempts: options?.maxAttempts ?? 1,
          environmentId,
        },
      }),
    ],
  };

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [agentId]: [run, ...(document.runs[agentId] ?? [])].slice(0, 50),
    },
    environments: document.environments.map((environment) =>
      environment.id === environmentId
        ? {
            ...environment,
            updatedAt: now,
            lastHeartbeatAt: now,
            connectionIds: environment.connectionIds.includes(getBackgroundAgent(agentId)?.connectionId ?? "")
              ? environment.connectionIds
              : [...environment.connectionIds, getBackgroundAgent(agentId)?.connectionId ?? ""].filter(Boolean),
          }
        : environment,
    ),
    agents: document.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            updatedAt: now,
            lastRunAt: run.startedAt,
            lastRunStatus: "queued",
          }
        : agent,
    ),
  }));

  return run;
}

export async function markBackgroundAgentRunRunning(args: {
  agentId: string;
  runId: string;
  attemptCount: number;
  environmentId?: string | null;
}): Promise<void> {
  const now = Date.now();
  const environmentId =
    args.environmentId ??
    getBackgroundAgentRun(args.agentId, args.runId)?.environmentId ??
    DEFAULT_BACKGROUND_ENVIRONMENT_ID;

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [args.agentId]: (document.runs[args.agentId] ?? []).map((run) =>
        run.id === args.runId
          ? {
              ...run,
              status: "running",
              attemptCount: args.attemptCount,
              lastHeartbeatAt: now,
              events: [
                ...run.events,
                createRunEvent({
                  at: now,
                  type: "started",
                  level: "info",
                  message:
                    args.attemptCount > 1
                      ? `Retry attempt ${args.attemptCount} started.`
                      : "Detached analysis started.",
                  metadata: {
                    attemptCount: args.attemptCount,
                    environmentId,
                  },
                }),
              ].slice(-100),
            }
          : run,
      ),
    },
    environments: document.environments.map((environment) =>
      environment.id === environmentId
        ? {
            ...environment,
            status: environment.isEnabled ? "active" : "paused",
            updatedAt: now,
            lastDispatchAt: now,
            lastHeartbeatAt: now,
          }
        : environment,
    ),
    agents: document.agents.map((agent) =>
      agent.id === args.agentId
        ? {
            ...agent,
            updatedAt: now,
            lastRunAt: now,
            lastRunStatus: "running",
          }
        : agent,
    ),
  }));
}

export async function appendBackgroundAgentRunEvent(args: {
  agentId: string;
  runId: string;
  type: BackgroundAgentRunEventType;
  level?: BackgroundAgentRunEvent["level"];
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = Date.now();
  const environmentId =
    getBackgroundAgentRun(args.agentId, args.runId)?.environmentId ??
    DEFAULT_BACKGROUND_ENVIRONMENT_ID;

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [args.agentId]: (document.runs[args.agentId] ?? []).map((run) =>
        run.id === args.runId
          ? {
              ...run,
              lastHeartbeatAt: now,
              events: [
                ...run.events,
                createRunEvent({
                  at: now,
                  type: args.type,
                  level: args.level ?? "info",
                  message: args.message,
                  metadata: args.metadata,
                }),
              ].slice(-100),
            }
          : run,
      ),
    },
    environments: document.environments.map((environment) =>
      environment.id === environmentId
        ? {
            ...environment,
            updatedAt: now,
            lastHeartbeatAt: now,
          }
        : environment,
    ),
  }));
}

export async function requestBackgroundAgentRunTakeover(args: {
  agentId: string;
  runId: string;
  prompt: string;
}): Promise<void> {
  const now = Date.now();
  const environmentId =
    getBackgroundAgentRun(args.agentId, args.runId)?.environmentId ??
    DEFAULT_BACKGROUND_ENVIRONMENT_ID;

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [args.agentId]: (document.runs[args.agentId] ?? []).map((run) =>
        run.id === args.runId
          ? {
              ...run,
              takeoverRequestedAt: now,
              takeoverPrompt: args.prompt,
              events: [
                ...run.events,
                createRunEvent({
                  at: now,
                  type: "takeover_requested",
                  level: "info",
                  message: "Operator requested AI takeover.",
                }),
              ].slice(-100),
            }
          : run,
      ),
    },
    environments: document.environments.map((environment) =>
      environment.id === environmentId
        ? {
            ...environment,
            updatedAt: now,
            lastHeartbeatAt: now,
          }
        : environment,
    ),
  }));
}

export async function finishBackgroundAgentRun(args: {
  runId: string;
  agentId: string;
  status: BackgroundAgentRunStatus;
  summary?: string | null;
  error?: string | null;
  reportArtifactId?: string | null;
  queryArtifactIds?: string[];
  approvalIds?: string[];
}): Promise<void> {
  const now = Date.now();
  const environmentId =
    getBackgroundAgentRun(args.agentId, args.runId)?.environmentId ??
    DEFAULT_BACKGROUND_ENVIRONMENT_ID;

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [args.agentId]: (document.runs[args.agentId] ?? []).map((run) =>
        run.id === args.runId
          ? {
              ...run,
              status: args.status,
              finishedAt: now,
              lastHeartbeatAt: now,
              summary: args.summary ?? run.summary,
              error: args.error ?? run.error,
              reportArtifactId: args.reportArtifactId ?? run.reportArtifactId,
              queryArtifactIds: args.queryArtifactIds ?? run.queryArtifactIds,
              approvalIds: args.approvalIds ?? run.approvalIds,
              events: [
                ...run.events,
                createRunEvent({
                  at: now,
                  type: args.status === "failed" ? "failed" : "completed",
                  level:
                    args.status === "failed"
                      ? "error"
                      : args.status === "approval_required"
                        ? "warning"
                        : "info",
                  message:
                    args.status === "failed"
                      ? args.error ?? "Background run failed."
                      : args.status === "approval_required"
                        ? "Detached analysis completed and queued review items."
                        : "Detached analysis completed successfully.",
                }),
              ].slice(-100),
            }
          : run,
      ),
    },
    environments: document.environments.map((environment) =>
      environment.id === environmentId
        ? {
            ...environment,
            status: deriveEnvironmentStatus(document, environment, args.runId),
            updatedAt: now,
            lastHeartbeatAt: now,
          }
        : environment,
    ),
    agents: document.agents.map((agent) =>
      agent.id === args.agentId
        ? {
            ...agent,
            updatedAt: now,
            lastRunAt: now,
            lastRunStatus: args.status,
            lastRunArtifactId: args.reportArtifactId ?? null,
            lastRunSummary: args.summary ?? args.error ?? null,
          }
        : agent,
    ),
  }));
}

export async function addBackgroundAgentApprovalItems(
  approvals: Array<Omit<BackgroundAgentApprovalItem, "id" | "createdAt" | "resolvedAt" | "status">>,
): Promise<BackgroundAgentApprovalItem[]> {
  const created = approvals.map((approval) => ({
    ...approval,
    id: `background-agent-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending" as const,
    createdAt: Date.now(),
    resolvedAt: null,
  }));

  await updateDocument((document) => ({
    ...document,
    approvals: [...created, ...document.approvals].slice(0, 200),
  }));

  return created;
}

export async function resolveBackgroundAgentApproval(
  approvalId: string,
  status: Exclude<BackgroundAgentApprovalStatus, "pending">,
): Promise<void> {
  await updateDocument((document) => ({
    ...document,
    approvals: document.approvals.map((approval) =>
      approval.id === approvalId
        ? {
            ...approval,
            status,
            resolvedAt: Date.now(),
          }
        : approval,
    ),
  }));
}

export function shouldRunBackgroundAgentNow(
  agent: BackgroundAgentDefinition,
  now = Date.now(),
): boolean {
  if (!agent.isEnabled || !agent.cadenceMinutes || agent.cadenceMinutes <= 0) return false;
  if (!agent.lastRunAt) return true;
  return now - agent.lastRunAt >= agent.cadenceMinutes * 60_000;
}

export function __resetBackgroundAgentStoreForTests(): void {
  cache = null;
  listeners.clear();
  localStorage.removeItem(LEGACY_KEY);
}
