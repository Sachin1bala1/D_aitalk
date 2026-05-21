import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pyodide", () => ({
  loadPyodide: vi.fn(),
}));

function makeMockPyodide(jsResult: unknown = { n: 5 }) {
  return {
    loadPackage: vi.fn().mockResolvedValue(undefined),
    globals: { set: vi.fn() },
    runPython: vi.fn(),
    runPythonAsync: vi.fn().mockResolvedValue({
      toJs: vi.fn().mockReturnValue(jsResult),
    }),
    toPy: vi.fn((v: unknown) => v),
  };
}

describe("PyodideRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("status starts as idle", async () => {
    const { PyodideRuntime } = await import("./PyodideRuntime.js");
    const runtime = PyodideRuntime.getInstance();
    expect(runtime.getStatus()).toBe("idle");
  });

  it("run() returns JS-converted result and status becomes ready", async () => {
    const { loadPyodide } = await import("pyodide");
    const mockPy = makeMockPyodide({ mean: 42.0 });
    (loadPyodide as ReturnType<typeof vi.fn>).mockResolvedValue(mockPy);

    const { PyodideRuntime, PYODIDE_INDEX_URL, PYODIDE_PACKAGES } = await import("./PyodideRuntime.js");
    const runtime = PyodideRuntime.getInstance();
    const result = await runtime.run("result\nresult", {});

    expect(result).toEqual({ mean: 42.0 });
    expect(runtime.getStatus()).toBe("ready");
    expect(loadPyodide).toHaveBeenCalledWith({ indexURL: PYODIDE_INDEX_URL });
    expect(mockPy.loadPackage).toHaveBeenCalledWith([...PYODIDE_PACKAGES]);
  });

  it("singleton: loadPyodide called only once across multiple run() calls", async () => {
    const { loadPyodide } = await import("pyodide");
    const mockPy = makeMockPyodide({});
    (loadPyodide as ReturnType<typeof vi.fn>).mockResolvedValue(mockPy);

    const { PyodideRuntime } = await import("./PyodideRuntime.js");
    const runtime = PyodideRuntime.getInstance();
    await runtime.run("1", {});
    await runtime.run("2", {});

    expect(loadPyodide).toHaveBeenCalledTimes(1);
  });

  it("injects globals before executing code", async () => {
    const { loadPyodide } = await import("pyodide");
    const mockPy = makeMockPyodide({});
    (loadPyodide as ReturnType<typeof vi.fn>).mockResolvedValue(mockPy);

    const { PyodideRuntime } = await import("./PyodideRuntime.js");
    const runtime = PyodideRuntime.getInstance();
    await runtime.run("result\nresult", { data: [1, 2, 3], threshold: 3.0 });

    expect(mockPy.globals.set).toHaveBeenCalledWith("data", [1, 2, 3]);
    expect(mockPy.globals.set).toHaveBeenCalledWith("threshold", 3.0);
  });

  it("status becomes error and re-throws when loadPyodide fails", async () => {
    const { loadPyodide } = await import("pyodide");
    (loadPyodide as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("WASM load failed"));

    const { PyodideRuntime } = await import("./PyodideRuntime.js");
    const runtime = PyodideRuntime.getInstance();

    await expect(runtime.run("1", {})).rejects.toThrow("WASM load failed");
    expect(runtime.getStatus()).toBe("error");
  });
});
