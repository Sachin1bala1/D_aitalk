import { beforeEach, describe, expect, it, vi } from "vitest";

describe("WorkspaceRuleStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts empty after native hydration", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const { useWorkspaceRuleStore } = await import("./WorkspaceRuleStore");
    await useWorkspaceRuleStore.getState().ensureLoaded();

    expect(useWorkspaceRuleStore.getState().rules).toEqual([]);
    expect(useWorkspaceRuleStore.getState().hydrated).toBe(true);
  });

  it("persists suggestion approval lifecycle", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const { useWorkspaceRuleStore } = await import("./WorkspaceRuleStore");
    await useWorkspaceRuleStore.getState().ensureLoaded();

    const created = useWorkspaceRuleStore.getState().createRule({
      title: "Always include row counts",
      instruction: "When summarizing query results, always state the row count.",
      kind: "reporting",
      scope: "workspace",
      source: "agent",
      status: "suggested",
      evidence: ["User asked for row counts twice."],
    });

    useWorkspaceRuleStore.getState().approveRule(created.id);

    const approved = useWorkspaceRuleStore.getState().getApprovedRules();
    expect(approved).toHaveLength(1);
    expect(approved[0]?.title).toBe("Always include row counts");
    expect(saveSpy).toHaveBeenCalled();
  });

  it("filters connection-scoped approved rules correctly", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const { useWorkspaceRuleStore } = await import("./WorkspaceRuleStore");
    await useWorkspaceRuleStore.getState().ensureLoaded();

    useWorkspaceRuleStore.getState().createRule({
      title: "Warehouse quoting",
      instruction: "Always include created_at in Warehouse trend summaries.",
      kind: "analysis",
      scope: "connection",
      connectionId: "conn-1",
      source: "user",
      status: "approved",
    });
    useWorkspaceRuleStore.getState().createRule({
      title: "Global safety",
      instruction: "Never mutate data without explicit confirmation.",
      kind: "safety",
      scope: "workspace",
      source: "user",
      status: "approved",
    });

    expect(useWorkspaceRuleStore.getState().getApprovedRules("conn-1")).toHaveLength(2);
    expect(useWorkspaceRuleStore.getState().getApprovedRules("conn-2")).toHaveLength(1);
  });
});
