/**
 * ContextEngine — Staged Context Management for Agent Loop
 *
 * Based on TerminalBench-2 staged context pattern:
 * Phase 0: Compact conversation history before each model invocation
 * Phase 1: Build dynamic system prompt with only relevant context
 * Phase 2: Estimate token usage across all components
 *
 * Purpose: Maximize model context efficiency and improve response quality by
 * ensuring only pertinent context is included in each invocation.
 */

import type { ConversationTurn } from "../../ai/types";
import { HarnessObserver } from "./HarnessObserver";

export interface ContextBudget {
  totalTokens: number;
  systemReserved: number;
  toolResultsMax: number;
  historyMax: number;
  memoryMax: number;
}

export interface MemoryContext {
  recentEpisodes: Array<{
    problem: string;
    findings: string;
    similarity: number;
  }>;
  priorityParams: string[];
}

export interface SchemaContext {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

export interface TokenUsage {
  system: number;
  history: number;
  total: number;
}

/**
 * Returns only the schema sections whose table names appear as keywords
 * in the user message. Falls back to all tables if fewer than 3 match.
 */
export function filterSchemaToRelevant(
  schema: Record<string, unknown>,
  userMessage: string,
): Record<string, unknown> {
  const lower = userMessage.toLowerCase();
  const allKeys = Object.keys(schema);
  const relevant = allKeys.filter((k) => lower.includes(k.toLowerCase()));
  // Always include at least 3 tables so the agent has context
  if (relevant.length < 3) return schema;
  return Object.fromEntries(relevant.map((k) => [k, schema[k]]));
}

function extractMentionedTables(
  question: string,
  schema: SchemaContext
): SchemaContext["tables"] {
  const questionLower = question.toLowerCase();
  return schema.tables.filter(table => {
    const tableName = table.name.toLowerCase();
    if (questionLower.includes(tableName)) return true;
    return table.columns.some(col =>
      questionLower.includes(col.name.toLowerCase())
    );
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: ConversationTurn): number {
  const content = typeof msg.text === "string"
    ? msg.text
    : JSON.stringify(msg);
  return estimateTokens(content);
}

export class ContextEngine {
  static readonly DEFAULT_BUDGET: ContextBudget = {
    totalTokens: 180_000,
    systemReserved: 8_000,
    toolResultsMax: 40_000,
    historyMax: 30_000,
    memoryMax: 8_000,
  };

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * PHASE 0: Compact the conversation history before each model call.
   * Always keeps all user messages + last 6 assistant messages.
   * Compresses old tool results to placeholders when over budget.
   */
  static compactHistory(
    messages: ConversationTurn[],
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): ConversationTurn[] {
    let totalTokens = 0;
    const kept: ConversationTurn[] = [];
    const reversed = [...messages].reverse();
    let assistantCount = 0;

    for (const msg of reversed) {
      const est = estimateMessageTokens(msg);

      if (msg.role === "user" && !msg.toolResults) {
        totalTokens += est;
        kept.unshift(msg);
        continue;
      }

      if (msg.role === "assistant") {
        assistantCount++;
        if (assistantCount <= 6) {
          totalTokens += est;
          kept.unshift(msg);
          continue;
        }
      }

      if (msg.toolResults && totalTokens + est > budget.historyMax) {
        const toolNames = msg.toolResults
          .map(tr => tr.name)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ");
        const rowCount = msg.toolResults
          .filter(tr => !tr.isError)
          .reduce((sum, tr) => {
            try {
              const parsed = JSON.parse(tr.content);
              return sum + (Array.isArray(parsed) ? parsed.length : 1);
            } catch {
              return sum;
            }
          }, 0);

        const compressed: ConversationTurn = {
          role: "user",
          toolResults: [{
            toolCallId: "compacted",
            name: toolNames,
            content: `[Compacted tool results from: ${toolNames} (${rowCount} rows total) — see memory for details]`,
            isError: false,
          }],
        };

        const compressedTokens = estimateMessageTokens(compressed);
        if (totalTokens + compressedTokens <= budget.historyMax) {
          totalTokens += compressedTokens;
          kept.unshift(compressed);
        }
        continue;
      }

      if (totalTokens + est <= budget.historyMax) {
        totalTokens += est;
        kept.unshift(msg);
      }
    }

    return kept;
  }

  /**
   * PHASE 1: Build dynamic system prompt — filters schema and memory to only
   * what's relevant for the current question.
   */
  static buildDynamicSystemPrompt(
    basePrompt: string,
    memoryContext: MemoryContext,
    schema: SchemaContext,
    userQuestion: string,
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): string {
    void budget;
    const parts: string[] = [basePrompt];

    const relevantTables = extractMentionedTables(userQuestion, schema);
    if (relevantTables.length > 0 && relevantTables.length < schema.tables.length) {
      const schemaText = relevantTables
        .map(t => {
          const cols = t.columns.map(c => `${c.name} (${c.type})`).join(", ");
          return `Table: ${t.name}\nColumns: ${cols}`;
        })
        .join("\n\n");
      parts.push(`## Relevant Schema for This Question\n${schemaText}`);
    }

    if (memoryContext.recentEpisodes.length > 0) {
      const relevant = memoryContext.recentEpisodes
        .filter(e => e.similarity > 0.7)
        .slice(0, 3);
      if (relevant.length > 0) {
        const episodeText = relevant
          .map(e => `- **${e.problem}**: ${e.findings}`)
          .join("\n");
        parts.push(`## Relevant Past Analyses\n${episodeText}`);
      }
    }

    if (memoryContext.priorityParams.length > 0) {
      const params = memoryContext.priorityParams.slice(0, 8).join(", ");
      parts.push(`## User Priority Parameters\n${params}`);
    }

    let systemPrompt = parts.join("\n\n");

    // If estimated prompt exceeds 80k tokens (~320k chars), compact schema to table names only
    const PROMPT_CHAR_BUDGET = 320_000;
    if (systemPrompt.length > PROMPT_CHAR_BUDGET) {
      const filteredSchema = filterSchemaToRelevant(
        Object.fromEntries(schema.tables.map((t) => [t.name, t])),
        userQuestion,
      );
      const schemaStr = JSON.stringify(
        Object.fromEntries(schema.tables.map((t) => [t.name, t])),
        null,
        2,
      );
      const tableNamesOnly = Object.fromEntries(
        Object.keys(filteredSchema).map((k) => [k, "(schema omitted — prompt too large)"])
      );
      systemPrompt = systemPrompt.replace(schemaStr, JSON.stringify(tableNamesOnly, null, 2));
    }

    return systemPrompt;
  }

  /**
   * PHASE 2: Estimate total token usage of a full context build.
   */
  static estimateTokenUsage(
    systemPrompt: string,
    messages: ConversationTurn[]
  ): TokenUsage {
    const systemTokens = estimateTokens(systemPrompt);
    const historyTokens = messages.reduce(
      (sum, msg) => sum + estimateMessageTokens(msg),
      0
    );
    return {
      system: systemTokens,
      history: historyTokens,
      total: systemTokens + historyTokens,
    };
  }

  /**
   * Track a context build event in HarnessObserver for telemetry.
   * Called by AgentLoop before each model invocation.
   */
  static trackContextBuild(
    sessionId: string,
    systemPrompt: string,
    messages: ConversationTurn[]
  ): void {
    const usage = this.estimateTokenUsage(systemPrompt, messages);
    HarnessObserver.recordContextBuild(sessionId, usage);
  }

  static getUsageIndicator(
    tokens: number,
    budget: ContextBudget = this.DEFAULT_BUDGET
  ): { color: "green" | "amber" | "red"; percentage: number } {
    const percentage = (tokens / budget.totalTokens) * 100;
    if (percentage < 50) return { color: "green", percentage };
    if (percentage < 80) return { color: "amber", percentage };
    return { color: "red", percentage };
  }
}
