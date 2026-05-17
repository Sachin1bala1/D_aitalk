import { DbClient, type FullSchema } from "../db/DbClient";
import type { AgentCommand } from "./commands";
import type { QueryResults } from "../stores/WorkspaceStore";
import type { VerificationResult, VerifyResultParams } from "./TaskState";

function summarizeActualResults(results: QueryResults | null): VerificationResult["actual"] {
  if (!results) {
    return {
      rowCount: 0,
      columns: [],
      queryId: null,
      sourceTables: [],
    };
  }

  return {
    rowCount: results.rowCount,
    columns: results.fields.map((field) => field.name),
    queryId: results.queryId,
    sourceTables: results.source_tables,
  };
}

export function verifyCurrentResults(
  params: VerifyResultParams,
  results: QueryResults | null,
): VerificationResult {
  const actual = summarizeActualResults(results);
  const failures: string[] = [];

  if (!results) {
    if (params.requireResults !== false) {
      failures.push("No query results were available to verify.");
    }
  } else {
    if (typeof params.expectedMinRows === "number" && results.rowCount < params.expectedMinRows) {
      failures.push(
        `Expected at least ${params.expectedMinRows} rows, but only ${results.rowCount} were available.`,
      );
    }

    if (params.expectedColumns?.length) {
      const columns = new Set(results.fields.map((field) => field.name.toLowerCase()));
      const missingColumns = params.expectedColumns.filter(
        (column) => !columns.has(column.toLowerCase()),
      );
      if (missingColumns.length > 0) {
        failures.push(`Missing expected columns: ${missingColumns.join(", ")}.`);
      }
    }
  }

  if (failures.length > 0) {
    return {
      passed: false,
      actual,
      diagnosis: failures.join(" "),
      verificationMode: "deterministic",
    };
  }

  const rowCount = results?.rowCount ?? 0;
  const columnCount = results?.fields.length ?? 0;
  return {
    passed: true,
    actual,
    diagnosis: `Verified ${rowCount} rows across ${columnCount} columns for ${params.description}.`,
    verificationMode: "deterministic",
  };
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function normalizeTableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function buildAndEquals(conditions: Array<{ column: string; value: unknown }>): string {
  return conditions
    .map(({ column, value }) =>
      value === null || value === undefined
        ? `${quoteIdent(column)} IS NULL`
        : `${quoteIdent(column)} = ${sqlLiteral(value)}`,
    )
    .join(" AND ");
}

async function getTablePrimaryKeyColumns(
  connectionId: string,
  schemaName: string,
  tableName: string,
): Promise<string[]> {
  const schema = (await DbClient.getSchema(connectionId)) as FullSchema;
  const columns = schema.columns[normalizeTableKey(schemaName, tableName)] ?? [];
  return columns.filter((column) => column.is_primary_key).map((column) => column.name);
}

async function verifyInsertedRowByPrimaryKey(args: {
  connectionId: string;
  schema: string;
  table: string;
  values: Record<string, unknown>;
  commandType: AgentCommand["type"];
}): Promise<VerificationResult> {
  const primaryKeyColumns = await getTablePrimaryKeyColumns(args.connectionId, args.schema, args.table);
  if (primaryKeyColumns.length === 0) {
    return {
      passed: true,
      actual: {
        commandType: args.commandType,
        schema: args.schema,
        table: args.table,
        insertedColumns: Object.keys(args.values),
        primaryKeyColumns: [],
      },
      diagnosis: `Executed ${args.commandType} on ${args.schema}.${args.table}, but deterministic verification requires a stable primary key and this table does not expose one in schema metadata.`,
      verificationMode: "best_effort",
    };
  }

  const missingPrimaryKeys = primaryKeyColumns.filter((column) => !(column in args.values));
  if (missingPrimaryKeys.length > 0) {
    return {
      passed: true,
      actual: {
        commandType: args.commandType,
        schema: args.schema,
        table: args.table,
        insertedColumns: Object.keys(args.values),
        primaryKeyColumns,
        missingPrimaryKeys,
      },
      diagnosis: `Executed ${args.commandType} on ${args.schema}.${args.table}, but deterministic verification requires all primary-key columns. Missing: ${missingPrimaryKeys.join(", ")}.`,
      verificationMode: "best_effort",
    };
  }

  const primaryKeyPredicate = buildAndEquals(
    primaryKeyColumns.map((column) => ({
      column,
      value: args.values[column],
    })),
  );
  const projectedColumns = Object.keys(args.values)
    .map((column) => `${quoteIdent(column)} AS ${quoteIdent(column)}`)
    .join(", ");
  const rows = await DbClient.query(
    args.connectionId,
    `SELECT ${projectedColumns} FROM ${quoteIdent(args.schema)}.${quoteIdent(args.table)} WHERE ${primaryKeyPredicate} LIMIT 1;`,
  );
  const row = rows[0];
  const mismatchedColumns = Object.entries(args.values).filter(([column, expectedValue]) => {
    const actualValue = row?.[column] ?? null;
    return String(actualValue) !== String(expectedValue ?? null);
  });
  const passed = !!row && mismatchedColumns.length === 0;

  return {
    passed,
    actual: {
      commandType: args.commandType,
      schema: args.schema,
      table: args.table,
      primaryKeyColumns,
      matchedPrimaryKey: !!row,
      mismatchedColumns: mismatchedColumns.map(([column, expectedValue]) => ({
        column,
        expectedValue,
        actualValue: row?.[column] ?? null,
      })),
    },
    diagnosis: passed
      ? `Verified row exists on ${args.schema}.${args.table} for the inserted primary key and matches the approved values.`
      : !row
        ? `Could not find the inserted row on ${args.schema}.${args.table} using the approved primary key values.`
        : `Inserted row was found, but ${mismatchedColumns.map(([column]) => column).join(", ")} did not match the approved values.`,
    verificationMode: "deterministic",
  };
}

function parseBulkTransformSql(command: Extract<AgentCommand, { type: "bulk_transform" }>) {
  const sql = command.sql.trim().replace(/;$/, "");

  const deleteMatch = sql.match(
    /^delete\s+from\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s+where\s+(.+)$/i,
  );
  if (deleteMatch) {
    return {
      mode: "delete" as const,
      schema: deleteMatch[1] ?? "public",
      table: deleteMatch[2],
      whereClause: deleteMatch[3],
    };
  }

  const insertMatch = sql.match(
    /^insert\s+into\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)$/i,
  );
  if (insertMatch) {
    const columns = insertMatch[3].split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    const values = insertMatch[4].split(",").map((value) => value.trim());
    if (columns.length === values.length) {
      const normalizedValues = Object.fromEntries(
        columns.map((column, index) => {
          const raw = values[index] ?? "";
          if (/^null$/i.test(raw)) return [column, null];
          if (/^'.*'$/.test(raw)) return [column, raw.slice(1, -1).replace(/''/g, "'")];
          if (/^(true|false)$/i.test(raw)) return [column, /^true$/i.test(raw)];
          if (!Number.isNaN(Number(raw))) return [column, Number(raw)];
          return [column, raw];
        }),
      );

      return {
        mode: "insert" as const,
        schema: insertMatch[1] ?? "public",
        table: insertMatch[2],
        values: normalizedValues,
      };
    }
  }

  const updateMatch = sql.match(
    /^update\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s+set\s+"?([A-Za-z0-9_]+)"?\s*=\s*(.+?)\s+where\s+"?([A-Za-z0-9_]+)"?\s*=\s*(.+)$/i,
  );
  if (updateMatch) {
    const rawNewValue = updateMatch[4].trim();
    const rawPkValue = updateMatch[6].trim();
    const parseLiteral = (raw: string) => {
      if (/^null$/i.test(raw)) return null;
      if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
      if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
      if (!Number.isNaN(Number(raw))) return Number(raw);
      return raw;
    };
    return {
      mode: "update_cell" as const,
      schema: updateMatch[1] ?? "public",
      table: updateMatch[2],
      column: updateMatch[3],
      newValue: parseLiteral(rawNewValue),
      pkColumn: updateMatch[5],
      pkValue: parseLiteral(rawPkValue),
    };
  }

  return null;
}

export async function verifyMutationCommand(
  command: AgentCommand,
  connectionId: string | null,
): Promise<VerificationResult> {
  if (!connectionId) {
    return {
      passed: false,
      actual: { connectionId: null, commandType: command.type },
      diagnosis: "No active connection available for post-mutation verification.",
      verificationMode: "deterministic",
    };
  }

  switch (command.type) {
    case "add_column": {
      const schema = await DbClient.getSchema(connectionId);
      const columns = schema.columns[`${command.schema}.${command.table}`] ?? [];
      const exists = columns.some((column) => column.name === command.columnName);
      return {
        passed: exists,
        actual: {
          commandType: command.type,
          schema: command.schema,
          table: command.table,
          columnName: command.columnName,
          exists,
        },
        diagnosis: exists
          ? `Verified column ${command.columnName} exists on ${command.schema}.${command.table}.`
          : `Column ${command.columnName} was not found after the approved change.`,
        verificationMode: "deterministic",
      };
    }
    case "drop_column": {
      const schema = await DbClient.getSchema(connectionId);
      const columns = schema.columns[`${command.schema}.${command.table}`] ?? [];
      const exists = columns.some((column) => column.name === command.columnName);
      return {
        passed: !exists,
        actual: {
          commandType: command.type,
          schema: command.schema,
          table: command.table,
          columnName: command.columnName,
          exists,
        },
        diagnosis: !exists
          ? `Verified column ${command.columnName} is absent from ${command.schema}.${command.table}.`
          : `Column ${command.columnName} still exists after the approved drop.`,
        verificationMode: "deterministic",
      };
    }
    case "rename_table": {
      const schema = await DbClient.getSchema(connectionId);
      const hasNew = schema.tables.some((table) => table.schema === command.schema && table.name === command.newName);
      const hasOld = schema.tables.some((table) => table.schema === command.schema && table.name === command.oldName);
      const passed = hasNew && !hasOld;
      return {
        passed,
        actual: {
          commandType: command.type,
          schema: command.schema,
          oldName: command.oldName,
          newName: command.newName,
          hasNew,
          hasOld,
        },
        diagnosis: passed
          ? `Verified table rename from ${command.oldName} to ${command.newName}.`
          : `Table rename could not be verified after the approved change.`,
        verificationMode: "deterministic",
      };
    }
    case "delete_rows": {
      const rows = await DbClient.query(
        connectionId,
        `SELECT COUNT(*) AS remaining_count FROM "${command.schema}"."${command.table}" WHERE ${command.where};`,
      );
      const remaining = Number(rows[0]?.remaining_count ?? 0);
      return {
        passed: remaining === 0,
        actual: {
          commandType: command.type,
          schema: command.schema,
          table: command.table,
          where: command.where,
          remainingCount: remaining,
        },
        diagnosis:
          remaining === 0
            ? "Verified no rows remain matching the approved delete predicate."
            : `${remaining} rows still match the approved delete predicate.`,
        verificationMode: "deterministic",
      };
    }
    case "update_cell": {
      const rows = await DbClient.query(
        connectionId,
        `SELECT "${command.column}" AS value FROM "${command.schema}"."${command.table}" WHERE "${command.pkColumn}" = ${sqlLiteral(command.pkValue)} LIMIT 1;`,
      );
      const actualValue = rows[0]?.value ?? null;
      const expectedValue = command.newValue ?? null;
      const passed = String(actualValue) === String(expectedValue);
      return {
        passed,
        actual: {
          commandType: command.type,
          schema: command.schema,
          table: command.table,
          pkColumn: command.pkColumn,
          pkValue: command.pkValue,
          column: command.column,
          expectedValue,
          actualValue,
        },
        diagnosis: passed
          ? `Verified ${command.column} now matches the approved value.`
          : `Expected ${command.column}=${String(expectedValue)}, but found ${String(actualValue)}.`,
        verificationMode: "deterministic",
      };
    }
    case "create_index": {
      const schema = await DbClient.getSchema(connectionId);
      const normalizedColumns = [...command.columns].sort().join("|");
      const exists = schema.indexes.some((index) => {
        if (command.indexName && index.index_name !== command.indexName) return false;
        if (index.table_name !== command.table) return false;
        return [...index.columns].sort().join("|") === normalizedColumns;
      });
      return {
        passed: exists,
        actual: {
          commandType: command.type,
          schema: command.schema,
          table: command.table,
          columns: command.columns,
          indexName: command.indexName ?? null,
          exists,
        },
        diagnosis: exists
          ? `Verified index exists on ${command.table}(${command.columns.join(", ")}).`
          : `Index on ${command.table}(${command.columns.join(", ")}) was not found after creation.`,
        verificationMode: "deterministic",
      };
    }
    case "insert_row":
      return verifyInsertedRowByPrimaryKey({
        connectionId,
        schema: command.schema,
        table: command.table,
        values: command.values,
        commandType: command.type,
      });
    case "bulk_transform": {
      const parsed = parseBulkTransformSql(command);
      if (!parsed) {
        return {
          passed: true,
          actual: {
            commandType: command.type,
          },
          diagnosis:
            "Executed bulk_transform, but the SQL was too broad or ambiguous for deterministic post-mutation verification.",
          verificationMode: "best_effort",
        };
      }

      if (parsed.mode === "delete") {
        const rows = await DbClient.query(
          connectionId,
          `SELECT COUNT(*) AS remaining_count FROM ${quoteIdent(parsed.schema)}.${quoteIdent(parsed.table)} WHERE ${parsed.whereClause};`,
        );
        const remaining = Number(rows[0]?.remaining_count ?? 0);
        return {
          passed: remaining === 0,
          actual: {
            commandType: command.type,
            schema: parsed.schema,
            table: parsed.table,
            where: parsed.whereClause,
            remainingCount: remaining,
          },
          diagnosis:
            remaining === 0
              ? "Verified no rows remain matching the approved bulk delete predicate."
              : `${remaining} rows still match the approved bulk delete predicate.`,
          verificationMode: "deterministic",
        };
      }

      if (parsed.mode === "insert") {
        return verifyInsertedRowByPrimaryKey({
          connectionId,
          schema: parsed.schema,
          table: parsed.table,
          values: parsed.values,
          commandType: command.type,
        });
      }

      const rows = await DbClient.query(
        connectionId,
        `SELECT ${quoteIdent(parsed.column)} AS value FROM ${quoteIdent(parsed.schema)}.${quoteIdent(parsed.table)} WHERE ${quoteIdent(parsed.pkColumn)} = ${sqlLiteral(parsed.pkValue)} LIMIT 1;`,
      );
      const actualValue = rows[0]?.value ?? null;
      const expectedValue = parsed.newValue ?? null;
      const passed = String(actualValue) === String(expectedValue);
      return {
        passed,
        actual: {
          commandType: command.type,
          schema: parsed.schema,
          table: parsed.table,
          pkColumn: parsed.pkColumn,
          pkValue: parsed.pkValue,
          column: parsed.column,
          expectedValue,
          actualValue,
        },
        diagnosis: passed
          ? `Verified ${parsed.column} now matches the approved bulk update value.`
          : `Expected ${parsed.column}=${String(expectedValue)}, but found ${String(actualValue)} after bulk_transform.`,
        verificationMode: "deterministic",
      };
    }
    default:
      return {
        passed: true,
        actual: {
          commandType: command.type,
        },
        diagnosis: `Executed ${command.type}, but no deterministic post-mutation verifier is implemented yet.`,
        verificationMode: "best_effort",
      };
  }
}
