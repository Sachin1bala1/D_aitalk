import type { ConversationTurn } from "./types";
import type { AnalysisSection } from "../reports/ReportBuilder";

export type AiMessageRole = "user" | "assistant" | "plan_queued" | "error";

export interface PersistedToolLogResult {
  success: boolean;
  summary: string;
  data?: unknown;
}

export interface PersistedToolLogEntry {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: PersistedToolLogResult;
}

export interface PersistedAiChatMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  toolLog?: PersistedToolLogEntry[];
}

export interface PersistedAiSessionState {
  messages: PersistedAiChatMessage[];
  conversationTurns: ConversationTurn[];
  sessionSections: AnalysisSection[];
  sessionQuestion: string;
  queryDepth: "fast" | "deep" | null;
}
