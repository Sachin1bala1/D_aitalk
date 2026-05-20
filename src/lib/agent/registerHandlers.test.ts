import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { registerHandlers } from "./registerHandlers";
import { commandBus } from "./CommandBus";
import { DbClient, type QueryBatch } from "../db/DbClient";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { createSmokeConnection, createSmokeWorkspaceSnapshot } from "../app/SmokeWorkspace";
import { PyodideRuntime } from "../pyodide/PyodideRuntime";

describe("registerHandlers open_table", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    registerHandlers();

    const snapshot = createSmokeWorkspaceSnapshot();
    const connection = createSmokeConnection();

    useWorkspaceStore.setState((state) => ({
      ...state,
      connections: [connection],
      activeConnectionId: connection.id,
      tabs: snapshot.tabs.map((tab) => ({
        ...tab,
        sql: "",
        queryResults: null,
        isExecuting: false,
      })),
      activeTabId: snapshot.activeTabId,
    }));
  });

  it("loads preview rows instead of only writing SQL to the editor", async () => {
    let onBatch: ((event: { payload: QueryBatch }) => void) | null = null;

    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      onBatch = callback as (event: { payload: QueryBatch }) => void;
      return () => {};
    });

    vi.spyOn(DbClient, "executeStreaming").mockImplementation(async (_connectionId, sql) => {
      expect(sql).toBe('SELECT * FROM "public"."sachin_test_data_table" LIMIT 500;');

      setTimeout(() => {
        onBatch?.({
          payload: {
            query_id: "q-open-table",
            batch_index: 0,
            rows: [{ UDI: 1, "Product ID": "M14860" }],
            columns: [
              {
                name: "UDI",
                type_name: "integer",
                display_type: { kind: "integer" },
                nullable: false,
                is_primary_key: true,
              },
              {
                name: "Product ID",
                type_name: "text",
                display_type: { kind: "text" },
                nullable: false,
                is_primary_key: false,
              },
            ],
            is_final: true,
            total_elapsed_ms: 8,
            rows_so_far: 1,
            error: null,
          },
        });
      }, 0);

      return {
        query_id: "q-open-table",
        source_tables: ["public.sachin_test_data_table"],
      };
    });

    const result = await commandBus.dispatch({
      type: "open_table",
      schema: "public",
      table: "sachin_test_data_table",
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect(useWorkspaceStore.getState().tabs[0]?.sql).toBe(
      'SELECT * FROM "public"."sachin_test_data_table" LIMIT 500;',
    );
    expect(useWorkspaceStore.getState().tabs[0]?.queryResults?.rowCount).toBe(1);
    expect(useWorkspaceStore.getState().tabs[0]?.queryResults?.rows[0]?.["Product ID"]).toBe("M14860");
  });

  it("fails fast when the streaming query never finishes", async () => {
    vi.useFakeTimers();

    vi.mocked(listen).mockImplementation(async () => () => {});
    vi.spyOn(DbClient, "executeStreaming").mockResolvedValue({
      query_id: "q-stuck",
      source_tables: ["public.sachin_test_data_table"],
    });

    const pending = commandBus.dispatch({
      type: "open_table",
      schema: "public",
      table: "sachin_test_data_table",
      risk: "safe",
    });

    await vi.advanceTimersByTimeAsync(15_100);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});

describe("registerHandlers analysis and charts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    registerHandlers();

    const snapshot = createSmokeWorkspaceSnapshot();
    const connection = createSmokeConnection();

    useWorkspaceStore.setState((state) => ({
      ...state,
      connections: [connection],
      activeConnectionId: connection.id,
      tabs: snapshot.tabs.map((tab) => ({
        ...tab,
        sql: 'SELECT "Process temperature [K]", "Tool wear [min]", "Type" FROM "public"."sachin_test_data_table" LIMIT 100;',
        queryResults: {
          rows: [
            { "Process temperature [K]": 308.6, "Tool wear [min]": 0, Type: "M" },
            { "Process temperature [K]": 308.7, "Tool wear [min]": 3, Type: "L" },
            { "Process temperature [K]": 309.0, "Tool wear [min]": 9, Type: "H" },
          ],
          fields: [
            { name: "Process temperature [K]" },
            { name: "Tool wear [min]" },
            { name: "Type" },
          ],
          rowCount: 3,
          elapsedMs: 5,
          queryId: "q-chart",
          source_tables: ["public.sachin_test_data_table"],
        },
        isExecuting: false,
      })),
      activeTabId: snapshot.activeTabId,
      artifacts: {},
      artifactRevisions: {},
      artifactHeads: {},
      graphBuilderRequest: null,
    }));
  });

  it("falls back to correlation-based ranking when feature importance kernel fails", async () => {
    vi.spyOn(PyodideRuntime, "getInstance").mockReturnValue({
      run: vi.fn().mockRejectedValue(new Error("Pyodide package load failed")),
      getStatus: vi.fn().mockReturnValue("error"),
    } as unknown as PyodideRuntime);

    const result = await commandBus.dispatch({
      type: "run_stat_tool",
      method: "feature_importance",
      params: {
        X: [
          [10, 1],
          [12, 2],
          [11, 3],
          [13, 4],
        ],
        y: [10, 20, 30, 40],
        feature_names: ["temperature", "wear"],
      },
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect((result.result as { model_type: string }).model_type).toBe("correlation_proxy");
    expect((result.result as { top_features: string[] }).top_features[0]).toBe("wear");
  });

  it("opens a chart request with color grouping when colorColumn is provided", async () => {
    const result = await commandBus.dispatch({
      type: "create_chart",
      chartType: "scatter",
      xColumn: "Tool wear [min]",
      yColumn: "Process temperature [K]",
      colorColumn: "Type",
      title: "Process temp vs wear by type",
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect(useWorkspaceStore.getState().graphBuilderRequest?.colorColumn).toBe("Type");
    const artifactId = useWorkspaceStore.getState().graphBuilderRequest?.artifactId;
    expect(artifactId).toBeTruthy();
    if (!artifactId) throw new Error("expected artifact id");
    expect(useWorkspaceStore.getState().artifacts[artifactId]?.chart?.assignments.color).toBe("Type");
  });

  it("computes loaded correlation rankings from the active results", async () => {
    const result = await commandBus.dispatch({
      type: "analyze_loaded_correlation",
      targetColumn: "Tool wear [min]",
      columns: ["Process temperature [K]", "Tool wear [min]"],
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect((result.result as { analysis_type: string }).analysis_type).toBe("target_correlation_ranking");
    expect((result.result as { topFeatures: string[] }).topFeatures).toContain("Process temperature [K]");
  });

  it("computes loaded feature ranking from the active results without refetching", async () => {
    vi.spyOn(PyodideRuntime, "getInstance").mockReturnValue({
      run: vi.fn().mockResolvedValue({
        importances: [{ feature: "Process temperature [K]", importance: 0.71 }],
        top_features: ["Process temperature [K]"],
        model_type: "regressor",
        n_features: 1,
        n_samples: 2,
      }),
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as PyodideRuntime);

    const result = await commandBus.dispatch({
      type: "analyze_loaded_feature_importance",
      targetColumn: "Tool wear [min]",
      featureColumns: ["Process temperature [K]"],
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect((result.result as { top_features: string[] }).top_features[0]).toBe("Process temperature [K]");
    expect((result.result as { detailed_factors: Array<{ contribution_pct: number; effect_direction: string }> }).detailed_factors[0]?.contribution_pct).toBeGreaterThan(0);
    expect((result.result as { summary: string }).summary).toContain("Tool wear [min]");
  });

  it("opens an analysis chart from computed result rows", async () => {
    const result = await commandBus.dispatch({
      type: "create_analysis_chart",
      chartType: "bar",
      rows: [
        { feature: "Rotational speed [rpm]", contribution_pct: 29.9, effect_direction: "positive" },
        { feature: "Torque [Nm]", contribution_pct: 29.1, effect_direction: "positive" },
      ],
      xKey: "feature",
      yKey: "contribution_pct",
      colorKey: "effect_direction",
      title: "Major wear factors",
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect(useWorkspaceStore.getState().graphBuilderRequest?.colorColumn).toBe("effect_direction");
    const artifactId = useWorkspaceStore.getState().graphBuilderRequest?.artifactId;
    expect(artifactId).toBeTruthy();
  });

  it("computes loaded regression detail with enriched coefficients", async () => {
    vi.spyOn(PyodideRuntime, "getInstance").mockReturnValue({
      run: vi.fn().mockResolvedValue({
        coefficients: [{ feature: "Process temperature [K]", coef: 1.25, vif: 1.1 }],
        intercept: 0.5,
        r_squared: 0.82,
        adj_r_squared: 0.8,
        cv_r2_mean: 0.79,
        cv_r2_std: 0.04,
      }),
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as PyodideRuntime);

    const result = await commandBus.dispatch({
      type: "analyze_loaded_regression",
      targetColumn: "Tool wear [min]",
      featureColumns: ["Process temperature [K]"],
      risk: "safe",
    });

    expect(result.success).toBe(true);
    expect((result.result as { enriched_coefficients: Array<{ feature: string }> }).enriched_coefficients[0]?.feature).toBe("Process temperature [K]");
    expect((result.result as { summary: string }).summary).toContain("Model R²");
  });
});
