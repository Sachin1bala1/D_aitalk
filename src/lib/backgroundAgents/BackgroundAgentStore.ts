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
  | "approval_required";

export type BackgroundAgentApprovalStatus = "pending" | "approved" | "rejected";

export interface BackgroundAgentDefinition {
  id: string;
  name: string;
  prompt: string;
  connectionId: string;
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
  status: BackgroundAgentRunStatus;
  startedAt: number;
  finishedAt: number | null;
  summary: string | null;
  error: string | null;
  reportArtifactId: string | null;
  queryArtifactIds: string[];
  approvalIds: string[];
}

interface BackgroundAgentDocument {
  version: 1;
  agents: BackgroundAgentDefinition[];
  runs: Record<string, BackgroundAgentRun[]>;
  approvals: BackgroundAgentApprovalItem[];
}

const DOC_KEY = "background_analysis_agents";
const LEGACY_KEY = "daitalk_background_analysis_agents";

const DEFAULT_DOCUMENT: BackgroundAgentDocument = {
  version: 1,
  agents: [],
  runs: {},
  approvals: [],
};

let cache: BackgroundAgentDocument | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function cloneDocument(document: BackgroundAgentDocument): BackgroundAgentDocument {
  return {
    version: 1,
    agents: [...document.agents],
    runs: Object.fromEntries(
      Object.entries(document.runs).map(([agentId, runs]) => [agentId, [...runs]]),
    ),
    approvals: [...document.approvals],
  };
}

function loadLegacyDocument(): BackgroundAgentDocument {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return cloneDocument(DEFAULT_DOCUMENT);
    const parsed = JSON.parse(raw) as Partial<BackgroundAgentDocument>;
    return {
      version: 1,
      agents: parsed.agents ?? [],
      runs: parsed.runs ?? {},
      approvals: parsed.approvals ?? [],
    };
  } catch {
    return cloneDocument(DEFAULT_DOCUMENT);
  }
}

function getCache(): BackgroundAgentDocument {
  if (!cache) {
    cache = loadLegacyDocument();
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

export async function ensureBackgroundAgentsLoaded(): Promise<BackgroundAgentDocument> {
  const fallback = loadLegacyDocument();
  const document = await loadJsonDocument<BackgroundAgentDocument>(DOC_KEY, fallback);
  const normalized: BackgroundAgentDocument = {
    version: 1,
    agents: document.agents ?? [],
    runs: document.runs ?? {},
    approvals: document.approvals ?? [],
  };
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

export function getBackgroundAgentRuns(agentId: string): BackgroundAgentRun[] {
  return getCache().runs[agentId] ?? [];
}

export function listBackgroundAgentApprovals(agentId?: string): BackgroundAgentApprovalItem[] {
  const approvals = getCache().approvals;
  return agentId ? approvals.filter((approval) => approval.agentId === agentId) : approvals;
}

export async function createBackgroundAgent(input: {
  name: string;
  prompt: string;
  connectionId: string;
  cadenceMinutes: number | null;
  isEnabled: boolean;
}): Promise<BackgroundAgentDefinition> {
  const now = Date.now();
  const agent: BackgroundAgentDefinition = {
    id: `background-agent-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    connectionId: input.connectionId,
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
  }));

  return agent;
}

export async function updateBackgroundAgent(
  agentId: string,
  changes: Partial<Pick<BackgroundAgentDefinition, "name" | "prompt" | "connectionId" | "cadenceMinutes" | "isEnabled">>,
): Promise<void> {
  await updateDocument((document) => ({
    ...document,
    agents: document.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            ...changes,
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

export async function recordBackgroundAgentRunStart(agentId: string): Promise<BackgroundAgentRun> {
  const run: BackgroundAgentRun = {
    id: `background-agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    summary: null,
    error: null,
    reportArtifactId: null,
    queryArtifactIds: [],
    approvalIds: [],
  };

  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [agentId]: [run, ...(document.runs[agentId] ?? [])].slice(0, 50),
    },
    agents: document.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            updatedAt: Date.now(),
            lastRunAt: run.startedAt,
            lastRunStatus: "running",
          }
        : agent,
    ),
  }));

  return run;
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
  await updateDocument((document) => ({
    ...document,
    runs: {
      ...document.runs,
      [args.agentId]: (document.runs[args.agentId] ?? []).map((run) =>
        run.id === args.runId
          ? {
              ...run,
              status: args.status,
              finishedAt: Date.now(),
              summary: args.summary ?? run.summary,
              error: args.error ?? run.error,
              reportArtifactId: args.reportArtifactId ?? run.reportArtifactId,
              queryArtifactIds: args.queryArtifactIds ?? run.queryArtifactIds,
              approvalIds: args.approvalIds ?? run.approvalIds,
            }
          : run,
      ),
    },
    agents: document.agents.map((agent) =>
      agent.id === args.agentId
        ? {
            ...agent,
            updatedAt: Date.now(),
            lastRunAt: Date.now(),
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
