/**
 * AIChat — multi-provider AgentLoop integration.
 *
 * Uses ProviderRegistry to pick Claude / Gemini / OpenAI / NVIDIA NIM.
 * Streams text tokens live, shows inline tool steps, handles Plan Mode queuing.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Settings2, Clock, Trash2, Wrench, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { FullSchema } from "../../lib/db/DbClient";
import type { QueryResults } from "../../lib/stores/WorkspaceStore";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { resumeTaskEngine, startTaskEngine } from "../../lib/agent/TaskEngine";
import type { CommandResult } from "../../lib/agent/CommandBus";
import { commandBus } from "../../lib/agent/CommandBus";
import type { PersistedAiChatMessage, PersistedAiSessionState } from "../../lib/ai/AiSessionState";
import type { ConversationTurn } from "../../lib/ai/types";
import { loadSettings, loadApiKeysFromKeychain, getActiveKey, getActiveModel, PROVIDER_CATALOG } from "../../lib/ai/types";
import { getProvider } from "../../lib/ai/ProviderRegistry";
import { ProviderSettingsDialog } from "./ProviderSettingsDialog";
import { UserToolsPanel } from "./UserToolsPanel";
import { ToolCallLog } from "./ToolCallLog";
import type { ToolLogEntry } from "./ToolCallLog";
import { HypothesisPanel } from "./HypothesisPanel";
import { ConfidenceBar } from "./ConfidenceBar";
import { EpisodicMemory } from "../../lib/memory/EpisodicMemory";
import { UserCalibrationProfile } from "../../lib/memory/UserCalibrationProfile";
import { useWorkspaceRuleStore } from "../../lib/memory/WorkspaceRuleStore";
import type { MemoryContext } from "../../lib/agent/AgentLoop";
import type { AnalysisSection } from "../../lib/reports/ReportBuilder";
import { ReportPanel } from "../reports/ReportPanel";
import { BusinessClient } from "../../lib/business/BusinessClient";
import { TaskProgressPanel } from "./TaskProgressPanel";
import { createReportArtifact } from "../../lib/artifacts/reportArtifacts";
import { getLatestArtifactRevisionId } from "../../lib/stores/WorkspaceStore";
import type { TaskCheckpoint } from "../../lib/agent/TaskState";
import {
  attemptedQueryMaterialization,
  getAutoExecutableSql,
  hasSuccessfulResultTool,
  requiresLiveExecution,
  type ToolExecutionOutcome,
} from "../../lib/agent/ExecutionIntentGuard";

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "plan_queued" | "error";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  /** Tool calls attached to an assistant message — rendered as collapsible ToolCallLog */
  toolLog?: ToolLogEntry[];
}

function toPersistedMessages(messages: ChatMessage[]): PersistedAiChatMessage[] {
  return messages.map(({ id, role, content, toolLog }) => ({
    id,
    role,
    content,
    toolLog,
  }));
}

interface AIChatProps {
  currentSQL: string | null;
  currentResults: QueryResults | null;
  currentSchema: FullSchema | null;
  connectionId: string | null;
  onApplySQL: (sql: string) => void;
  onQuerySuccess: (results: QueryResults, sql: string) => void;
}

function buildInterruptedResumePrompt(checkpoint: TaskCheckpoint): string {
  const activeSubtask = checkpoint.task.subtasks[checkpoint.task.currentIndex];
  const lastNote =
    activeSubtask?.auditLog[activeSubtask.auditLog.length - 1]?.note ??
    checkpoint.lastCheckpointNote ??
    "No checkpoint note recorded.";

  return [
    "Resume the interrupted analysis task safely.",
    `Original goal: ${checkpoint.task.userGoal}`,
    activeSubtask ? `Current subtask: ${activeSubtask.goal}` : null,
    `Last checkpoint: ${lastNote}`,
    "Treat any restored results as snapshots only.",
    "Re-check the world state before continuing and do not assume any in-flight work completed.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Plan-queued row ───────────────────────────────────────────────────────────

function PlanQueuedRow({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-amber-400/70 font-mono py-0.5 pl-2">
      <Clock className="w-3 h-3" />
      <span className="truncate">Queued: {content}</span>
    </div>
  );
}

// ── No-provider prompt ────────────────────────────────────────────────────────

function NoProviderPrompt({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4 text-center">
      <div className="w-10 h-10 rounded-full bg-[#00d2ff]/10 flex items-center justify-center">
        <Settings2 className="w-5 h-5 text-[#00d2ff]" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white/80">No AI provider configured</p>
        <p className="text-xs text-white/30 mt-1">
          Set an API key to start using the AI agent.
        </p>
      </div>
      <button
        onClick={onOpen}
        className="px-4 py-2 bg-[#00d2ff] text-black text-xs font-bold rounded-lg hover:opacity-90"
      >
        Configure Provider
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hello! I'm **APEX** — your Autonomous Process Engineering eXpert. I think like a 30-year senior process engineer.\n\nAsk me to:\n- Analyze your data with SPC, regression, or capability analysis\n- Detect anomalies and Western Electric rule violations\n- Find root causes using structured RCA methodology\n- Query and modify your database in plain language\n\nConnect a database and tell me what to investigate.",
};

export function AIChat({ currentSQL, currentResults, currentSchema, connectionId, onApplySQL }: AIChatProps) {
  const {
    agentMode,
    undoStack,
    popUndo,
    activeHypotheses,
    clearHypotheses,
    clearConfidence,
    connections,
    artifacts,
    artifactRevisions,
    commitArtifactRevision,
    aiSession,
    setAiSession,
    clearAiSession,
    taskCheckpoint,
    clearTaskCheckpoint,
    abandonTaskCheckpoint,
    pendingTaskResume,
    clearPendingTaskResume,
  } = useWorkspaceStore();

  const pendingChatInput = useWorkspaceStore((s) => s.pendingChatInput);
  const clearPendingChatInput = useWorkspaceStore((s) => s.clearPendingChatInput);

  const [providerSettings, setProviderSettings] = useState(loadSettings);
  const [providerKeysHydrated, setProviderKeysHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => aiSession?.messages as ChatMessage[] ?? [WELCOME]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [queryDepth, setQueryDepth] = useState<'fast' | 'deep' | null>(aiSession?.queryDepth ?? null);
  const [sessionSections, setSessionSections] = useState<AnalysisSection[]>(aiSession?.sessionSections ?? []);
  const [reportPanelOpen, setReportPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>(aiSession?.conversationTurns ?? []);
  const historyRef = useRef<ConversationTurn[]>(aiSession?.conversationTurns ?? []);
  const toolsCalledRef = useRef<string[]>([]);
  const toolOutcomeRef = useRef<ToolExecutionOutcome[]>([]);
  const [sessionQuestion, setSessionQuestion] = useState(aiSession?.sessionQuestion ?? "");

  // Load API keys from OS keychain on mount and merge into settings
  useEffect(() => {
    loadApiKeysFromKeychain().then((keys) => {
      setProviderSettings((s) => ({ ...s, keys: { ...s.keys, ...keys } }));
      setProviderKeysHydrated(true);
    }).catch(() => {
      setProviderKeysHydrated(true);
    });
  }, []);

  // Consume pending chat input set by StatResultView "Ask APEX" button
  useEffect(() => {
    if (pendingChatInput) {
      setInput(pendingChatInput);
      clearPendingChatInput();
      inputRef.current?.focus();
    }
  }, [pendingChatInput, clearPendingChatInput]);

  useEffect(() => {
    if (!pendingTaskResume || isProcessing) return;
    clearPendingTaskResume();
    void handleResumeInterruptedTask(pendingTaskResume);
  }, [clearPendingTaskResume, isProcessing, pendingTaskResume]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Persist stable AI session state through the native workspace snapshot layer.
  useEffect(() => {
    const stable = messages.filter((m) => !m.streaming);
    const nextSession: PersistedAiSessionState = {
      messages: toPersistedMessages(stable.slice(-100)),
      conversationTurns,
      sessionSections,
      sessionQuestion,
      queryDepth,
    };
    setAiSession(nextSession);
  }, [conversationTurns, messages, queryDepth, sessionQuestion, sessionSections, setAiSession]);

  // Ctrl+Z — undo last agent command
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !isProcessing) {
        const entry = popUndo();
        if (!entry) return;
        e.preventDefault();
        // Undo by re-dispatching a reversal: set_editor_content to clear, or notify only
        // For now show a toast indicating what was undone (full undo requires DB rollback)
        addMsg({
          role: "assistant",
          content: `↩ Undo: **${entry.humanReadable}** — DB-level undo requires a manual rollback. The action was: \`${entry.command.type}\``,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isProcessing, popUndo]);

  const addMsg = useCallback((msg: Omit<ChatMessage, "id">): string => {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const appendToken = useCallback((token: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, content: last.content + token }];
      }
      return [
        ...prev,
        { id: `stream-${Date.now()}`, role: "assistant" as MessageRole, content: token, streaming: true },
      ];
    });
  }, []);

  const finalizeStream = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }];
      return prev;
    });
  }, []);

  const activeKey = getActiveKey(providerSettings);
  const activeModel = getActiveModel(providerSettings);
  const activeMeta = PROVIDER_CATALOG.find((p) => p.id === providerSettings.activeProvider)!;

  const executeAgentRequest = useCallback(async (userMsg: string, options?: {
    visibleUserMessage?: string;
    preserveSessionSections?: boolean;
    preserveQueryDepth?: boolean;
    resumeCheckpoint?: TaskCheckpoint | null;
  }) => {
    if (!userMsg.trim() || isProcessing) return;
    const provider = getProvider(providerSettings);
    if (!provider) {
      setSettingsOpen(true);
      return;
    }

    const visibleUserMessage = options?.visibleUserMessage ?? userMsg;

    clearHypotheses();
    clearConfidence();
    if (!options?.preserveQueryDepth) {
      setQueryDepth(null);
    }
    if (!options?.preserveSessionSections) {
      setSessionSections([]);
    }
    setSessionQuestion("");
    setSessionQuestion(userMsg);
    addMsg({ role: "user", content: visibleUserMessage });
    setIsProcessing(true);
    clearTaskCheckpoint();

    let memoryContext: MemoryContext | undefined;
    try {
      const [episodes, profile] = await Promise.all([
        EpisodicMemory.search(userMsg, 5, connectionId ?? undefined),
        UserCalibrationProfile.getProfile(),
      ]);
      const workspaceRules = useWorkspaceRuleStore.getState().getApprovedRules(connectionId ?? null);
      const [customerBrief, pendingOutcomes] = await Promise.all([
        BusinessClient.getCustomerBrief().catch(() => []),
        BusinessClient.getPendingOutcomes(5).catch(() => []),
      ]);
      memoryContext = {
        recentEpisodes: episodes,
        priorityParams: profile.parameterPriorities,
        expertiseLevel: profile.expertiseLevel,
        workspaceRules,
        customerBrief,
        pendingOutcomes,
      };
    } catch {
      // Memory failure must not block the agent
    }
    toolsCalledRef.current = [];
    toolOutcomeRef.current = [];

    try {
      const sharedTaskOptions = {
        provider,
        model: activeModel,
        connectionId,
        schema: currentSchema,
        currentSQL,
        currentResults,
        memoryContext,

        onToken: appendToken,

        onToolStart: (toolName: string, input: unknown) => {
          toolsCalledRef.current.push(toolName);
          const entry: ToolLogEntry = {
            id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            toolName,
            input: (input as Record<string, unknown>) ?? {},
          };
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, toolLog: [...(last.toolLog ?? []), entry] }];
            }
            return [...prev, { id: `m-${Date.now()}`, role: "assistant" as MessageRole, content: "", toolLog: [entry] }];
          });
        },

        onToolEnd: (toolName: string, result: CommandResult) => {
          toolOutcomeRef.current.push({
            toolName,
            success: result.success,
          });

          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (msg.role === "assistant" && msg.toolLog) {
                let logIdx = -1;
                for (let j = msg.toolLog.length - 1; j >= 0; j--) {
                  if (msg.toolLog[j].toolName === toolName && !msg.toolLog[j].result) {
                    logIdx = j;
                    break;
                  }
                }
                if (logIdx >= 0) {
                  const updatedLog = [...msg.toolLog];
                  updatedLog[logIdx] = {
                    ...updatedLog[logIdx],
                    result: {
                      success: result.success,
                      summary: result.success
                        ? JSON.stringify(result.result ?? "done").slice(0, 100)
                        : (result.error ?? "unknown error"),
                      data: result.result,
                    },
                  };
                  return [...prev.slice(0, i), { ...msg, toolLog: updatedLog }, ...prev.slice(i + 1)];
                }
              }
            }
            return prev;
          });

          // Track stat tool results for report session
          if (toolName.startsWith("stat__") && result.success) {
            const rawResult = result.result;
            setSessionSections((prev) => [
              ...prev,
              {
                toolName,
                chartId: `chart-${toolName}-${Date.now()}`,
                findings:
                  typeof rawResult === "string"
                    ? rawResult
                    : JSON.stringify(rawResult).slice(0, 300),
                timestamp: Date.now(),
              },
            ]);
          }
        },

        onPlanQueued: (_stepId: string, description: string) => {
          addMsg({ role: "plan_queued", content: description });
        },
      };
      const { finalText, updatedHistory, queryDepth: resultDepth } = options?.resumeCheckpoint
        ? await resumeTaskEngine(options.resumeCheckpoint, historyRef.current, sharedTaskOptions)
        : await startTaskEngine(userMsg, historyRef.current, sharedTaskOptions);

      finalizeStream();
      setQueryDepth(resultDepth ?? null);
      historyRef.current = updatedHistory;
      setConversationTurns(updatedHistory);

      if (
        requiresLiveExecution(userMsg) &&
        attemptedQueryMaterialization(toolOutcomeRef.current) &&
        !hasSuccessfulResultTool(toolOutcomeRef.current)
      ) {
        const state = useWorkspaceStore.getState();
        const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
        const fallbackConnectionId =
          activeTab?.connectionId ?? state.activeConnectionId ?? connectionId;
        const fallbackSql = getAutoExecutableSql(activeTab?.sql ?? null);

        if (fallbackConnectionId && fallbackSql) {
          addMsg({
            role: "assistant",
            content:
              "The agent generated the SQL but the live execution path did not complete. Running the safe read query automatically now.",
          });

          const fallbackResult = await commandBus.dispatch({
            type: "execute_sql",
            sql: fallbackSql,
            connectionId: fallbackConnectionId,
            risk: "safe",
          });

          toolOutcomeRef.current.push({
            toolName: "execute_sql",
            success: fallbackResult.success,
          });

          if (fallbackResult.success) {
            const rowCount =
              typeof fallbackResult.result === "object" &&
              fallbackResult.result !== null &&
              "rowCount" in fallbackResult.result
                ? Number((fallbackResult.result as { rowCount?: number }).rowCount ?? 0)
                : null;

            addMsg({
              role: "assistant",
              content:
                rowCount != null
                  ? `Live execution completed automatically. Loaded **${rowCount}** row${rowCount === 1 ? "" : "s"} into the results pane.`
                  : "Live execution completed automatically and the results pane is now populated.",
            });
          } else {
            addMsg({
              role: "error",
              content: `The agent generated SQL, but live execution still failed: ${fallbackResult.error ?? "Unknown execution error"}`,
            });
          }
        } else {
          addMsg({
            role: "error",
            content:
              "The agent generated SQL but did not complete live execution, and no safe runnable query/connection context was available for automatic fallback.",
          });
        }
      }

      try {
        await EpisodicMemory.store({
          sessionId: `session-${Date.now()}`,
          connectionId: connectionId ?? undefined,
          problem: userMsg,
          toolsUsed: toolsCalledRef.current,
          findings: { summary: finalText?.slice(0, 300) ?? "" },
          outcome: finalText?.slice(0, 300) ?? "",
        });
      } catch {
      }
    } catch (e: unknown) {
      finalizeStream();
      const rawMsg: string = e instanceof Error ? e.message : String(e);
      const provider = providerSettings.activeProvider;
      let hint = rawMsg;
      if (rawMsg === "Connection error." || rawMsg.includes("fetch")) {
        if (provider === "ollama") {
          hint = "Cannot reach Ollama at http://127.0.0.1:11434 — is Ollama running? Run: ollama serve";
        } else {
          hint = `Cannot reach ${provider} API — check your internet connection and API key in Configure Provider`;
        }
      }
      addMsg({ role: "error", content: `Agent error: ${hint}` });
    } finally {
      setIsProcessing(false);
    }
  }, [
    activeModel,
    appendToken,
    artifacts,
    clearConfidence,
    clearHypotheses,
    clearTaskCheckpoint,
    connectionId,
    currentResults,
    currentSQL,
    currentSchema,
    finalizeStream,
    isProcessing,
    providerSettings,
    setSessionSections,
    setSessionQuestion,
    setSettingsOpen,
    setQueryDepth,
    addMsg,
  ]);

  const handleSend = async () => {
    const userMsg = input.trim();
    if (!userMsg || isProcessing) return;
    setInput("");
    await executeAgentRequest(userMsg);
  };

  const handleResumeInterruptedTask = async (checkpoint: TaskCheckpoint) => {
    if (isProcessing) return;
    await executeAgentRequest(checkpoint.task.userGoal, {
      visibleUserMessage: `Resume interrupted task: ${checkpoint.task.userGoal}`,
      preserveSessionSections: true,
      preserveQueryDepth: true,
      resumeCheckpoint: checkpoint,
    });
  };

  const isOllamaActive = providerSettings.activeProvider === "ollama";
  if (!providerKeysHydrated && !isOllamaActive) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-white/30">
        Loading provider settings…
      </div>
    );
  }

  if (!activeKey && !isOllamaActive) {
    return (
      <>
        <NoProviderPrompt onOpen={() => setSettingsOpen(true)} />
        <ProviderSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSave={setProviderSettings}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Hypothesis Panel — shown only when there are active hypotheses */}
        {taskCheckpoint?.lifecycle === "interrupted" && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono uppercase tracking-widest text-[10px] text-amber-300/70">
                  Interrupted Task
                </div>
                <div className="mt-1 truncate text-white/80">{taskCheckpoint.task.userGoal}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-white/45">
                  {taskCheckpoint.task.subtasks[taskCheckpoint.task.currentIndex]?.goal ?? "Awaiting next step"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void handleResumeInterruptedTask(taskCheckpoint)}
                  className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-300/70 hover:text-cyan-200"
                >
                  Resume
                </button>
                <button
                  onClick={abandonTaskCheckpoint}
                  className="rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-white/45 hover:text-white/70"
                >
                  Abandon
                </button>
              </div>
            </div>
          </div>
        )}
        {activeHypotheses && activeHypotheses.length > 0 && <HypothesisPanel />}

        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[90%] px-3 py-2 rounded-lg bg-[#00d2ff] text-black text-sm font-medium">
                  {msg.content}
                </div>
              </div>
            );
          }

          if (msg.role === "assistant") {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[95%] px-3 py-2 rounded-lg bg-white/5 text-white/80 text-sm">
                  {msg.content && (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-4 bg-[#00d2ff] animate-pulse ml-0.5 align-middle" />
                  )}
                  {msg.toolLog && msg.toolLog.length > 0 && (
                    <ToolCallLog entries={msg.toolLog} onApplySQL={onApplySQL} />
                  )}
                </div>
              </div>
            );
          }

          if (msg.role === "error") {
            return (
              <div key={msg.id} className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {msg.content}
              </div>
            );
          }

          if (msg.role === "plan_queued") {
            return <PlanQueuedRow key={msg.id} content={msg.content} />;
          }

          return null;
        })}

        {isProcessing && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-xs text-[#00d2ff]/70 font-mono animate-pulse">
            <Sparkles className="w-3 h-3" />
            <span>Thinking…</span>
          </div>
        )}
      </div>

      {/* Confidence bar — always mounted, renders null when no confidence data */}
      <ConfidenceBar />

      {/* Task progress — shows active multi-step task */}
      <TaskProgressPanel />

      <div className="p-3 border-t border-[#262626] shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            data-ai-input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={connectionId ? "Ask Daitalk AI… (Ctrl+K)" : "Connect a database first…"}
            disabled={isProcessing}
            className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-[#00d2ff] resize-none min-h-[44px] max-h-32 disabled:opacity-50"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || !connectionId}
            className="absolute right-2 bottom-2 p-2 bg-[#00d2ff] text-black rounded-md hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Footer bar: provider badge + mode + settings */}
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold">
              {agentMode === "plan" ? "● Plan" : "● Auto"}
            </span>
            <span className="text-[9px] text-white/15">·</span>
            <span className="text-[9px] text-white/25 font-mono truncate max-w-[140px]">
              {activeMeta.name} / {activeModel.split("/").pop()}
            </span>
            {queryDepth === 'deep' && (
              <>
                <span className="text-[9px] text-white/15">·</span>
                <span className="text-[9px] text-purple-400 font-bold uppercase tracking-widest">● Deep</span>
              </>
            )}
            {queryDepth === 'fast' && (
              <>
                <span className="text-[9px] text-white/15">·</span>
                <span className="text-[9px] text-teal-400 font-bold uppercase tracking-widest">● Fast</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMessages([WELCOME]);
                historyRef.current = [];
                setConversationTurns([]);
                setSessionSections([]);
                setSessionQuestion("");
                setQueryDepth(null);
                clearAiSession();
              }}
              className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
              title="Clear conversation"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
            {undoStack.length > 0 && (
              <span className="text-[9px] text-white/20 font-mono">
                {undoStack.length} undo
              </span>
            )}
            <button
              onClick={() => setToolsPanelOpen(true)}
              className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
            >
              <Wrench className="w-2.5 h-2.5" /> My Tools
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
            >
              <Settings2 className="w-2.5 h-2.5" /> Provider
            </button>
            <button
              onClick={() => setReportPanelOpen(true)}
              title="Export Report"
              className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <ProviderSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={setProviderSettings}
      />
      {toolsPanelOpen && <UserToolsPanel onClose={() => setToolsPanelOpen(false)} />}
      <ReportPanel
        open={reportPanelOpen}
        onOpenChange={setReportPanelOpen}
        session={sessionSections.length > 0 ? {
          userQuestion: sessionQuestion || 'Analysis Session',
          sections: sessionSections,
          connectionName: connections.find((c) => c.id === connectionId)?.display_name ?? connectionId ?? 'Unknown',
          finalText: [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '',
        } : null}
        onSaveArtifact={(spec) => {
          const sourceArtifacts = Object.values(artifacts)
            .filter((artifact) => artifact.kind === "chart" || artifact.kind === "query")
            .slice(-6)
            .map((artifact) => ({
              id: artifact.id,
              revisionId: getLatestArtifactRevisionId(artifactRevisions[artifact.id]),
            }));
          const reportArtifact = createReportArtifact({
            name: spec.title,
            connectionName: spec.connectionName,
            spec,
            sourceArtifacts,
          });
          commitArtifactRevision(reportArtifact);
        }}
      />
    </div>
  );
}
