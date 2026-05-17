import { afterEach, describe, expect, it, vi } from "vitest";
import { DbClient } from "../db/DbClient";
import { verifyCurrentResults, verifyMutationCommand } from "./VerificationEngine";
import type { QueryResults } from "../stores/WorkspaceStore";

const SAMPLE_RESULTS: QueryResults = {
  rows: [
    { id: 1, status: "ok" },
    { id: 2, status: "bad" },
  ],
  fields: [{ name: "id" }, { name: "status" }],
  rowCount: 2,
  elapsedMs: 5,
  queryId: "query-1",
  source_tables: ["public.orders"],
};

describe("VerificationEngine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks current-result verification as deterministic when checks pass", () => {
    const result = verifyCurrentResults(
      {
        description: "orders query",
        expectedMinRows: 1,
        expectedColumns: ["id", "status"],
      },
      SAMPLE_RESULTS,
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("deterministic");
    expect(result.diagnosis).toContain("Verified 2 rows");
  });

  it("returns best-effort verification for insert_row mutations", async () => {
    vi.spyOn(DbClient, "getSchema").mockResolvedValue({
      driver: "postgresql",
      tables: [],
      columns: {
        "public.orders": [
          {
            name: "id",
            type_name: "integer",
            nullable: false,
            is_primary_key: true,
          },
        ],
      },
      foreign_keys: [],
      indexes: [],
      functions: [],
      views: [],
    } as any);
    vi.spyOn(DbClient, "query").mockResolvedValue([{ id: 3, status: "ok" }] as any);

    const result = await verifyMutationCommand(
      {
        type: "insert_row",
        schema: "public",
        table: "orders",
        values: { id: 3, status: "ok" },
        risk: "caution",
      },
      "conn-1",
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("deterministic");
    expect(result.diagnosis).toContain("Verified row exists");
  });

  it("falls back to best-effort insert verification without primary-key coverage", async () => {
    vi.spyOn(DbClient, "getSchema").mockResolvedValue({
      driver: "postgresql",
      tables: [],
      columns: {
        "public.orders": [
          {
            name: "id",
            type_name: "integer",
            nullable: false,
            is_primary_key: true,
          },
        ],
      },
      foreign_keys: [],
      indexes: [],
      functions: [],
      views: [],
    } as any);

    const result = await verifyMutationCommand(
      {
        type: "insert_row",
        schema: "public",
        table: "orders",
        values: { status: "ok" },
        risk: "caution",
      },
      "conn-1",
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("best_effort");
    expect(result.diagnosis).toContain("Missing: id");
  });

  it("deterministically verifies add_column using refreshed schema", async () => {
    vi.spyOn(DbClient, "getSchema").mockResolvedValue({
      driver: "postgresql",
      tables: [],
      columns: {
        "public.orders": [
          {
            name: "priority",
            type_name: "text",
            nullable: true,
            is_primary_key: false,
          },
        ],
      },
      foreign_keys: [],
      indexes: [],
      functions: [],
      views: [],
    } as any);

    const result = await verifyMutationCommand(
      {
        type: "add_column",
        schema: "public",
        table: "orders",
        columnName: "priority",
        dataType: "text",
        nullable: true,
        risk: "caution",
      },
      "conn-1",
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("deterministic");
    expect(result.diagnosis).toContain("Verified column priority exists");
  });

  it("deterministically verifies a parseable bulk delete transform", async () => {
    vi.spyOn(DbClient, "query").mockResolvedValue([{ remaining_count: 0 }] as any);

    const result = await verifyMutationCommand(
      {
        type: "bulk_transform",
        sql: 'DELETE FROM public.orders WHERE status = \'bad\'',
        risk: "destructive",
      },
      "conn-1",
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("deterministic");
    expect(result.diagnosis).toContain("approved bulk delete predicate");
  });

  it("returns best-effort verification for ambiguous bulk_transform SQL", async () => {
    const result = await verifyMutationCommand(
      {
        type: "bulk_transform",
        sql: "UPDATE public.orders SET status = status || '-x'",
        risk: "destructive",
      },
      "conn-1",
    );

    expect(result.passed).toBe(true);
    expect(result.verificationMode).toBe("best_effort");
    expect(result.diagnosis).toContain("too broad or ambiguous");
  });
});
