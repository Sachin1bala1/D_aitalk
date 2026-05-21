import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "./UpdateService";

const getVersion = vi.fn();

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => getVersion(...args),
}));

describe("UpdateService", () => {
  beforeEach(() => {
    getVersion.mockReset();
    getVersion.mockResolvedValue("0.1.0");
  });

  it("reports unavailable outside a Tauri desktop runtime", async () => {
    const original = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const result = await checkForUpdates();

    expect(result.kind).toBe("unavailable");

    if (original) {
      (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = original;
    }
  });
});
