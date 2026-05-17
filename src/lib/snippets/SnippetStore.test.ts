import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SnippetStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("migrates legacy localStorage snippets into native persistence", async () => {
    const legacySnippets = [
      {
        id: "snip-1",
        name: "Count rows",
        sql: "SELECT COUNT(*) FROM orders",
        tags: ["orders"],
        createdAt: 1,
      },
    ];
    localStorage.setItem("daitalk_snippets", JSON.stringify(legacySnippets));

    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const snippetModule = await import("./SnippetStore");
    const snippets = await snippetModule.ensureSnippetsLoaded();

    expect(snippets).toEqual(legacySnippets);
    expect(saveSpy).toHaveBeenCalledWith("snippets", JSON.stringify(legacySnippets));
    expect(localStorage.getItem("daitalk_snippets")).toBeNull();
  });

  it("persists new snippets to localStorage when native persistence fails", async () => {
    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "saveAppDocument").mockRejectedValue(new Error("native store unavailable"));

    const snippetModule = await import("./SnippetStore");
    snippetModule.addSnippet("Latest Orders", "SELECT * FROM orders", ["orders"]);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const raw = localStorage.getItem("daitalk_snippets");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });
});
