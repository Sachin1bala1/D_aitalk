/**
 * AIChat — multi-provider AgentLoop integration.
 *
 * Uses ProviderRegistry to pick Claude / Gemini / OpenAI / NVIDIA NIM.
 * Streams text tokens live, shows inline tool steps, handles Plan Mode queuing.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Settings2, CheckCircle2, AlertTriangle, Loader2, Clock, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { FullSchema } from "../../lib/db/DbClient";
import type { QueryResults } from "../../lib/stores/WorkspaceStore";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import { commandBus } from "../../lib/agent/CommandBus";
import { runAgentLoop } from "../../lib/agent/AgentLoop";
import type { CommandResult } from "../../lib/agent/CommandBus";
import type { ConversationTurn } from "../../lib/ai/types";
import { loadSettings, getActiveKey, getActiveModel, PROVIDER_CATALOG } from "../../lib/ai/types";
import { getProvider } from "../../lib/ai/ProviderRegistry";
import { ProviderSettingsDialog } from "./ProviderSettingsDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "tool_start" | "tool_end" | "plan_queued" | "error";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  streaming?: boolean;
}

interface AIChatProps {
  currentSQL: string | null;
  currentResults: QueryResults | null;
  currentSchema: FullSchema | null;
  connectionId: string | null;
  onApplySQL: (sql: string) => void;
  onQuerySuccess: (results: QueryResults, sql: string) => void;
}

// ── Tool step rows ────────────────────────────────────────────────────────────

function ToolStep({ msg }: { msg: ChatMessage }) {
  if (msg.role === "tool_start") {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40 font-mono py-0.5 pl-2">
        <Loader2 className="w-3 h-3 animate-spin text-[#00d2ff]" />
        <span className="text-[#00d2ff]/70">{msg.toolName}</span>
      </div>
    );
  }
  if (msg.role === "tool_end") {
    const ok = msg.content.startsWith("ok:");
    return (
      <div className={`flex items-center gap-2 text-xs font-mono py-0.5 pl-2 ${ok ? "text-emerald-400/60" : "text-red-400/60"}`}>
        {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        <span className="truncate">{msg.content.slice(3)}</span>
      </div>
    );
  }
  if (msg.role === "plan_queued") {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-400/70 font-mono py-0.5 pl-2">
        <Clock className="w-3 h-3" />
        <span className="truncate">Queued: {msg.content}</span>
      </div>
    );
  }
  return null;
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
    "Hello! I'm Daitalk AI. Connect a database and ask me anything — I can write SQL, execute queries, analyze results, and modify your schema.",
};

function loadMessages(): ChatMessage[] {
  return [WELCOME];
}

function loadTurns(): ConversationTurn[] {
  return [];
}

export function AIChat({ currentSQL, currentResults, currentSchema, connectionId }: AIChatProps) {
  const { agentMode, undoStack } = useWorkspaceStore();

  const [providerSettings, setProviderSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ConversationTurn[]>(loadTurns());
  const lastSendAtRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);


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

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;
    const now = Date.now();
    if (now - lastSendAtRef.current < 1500) {
      addMsg({
        role: "error",
        content: "Please wait a moment before sending another request.",
      });
      return;
    }
    lastSendAtRef.current = now;

    const provider = getProvider(providerSettings);
    if (!provider) {
      setSettingsOpen(true);
      return;
    }

    const userMsg = input.trim();
    setInput("");
    addMsg({ role: "user", content: userMsg });
    setIsProcessing(true);

    try {
      const { updatedHistory } = await runAgentLoop(userMsg, historyRef.current, {
        provider,
        model: activeModel,
        connectionId,
        schema: currentSchema,
        currentSQL,
        currentResults,

        onToken: appendToken,

        onToolStart: (toolName) => {
          addMsg({ role: "tool_start", content: toolName, toolName });
        },

        onToolEnd: (toolName, result: CommandResult) => {
          const body = result.success
            ? `ok:${toolName} → ${JSON.stringify(result.result ?? "done").slice(0, 100)}`
            : `err:${toolName}: ${result.error}`;
          addMsg({ role: "tool_end", content: body, toolName });
        },

        onPlanQueued: (_stepId, description) => {
          addMsg({ role: "plan_queued", content: description });
        },
      });

      finalizeStream();
      historyRef.current = updatedHistory;
    } catch (e: any) {
      finalizeStream();
      addMsg({ role: "error", content: `Agent error: ${e?.message ?? String(e)}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const isOllamaActive = providerSettings.activeProvider === "ollama";
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
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-4 bg-[#00d2ff] animate-pulse ml-0.5 align-middle" />
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

          return <ToolStep key={msg.id} msg={msg} />;
        })}

        {isProcessing && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-xs text-[#00d2ff]/70 font-mono animate-pulse">
            <Sparkles className="w-3 h-3" />
            <span>Thinking…</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[#262626] shrink-0">
        <div className="relative">
          <textarea
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
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMessages([WELCOME]);
                historyRef.current = [];
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
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
            >
              <Settings2 className="w-2.5 h-2.5" /> Provider
            </button>
          </div>
        </div>
      </div>

      <ProviderSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={setProviderSettings}
      />
    </div>
  );
}
