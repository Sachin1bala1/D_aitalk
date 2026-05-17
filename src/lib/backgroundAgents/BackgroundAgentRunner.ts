import { toast } from "sonner";
import { DbClient, type FullSchema } from "../db/DbClient";
import { getProvider } from "../ai/ProviderRegistry";
import { getActiveModel, loadApiKeysFromKeychain, loadSettings, type ConversationTurn, type ToolCall, type UnifiedTool } from "../ai/types";
import {
  addBackgroundAgentApprovalItems,
  ensureBackgroundAgentsLoaded,
  finishBackgroundAgentRun,
  getBackgroundAgent,
  listBackgroundAgents,
  recordBackgroundAgentRunStart,
  shouldRunBackgroundAgentNow,
  type BackgroundAgentApprovalItem,
  type BackgroundAgentDefinition,
} from "./BackgroundAgentStore";
import { createQueryArtifact } from "../artifacts/queryArtifacts";
import { createReportArtifact } from "../artifacts/reportArtifacts";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { getLatestArtifactRevisionId } from "../stores/WorkspaceStore";

interface BackgroundSqlExecutionRecord {
  sql: string;
  rowCount: number;
  artifactId: string;
}

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

const inFlightAgents = new Set<string>();

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

export async function runBackgroundAnalysisAgent(agentId: string): Promise<void> {
  await ensureBackgroundAgentsLoaded();
  const agent = getBackgroundAgent(agentId);
  if (!agent) throw new Error("Background agent not found");
  if (inFlightAgents.has(agent.id)) return;
  inFlightAgents.add(agent.id);

  const run = await recordBackgroundAgentRunStart(agent.id);
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
    const history: ConversationTurn[] = [{ role: "user", text: agent.prompt }];
    let finalText = "";

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
          queuedApprovals.push({
            agentId: agent.id,
            runId: run.id,
            title: String(toolCall.input.title ?? "Recommended follow-up"),
            rationale: String(toolCall.input.rationale ?? "No rationale provided."),
            risk:
              toolCall.input.risk === "destructive" ? "destructive" : "caution",
            suggestedSql:
              typeof toolCall.input.suggestedSql === "string"
                ? toolCall.input.suggestedSql
                : undefined,
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
    inFlightAgents.delete(agent.id);
  }
}

export async function runDueBackgroundAnalysisAgents(now = Date.now()): Promise<void> {
  await ensureBackgroundAgentsLoaded();
  const agents = listBackgroundAgents().filter((agent) => shouldRunBackgroundAgentNow(agent, now));
  for (const agent of agents) {
    void runBackgroundAnalysisAgent(agent.id);
  }
}
