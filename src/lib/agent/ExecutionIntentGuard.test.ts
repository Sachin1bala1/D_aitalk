import { describe, expect, it } from "vitest";
import {
  attemptedQueryMaterialization,
  getAutoExecutableSql,
  hasSuccessfulResultTool,
  requiresLiveExecution,
} from "./ExecutionIntentGuard";

describe("ExecutionIntentGuard", () => {
  it("detects prompts that require live execution", () => {
    expect(requiresLiveExecution("pull 100 rows from the data table")).toBe(true);
    expect(requiresLiveExecution("run the query and show the results")).toBe(true);
    expect(requiresLiveExecution("write the sql only")).toBe(false);
    expect(requiresLiveExecution("do not run this yet, just draft the sql")).toBe(false);
  });

  it("recognizes successful result-producing tools", () => {
    expect(
      hasSuccessfulResultTool([
        { toolName: "set_editor_content", success: true },
        { toolName: "execute_sql", success: false },
      ]),
    ).toBe(false);

    expect(
      hasSuccessfulResultTool([
        { toolName: "set_editor_content", success: true },
        { toolName: "execute_sql", success: true },
      ]),
    ).toBe(true);
  });

  it("detects when the agent at least attempted to materialize a query", () => {
    expect(
      attemptedQueryMaterialization([
        { toolName: "set_editor_content", success: true },
      ]),
    ).toBe(true);
    expect(
      attemptedQueryMaterialization([
        { toolName: "search_workspace", success: true },
      ]),
    ).toBe(false);
  });

  it("only auto-executes safe read queries", () => {
    expect(getAutoExecutableSql("SELECT * FROM public.orders LIMIT 100;")).toBe(
      "SELECT * FROM public.orders LIMIT 100;",
    );
    expect(getAutoExecutableSql("  ; WITH recent AS (SELECT 1) SELECT * FROM recent")).toBe(
      "WITH recent AS (SELECT 1) SELECT * FROM recent",
    );
    expect(getAutoExecutableSql("UPDATE public.orders SET status = 'done'")).toBeNull();
  });
});
