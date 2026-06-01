import { describe, it, expect } from "vitest";
import { deriveDefaultVisibleSchemas, SYSTEM_SCHEMA_BLOCKLIST } from "./schemaDefaults";
import type { FullSchema } from "../db/DbClient";

const makeSchema = (schemas: string[]): FullSchema => ({
  connection_id: "c1",
  driver: "postgres",
  tables: schemas.map((s, i) => ({
    name: `table_${i}`,
    schema: s,
    row_estimate: 0,
    size_bytes: 0,
    object_type: "table" as const,
  })),
  columns: {},
  foreign_keys: [],
  indexes: [],
  hypertable_tables: [],
  functions: [],
});

describe("deriveDefaultVisibleSchemas", () => {
  it("always includes public", () => {
    const result = deriveDefaultVisibleSchemas(makeSchema(["public", "auth", "storage"]));
    expect(result).toContain("public");
  });

  it("excludes known Supabase system schemas", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "auth", "storage", "realtime", "extensions", "vault"])
    );
    expect(result).not.toContain("auth");
    expect(result).not.toContain("storage");
    expect(result).not.toContain("realtime");
    expect(result).not.toContain("extensions");
    expect(result).not.toContain("vault");
  });

  it("includes custom user schemas not on blocklist", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "auth", "analytics", "reporting"])
    );
    expect(result).toContain("analytics");
    expect(result).toContain("reporting");
    expect(result).not.toContain("auth");
  });

  it("falls back to all schemas when everything is blocked", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["auth", "storage", "realtime"])
    );
    expect(result).toEqual(["auth", "storage", "realtime"]);
  });

  it("returns [] for empty schema (no tables)", () => {
    const result = deriveDefaultVisibleSchemas(makeSchema([]));
    expect(result).toEqual([]);
  });

  it("deduplicates schemas", () => {
    const result = deriveDefaultVisibleSchemas(
      makeSchema(["public", "public", "analytics"])
    );
    expect(result.filter((s) => s === "public").length).toBe(1);
  });

  it("exports SYSTEM_SCHEMA_BLOCKLIST as a Set", () => {
    expect(SYSTEM_SCHEMA_BLOCKLIST.has("auth")).toBe(true);
    expect(SYSTEM_SCHEMA_BLOCKLIST.has("public")).toBe(false);
  });
});
