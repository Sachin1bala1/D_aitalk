import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTool } from "../tools/user.tools";

const TOOL_A: UserTool = {
  id: "tool_a",
  displayName: "Tool A",
  description: "Does A",
  category: "analysis",
  parameters: [],
  body: { type: "notify", message: "Hello", level: "info" },
};

const TOOL_B: UserTool = {
  id: "tool_b",
  displayName: "Tool B",
  description: "Does B",
  category: "reports",
  parameters: [],
  body: { type: "sql_template", sql: "SELECT 1" },
};

describe("UserToolStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts empty after native hydration", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const { useUserToolStore } = await import("./UserToolStore");
    await useUserToolStore.getState().ensureLoaded();

    expect(useUserToolStore.getState().tools).toEqual([]);
    expect(useUserToolStore.getState().hydrated).toBe(true);
  });

  it("migrates legacy localStorage tools into native persistence", async () => {
    localStorage.setItem("daitalk_user_tools", JSON.stringify([TOOL_A]));
    const { DbClient } = await import("../db/DbClient");
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);

    const { useUserToolStore } = await import("./UserToolStore");
    await useUserToolStore.getState().ensureLoaded();

    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0]?.id).toBe("tool_a");
    expect(localStorage.getItem("daitalk_user_tools")).toBeNull();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("persists CRUD changes to native storage", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const { useUserToolStore } = await import("./UserToolStore");
    await useUserToolStore.getState().ensureLoaded();

    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().addTool(TOOL_B);
    useUserToolStore.getState().updateTool("tool_a", { displayName: "Updated A" });
    useUserToolStore.getState().deleteTool("tool_b");

    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0]?.displayName).toBe("Updated A");
    expect(saveSpy).toHaveBeenCalled();
  });

  it("falls back to localStorage persistence if native persistence fails", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockRejectedValue(new Error("native unavailable"));

    const { useUserToolStore } = await import("./UserToolStore");
    await useUserToolStore.getState().ensureLoaded();

    useUserToolStore.getState().addTool(TOOL_A);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const raw = localStorage.getItem("daitalk_user_tools");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")[0]?.id).toBe("tool_a");
  });
});
