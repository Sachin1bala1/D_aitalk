import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDataEvidence,
  buildOpenTabsSummary,
  buildReflectionGuidance,
  buildVisualizationClarifier,
  inferNumericColumns,
  isUnderspecifiedVisualizationRequest,
  runAgentLoop,
} from "./AgentLoop";
import { commandBus } from "./CommandBus";
import type { AIProvider } from "../ai/types";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import type { QueryResults, TabState } from "../stores/WorkspaceStore";

const SAMPLE_RESULTS: QueryResults = {
  rows: [
    {
      "Torque [Nm]": 42.8,
      "Tool wear [min]": 0,
      "Air temperature [K]": 298.1,
      Type: "L",
    },
    {
      "Torque [Nm]": 46.3,
      "Tool wear [min]": 3,
      "Air temperature [K]": 298.2,
      Type: "M",
    },
  ],
  fields: [
    { name: "Torque [Nm]" },
    { name: "Tool wear [min]" },
    { name: "Air temperature [K]" },
    { name: "Type" },
  ],
  rowCount: 2,
  elapsedMs: 12,
  queryId: "q1",
  source_tables: ["public.sachin_test_data_table"],
};

describe("visualization clarification heuristics", () => {
  it("flags generic plot requests as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("make plot")).toBe(true);
    expect(isUnderspecifiedVisualizationRequest("plot data")).toBe(true);
  });

  it("does not flag explicit plot relationships as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("plot Torque [Nm] vs Tool wear [min]")).toBe(false);
    expect(isUnderspecifiedVisualizationRequest("make a histogram of Torque [Nm]")).toBe(false);
  });

  it("infers numeric columns from current results", () => {
    expect(inferNumericColumns(SAMPLE_RESULTS)).toEqual([
      "Torque [Nm]",
      "Tool wear [min]",
      "Air temperature [K]",
    ]);
  });

  it("builds a clarifying question with concrete examples when results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", SAMPLE_RESULTS);
    expect(clarifier).toContain("Which relationship do you want plotted?");
    expect(clarifier).toContain("Torque [Nm] vs Tool wear [min]");
  });

  it("asks for columns when no results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", null);
    expect(clarifier).toContain("Which columns or relationship do you want plotted?");
  });
});

describe("destructive command approval enforcement", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      agentMode: "auto",
      planQueue: [],
      currentTask: null,
    });
    vi.restoreAllMocks();
  });

  it("queues destructive commands for approval even in auto mode", async () => {
    const provider: AIProvider = {
      id: "openai",
      name: "Test Provider",
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          text: "I need to remove the bad rows.",
          toolCalls: [
            {
              id: "tc-1",
              name: "delete_rows",
              input: {
                schema: "public",
                table: "orders",
                where: "\"status\" = 'bad'",
              },
            },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          text: "The delete is queued for your approval.",
          toolCalls: [],
          stopReason: "end_turn",
        }),
    };

    const dispatchSpy = vi.spyOn(commandBus, "dispatch");
    const queuedSteps: string[] = [];

    const result = await runAgentLoop("Delete the bad rows", [], {
      provider,
      model: "test-model",
      connectionId: "conn-1",
      schema: null,
      currentSQL: null,
      currentResults: null,
      onToken: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onPlanQueued: (stepId) => {
        queuedSteps.push(stepId);
      },
    });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(queuedSteps).toHaveLength(1);
    expect(result.pendingApprovalSteps).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(1);
    expect(useWorkspaceStore.getState().planQueue[0]?.commandType).toBe("delete_rows");
    expect(useWorkspaceStore.getState().planQueue[0]?.status).toBe("pending");
  });

  it("still dispatches safe commands immediately in auto mode", async () => {
    const provider: AIProvider = {
      id: "openai",
      name: "Test Provider",
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          text: "Opening the table.",
          toolCalls: [
            {
              id: "tc-2",
              name: "open_table",
              input: {
                schema: "public",
                table: "orders",
              },
            },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          text: "The table is open.",
          toolCalls: [],
          stopReason: "end_turn",
        }),
    };

    const dispatchSpy = vi.spyOn(commandBus, "dispatch").mockResolvedValue({
      success: true,
      result: "opened",
    });

    await runAgentLoop("Open orders", [], {
      provider,
      model: "test-model",
      connectionId: "conn-1",
      schema: null,
      currentSQL: null,
      currentResults: null,
      onToken: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onPlanQueued: () => {},
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().planQueue).toHaveLength(0);
  });
});

describe("buildReflectionGuidance", () => {
  it("returns content unchanged for successful non-empty execute_sql", () => {
    const content = JSON.stringify({ rows: [{ a: 1 }], rowCount: 1 });
    expect(buildReflectionGuidance("execute_sql", content, false)).toBe(content);
  });

  it("appends ZERO RESULTS block when execute_sql returns empty rows", () => {
    const content = JSON.stringify({ rows: [], rowCount: 0, fields: [], elapsedMs: 5 });
    const out = buildReflectionGuidance("execute_sql", content, false);
    expect(out).toContain("ZERO RESULTS");
    expect(out).toContain("derived table");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION block on tool error", () => {
    const content = "Error: column not found";
    const out = buildReflectionGuidance("execute_sql", content, true);
    expect(out).toContain("ERROR REFLECTION");
    expect(out).toContain(content);
  });

  it("appends ERROR REFLECTION for non-execute_sql tool errors", () => {
    const content = "Error: connection refused";
    const out = buildReflectionGuidance("analyze_loaded_correlation", content, true);
    expect(out).toContain("ERROR REFLECTION");
  });

  it("returns content unchanged for successful non-execute_sql tool", () => {
    const content = JSON.stringify({ correlations: [{ column: "A", correlation: 0.9 }] });
    expect(buildReflectionGuidance("analyze_loaded_correlation", content, false)).toBe(content);
  });

  it("returns content unchanged for execute_sql with non-JSON content and no error", () => {
    // Tests the catch path for non-JSON content
    expect(buildReflectionGuidance("execute_sql", "plain text result", false)).toBe("plain text result");
  });

  it("appends ERROR REFLECTION for empty-string content on error", () => {
    const out = buildReflectionGuidance("execute_sql", "", true);
    expect(out).toContain("ERROR REFLECTION");
  });

  it("does NOT append ZERO RESULTS when rowCount is null (not zero)", () => {
    // rowCount: null must NOT trigger the zero-rows branch
    const content = JSON.stringify({ rows: [], rowCount: null, fields: [] });
    const out = buildReflectionGuidance("execute_sql", content, false);
    expect(out).toBe(content); // unchanged — null is not 0
  });
});

describe("buildDataEvidence", () => {
  it("returns null for empty results", () => {
    const results: QueryResults = {
      rows: [],
      fields: [{ name: "Torque" }],
      rowCount: 0,
      elapsedMs: 5,
      queryId: "q1",
      source_tables: [],
    };
    expect(buildDataEvidence(results)).toBeNull();
  });

  it("includes row count and numeric column stats", () => {
    const results: QueryResults = {
      rows: [
        { "Torque [Nm]": 40, Type: "L" },
        { "Torque [Nm]": 60, Type: "M" },
      ],
      fields: [{ name: "Torque [Nm]" }, { name: "Type" }],
      rowCount: 2,
      elapsedMs: 10,
      queryId: "q2",
      source_tables: ["public.data"],
    };
    const evidence = buildDataEvidence(results);
    expect(evidence).not.toBeNull();
    expect(evidence).toContain("2 rows");
    expect(evidence).toContain("Torque [Nm]");
    expect(evidence).toContain("min=40");
    expect(evidence).toContain("max=60");
    expect(evidence).toContain("mean=50");
  });

  it("skips non-numeric columns but still returns row count", () => {
    const results: QueryResults = {
      rows: [{ Type: "L" }, { Type: "M" }],
      fields: [{ name: "Type" }],
      rowCount: 2,
      elapsedMs: 5,
      queryId: "q3",
      source_tables: [],
    };
    const evidence = buildDataEvidence(results);
    expect(evidence).toContain("2 rows");
    expect(evidence).not.toContain("min=");
  });

  it("caps numeric summary at 6 columns", () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({ name: `col${i}` }));
    const row: Record<string, unknown> = {};
    fields.forEach((f, i) => { row[f.name] = i + 1; });
    const results: QueryResults = {
      rows: [row, row],
      fields,
      rowCount: 2,
      elapsedMs: 5,
      queryId: "q4",
      source_tables: [],
    };
    const evidence = buildDataEvidence(results);
    const matches = (evidence ?? "").match(/min=/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(6);
  });
});

describe("buildOpenTabsSummary", () => {
  const makeTab = (overrides: Partial<TabState>): TabState =>
    ({
      id: "t1",
      type: "sql_editor" as const,
      title: "Query",
      connectionId: "conn1",
      sql: "",
      queryResults: null,
      isExecuting: false,
      queryView: "results" as const,
      isSheet: false,
      ...overrides,
    } as TabState);

  const makeResults = (rowCount: number, fields: string[]) => ({
    rows: Array.from({ length: Math.min(rowCount, 1) }, () =>
      Object.fromEntries(fields.map((f) => [f, 1]))
    ),
    fields: fields.map((name) => ({ name })),
    rowCount,
    elapsedMs: 5,
    queryId: "q1",
    source_tables: [],
  });

  it("returns null when no tabs have results", () => {
    expect(buildOpenTabsSummary([])).toBeNull();
    expect(buildOpenTabsSummary([makeTab({ queryResults: null })])).toBeNull();
  });

  it("returns null when only the active tab has results", () => {
    const tab = makeTab({ id: "active", queryResults: makeResults(10, ["x"]) });
    expect(buildOpenTabsSummary([tab], "active")).toBeNull();
  });

  it("includes non-active tabs with results", () => {
    const tabs: TabState[] = [
      makeTab({ id: "active", title: "Live Query", queryResults: makeResults(10, ["x"]) }),
      makeTab({ id: "sheet1", title: "Type-L rows", isSheet: true, queryResults: makeResults(150, ["Torque", "Type"]) }),
    ];
    const summary = buildOpenTabsSummary(tabs, "active");
    expect(summary).not.toBeNull();
    expect(summary).toContain("Type-L rows");
    expect(summary).toContain("150 rows");
    expect(summary).toContain("Torque");
    expect(summary).toContain("sheet");
  });

  it("caps at 5 tabs to limit tokens", () => {
    const tabs = Array.from({ length: 8 }, (_, i) =>
      makeTab({ id: `t${i}`, title: `Tab ${i}`, queryResults: makeResults(i + 1, ["v"]) })
    );
    const summary = buildOpenTabsSummary(tabs) ?? "";
    const matches = summary.match(/Tab \d/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(5);
  });
});
