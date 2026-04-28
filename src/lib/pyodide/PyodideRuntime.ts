import { loadPyodide } from "pyodide";
import type { PyodideInterface } from "pyodide";

export type PyodideStatus = "idle" | "loading" | "ready" | "error";

export class PyodideRuntime {
  private static _instance: PyodideRuntime | null = null;
  private pyodide: PyodideInterface | null = null;
  private loadingPromise: Promise<PyodideInterface> | null = null;
  private _status: PyodideStatus = "idle";

  static getInstance(): PyodideRuntime {
    if (!PyodideRuntime._instance) {
      PyodideRuntime._instance = new PyodideRuntime();
    }
    return PyodideRuntime._instance;
  }

  getStatus(): PyodideStatus {
    return this._status;
  }

  async load(onProgress?: (pkg: string) => void): Promise<PyodideInterface> {
    if (this.pyodide) return this.pyodide;
    if (this.loadingPromise) return this.loadingPromise;

    this._status = "loading";
    this.loadingPromise = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/",
    })
      .then(async (py) => {
        const packages = ["numpy", "scipy", "scikit-learn", "statsmodels", "pandas", "micropip"];
        for (const pkg of packages) {
          onProgress?.(pkg);
          await py.loadPackage([pkg]);
        }
        onProgress?.("pymc-base");
        await py.runPythonAsync(
          "import micropip; await micropip.install(['pymc-base'])"
        );
        this.pyodide = py;
        this._status = "ready";
        return py;
      })
      .catch((err: Error) => {
        this._status = "error";
        this.loadingPromise = null;
        throw err;
      });

    return this.loadingPromise;
  }

  async run(code: string, globals: Record<string, unknown> = {}, onProgress?: (pkg: string) => void): Promise<unknown> {
    const py = await this.load(onProgress);
    const injectedKeys = Object.keys(globals);
    for (const [k, v] of Object.entries(globals)) {
      py.globals.set(k, py.toPy(v));
    }
    try {
      const raw = await py.runPythonAsync(code);
      if (raw !== null && raw !== undefined && typeof (raw as { toJs?: unknown }).toJs === "function") {
        return (raw as { toJs: (opts: unknown) => unknown }).toJs({ dict_converter: Object.fromEntries });
      }
      return raw;
    } finally {
      if (injectedKeys.length > 0) {
        // Remove injected globals so they cannot bleed into subsequent kernel calls
        const cleanup = injectedKeys.map((k) => `globals().pop(${JSON.stringify(k)}, None)`).join("; ");
        py.runPython(cleanup);
      }
    }
  }
}
