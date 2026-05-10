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
