import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { UserTool } from "../tools/user.tools";
import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

interface UserToolDocument {
  version: 1;
  tools: UserTool[];
}

export interface UserToolState {
  tools: UserTool[];
  hydrated: boolean;
  ensureLoaded: () => Promise<void>;
  addTool: (tool: UserTool) => void;
  updateTool: (id: string, updates: Partial<Omit<UserTool, "id">>) => void;
  deleteTool: (id: string) => void;
}

const DOC_KEY = "user_tools";
const LEGACY_KEY = "daitalk_user_tools";

const DEFAULT_DOC: UserToolDocument = {
  version: 1,
  tools: [],
};

let loadPromise: Promise<void> | null = null;

function loadLegacyTools(): UserTool[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserTool[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistTools(tools: UserTool[]): Promise<void> {
  const payload: UserToolDocument = { version: 1, tools };
  try {
    await saveJsonDocument(DOC_KEY, payload);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    notifyNativePersistenceFallback("User tools");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(tools));
  }
}

export const useUserToolStore = create<UserToolState>()(
  immer((set, get) => ({
    tools: [],
    hydrated: false,

    ensureLoaded: async () => {
      if (get().hydrated) return;
      if (loadPromise) return loadPromise;

      loadPromise = (async () => {
        const fallback: UserToolDocument = {
          version: 1,
          tools: loadLegacyTools(),
        };
        const doc = await loadJsonDocument<UserToolDocument>(DOC_KEY, fallback);
        const tools = Array.isArray(doc.tools) ? doc.tools : DEFAULT_DOC.tools;
        set((state) => {
          state.tools = tools;
          state.hydrated = true;
        });
        if (doc === fallback) {
          await persistTools(tools);
        }
      })().finally(() => {
        loadPromise = null;
      });

      return loadPromise;
    },

    addTool: (tool) => {
      const nextTools = [...get().tools, tool];
      set((state) => {
        state.tools = nextTools;
      });
      void persistTools(nextTools);
    },

    updateTool: (id, updates) => {
      const idx = get().tools.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const nextTools = get().tools.map((tool) =>
        tool.id === id ? { ...tool, ...updates } : tool,
      );
      set((state) => {
        state.tools = nextTools;
      });
      void persistTools(nextTools);
    },

    deleteTool: (id) => {
      const nextTools = get().tools.filter((t) => t.id !== id);
      if (nextTools.length === get().tools.length) return;
      set((state) => {
        state.tools = nextTools;
      });
      void persistTools(nextTools);
    },
  })),
);

void useUserToolStore.getState().ensureLoaded();
