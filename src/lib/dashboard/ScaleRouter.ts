import { invoke } from "@tauri-apps/api/core";

export interface ScaleDecision {
  strategy: "raw" | "binned" | "sampled";
  estimatedRows: number;
  bins: number;
  reason: string;
}

export interface ChartAxisConfig {
  xColumn: string;
  yColumn?: string;
  colorColumn?: string;
  tableName: string;
  schema?: string;
  whereClause?: string;
}

export class ScaleRouter {
  static readonly RAW_THRESHOLD = 50_000;
  static readonly BINNED_THRESHOLD = 50_000;
  static readonly BIN_COUNT_DEFAULT = 200;
  static readonly BIN_COUNT_LINE = 1000;
  static readonly BIN_COUNT_BOX = 50;

  static async estimateRowCount(
    connectionId: string,
    tableName: string,
    schema: string,
    whereClause?: string
  ): Promise<number> {
    const sql = whereClause
      ? `SELECT COUNT(*) as n FROM ${schema}.${tableName} WHERE ${whereClause}`
      : `SELECT reltuples::bigint as n FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE relname = '${tableName}' AND nspname = '${schema}'`;
    const result = await invoke<{ rows: Record<string, unknown>[] }>("db_execute_query", {
      connectionId,
      sql,
      limit: 1,
    });
    return Number(result?.rows?.[0]?.n ?? 0);
  }

  static decide(estimatedRows: number, chartType: string): ScaleDecision {
    if (estimatedRows <= this.RAW_THRESHOLD) {
      return {
        strategy: "raw",
        estimatedRows,
        bins: 0,
        reason: `${estimatedRows.toLocaleString()} rows — using raw data`,
      };
    }
    if (chartType === "line") {
      return {
        strategy: "binned",
        estimatedRows,
        bins: this.BIN_COUNT_LINE,
        reason: `${(estimatedRows / 1e6).toFixed(1)}M rows — time-bucketed to ${this.BIN_COUNT_LINE} points`,
      };
    }
    if (chartType === "box") {
      return {
        strategy: "binned",
        estimatedRows,
        bins: this.BIN_COUNT_BOX,
        reason: `${(estimatedRows / 1e6).toFixed(1)}M rows — grouped into ${this.BIN_COUNT_BOX} categories`,
      };
    }
    return {
      strategy: "binned",
      estimatedRows,
      bins: this.BIN_COUNT_DEFAULT,
      reason: `${(estimatedRows / 1e6).toFixed(1)}M rows — binned to ${this.BIN_COUNT_DEFAULT}x${this.BIN_COUNT_DEFAULT} grid`,
    };
  }
}
