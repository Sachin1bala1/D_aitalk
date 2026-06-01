import type { FullSchema } from "../db/DbClient";

/**
 * Postgres / Supabase internal schemas hidden by default.
 * Any schema NOT in this set (other than "public") is treated as user-created.
 */
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

/**
 * Derive which schemas should be visible by default for a freshly introspected connection.
 *
 * Rules (in order):
 * 1. Always include "public" if present.
 * 2. Exclude any schema on SYSTEM_SCHEMA_BLOCKLIST.
 * 3. Include any schema NOT on the blocklist (user-created custom schemas).
 * 4. Fallback: if the result is empty, return all unique schemas (never leave sidebar blank).
 */
export function deriveDefaultVisibleSchemas(fullSchema: FullSchema): string[] {
  const all = [...new Set(fullSchema.tables.map((t) => t.schema).filter(Boolean))];
  if (all.length === 0) return [];

  const defaults = all.filter(
    (s) => s === "public" || !SYSTEM_SCHEMA_BLOCKLIST.has(s)
  );

  return defaults.length > 0 ? defaults : all;
}
