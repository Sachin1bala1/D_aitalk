/**
 * toolDefinitions — unified tool schemas for all AgentCommands.
 * Uses UnifiedTool (provider-agnostic). Each provider converts internally.
 */
import type { UnifiedTool } from "../ai/types";

export const AGENT_TOOLS: UnifiedTool[] = [
  // ── SQL ───────────────────────────────────────────────────────────────────
  {
    name: "set_editor_content",
    description:
      "Write SQL into the editor without executing it. Use when you want the user to review or run the query themselves.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "The SQL to place in the editor" },
      },
      required: ["sql"],
    },
  },
  {
    name: "execute_sql",
    description:
      "Execute a SQL SELECT query against the active database and return results. Use for read-only queries to fetch data, answer questions, or validate assumptions.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "The SQL SELECT query to execute" },
      },
      required: ["sql"],
    },
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  {
    name: "open_table",
    description: "Open a database table in the editor with SELECT * LIMIT 500.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (e.g. 'public')" },
        table: { type: "string", description: "Table name" },
      },
      required: ["schema", "table"],
    },
  },
  {
    name: "open_new_tab",
    description: "Open a new empty SQL editor tab.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional tab title" },
      },
    },
  },
  {
    name: "create_dashboard",
    description:
      "Create a dashboard tab. Use current query results when available so charts and widgets can be seeded immediately.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional dashboard title" },
        useCurrentResults: {
          type: "boolean",
          description: "Whether to seed the dashboard from the current query results if available",
        },
      },
    },
  },
  {
    name: "update_dashboard_widget",
    description:
      "Update an existing widget in the active dashboard. Use this to retitle widgets, switch widget type, change datasource bindings, or rebind x/y/metric fields after a dashboard already exists.",
    parameters: {
      type: "object",
      properties: {
        widgetId: {
          type: "string",
          description: "Optional exact widget id when you know it",
        },
        widgetTitle: {
          type: "string",
          description: "Optional current widget title to target when id is unknown",
        },
        datasourceId: {
          type: "string",
          description: "Optional datasource id to bind the widget to",
        },
        datasourceName: {
          type: "string",
          description: "Optional datasource name to bind by name when id is unknown",
        },
        widgetType: {
          type: "string",
          enum: ["bar_chart", "line_chart", "scatter_chart", "area_chart", "pie_chart", "metric", "table", "text"],
          description: "Optional widget type to switch to",
        },
        title: { type: "string", description: "Optional new widget title" },
        xField: { type: "string", description: "Optional X/category field for chart widgets" },
        yField: { type: "string", description: "Optional Y/value field for chart widgets" },
        metricField: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Optional numeric field for metric widgets. Use null for row count metrics.",
        } as any,
        aggregate: {
          type: "string",
          enum: ["row_count", "sum", "avg", "min", "max"],
          description: "Optional aggregate for metric widgets",
        },
      },
    },
  },

  // ── Schema mutation ───────────────────────────────────────────────────────
  {
    name: "add_column",
    description:
      "Add a new column to a table (ALTER TABLE … ADD COLUMN). For schema evolution.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name" },
        table: { type: "string", description: "Table name" },
        columnName: { type: "string", description: "New column name" },
        dataType: { type: "string", description: "SQL data type, e.g. TEXT, INTEGER, TIMESTAMPTZ" },
        nullable: { type: "boolean", description: "Whether the column allows NULL" },
        defaultValue: { type: "string", description: "Optional DEFAULT expression" },
      },
      required: ["schema", "table", "columnName", "dataType", "nullable"],
    },
  },
  {
    name: "drop_column",
    description: "Drop a column from a table. DESTRUCTIVE — irreversible.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        table: { type: "string" },
        columnName: { type: "string", description: "Column to drop" },
      },
      required: ["schema", "table", "columnName"],
    },
  },
  {
    name: "rename_table",
    description: "Rename a table. DESTRUCTIVE.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        oldName: { type: "string" },
        newName: { type: "string" },
      },
      required: ["schema", "oldName", "newName"],
    },
  },

  // ── Data mutation ─────────────────────────────────────────────────────────
  {
    name: "delete_rows",
    description:
      "Delete rows matching a WHERE clause. DESTRUCTIVE — always confirm the WHERE condition with the user first.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        table: { type: "string" },
        where: {
          type: "string",
          description: "SQL WHERE clause (without the WHERE keyword), e.g. \"id = 42\"",
        },
        estimatedCount: { type: "number", description: "Approximate row count to be deleted" },
      },
      required: ["schema", "table", "where"],
    },
  },
  {
    name: "bulk_transform",
    description:
      "Execute a full UPDATE, INSERT, or MERGE statement. DESTRUCTIVE — use only when explicitly requested.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Full UPDATE/INSERT/MERGE SQL" },
      },
      required: ["sql"],
    },
  },

  // ── Schema helpers ────────────────────────────────────────────────────────
  {
    name: "create_index",
    description: "Create an index on one or more columns to speed up queries.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name" },
        table: { type: "string", description: "Table name" },
        columns: {
          type: "array",
          description: "Ordered list of column names to index",
          items: { type: "string" },
        } as any,
        unique: { type: "boolean", description: "Whether to create a UNIQUE index" },
        indexName: { type: "string", description: "Optional index name (auto-generated if omitted)" },
      },
      required: ["schema", "table", "columns", "unique"],
    },
  },
  {
    name: "focus_schema_node",
    description: "Highlight and expand a specific table in the schema sidebar so the user can see its columns.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name" },
        table: { type: "string", description: "Table to focus" },
      },
      required: ["schema", "table"],
    },
  },

  // ── Single-row mutations ──────────────────────────────────────────────────
  {
    name: "insert_row",
    description: "Insert a single row into a table.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        table: { type: "string" },
        values: {
          type: "object",
          description: "Key-value pairs mapping column names to values",
          additionalProperties: true,
        } as any,
      },
      required: ["schema", "table", "values"],
    },
  },
  {
    name: "update_cell",
    description: "Update a single cell in a table by primary key.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        table: { type: "string" },
        pkColumn: { type: "string", description: "Primary key column name" },
        pkValue: { description: "Primary key value to match" } as any,
        column: { type: "string", description: "Column to update" },
        newValue: { description: "New value to set" } as any,
      },
      required: ["schema", "table", "pkColumn", "pkValue", "column", "newValue"],
    },
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    name: "run_duckdb_analysis",
    description:
      "Run an analytical SQL query using the embedded DuckDB engine. Faster than the main DB for aggregations on large result sets, or for querying loaded Parquet/CSV files.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "DuckDB SQL query (can reference loaded views)" },
      },
      required: ["sql"],
    },
  },

  // ── Tab management ────────────────────────────────────────────────────────
  {
    name: "close_tab",
    description: "Close a SQL editor tab. Omit tabId to close the currently active tab.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "ID of the tab to close (optional — defaults to active tab)" },
      },
    },
  },

  // ── Charts ────────────────────────────────────────────────────────────────
  {
    name: "create_chart",
    description:
      "Create a chart visualization from the current query results. If a dashboard tab is active, add a widget there. Otherwise create or seed a dashboard from the current results.",
    parameters: {
      type: "object",
      properties: {
        chartType: { type: "string", enum: ["bar", "line", "scatter", "pie", "area"], description: "Chart type" },
        xColumn: { type: "string", description: "Column to use as the X axis / category" },
        yColumn: { type: "string", description: "Column to use as the Y axis / value" },
        title: { type: "string", description: "Optional chart title" },
      },
      required: ["chartType", "xColumn", "yColumn"],
    },
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────
  {
    name: "create_pipeline",
    description: "Define a data pipeline that copies query results from one connection to a table in another.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Pipeline name" },
        sourceConnectionId: { type: "string", description: "Source connection ID" },
        sourceQuery: { type: "string", description: "SQL query to pull source data" },
        targetConnectionId: { type: "string", description: "Target connection ID" },
        targetTable: { type: "string", description: "Target table name (fully qualified)" },
      },
      required: ["name", "sourceConnectionId", "sourceQuery", "targetConnectionId", "targetTable"],
    },
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  {
    name: "notify_user",
    description: "Show a toast notification to the user.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        level: { type: "string", enum: ["info", "success", "warning", "error"] },
      },
      required: ["message", "level"],
    },
  },
];
