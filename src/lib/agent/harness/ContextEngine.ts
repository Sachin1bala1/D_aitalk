// src/lib/agent/harness/ContextEngine.ts
import type { ConversationTurn } from '../../ai/types';
import { HarnessObserver } from './HarnessObserver';

export interface ContextBudget {
  historyMax: number;
}

export const DEFAULT_BUDGET: ContextBudget = {
  historyMax: 30_000,
};

export class ContextEngine {
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  static compactHistory(
    messages: ConversationTurn[],
    budget: ContextBudget = DEFAULT_BUDGET
  ): ConversationTurn[] {
    const estimateTurn = (m: ConversationTurn): number => {
      let chars = 0;
      if (m.text) chars += m.text.length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
      if (m.toolResults) chars += m.toolResults.reduce((s, r) => s + r.content.length, 0);
      return Math.ceil(chars / 4);
    };

    const assistantIndices = messages
      .map((m, i) => (m.role === 'assistant' ? i : -1))
      .filter(i => i >= 0);
    const keepAssistantIndices = new Set(assistantIndices.slice(-6));

    let totalTokens = 0;
    const result: ConversationTurn[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const est = estimateTurn(m);

      if (totalTokens + est <= budget.historyMax || keepAssistantIndices.has(i)) {
        result.unshift(m);
        totalTokens += est;
      } else {
        if (m.toolResults) {
          const compressed: ConversationTurn = {
            ...m,
            toolResults: m.toolResults.map(r => ({
              ...r,
              content: r.content.length > 120
                ? `[Compacted: ${r.content.slice(0, 120)}… (${r.content.length} chars total)]`
                : r.content,
            })),
          };
          result.unshift(compressed);
          totalTokens += Math.ceil(120 / 4) * (m.toolResults.length || 1);
        } else if (m.role === 'assistant' && m.text && m.text.length > 200) {
          result.unshift({
            ...m,
            text: m.text.slice(0, 200) + '… [compacted]',
          });
          totalTokens += Math.ceil(200 / 4);
        } else if (m.role === 'user' && m.text) {
          result.unshift(m);
          totalTokens += est;
        }
      }
    }

    return result;
  }

  static estimateContextUsage(
    systemPrompt: string,
    messages: ConversationTurn[]
  ): { system: number; history: number; total: number } {
    const system = Math.ceil(systemPrompt.length / 4);
    const history = messages.reduce((s, m) => {
      let chars = 0;
      if (m.text) chars += m.text.length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
      if (m.toolResults) chars += m.toolResults.reduce((a, r) => a + r.content.length, 0);
      return s + Math.ceil(chars / 4);
    }, 0);
    return { system, history, total: system + history };
  }

  static trackContextBuild(sessionId: string, systemPrompt: string, messages: ConversationTurn[]): void {
    const usage = this.estimateContextUsage(systemPrompt, messages);
    HarnessObserver.recordContextBuild(sessionId, usage);
  }
}
