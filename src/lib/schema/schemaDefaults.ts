import type { FullSchema } from "../db/DbClient";

export const SYSTEM_SCHEMA_BLOCKLIST = new Set([
  "auth",
  "storage",
  "realtime",
  "extensions",
  "graphql",
  "graphql_public",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "pgbouncer",
  "supabase_functions",
  "supabase_migrations",
  "_analytics",
  "_realtime",
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "pg_internal",
]);

export function deriveDefaultVisibleSchemas(fullSchema: FullSchema): string[] {
  const all = [...new Set(fullSchema.tables.map((t) => t.schema).filter(Boolean))];
  if (all.length === 0) return [];

  const defaults = all.filter(
    (s) => s === "public" || !SYSTEM_SCHEMA_BLOCKLIST.has(s)
  );

  return defaults.length > 0 ? defaults : all;
}
