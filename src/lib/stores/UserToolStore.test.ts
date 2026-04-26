import { describe, it, expect, beforeEach } from "vitest";
import { useUserToolStore } from "./UserToolStore";
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

beforeEach(() => {
  localStorage.removeItem("daitalk_user_tools");
  useUserToolStore.setState({ tools: [] });
});

describe("UserToolStore", () => {
  it("starts with an empty tools array", () => {
    expect(useUserToolStore.getState().tools).toEqual([]);
  });

  it("addTool appends a new tool", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0].id).toBe("tool_a");
  });

  it("addTool preserves existing tools", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().addTool(TOOL_B);
    expect(useUserToolStore.getState().tools).toHaveLength(2);
  });

  it("updateTool updates matching tool by id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("tool_a", { displayName: "Updated A" });
    expect(useUserToolStore.getState().tools[0].displayName).toBe("Updated A");
  });

  it("updateTool does not change other fields", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("tool_a", { displayName: "Updated A" });
    expect(useUserToolStore.getState().tools[0].category).toBe("analysis");
  });

  it("updateTool is a no-op for unknown id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("nonexistent", { displayName: "X" });
    expect(useUserToolStore.getState().tools[0].displayName).toBe("Tool A");
  });

  it("deleteTool removes the matching tool", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().addTool(TOOL_B);
    useUserToolStore.getState().deleteTool("tool_a");
    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0].id).toBe("tool_b");
  });

  it("deleteTool is a no-op for unknown id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().deleteTool("nonexistent");
    expect(useUserToolStore.getState().tools).toHaveLength(1);
  });
});
