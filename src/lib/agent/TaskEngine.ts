import { runAgentLoop, type AgentLoopOptions } from "./AgentLoop";
import { CREATE_TASK_PLAN_TOOL, VERIFY_RESULT_TOOL } from "./toolDefinitions";
import type { ConversationTurn, ToolCall } from "../ai/types";
import type { AuditEntry, SubTask, SubTaskStatus, Task, TaskCheckpoint, TaskProvenance, VerifyResultParams } from "./TaskState";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { verifyCurrentResults } from "./VerificationEngine";
import { withTimeout } from "../ai/resilience";

interface TaskPlan {
  subtasks: string[];
}

interface TaskExecutionRequest {
  userMessage: string;
  history: ConversationTurn[];
  options: AgentLoopOptions;
  resumeCheckpoint?: TaskCheckpoint | null;
}

const RESULT_PRODUCING_TOOLS = new Set(["execute_sql", "open_table", "run_duckdb_analysis"]);
const MAX_AUTO_RETRIES = 1;
const TASK_PLAN_TIMEOUT_MS = 6_000;
const VERIFY_PLAN_TIMEOUT_MS = 4_000;
const SINGLE_STEP_TIMEOUT_MS = 20_000;
const SUBTASK_TIMEOUT_MS = 15_000;

function createAuditEntry(state: SubTaskStatus, note?: string, extras?: Partial<AuditEntry>): AuditEntry {
  return {
    state,
    timestamp: Date.now(),
    note,
    ...extras,
  };
}

function createSubtask(goal: string, status: SubTaskStatus = "pending"): SubTask {
  return {
    id: `subtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    goal,
    status,
    retryCount: 0,
    maxRetries: 3,
    isRisky: false,
    auditLog: [createAuditEntry(status, status === "planning" ? "Preparing subtask" : "Queued")],
  };
}

function createSingleStepTask(userGoal: string): Task {
  return {
    id: `task-${Date.now()}`,
    userGoal,
    subtasks: [createSubtask(userGoal, "planning")],
    currentIndex: 0,
    status: "running",
  };
}

function createPlannedTask(userGoal: string, subtasks: string[]): Task {
  return {
    id: `task-${Date.now()}`,
    userGoal,
    subtasks: subtasks.map((goal, index) => createSubtask(goal, index === 0 ? "planning" : "pending")),
    currentIndex: 0,
    status: "running",
  };
}

function setCurrentTask(task: Task | null) {
  useWorkspaceStore.getState().setCurrentTask(task);
}

function createTaskCheckpoint(task: Task): TaskCheckpoint {
  const state = useWorkspaceStore.getState();
  const activeSubtask = task.subtasks[task.currentIndex] ?? null;
  const hasApprovalRisk = task.subtasks.some(
    (subtask) => subtask.isRisky || subtask.status === "awaiting_approval",
  );

  return {
    task,
    lifecycle: "running",
    interruptedAt: null,
    updatedAt: Date.now(),
    resumeEligible: task.status === "running",
    resumeRisk: hasApprovalRisk ? "approval_required" : "safe",
    connectionId: state.activeConnectionId,
    activeTabId: state.activeTabId,
    lastCheckpointNote: activeSubtask?.auditLog[activeSubtask.auditLog.length - 1]?.note,
  };
}

function persistTaskCheckpoint(task: Task | null) {
  const state = useWorkspaceStore.getState();
  if (!task) {
    state.clearTaskCheckpoint();
    return;
  }
  state.setTaskCheckpoint(createTaskCheckpoint(task));
}

function updateSubtask(
  task: Task,
  subtaskIndex: number,
  status: SubTaskStatus,
  note?: string,
  extras?: Partial<SubTask>,
): Task {
  const current = task.subtasks[subtaskIndex];
  if (!current) return task;

  const updatedSubtask: SubTask = {
    ...current,
    ...extras,
    status,
    auditLog: [
      ...current.auditLog,
      createAuditEntry(status, note, {
        sql: extras?.sql ?? current.sql,
        verificationPassed: extras?.verificationPassed ?? current.verificationPassed,
        verificationMode: extras?.verificationMode ?? current.verificationMode,
        retryAttempt: extras?.retryCount,
        commandTypes: extras?.provenance?.commandTypes ?? current.provenance?.commandTypes,
        queryId: extras?.provenance?.latestQueryId ?? current.provenance?.latestQueryId ?? null,
        sourceTables: extras?.provenance?.latestSourceTables ?? current.provenance?.latestSourceTables ?? [],
      }),
    ],
  };

  return {
    ...task,
    currentIndex: subtaskIndex,
    subtasks: task.subtasks.map((subtask, index) =>
      index === subtaskIndex ? updatedSubtask : subtask
    ),
  };
}

function finalizeTask(task: Task, status: Task["status"]): Task {
  return {
    ...task,
    status,
  };
}

function getRecentToolCalls(previousHistory: ConversationTurn[], nextHistory: ConversationTurn[]): ToolCall[] {
  return nextHistory
    .slice(previousHistory.length)
    .flatMap((turn) => turn.toolCalls ?? []);
}

function extractLatestSql(toolCalls: ToolCall[]): string | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (
      (toolCall.name === "execute_sql" || toolCall.name === "run_duckdb_analysis") &&
      typeof toolCall.input.sql === "string" &&
      toolCall.input.sql.trim().length > 0
    ) {
      return toolCall.input.sql;
    }
  }
  return undefined;
}

function shouldVerifySubtask(toolCalls: ToolCall[]): boolean {
  return toolCalls.some((toolCall) => RESULT_PRODUCING_TOOLS.has(toolCall.name));
}

function getActiveTabResults() {
  const state = useWorkspaceStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab?.queryResults ?? null;
}

function buildSubtaskProvenance(
  toolCalls: ToolCall[],
  latestSql?: string,
): TaskProvenance {
  const state = useWorkspaceStore.getState();
  const activeResults = getActiveTabResults();
  const toolNames = toolCalls.map((toolCall) => toolCall.name);

  return {
    connectionId: state.activeConnectionId,
    activeTabId: state.activeTabId,
    latestSql,
    latestQueryId: activeResults?.queryId ?? null,
    latestSourceTables: activeResults?.source_tables ?? [],
    toolNames,
    commandTypes: toolNames,
  };
}

function buildSubtaskPrompt(
  task: Task,
  subtaskIndex: number,
  userMessage: string,
  retryDiagnosis?: string,
): string {
  const basePrompt =
    `Subtask ${subtaskIndex + 1}/${task.subtasks.length}: ${task.subtasks[subtaskIndex].goal}\n` +
    `Original user goal: ${userMessage}\n` +
    "Stay focused on this subtask only. Use read-only investigation and analysis behavior.";

  if (!retryDiagnosis) return basePrompt;

  return (
    `${basePrompt}\n` +
    `Retry guidance: the previous attempt failed deterministic verification.\n` +
    `Fix this specific issue before concluding: ${retryDiagnosis}`
  );
}

export function shouldSkipPlanning(
  userMessage: string,
  currentResults: AgentLoopOptions["currentResults"] = null,
): boolean {
  const q = userMessage.toLowerCase();
  if (/\b(delete|drop|rename|alter|update|insert|create index|pipeline|migrate|transform)\b/.test(q)) {
    return true;
  }

  if (
    /\b(important parameter|most important|top parameter|key parameter|summary statistics|descriptive statistics|basic statistics|correlation|distribution|failure rate|sample rows|first \d+ rows|top \d+ rows)\b/.test(q)
  ) {
    return true;
  }

  if (currentResults && currentResults.rowCount > 0 && currentResults.rowCount <= 1_000) {
    if (
      /\b(show|pull|get|run|list|summarize|summarise|describe|analyze|analyse|plot|chart|visualize|visualise|correlate|compare)\b/.test(q)
    ) {
      return true;
    }
  }

  return false;
}

async function requestTaskPlan(
  userMessage: string,
  history: ConversationTurn[],
  options: AgentLoopOptions,
): Promise<TaskPlan | null> {
  if (shouldSkipPlanning(userMessage, options.currentResults)) return null;

  const planningSystem = [
    "You are planning a safe, read-only data investigation workflow inside Daitalk.",
    "Only create a plan if the request clearly needs multiple read-only steps.",
    "If a plan is needed, call create_task_plan with 2 to 5 short read-only subtasks.",
    "Do not plan any mutating or destructive actions in this mode.",
    "If the task is simple or requires mutation, respond normally without tool calls.",
  ].join(" ");

  const planningHistory: ConversationTurn[] = [
    ...history,
    { role: "user", text: userMessage },
  ];

  const { toolCalls } = await withTimeout(
    options.provider.stream({
      system: planningSystem,
      history: planningHistory,
      model: options.model,
      tools: [CREATE_TASK_PLAN_TOOL],
      onToken: () => {},
    }),
    TASK_PLAN_TIMEOUT_MS,
    "Task planning",
  );

  const toolCall = toolCalls.find((call) => call.name === "create_task_plan");
  if (!toolCall) return null;

  const subtasks = Array.isArray(toolCall.input.subtasks)
    ? toolCall.input.subtasks.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (subtasks.length < 2) return null;
  return { subtasks: subtasks.slice(0, 5) };
}

async function requestVerificationPlan(
  userMessage: string,
  subtaskGoal: string,
  latestSql: string | undefined,
  options: AgentLoopOptions,
): Promise<VerifyResultParams | null> {
  const currentResults = getActiveTabResults();
  const verificationPrompt = [
    `Original user goal: ${userMessage}`,
    `Completed subtask: ${subtaskGoal}`,
    latestSql ? `Latest SQL: ${latestSql}` : "Latest SQL: unavailable",
    `Available row count: ${currentResults?.rowCount ?? 0}`,
    `Available columns: ${(currentResults?.fields.map((field) => field.name).join(", ") || "(none)")}`,
    "If the completed subtask should be verified against the available tabular result, call verify_result with conservative checks.",
    "Only require columns that are necessary to satisfy the subtask. If no deterministic verification is possible, respond without a tool call.",
  ].join("\n");

  const { toolCalls } = await withTimeout(
    options.provider.stream({
      system:
        "You are defining deterministic verification checks for a completed read-only data analysis subtask. Prefer minimal checks that can be validated against the current tabular result.",
      history: [{ role: "user", text: verificationPrompt }],
      model: options.model,
      tools: [VERIFY_RESULT_TOOL],
      onToken: () => {},
    }),
    VERIFY_PLAN_TIMEOUT_MS,
    "Verification planning",
  );

  const verificationCall = toolCalls.find((call) => call.name === "verify_result");
  if (!verificationCall) return null;

  return {
    description:
      typeof verificationCall.input.description === "string"
        ? verificationCall.input.description
        : subtaskGoal,
    sql: typeof verificationCall.input.sql === "string" ? verificationCall.input.sql : latestSql,
    expectedMinRows:
      typeof verificationCall.input.expectedMinRows === "number"
        ? verificationCall.input.expectedMinRows
        : undefined,
    expectedColumns: Array.isArray(verificationCall.input.expectedColumns)
      ? verificationCall.input.expectedColumns.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : undefined,
    requireResults:
      typeof verificationCall.input.requireResults === "boolean"
        ? verificationCall.input.requireResults
        : true,
  };
}

export async function runTaskEngine(
  userMessage: string,
  history: ConversationTurn[],
  options: AgentLoopOptions,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  return startTaskEngine(userMessage, history, options);
}

export async function startTaskEngine(
  userMessage: string,
  history: ConversationTurn[],
  options: AgentLoopOptions,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  return executeTaskEngine({
    userMessage,
    history,
    options,
  });
}

export async function resumeTaskEngine(
  checkpoint: TaskCheckpoint,
  history: ConversationTurn[],
  options: AgentLoopOptions,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const activeSubtask = checkpoint.task.subtasks[checkpoint.task.currentIndex];
  const resumePrompt = [
    "Resume the interrupted analysis task safely.",
    `Original goal: ${checkpoint.task.userGoal}`,
    activeSubtask ? `Last incomplete subtask: ${activeSubtask.goal}` : null,
    checkpoint.lastCheckpointNote ? `Last checkpoint note: ${checkpoint.lastCheckpointNote}` : null,
    "Treat restored results as snapshots only.",
    "Re-check the world state before continuing and do not assume any in-flight work completed.",
  ]
    .filter(Boolean)
    .join("\n");

  return executeTaskEngine({
    userMessage: resumePrompt,
    history,
    options,
    resumeCheckpoint: checkpoint,
  });
}

async function executeTaskEngine({
  userMessage,
  history,
  options,
  resumeCheckpoint,
}: TaskExecutionRequest): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const plan = await requestTaskPlan(userMessage, history, options).catch(() => null);
  let task = resumeCheckpoint?.task
    ? {
        ...resumeCheckpoint.task,
        status: "running" as const,
        subtasks: resumeCheckpoint.task.subtasks.map((subtask, index) => ({
          ...subtask,
          status: (
            index < resumeCheckpoint.task.currentIndex
              ? "complete"
              : index === resumeCheckpoint.task.currentIndex
                ? "planning"
                : "pending"
          ) as SubTaskStatus,
        })),
      }
    : plan
      ? createPlannedTask(userMessage, plan.subtasks)
      : createSingleStepTask(userMessage);
  setCurrentTask(task);
  persistTaskCheckpoint(task);

  try {
    if (!plan) {
      task = updateSubtask(task, 0, "executing", "Running agent loop");
      setCurrentTask(task);
      persistTaskCheckpoint(task);

      const result = await withTimeout(
        runAgentLoop(userMessage, history, options),
        SINGLE_STEP_TIMEOUT_MS,
        "Agent execution",
      );

      if (result.pendingApprovalSteps.length > 0) {
        task = updateSubtask(task, 0, "awaiting_approval", "Waiting for plan approval");
        task = finalizeTask(task, "awaiting_input");
        setCurrentTask(task);
        persistTaskCheckpoint(task);
        return result;
      }

      task = finalizeTask(
        updateSubtask(task, 0, "complete", "Agent run finished"),
        "complete",
      );
      setCurrentTask(task);
      persistTaskCheckpoint(null);
      return result;
    }

    let aggregatedFinalText = "";
    let aggregatedHistory = history;
    let finalDepth: "fast" | "deep" = "fast";

    for (let i = 0; i < task.subtasks.length; i++) {
      let retryDiagnosis: string | undefined;
      let completed = false;

      for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt += 1) {
        const attemptLabel =
          attempt === 0
            ? `Running subtask ${i + 1} of ${task.subtasks.length}`
            : `Retrying subtask ${i + 1} after verification failure`;

        task = updateSubtask(task, i, "executing", attemptLabel, {
          retryCount: attempt,
          diagnosis: retryDiagnosis,
        });
        setCurrentTask(task);
        persistTaskCheckpoint(task);

        const subtaskPrompt = buildSubtaskPrompt(task, i, userMessage, retryDiagnosis);
        const priorHistory = aggregatedHistory;
        const result = await withTimeout(
          runAgentLoop(subtaskPrompt, aggregatedHistory, options),
          SUBTASK_TIMEOUT_MS,
          `Subtask ${i + 1} execution`,
        );

        if (result.pendingApprovalSteps.length > 0) {
          aggregatedFinalText += (aggregatedFinalText ? "\n\n" : "") + result.finalText;
          aggregatedHistory = result.updatedHistory;
          finalDepth = result.queryDepth;
          task = updateSubtask(task, i, "awaiting_approval", `Waiting for approval on subtask ${i + 1}`);
          task = finalizeTask(task, "awaiting_input");
          setCurrentTask(task);
          persistTaskCheckpoint(task);
          return {
            finalText: aggregatedFinalText,
            updatedHistory: aggregatedHistory,
            queryDepth: finalDepth,
            pendingApprovalSteps: result.pendingApprovalSteps,
          };
        }

        const recentToolCalls = getRecentToolCalls(priorHistory, result.updatedHistory);
        const latestSql = extractLatestSql(recentToolCalls);
        const provenance = buildSubtaskProvenance(recentToolCalls, latestSql);

        task = updateSubtask(task, i, "verifying", `Checking subtask ${i + 1} output`, {
          sql: latestSql,
          result: result.finalText,
          provenance,
        });
        setCurrentTask(task);
        persistTaskCheckpoint(task);

        let verificationDiagnosis = `Completed subtask ${i + 1}`;
        let verificationPassed = true;
        let verificationMode: SubTask["verificationMode"] = "best_effort";

        if (shouldVerifySubtask(recentToolCalls)) {
          const verificationPlan = await requestVerificationPlan(
            userMessage,
            task.subtasks[i].goal,
            latestSql,
            options,
          ).catch(() => null);

          if (verificationPlan) {
            const verification = verifyCurrentResults(verificationPlan, getActiveTabResults());
            verificationDiagnosis = verification.diagnosis;
            verificationPassed = verification.passed;
            verificationMode = verification.verificationMode;
            provenance.latestQueryId =
              verification.actual && typeof verification.actual === "object" && verification.actual !== null && "queryId" in verification.actual
                ? (verification.actual as { queryId?: string | null }).queryId ?? provenance.latestQueryId
                : provenance.latestQueryId;
            provenance.latestSourceTables =
              verification.actual && typeof verification.actual === "object" && verification.actual !== null && "sourceTables" in verification.actual
                ? ((verification.actual as { sourceTables?: string[] }).sourceTables ?? provenance.latestSourceTables)
                : provenance.latestSourceTables;
          }
        }

        if (verificationPassed) {
          aggregatedFinalText += (aggregatedFinalText ? "\n\n" : "") + result.finalText;
          aggregatedHistory = result.updatedHistory;
          finalDepth = result.queryDepth;
          task = updateSubtask(task, i, "complete", verificationDiagnosis, {
            verificationPassed: true,
            verificationMode,
            diagnosis: verificationDiagnosis,
            retryCount: attempt,
            provenance,
          });
          completed = true;
          break;
        }

        retryDiagnosis = verificationDiagnosis;
        task = updateSubtask(task, i, "retry_requested", verificationDiagnosis, {
          verificationPassed: false,
          verificationMode,
          diagnosis: verificationDiagnosis,
          retryCount: attempt + 1,
          provenance,
        });
        setCurrentTask(task);
        persistTaskCheckpoint(task);

        if (attempt >= MAX_AUTO_RETRIES) {
          task = finalizeTask(
            updateSubtask(task, i, "failed", verificationDiagnosis, {
              verificationPassed: false,
              verificationMode,
              diagnosis: verificationDiagnosis,
              retryCount: attempt + 1,
              provenance,
            }),
            "failed",
          );
          setCurrentTask(task);
          throw new Error(verificationDiagnosis);
        }
      }

      if (!completed) {
        throw new Error(`Subtask ${i + 1} did not complete.`);
      }

      if (i + 1 < task.subtasks.length) {
        task = updateSubtask(task, i + 1, "planning", `Preparing subtask ${i + 2}`);
      }
      setCurrentTask(task);
      persistTaskCheckpoint(task);
    }

    task = finalizeTask(task, "complete");
    setCurrentTask(task);
    persistTaskCheckpoint(null);
    return {
      finalText: aggregatedFinalText,
      updatedHistory: aggregatedHistory,
      queryDepth: finalDepth,
      pendingApprovalSteps: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed";
    task = finalizeTask(
      updateSubtask(task, task.currentIndex, "failed", message, {
        diagnosis: message,
      }),
      "failed",
    );
    setCurrentTask(task);
    persistTaskCheckpoint(null);
    throw error;
  } finally {
    setTimeout(() => {
      const currentTask = useWorkspaceStore.getState().currentTask;
      if (currentTask?.id === task.id && currentTask.status !== "awaiting_input") {
        setCurrentTask(null);
      }
    }, 1500);
  }
}
