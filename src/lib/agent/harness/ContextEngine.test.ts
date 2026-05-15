import { describe, it, expect } from 'vitest';
import { ContextEngine } from './ContextEngine';
import type { ConversationTurn } from '../../ai/types';

describe('ContextEngine.compactHistory', () => {
  it('keeps all messages when under budget', () => {
    const msgs: ConversationTurn[] = [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi' },
    ];
    const result = ContextEngine.compactHistory(msgs, { historyMax: 100_000 });
    expect(result).toHaveLength(2);
  });

  it('compresses tool result content when over historyMax', () => {
    const longContent = 'x'.repeat(10_000);
    const msgs: ConversationTurn[] = [
      { role: 'user', text: 'q' },
      {
        role: 'user',
        toolResults: [{ toolCallId: '1', name: 'execute_sql', content: longContent, isError: false }],
      },
      { role: 'assistant', text: 'final answer' },
    ];
    const result = ContextEngine.compactHistory(msgs, { historyMax: 500 });
    const toolTurn = result.find(m => m.toolResults);
    expect(toolTurn?.toolResults?.[0].content.length).toBeLessThan(longContent.length);
  });

  it('always keeps the last assistant message', () => {
    const msgs: ConversationTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(200),
    } as ConversationTurn));
    const result = ContextEngine.compactHistory(msgs, { historyMax: 1_000 });
    const lastAssistant = result.filter(m => m.role === 'assistant').at(-1);
    expect(lastAssistant?.text).toBe('x'.repeat(200));
  });
});

describe('ContextEngine.estimateTokens', () => {
  it('returns a positive number', () => {
    const n = ContextEngine.estimateTokens('hello world');
    expect(n).toBeGreaterThan(0);
  });
});
