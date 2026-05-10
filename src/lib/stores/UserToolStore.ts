import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UserTool } from "../tools/user.tools";

export interface UserToolState {
  tools: UserTool[];
  addTool: (tool: UserTool) => void;
  updateTool: (id: string, updates: Partial<Omit<UserTool, "id">>) => void;
  deleteTool: (id: string) => void;
}

export const useUserToolStore = create<UserToolState>()(
  persist(
    immer((set) => ({
      tools: [],

      addTool: (tool) =>
        set((state) => {
          state.tools.push(tool);
        }),

      updateTool: (id, updates) =>
        set((state) => {
          const idx = state.tools.findIndex((t) => t.id === id);
          if (idx >= 0) Object.assign(state.tools[idx], updates);
        }),

      deleteTool: (id) =>
        set((state) => {
          state.tools = state.tools.filter((t) => t.id !== id);
        }),
    })),
    { name: "daitalk_user_tools" }
  )
);
