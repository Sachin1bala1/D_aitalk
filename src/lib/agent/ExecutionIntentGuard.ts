export interface ToolExecutionOutcome {
  toolName: string;
  success: boolean;
}

const RESULT_PRODUCING_TOOLS = new Set(["execute_sql", "open_table", "run_duckdb_analysis"]);

export function requiresLiveExecution(userMessage: string): boolean {
  const q = userMessage.toLowerCase().trim();

  if (
    /\b(sql only|just the sql|write the sql|show the sql|draft the sql|do not run|don't run|without running)\b/.test(q)
  ) {
    return false;
  }

  if (/\b(first|top|latest)\s+\d+\b/.test(q) || /\blimit\s+\d+\b/.test(q)) {
    return true;
  }

  const action = /\b(run|execute|pull|fetch|get|load|show|query)\b/.test(q);
  const object = /\b(row|rows|record|records|data|table|query|results?)\b/.test(q);
  return action && object;
}

export function hasSuccessfulResultTool(outcomes: ToolExecutionOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.success && RESULT_PRODUCING_TOOLS.has(outcome.toolName));
}

export function attemptedQueryMaterialization(outcomes: ToolExecutionOutcome[]): boolean {
  return outcomes.some((outcome) =>
    outcome.toolName === "set_editor_content" ||
    outcome.toolName === "execute_sql" ||
    outcome.toolName === "open_table",
  );
}

export function getAutoExecutableSql(sql: string | null | undefined): string | null {
  if (!sql) return null;
  const trimmed = sql.trim().replace(/^[;\s]+/, "");
  if (!trimmed) return null;
  if (/^(select|with)\b/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}
