import { loadPyodide } from "pyodide";
import type { PyodideInterface } from "pyodide";

export type PyodideStatus = "idle" | "loading" | "ready" | "error";

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_PACKAGES = ["numpy", "scipy", "scikit-learn", "statsmodels"] as const;

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

  private async load(): Promise<PyodideInterface> {
    if (this.pyodide) return this.pyodide;
    if (this.loadingPromise) return this.loadingPromise;

    this._status = "loading";
    this.loadingPromise = loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
    })
      .then(async (py) => {
        await py.loadPackage([...PYODIDE_PACKAGES]);
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

  async run(code: string, globals: Record<string, unknown> = {}): Promise<unknown> {
    const py = await this.load();
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

export { PYODIDE_INDEX_URL, PYODIDE_PACKAGES, PYODIDE_VERSION };
