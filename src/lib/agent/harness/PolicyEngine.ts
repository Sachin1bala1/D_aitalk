// src/lib/agent/harness/PolicyEngine.ts
// Executable policy checks applied to every tool call before execution.

export interface PolicyContext {
  sessionId: string;
  connectionId: string | null;
  question: string;
  isReadOnly: boolean;
  connectionType: string;
  piiColumns: string[];
}

export interface PolicyResult {
  allowed: boolean;
  policyId?: string;
  policyName?: string;
  reason?: string;
}

export interface Policy {
  id: string;
  name: string;
  check: (tool: string, input: unknown, ctx: PolicyContext) => string | null;
}

const WRITE_SQL_PATTERNS = /^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE|ALTER)\b/i;
const WRITE_TOOLS = new Set(['delete_rows', 'drop_column', 'rename_table', 'bulk_transform', 'add_column', 'update_cell', 'insert_row']);
const HAS_LIMIT = /\bLIMIT\s+\d+/i;
const HAS_AGGREGATE = /\b(COUNT|SUM|AVG|MAX|MIN|GROUP\s+BY|HAVING|DISTINCT)\b/i;

export const DATAIQ_POLICIES: Policy[] = [
  {
    id: 'no-write-on-readonly',
    name: 'No writes on read-only connections',
    check: (tool, input, ctx) => {
      if (!ctx.isReadOnly) return null;
      if (WRITE_TOOLS.has(tool)) {
        return `Connection is read-only — '${tool}' is blocked`;
      }
      if (tool === 'execute_sql') {
        const sql = ((input as Record<string, unknown>).sql as string) ?? '';
        if (WRITE_SQL_PATTERNS.test(sql)) {
          return `Connection is read-only — write SQL is blocked`;
        }
      }
      return null;
    },
  },

  {
    id: 'pi-historian-readonly',
    name: 'PI Historian is always read-only',
    check: (tool, input, ctx) => {
      if (ctx.connectionType !== 'PIHistorian') return null;
      if (WRITE_TOOLS.has(tool)) {
        return `PI Historian connections are permanently read-only`;
      }
      if (tool === 'execute_sql') {
        const sql = ((input as Record<string, unknown>).sql as string) ?? '';
        if (WRITE_SQL_PATTERNS.test(sql)) {
          return `PI Historian connections are permanently read-only`;
        }
      }
      return null;
    },
  },

  {
    id: 'row-limit-enforcer',
    name: 'Enforce row limits on SELECT queries',
    check: (tool, input, _ctx) => {
      if (tool !== 'execute_sql') return null;
      const sql = ((input as Record<string, unknown>).sql as string) ?? '';
      if (!/^\s*SELECT\b/i.test(sql)) return null;
      if (HAS_LIMIT.test(sql) || HAS_AGGREGATE.test(sql)) return null;
      return `Query must include LIMIT or aggregate functions (COUNT, SUM, AVG, etc.). Add LIMIT to prevent scanning millions of rows.`;
    },
  },

  {
    id: 'no-pii-in-ai-context',
    name: 'Block PII columns from AI context',
    check: (tool, input, ctx) => {
      if (ctx.piiColumns.length === 0) return null;
      if (tool !== 'execute_sql') return null;
      const sql = ((input as Record<string, unknown>).sql as string) ?? '';
      const violating = ctx.piiColumns.filter(col =>
        new RegExp(`\\b${col}\\b`, 'i').test(sql)
      );
      if (violating.length > 0) {
        return `Query references PII-tagged columns: ${violating.join(', ')}. These cannot be sent to the AI model.`;
      }
      return null;
    },
  },
];

export class PolicyEngine {
  static evaluate(
    tool: string,
    input: unknown,
    ctx: PolicyContext,
    policies: Policy[] = DATAIQ_POLICIES
  ): PolicyResult {
    for (const policy of policies) {
      const reason = policy.check(tool, input, ctx);
      if (reason) {
        return { allowed: false, policyId: policy.id, policyName: policy.name, reason };
      }
    }
    return { allowed: true };
  }
}
