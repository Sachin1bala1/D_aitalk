import { beforeEach, describe, expect, it, vi } from "vitest";

describe("QueryHistory persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("migrates legacy localStorage history into native persistence", async () => {
    const legacyEntries = [
      {
        id: "h-1",
        sql: "SELECT 1",
        rowCount: 1,
        elapsedMs: 5,
        timestamp: 1,
      },
    ];
    localStorage.setItem("daitalk_query_history", JSON.stringify(legacyEntries));

    const { DbClient } = await import("../../lib/db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const historyModule = await import("./QueryHistory");
    const entries = await historyModule.ensureHistoryLoaded();

    expect(entries).toEqual(legacyEntries);
    expect(saveSpy).toHaveBeenCalledWith("query_history", JSON.stringify(legacyEntries));
    expect(localStorage.getItem("daitalk_query_history")).toBeNull();
  });

  it("pushHistory falls back to localStorage if native persistence fails", async () => {
    const { DbClient } = await import("../../lib/db/DbClient");
    vi.spyOn(DbClient, "saveAppDocument").mockRejectedValue(new Error("native store unavailable"));

    const historyModule = await import("./QueryHistory");
    historyModule.pushHistory({
      sql: "SELECT * FROM orders",
      rowCount: 3,
      elapsedMs: 20,
      timestamp: 123,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const raw = localStorage.getItem("daitalk_query_history");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });
});
