import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { registerHandlers } from "./registerHandlers";
import { commandBus } from "./CommandBus";
import { DbClient, type QueryBatch } from "../db/DbClient";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { createSmokeConnection, createSmokeWorkspaceSnapshot } from "../app/SmokeWorkspace";

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
