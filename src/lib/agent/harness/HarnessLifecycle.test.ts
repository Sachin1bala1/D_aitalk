import { describe, it, expect } from 'vitest';
import { detectStruggle } from './HarnessLifecycle';
import type { SessionContext } from './HarnessLifecycle';

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'test-session',
    connectionId: 'conn-1',
    question: 'test question',
    toolsCalledSoFar: [],
    errorsSoFar: [],
    startTime: Date.now(),
    iterationCount: 0,
    policyContext: {
      sessionId: 'test-session',
      connectionId: 'conn-1',
      question: 'test question',
      isReadOnly: false,
      connectionType: 'postgresql',
      piiColumns: [],
    },
    ...overrides,
  };
}

describe('detectStruggle', () => {
  it('returns null when no patterns detected', () => {
    expect(detectStruggle(makeCtx())).toBeNull();
  });

  it('detects same_tool_called_3x', () => {
    const ctx = makeCtx({
      toolsCalledSoFar: ['execute_sql', 'execute_sql', 'execute_sql'],
    });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('same_tool_called_3x');
    expect(result?.details).toBe('execute_sql');
  });

  it('detects repeated_tool_errors after 2 errors', () => {
    const ctx = makeCtx({
      errorsSoFar: [
        { tool: 'execute_sql', error: 'bad sql' },
        { tool: 'execute_sql', error: 'still bad' },
      ],
    });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('repeated_tool_errors');
  });

  it('detects no_progress_5_iters at iteration 5', () => {
    const ctx = makeCtx({ iterationCount: 5 });
    const result = detectStruggle(ctx);
    expect(result?.type).toBe('no_progress_5_iters');
  });

  it('same_tool_called_3x takes priority over iteration count', () => {
    const ctx = makeCtx({
      toolsCalledSoFar: ['execute_sql', 'execute_sql', 'execute_sql'],
      iterationCount: 5,
    });
    expect(detectStruggle(ctx)?.type).toBe('same_tool_called_3x');
  });
});
