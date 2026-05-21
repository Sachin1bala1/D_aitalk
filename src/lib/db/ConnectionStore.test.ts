import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DbClient } from "./DbClient";
import { loadConnectionWithPassword } from "./ConnectionStore";

describe("ConnectionStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates a saved connection string with the keychain password", async () => {
    vi.spyOn(DbClient, "loadConnections").mockResolvedValue([
      {
        id: "conn-1",
        display_name: "Saved Postgres",
        driver: "postgres",
        connection_string: "postgresql://postgres@db.example.com:5432/app",
      },
    ]);

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_credential") return "supersecret";
      return null;
    });

    const config = await loadConnectionWithPassword("conn-1");

    expect(config?.connection_string).toBe(
      "postgresql://postgres:supersecret@db.example.com:5432/app",
    );
  });
});
