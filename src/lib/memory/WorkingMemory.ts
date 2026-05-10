// src/lib/memory/WorkingMemory.ts
// Session-scoped working memory — not persisted, lives in WorkspaceStore.

export interface WorkingMemoryState {
  activeQuestion: string | null;
  toolsTriedThisSession: string[];
  findingsSoFar: string[];
  userPreferencesStated: string[];
  sessionStartTime: number;
}

export const DEFAULT_WORKING_MEMORY: WorkingMemoryState = {
  activeQuestion: null,
  toolsTriedThisSession: [],
  findingsSoFar: [],
  userPreferencesStated: [],
  sessionStartTime: Date.now(),
};

const sessions = new Map<string, WorkingMemoryState>();

function getSession(sessionId: string): WorkingMemoryState {
  let existing = sessions.get(sessionId);
  if (!existing) {
    existing = { ...DEFAULT_WORKING_MEMORY, sessionStartTime: Date.now() };
    sessions.set(sessionId, existing);
  }
  return existing;
}

export const WorkingMemory = {
  async setActiveQuestion(sessionId: string, question: string | null): Promise<void> {
    getSession(sessionId).activeQuestion = question;
  },

  recordToolUsed(sessionId: string, toolName: string): void {
    getSession(sessionId).toolsTriedThisSession.push(toolName);
  },

  recordFinding(sessionId: string, finding: string): void {
    getSession(sessionId).findingsSoFar.push(finding);
  },

  recordPreference(sessionId: string, preference: string): void {
    getSession(sessionId).userPreferencesStated.push(preference);
  },

  get(sessionId: string): WorkingMemoryState {
    return { ...getSession(sessionId) };
  },

  clear(sessionId: string): void {
    sessions.delete(sessionId);
  },
};
