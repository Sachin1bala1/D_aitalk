import type { UnifiedTool } from "../ai/types";

// ── Parameter & body types ─────────────────────────────────────────────────────

export interface UserToolParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
}

export type UserToolBody =
  | { type: "sql_template"; sql: string }
  | {
      type: "chart";
      sql: string;
      chartType: "bar" | "line" | "scatter" | "pie" | "area";
      xColumn: string;
      yColumn: string;
      title?: string;
    }
  | { type: "report"; steps: Array<{ label: string; sql: string }> }
  | { type: "notify"; message: string; level: "info" | "success" | "warning" | "error" };

export interface UserTool {
  /** URL-safe identifier — becomes `user__<id>` in the tool name */
  id: string;
  displayName: string;
  description: string;
  category: string;
  parameters: UserToolParameter[];
  body: UserToolBody;
}

// ── Converters ────────────────────────────────────────────────────────────────

export function userToolToUnifiedTool(tool: UserTool): UnifiedTool {
  return {
    name: `user__${tool.id}`,
    description: `[${tool.category}] ${tool.description}`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
      ),
      required: tool.parameters.filter((p) => p.required).map((p) => p.name),
    },
  };
}

/** Replace {{param_name}} placeholders with values from params. Unknown keys become "". */
export function fillTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ""));
}
