/**
 * ImpactMapEngine — H-3 module
 *
 * Before any multi-step agent task executes, this generates an "impact map":
 * a structured plan of what tables/columns will be read or mutated, and the
 * risk level. Displayed to the user in Plan Mode for review before execution.
 */

import type { AgentCommand } from '../commands';

export type ImpactNodeType = 'table' | 'column' | 'view' | 'index' | 'connection';
export type ImpactEdgeType = 'reads' | 'writes' | 'drops' | 'creates' | 'alters';
export type RiskLevel = 'safe' | 'caution' | 'destructive';

export interface ImpactNode {
  id: string;     // e.g. "public.orders", "public.orders.status"
  type: ImpactNodeType;
  label: string;  // human-readable name
}

export interface ImpactEdge {
  from: string;         // node id
  to: string;           // node id
  edgeType: ImpactEdgeType;
  riskLevel: RiskLevel;
}

export interface ImpactMap {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  overallRisk: RiskLevel;  // max risk across all edges
  summary: string;          // one-line human description
}

// ─────────────────────────────────────────────────────────────────────────────

export class ImpactMapEngine {
  /**
   * Generate an impact map from a list of planned AgentCommands.
   */
  static fromCommands(commands: AgentCommand[], connectionId: string | null): ImpactMap {
    const nodeMap = new Map<string, ImpactNode>();
    const edges: ImpactEdge[] = [];

    const connId = connectionId ?? 'default';
    const connNodeId = `connection:${connId}`;

    // Ensure the connection node exists
    nodeMap.set(connNodeId, {
      id: connNodeId,
      type: 'connection',
      label: connId,
    });

    let reads = 0;
    let writes = 0;
    let drops = 0;

    for (const cmd of commands) {
      const edgeType = ImpactMapEngine.commandToEdgeType(cmd.type);
      const cmdRisk: RiskLevel = cmd.risk === 'destructive'
        ? 'destructive'
        : cmd.risk === 'caution'
          ? 'caution'
          : 'safe';

      // Collect target node ids for this command
      const targets: Array<{ id: string; type: ImpactNodeType; label: string }> = [];

      if (cmd.type === 'execute_sql') {
        const tables = ImpactMapEngine.extractTablesFromSql(cmd.sql);
        for (const t of tables) {
          targets.push({ id: t, type: 'table', label: t });
        }
        if (tables.length === 0) {
          targets.push({ id: `sql:${cmd.sql.slice(0, 40)}`, type: 'table', label: 'SQL query' });
        }
      } else if (cmd.type === 'add_column') {
        const nodeId = `${cmd.schema}.${cmd.table}.${cmd.columnName}`;
        targets.push({ id: nodeId, type: 'column', label: `${cmd.table}.${cmd.columnName}` });
      } else if (cmd.type === 'drop_column') {
        const nodeId = `${cmd.schema}.${cmd.table}.${cmd.columnName}`;
        targets.push({ id: nodeId, type: 'column', label: `${cmd.table}.${cmd.columnName}` });
      } else if (cmd.type === 'delete_rows') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'table', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'insert_row') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'table', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'update_cell') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'table', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'bulk_transform') {
        const tables = ImpactMapEngine.extractTablesFromSql(cmd.sql);
        for (const t of tables) {
          targets.push({ id: t, type: 'table', label: t });
        }
        if (tables.length === 0) {
          targets.push({ id: `bulk:${cmd.sql.slice(0, 40)}`, type: 'table', label: 'Bulk SQL' });
        }
      } else if (cmd.type === 'create_index') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'index', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'rename_table') {
        const oldId = `${cmd.schema}.${cmd.oldName}`;
        const newId = `${cmd.schema}.${cmd.newName}`;
        targets.push({ id: oldId, type: 'table', label: `${cmd.schema}.${cmd.oldName}` });
        targets.push({ id: newId, type: 'table', label: `${cmd.schema}.${cmd.newName}` });
      } else if (cmd.type === 'open_table') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'table', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'focus_schema_node') {
        const nodeId = `${cmd.schema}.${cmd.table}`;
        targets.push({ id: nodeId, type: 'table', label: `${cmd.schema}.${cmd.table}` });
      } else if (cmd.type === 'run_stat_tool') {
        targets.push({ id: `stat:${cmd.method}`, type: 'table', label: `Stat: ${cmd.method}` });
      } else {
        // Fallback: use commandType as node id
        targets.push({ id: cmd.type, type: 'table', label: cmd.type });
      }

      // Register nodes and edges
      for (const target of targets) {
        if (!nodeMap.has(target.id)) {
          nodeMap.set(target.id, {
            id: target.id,
            type: target.type,
            label: target.label,
          });
        }

        edges.push({
          from: connNodeId,
          to: target.id,
          edgeType,
          riskLevel: cmdRisk,
        });

        // Count operation types for summary
        if (edgeType === 'reads') reads++;
        else if (edgeType === 'writes') writes++;
        else if (edgeType === 'drops') drops++;
        else if (edgeType === 'creates') writes++; // count creates as writes for summary
        else if (edgeType === 'alters') writes++;  // count alters as writes for summary
      }
    }

    // Determine overall risk: max across all edges
    let overallRisk: RiskLevel = 'safe';
    for (const edge of edges) {
      if (edge.riskLevel === 'destructive') {
        overallRisk = 'destructive';
        break;
      }
      if (edge.riskLevel === 'caution') {
        overallRisk = 'caution';
      }
    }

    const commandCount = commands.length;
    const summary = `${commandCount} operation${commandCount !== 1 ? 's' : ''}: ${reads} read${reads !== 1 ? 's' : ''}, ${writes} write${writes !== 1 ? 's' : ''}, ${drops} drop${drops !== 1 ? 's' : ''}`;

    return {
      nodes: Array.from(nodeMap.values()),
      edges,
      overallRisk,
      summary,
    };
  }

  /**
   * Parse SQL to extract referenced tables (rough approximation).
   * Supports both quoted ("schema"."table") and unquoted (schema.table) formats.
   * Returns unique table ids as "schema.table" strings.
   */
  static extractTablesFromSql(sql: string): string[] {
    // Match patterns: FROM, JOIN, INTO, UPDATE, TABLE followed by schema.table
    // Supports both quoted and unquoted identifiers
    const pattern =
      /(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:"([^"]+)"\."([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*))/gi;

    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(sql)) !== null) {
      // Groups 1+2 are quoted, groups 3+4 are unquoted
      const schema = match[1] ?? match[3];
      const table = match[2] ?? match[4];
      if (schema && table) {
        seen.add(`${schema}.${table}`);
      }
    }

    return Array.from(seen);
  }

  /**
   * Determine the edge type for a given command type.
   */
  private static commandToEdgeType(commandType: string): ImpactEdgeType {
    switch (commandType) {
      case 'execute_sql':
      case 'open_table':
      case 'run_stat_tool':
        return 'reads';

      case 'insert_row':
      case 'update_cell':
      case 'bulk_transform':
        return 'writes';

      case 'drop_column':
      case 'delete_rows':
      case 'rename_table':
        return 'drops';

      case 'add_column':
      case 'create_index':
        return 'creates';

      default:
        return 'reads';
    }
  }
}
