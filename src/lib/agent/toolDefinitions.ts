/**
 * toolDefinitions — unified tool schemas for all AgentCommands.
 * Uses UnifiedTool (provider-agnostic). Each provider converts internally.
 */
import type { UnifiedTool } from "../ai/types";
import { STAT_TOOLS } from "../tools/stat.tools";

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
    description: "Request a chart visualization of the current query results.",
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

  // ── Statistical Analysis (Pyodide WASM) ──────────────────────────────────
  ...STAT_TOOLS,

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

    // ── Confidence Scoring ──────────────────────────────────────────────
  {
    name: 'declare_confidence',
    description:
      'After completing an analysis, declare your confidence in the findings and what evidence would change your conclusion. Call this as the LAST tool call before giving the final narrative.',
    parameters: {
      type: 'object',
      properties: {
        confidence: { type: 'number', description: '0.0 to 1.0' },
        confidence_label: { type: 'string', enum: ['high', 'medium', 'low', 'insufficient_data'] },
        data_quality: { type: 'string', enum: ['good', 'limited', 'sparse', 'unreliable'] },
        what_would_change_conclusion: { type: 'string' },
        data_gaps: { type: 'string', description: 'What data is missing that would help?' },
      },
      required: ['confidence', 'confidence_label', 'what_would_change_conclusion'],
    },
  },

  // ── Hypothesis Engine ─────────────────────────────────────────────────────
  {
    name: "declare_hypotheses",
    description:
      "Before running any analysis tool, declare your competing hypotheses about what is causing the observed pattern. ALWAYS call this first when analyzing an anomaly, quality issue, or process upset.",
    parameters: {
      type: "object",
      properties: {
        hypotheses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              statement: { type: "string" },
              probability: { type: "number", description: "0.0 to 1.0" },
              evidence_for: { type: "string" },
              evidence_against: { type: "string" },
              discriminating_test: { type: "string", description: "What single analysis would confirm this?" },
            },
            required: ["statement", "probability"],
          },
        } as any,
        problem_frame: { type: "string", description: "One sentence: what exactly is being investigated?" },
      },
      required: ["hypotheses", "problem_frame"],
    },
  },

  // ── OSIsoft PI Historian ───────────────────────────────────────────────────
  {
    name: 'pi_search_tags',
    description: 'Search OSIsoft PI tags by name or description. Use this to find process data tags in a PI historian.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "temperature" or "PLANT.UNIT.*"' },
        max_count: { type: 'number', description: 'Maximum results to return (default 50)' }
      },
      required: ['query']
    }
  },
  {
    name: 'pi_get_history',
    description: 'Get historical time-series data for PI tags. Specify start/end as ISO8601 strings.',
    parameters: {
      type: 'object',
      properties: {
        web_ids: { type: 'array', items: { type: 'string' }, description: 'List of PI tag WebIds' } as any,
        start: { type: 'string', description: 'Start time (ISO8601 or relative like "*-24h")' },
        end: { type: 'string', description: 'End time (ISO8601 or "*" for now)' },
        interval: { type: 'string', description: 'Interpolation interval e.g. "1h", "5m"' }
      },
      required: ['web_ids', 'start', 'end']
    }
  },
  {
    name: 'pi_get_current',
    description: 'Get current snapshot values for PI tags.',
    parameters: {
      type: 'object',
      properties: {
        web_ids: { type: 'array', items: { type: 'string' }, description: 'List of PI tag WebIds' } as any
      },
      required: ['web_ids']
    }
  },

  // ── Billion-Scale Visualization ───────────────────────────────────────────
  {
    name: "create_gog_chart",
    description: `Create a chart using the Grammar of Graphics specification. This is the PRIMARY tool for all visualization requests. Automatically handles billion-row datasets by using aggregate SQL (binned strategy). Use this for ALL chart/visualization requests.`,
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        schema: { type: "string", description: "Schema name (default: public)" },
        geom: {
          type: "string",
          enum: ["scatter", "line", "bar", "histogram", "box", "area"],
          description: "Chart geometry type",
        },
        x: { type: "string", description: "Column name for X axis" },
        y: { type: "string", description: "Column name for Y axis (optional for histogram)" },
        color: { type: "string", description: "Column for color encoding" },
        title: { type: "string", description: "Chart title" },
        x_label: { type: "string", description: "X axis label" },
        y_label: { type: "string", description: "Y axis label" },
        where_clause: {
          type: "string",
          description: "SQL WHERE clause for filtering (without the WHERE keyword)",
        },
        overlays: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["ref_line", "spec_limits", "mean_line", "trend_line"],
              },
              axis: { type: "string", enum: ["x", "y"] },
              value: { type: "number" },
              lsl: { type: "number" },
              usl: { type: "number" },
              target: { type: "number" },
            },
            required: ["type"],
          },
        } as any,
      },
      required: ["table", "geom", "x"],
    },
  },
];
