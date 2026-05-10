declare module "pyodide" {
  export interface PyodideInterface {
    loadPackage(packages: string | string[]): Promise<void>;
    loadPackagesFromImports(code: string): Promise<void>;
    runPythonAsync<T = unknown>(code: string): Promise<T>;
    runPython<T = unknown>(code: string): T;
    toPy<T = unknown>(value: unknown): T;
    globals: {
      set(name: string, value: unknown): void;
      get(name: string): unknown;
    };
  }

  export interface LoadPyodideOptions {
    indexURL?: string;
  }

  export function loadPyodide(options?: LoadPyodideOptions): Promise<PyodideInterface>;
}
