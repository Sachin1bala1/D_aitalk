import { toast } from "sonner";
import { DbClient, type FullSchema } from "../db/DbClient";
import { getProvider } from "../ai/ProviderRegistry";
import { getActiveModel, loadApiKeysFromKeychain, loadSettings, type ConversationTurn, type UnifiedTool } from "../ai/types";
import {
  addBackgroundAgentApprovalItems,
  appendBackgroundAgentRunEvent,
  ensureBackgroundAgentsLoaded,
  finishBackgroundAgentRun,
  getBackgroundAgent,
  getBackgroundAgentEnvironment,
  getBackgroundAgentRun,
  getBackgroundAgentRuns,
  hasOpenBackgroundAgentRun,
  listBackgroundAgentApprovals,
  listBackgroundAgentEnvironments,
  listBackgroundAgents,
  listQueuedBackgroundAgentRuns,
  markBackgroundAgentRunRunning,
  recordBackgroundAgentRunStart,
  requestBackgroundAgentRunTakeover,
  shouldRunBackgroundAgentNow,
  type BackgroundAgentApprovalItem,
  type BackgroundAgentDefinition,
  type BackgroundAgentRun,
  type BackgroundAgentRunTrigger,
} from "./BackgroundAgentStore";
import { createQueryArtifact } from "../artifacts/queryArtifacts";
import { createReportArtifact } from "../artifacts/reportArtifacts";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { getLatestArtifactRevisionId } from "../stores/WorkspaceStore";

const BACKGROUND_AGENT_TOOLS: UnifiedTool[] = [
  {
    name: "background_execute_sql",
    description: "Run a read-only SQL query against the agent's target connection for detached analysis.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "Read-only SQL query to execute.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "queue_followup_action",
    description:
      "Queue a risky or mutating follow-up recommendation for human review instead of executing it.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short operator-facing title for the follow-up action.",
        },
        rationale: {
          type: "string",
          description: "Why this follow-up action is recommended.",
        },
        risk: {
          type: "string",
          enum: ["caution", "destructive"],
          description: "Risk level of the recommended follow-up action.",
        },
        suggestedSql: {
          type: "string",
          description: "Optional suggested SQL for the operator to review manually.",
        },
      },
      required: ["title", "rationale", "risk"],
    },
  },
];

const MAX_BACKGROUND_AGENT_ATTEMPTS = 2;
const inFlightRuns = new Map<string, Set<string>>();
const inFlightRunIds = new Set<string>();

function reserveRun(environmentId: string, runId: string) {
  if (!inFlightRuns.has(environmentId)) {
    inFlightRuns.set(environmentId, new Set());
  }
  inFlightRuns.get(environmentId)!.add(runId);
  inFlightRunIds.add(runId);
}

function releaseRun(environmentId: string, runId: string) {
  inFlightRuns.get(environmentId)?.delete(runId);
  if (inFlightRuns.get(environmentId)?.size === 0) {
    inFlightRuns.delete(environmentId);
  }
  inFlightRunIds.delete(runId);
}

function activeRunCount(environmentId: string): number {
  return inFlightRuns.get(environmentId)?.size ?? 0;
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().replace(/^\(+/, "").toLowerCase();
  return /^(select|with|show|explain|describe|desc|pragma)\b/.test(normalized);
}

function summarizeSchema(schema: FullSchema | null): string {
  if (!schema) return "Schema unavailable.";
  return schema.tables
    .slice(0, 40)
    .map((table) => {
      const key = `${table.schema}.${table.name}`;
      const cols = (schema.columns[key] ?? [])
        .slice(0, 12)
        .map((column) => `${column.name} ${column.type_name}${column.is_primary_key ? " PK" : ""}`)
        .join(", ");
      return `- ${key}: ${cols}`;
    })
    .join("\n");
}

function buildBackgroundAgentSystemPrompt(agent: BackgroundAgentDefinition, schema: FullSchema | null): string {
  return [
    "You are a detached background data analysis agent running inside Daitalk.",
    "You are not allowed to mutate the database during detached execution.",
    "Use only read-only SQL via background_execute_sql.",
    "If you believe a follow-up action should change data, schema, or run a risky workflow, call queue_followup_action instead of trying to execute it.",
    "Keep outputs concise, operational, and evidence-based.",
    "Conclude with a short operator-ready summary and next steps.",
    `Target connection: ${agent.connectionId}`,
    `Execution environment: ${agent.environmentId}`,
    "Available schema overview:",
    summarizeSchema(schema),
  ].join("\n\n");
}

function extractSummaryBullets(text: string): string[] {
  return text
    .split(/[\n.]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 4);
}

function buildBackgroundReportSpec(args: {
  agent: BackgroundAgentDefinition;
  finalText: string;
  queryArtifactIds: string[];
}) {
  const artifacts = useWorkspaceStore.getState().artifacts;
  const sourceArtifacts = args.queryArtifactIds
    .map((artifactId) => artifacts[artifactId])
    .filter((artifact): artifact is Extract<typeof artifact, { kind: "query" }> => !!artifact && artifact.kind === "query");

  return {
    title: `${args.agent.name} ${new Date().toLocaleString()}`,
    author: "Daitalk Background Agent",
    date: new Date().toLocaleDateString(),
    connectionName: args.agent.connectionId,
    sections: [
      { type: "title_page" as const },
      {
        type: "executive_summary" as const,
        bullets: extractSummaryBullets(args.finalText),
      },
      ...sourceArtifacts.map((artifact) => ({
        type: "data_table" as const,
        title: artifact.name,
        columns: artifact.snapshot.fields.map((field) => field.name),
        rows: artifact.snapshot.rows
          .slice(0, 20)
          .map((row) => artifact.snapshot.fields.map((field) => row[field.name] ?? null)),
      })),
      {
        type: "recommendations" as const,
        items: extractSummaryBullets(args.finalText).map((bullet) => ({
          priority: "medium",
          action: bullet,
        })),
      },
    ],
  };
}

function buildToolResultTurn(toolCallId: string, name: string, content: string, isError = false): ConversationTurn {
  return {
    role: "user",
    toolResults: [
      {
        toolCallId,
        name,
        content,
        isError,
      },
    ],
  };
}

function isRetryableBackgroundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection|timeout|temporar|429|rate limit|fetch|network/i.test(message);
}

function buildBackgroundAgentTakeoverPrompt(args: {
  agent: BackgroundAgentDefinition;
  run: BackgroundAgentRun;
  approvals: BackgroundAgentApprovalItem[];
}): string {
  const eventSummary = args.run.events
    .slice(-6)
    .map((event) => `- [${event.type}] ${event.message}`)
    .join("\n");

  const approvalSummary = args.approvals.length
    ? args.approvals
        .map((approval) => `- ${approval.title}: ${approval.rationale}${approval.suggestedSql ? ` SQL: ${approval.suggestedSql}` : ""}`)
        .join("\n")
    : "- No queued follow-up approvals.";

  return [
    `Continue the detached background investigation for "${args.agent.name}".`,
    `Original prompt: ${args.agent.prompt}`,
    `Execution environment: ${args.run.environmentId}`,
    `Run status: ${args.run.status}`,
    `Run summary: ${args.run.summary ?? args.run.error ?? "No final summary recorded."}`,
    args.run.reportArtifactId ? `Linked report artifact: ${args.run.reportArtifactId}` : null,
    args.run.queryArtifactIds.length > 0
      ? `Linked query artifacts: ${args.run.queryArtifactIds.join(", ")}`
      : null,
    "Recent detached run events:",
    eventSummary || "- No events recorded.",
    "Queued review items:",
    approvalSummary,
    "Treat detached outputs as current evidence, re-check live state before recommending any write action, and continue the investigation.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function executeQueuedBackgroundRun(
  agent: BackgroundAgentDefinition,
  run: BackgroundAgentRun,
): Promise<void> {
  if (inFlightRunIds.has(run.id)) return;

  const environment = getBackgroundAgentEnvironment(run.environmentId);
  if (!environment || !environment.isEnabled) {
    await appendBackgroundAgentRunEvent({
      agentId: agent.id,
      runId: run.id,
      type: "deferred_by_environment",
      level: "warning",
      message: "Run remains queued because its execution environment is disabled.",
      metadata: { environmentId: run.environmentId },
    });
    return;
  }

  reserveRun(run.environmentId, run.id);
  const queryArtifactIds: string[] = [];
  const queuedApprovals: Array<Omit<BackgroundAgentApprovalItem, "id" | "createdAt" | "resolvedAt" | "status">> = [];

  try {
    const providerSettings = loadSettings();
    const keys = await loadApiKeysFromKeychain();
    providerSettings.keys = { ...providerSettings.keys, ...keys };
    const provider = getProvider(providerSettings);
    if (!provider) {
      throw new Error("No AI provider configured for background agents");
    }

    const schema = await DbClient.getSchema(agent.connectionId).catch(() => null);
    let finalText = "";

    for (let attempt = 1; attempt <= run.maxAttempts; attempt += 1) {
      const history: ConversationTurn[] = [{ role: "user", text: agent.prompt }];
      try {
        await markBackgroundAgentRunRunning({
          agentId: agent.id,
          runId: run.id,
          attemptCount: attempt,
          environmentId: run.environmentId,
        });
        if (attempt > 1) {
          await appendBackgroundAgentRunEvent({
            agentId: agent.id,
            runId: run.id,
            type: "retrying",
            level: "warning",
            message: `Retrying detached investigation after transient failure (attempt ${attempt} of ${run.maxAttempts}).`,
            metadata: { environmentId: run.environmentId },
          });
        }

        finalText = "";
        for (let round = 0; round < 6; round += 1) {
          const { text, toolCalls, stopReason } = await provider.stream({
            system: buildBackgroundAgentSystemPrompt(agent, schema),
            history,
            model: getActiveModel(providerSettings),
            tools: BACKGROUND_AGENT_TOOLS,
            onToken: () => {},
          });

          finalText += text;
          history.push({
            role: "assistant",
            text,
            toolCalls,
          });

          if (stopReason === "end_turn" || toolCalls.length === 0) {
            break;
          }

          for (const toolCall of toolCalls) {
            if (toolCall.name === "background_execute_sql") {
              const sql = String(toolCall.input.sql ?? "");
              if (!isReadOnlySql(sql)) {
                history.push(
                  buildToolResultTurn(
                    toolCall.id,
                    toolCall.name,
                    "Error: only read-only SQL is allowed in detached background agents.",
                    true,
                  ),
                );
                await appendBackgroundAgentRunEvent({
                  agentId: agent.id,
                  runId: run.id,
                  type: "failed",
                  level: "warning",
                  message: "Blocked non-read-only SQL during detached execution.",
                  metadata: { sql, environmentId: run.environmentId },
                });
                continue;
              }

              const rows = await DbClient.query(agent.connectionId, sql);
              const artifact = createQueryArtifact({
                name: `${agent.name} query ${queryArtifactIds.length + 1}`,
                results: {
                  rows,
                  fields: rows[0] ? Object.keys(rows[0]).map((name) => ({ name })) : [],
                  rowCount: rows.length,
                  elapsedMs: 0,
                  queryId: `background-agent-query-${Date.now()}`,
                  source_tables: [],
                },
                sql,
                connectionId: agent.connectionId,
                sourceTabId: null,
              });
              useWorkspaceStore.getState().commitArtifactRevision(artifact);
              queryArtifactIds.push(artifact.id);
              await appendBackgroundAgentRunEvent({
                agentId: agent.id,
                runId: run.id,
                type: "sql_executed",
                message: `Executed read-only SQL and recorded ${rows.length} row(s).`,
                metadata: {
                  environmentId: run.environmentId,
                  artifactId: artifact.id,
                  rowCount: rows.length,
                  sql: sql.slice(0, 500),
                },
              });
              history.push(
                buildToolResultTurn(
                  toolCall.id,
                  toolCall.name,
                  JSON.stringify({
                    rowCount: rows.length,
                    columns: rows[0] ? Object.keys(rows[0]) : [],
                    artifactId: artifact.id,
                    preview: rows.slice(0, 5),
                  }),
                ),
              );
              continue;
            }

            if (toolCall.name === "queue_followup_action") {
              const queuedApproval = {
                agentId: agent.id,
                runId: run.id,
                title: String(toolCall.input.title ?? "Recommended follow-up"),
                rationale: String(toolCall.input.rationale ?? "No rationale provided."),
                risk: (
                  toolCall.input.risk === "destructive" ? "destructive" : "caution"
                ) as "caution" | "destructive",
                suggestedSql:
                  typeof toolCall.input.suggestedSql === "string"
                    ? toolCall.input.suggestedSql
                    : undefined,
              };
              queuedApprovals.push(queuedApproval);
              await appendBackgroundAgentRunEvent({
                agentId: agent.id,
                runId: run.id,
                type: "approval_queued",
                level: queuedApproval.risk === "destructive" ? "warning" : "info",
                message: `Queued follow-up review item: ${queuedApproval.title}`,
                metadata: {
                  environmentId: run.environmentId,
                  risk: queuedApproval.risk,
                  suggestedSql: queuedApproval.suggestedSql ?? null,
                },
              });
              history.push(
                buildToolResultTurn(
                  toolCall.id,
                  toolCall.name,
                  JSON.stringify({ queued: true }),
                ),
              );
            }
          }
        }
        break;
      } catch (error) {
        if (attempt >= run.maxAttempts || !isRetryableBackgroundError(error)) {
          throw error;
        }
      }
    }

    const approvals =
      queuedApprovals.length > 0
        ? await addBackgroundAgentApprovalItems(queuedApprovals)
        : [];
    const reportSpec = buildBackgroundReportSpec({
      agent,
      finalText,
      queryArtifactIds,
    });
    const artifactRevisions = useWorkspaceStore.getState().artifactRevisions;
    const reportArtifact = createReportArtifact({
      name: reportSpec.title,
      connectionName: agent.connectionId,
      spec: reportSpec,
      sourceArtifacts: queryArtifactIds.map((artifactId) => ({
        id: artifactId,
        revisionId: getLatestArtifactRevisionId(artifactRevisions[artifactId]),
      })),
    });
    useWorkspaceStore.getState().commitArtifactRevision(reportArtifact);
    await appendBackgroundAgentRunEvent({
      agentId: agent.id,
      runId: run.id,
      type: "report_created",
      message: `Created report artifact ${reportArtifact.id}.`,
      metadata: { environmentId: run.environmentId, reportArtifactId: reportArtifact.id },
    });

    const status = approvals.length > 0 ? "approval_required" : "success";
    const summary = extractSummaryBullets(finalText).join(" ");
    await finishBackgroundAgentRun({
      runId: run.id,
      agentId: agent.id,
      status,
      summary,
      reportArtifactId: reportArtifact.id,
      queryArtifactIds,
      approvalIds: approvals.map((approval) => approval.id),
    });

    if (status === "approval_required") {
      toast.warning(`Background agent "${agent.name}" queued follow-up actions`, {
        description: `${approvals.length} review item${approvals.length === 1 ? "" : "s"} need attention.`,
      });
    } else {
      toast.success(`Background agent "${agent.name}" completed`, {
        description: summary || "Detached analysis finished successfully.",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background agent run failed";
    await finishBackgroundAgentRun({
      runId: run.id,
      agentId: agent.id,
      status: "failed",
      error: message,
      queryArtifactIds,
    });
    toast.error(`Background agent "${agent.name}" failed`, {
      description: message,
    });
  } finally {
    releaseRun(run.environmentId, run.id);
    void drainBackgroundAgentQueue();
  }
}

export async function drainBackgroundAgentQueue(): Promise<void> {
  await ensureBackgroundAgentsLoaded();
  const environments = listBackgroundAgentEnvironments();
  const queuedRuns = listQueuedBackgroundAgentRuns().sort((left, right) => left.startedAt - right.startedAt);

  for (const environment of environments) {
    if (!environment.isEnabled) continue;
    let available = Math.max(0, environment.concurrencyLimit - activeRunCount(environment.id));
    if (available <= 0) continue;

    const runsForEnvironment = queuedRuns.filter((run) => run.environmentId === environment.id);
    for (const run of runsForEnvironment) {
      if (available <= 0) break;
      const latestRun = getBackgroundAgentRun(run.agentId, run.id);
      const agent = getBackgroundAgent(run.agentId);
      if (!latestRun || latestRun.status !== "queued" || !agent) continue;
      available -= 1;
      void executeQueuedBackgroundRun(agent, latestRun);
    }
  }
}

export async function runBackgroundAnalysisAgent(
  agentId: string,
  options?: { trigger?: BackgroundAgentRunTrigger; retryOfRunId?: string | null },
): Promise<BackgroundAgentRun | null> {
  await ensureBackgroundAgentsLoaded();
  const agent = getBackgroundAgent(agentId);
  if (!agent) throw new Error("Background agent not found");

  if (hasOpenBackgroundAgentRun(agent.id)) {
    return getBackgroundAgentRuns(agent.id).find((run) => run.status === "queued" || run.status === "running") ?? null;
  }

  const run = await recordBackgroundAgentRunStart(agent.id, {
    trigger: options?.trigger ?? "manual",
    maxAttempts: MAX_BACKGROUND_AGENT_ATTEMPTS,
    retryOfRunId: options?.retryOfRunId ?? null,
    environmentId: agent.environmentId,
  });

  const environment = getBackgroundAgentEnvironment(agent.environmentId);
  if (!environment || !environment.isEnabled) {
    await appendBackgroundAgentRunEvent({
      agentId: agent.id,
      runId: run.id,
      type: "deferred_by_environment",
      level: "warning",
      message: "Run queued but waiting for its execution environment to be enabled.",
      metadata: { environmentId: agent.environmentId },
    });
    return getBackgroundAgentRun(agent.id, run.id);
  }

  if (activeRunCount(agent.environmentId) >= environment.concurrencyLimit) {
    await appendBackgroundAgentRunEvent({
      agentId: agent.id,
      runId: run.id,
      type: "deferred_by_environment",
      level: "info",
      message: `Run queued while waiting for capacity in ${environment.name}.`,
      metadata: {
        environmentId: agent.environmentId,
        concurrencyLimit: environment.concurrencyLimit,
      },
    });
  }

  await drainBackgroundAgentQueue();
  return getBackgroundAgentRun(agent.id, run.id);
}

export async function runDueBackgroundAnalysisAgents(now = Date.now()): Promise<void> {
  await ensureBackgroundAgentsLoaded();
  const agents = listBackgroundAgents().filter((agent) => shouldRunBackgroundAgentNow(agent, now));
  for (const agent of agents) {
    void runBackgroundAnalysisAgent(agent.id, { trigger: "scheduled" });
  }
}

export function buildBackgroundRunTakeoverPrompt(
  agentId: string,
  runId: string,
): string | null {
  const agent = getBackgroundAgent(agentId);
  if (!agent) return null;
  const run = getBackgroundAgentRuns(agentId).find((candidate) => candidate.id === runId);
  if (!run) return null;
  const approvals = listBackgroundAgentApprovals(agentId).filter((approval) => run.approvalIds.includes(approval.id));
  return buildBackgroundAgentTakeoverPrompt({
    agent,
    run,
    approvals,
  });
}

export async function queueBackgroundRunTakeover(agentId: string, runId: string): Promise<string | null> {
  const run = getBackgroundAgentRuns(agentId).find((candidate) => candidate.id === runId);
  if (!run) return null;
  const prompt = buildBackgroundRunTakeoverPrompt(agentId, runId);
  if (!prompt) return null;
  await requestBackgroundAgentRunTakeover({
    agentId,
    runId,
    prompt,
  });
  return prompt;
}
