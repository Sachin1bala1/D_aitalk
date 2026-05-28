import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./resilience";

describe("withRetry abort", () => {
  it("aborts during retry delay when signal fires", async () => {
    const controller = new AbortController();
    let calls = 0;

    const fn = vi.fn(async () => {
      calls++;
      throw new Error("503 server error");
    });

    // Abort after first failure — before the 2s delay finishes
    setTimeout(() => controller.abort(), 10);

    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 2_000,
        signal: controller.signal,
      })
    ).rejects.toThrow("Aborted");

    // Should have called fn exactly once — abort fired during delay
    expect(calls).toBe(1);
  });

  it("does not abort when signal is not fired", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("503 server error");
      return "ok";
    });

    const result = await withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 1,
    });

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });
});
