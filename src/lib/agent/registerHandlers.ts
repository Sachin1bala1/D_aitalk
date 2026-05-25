/**
 * registerHandlers — wire every AgentCommand to its implementation.
 *
 * Call once at app startup (App.tsx). After this, `commandBus.dispatch(cmd)`
 * will route to the correct Tauri invoke / WorkspaceStore mutation / UI action.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { commandBus } from "./CommandBus";
import type { CommandResult } from "./CommandBus";
import { DbClient } from "../db/DbClient";
import { rowStore } from "../table/RowStore";
import { QueryManager } from "../table/QueryManager";
import { useWorkspaceStore } from "../stores/WorkspaceStore";
import { ScaleRouter } from "../dashboard/ScaleRouter";
import { BinQueryBuilder } from "../dashboard/BinQueryBuilder";
import type { GoGSpec } from "../dashboard/GoGSpec";
import {
  createChartArtifact,
  createDefaultChartArtifactOptions,
} from "../artifacts/chartArtifacts";
import type { QueryBatch } from "../db/DbClient";
import type {
  SetEditorContentCmd,
  ExecuteSqlCmd,
  CancelQueryCmd,
  OpenTableCmd,
  OpenNewTabCmd,
  CloseTabCmd,
  AddColumnCmd,
  DropColumnCmd,
  RenameTableCmd,
  DeleteRowsCmd,
  BulkTransformCmd,
  CreateIndexCmd,
  FocusSchemaNodeCmd,
  InsertRowCmd,
  UpdateCellCmd,
  RunDuckDbAnalysisCmd,
  RunStatToolCmd,
  AnalyzeLoadedCorrelationCmd,
  AnalyzeLoadedFeatureImportanceCmd,
  AnalyzeLoadedRegressionCmd,
  RunUserToolCmd,
  CreateChartCmd,
  CreateAnalysisChartCmd,
  CreateGoGChartCmd,
  CreatePipelineCmd,
  ListPipelinesCmd,
  RunPipelineCmd,
  SearchWorkspaceCmd,
  ProposeWorkspaceRuleCmd,
  NotifyUserCmd,
  DeclareHypothesesCmd,
  DeclareConfidenceCmd,
  ConfidenceDeclaration,
  PISearchTagsCmd,
  PIGetHistoryCmd,
  PIGetCurrentCmd,
  CreateDerivedTableCmd,
} from "./commands";
import { useUserToolStore } from "../stores/UserToolStore";
import { fillTemplate } from "../tools/user.tools";
import { PyodideRuntime } from "../pyodide/PyodideRuntime";
import { STAT_KERNELS } from "../pyodide/stat_kernels";
import {
  createPipelineDefinition,
  ensurePipelinesLoaded,
  getPipelineRuns,
  inspectPipelines,
  runPipelineDefinition,
} from "../pipelines/PipelineStore";
import { ensureHistoryLoaded, loadHistory } from "../../components/history/QueryHistory";
import {
  ensureBackgroundAgentsLoaded,
  listBackgroundAgentEnvironments,
  getBackgroundAgentRuns,
  listBackgroundAgents,
  listBackgroundAgentApprovals,
} from "../backgroundAgents/BackgroundAgentStore";
import { EpisodicMemory } from "../memory/EpisodicMemory";
import { useWorkspaceRuleStore } from "../memory/WorkspaceRuleStore";
import {
  buildWorkspaceSearchDocuments,
  searchWorkspaceDocuments,
  type WorkspaceSearchDocumentKind,
} from "../search/workspaceSemanticIndex";

const STREAMING_QUERY_TIMEOUT_MS = 15_000;
const DUCKDB_QUERY_TIMEOUT_MS = 15_000;

function asNumericArray(values: unknown): number[] | null {
  if (!Array.isArray(values)) return null;
  const numeric = values
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((value) => Number.isFinite(value));
  return numeric.length === values.length && numeric.length > 1 ? numeric : null;
}

function asNumericMatrix(values: unknown): number[][] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const rows: number[][] = [];
  for (const row of values) {
    if (!Array.isArray(row) || row.length === 0) return null;
    const numericRow = row
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
    if (numericRow.length !== row.length) return null;
    rows.push(numericRow);
  }
  return rows.length > 1 ? rows : null;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index]! - meanX;
    const dy = y[index]! - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  const denominator = Math.sqrt(sumSqX * sumSqY);
  return denominator > 0 ? numerator / denominator : 0;
}

function buildFeatureImportanceFallback(params: Record<string, unknown>): unknown | null {
  const matrix = asNumericMatrix(params.X);
  const target = asNumericArray(params.y);
  if (!matrix || !target || matrix.length !== target.length) return null;

  const featureNames = Array.isArray(params.feature_names)
    ? params.feature_names.map((name, index) => String(name ?? `feature_${index}`))
    : matrix[0]!.map((_, index) => `feature_${index}`);

  const importances = featureNames
    .map((feature, featureIndex) => {
      const series = matrix.map((row) => row[featureIndex] ?? 0);
      const correlation = pearsonCorrelation(series, target);
      return {
        feature,
        importance: Number(Math.abs(correlation).toFixed(6)),
        correlation: Number(correlation.toFixed(6)),
      };
    })
    .sort((left, right) => right.importance - left.importance);

  return {
    importances,
    top_features: importances.slice(0, 5).map((item) => item.feature),
    model_type: "correlation_proxy",
    n_features: featureNames.length,
    n_samples: target.length,
    note: "Fallback ranking used because the Pyodide Random Forest path was unavailable.",
  };
}

function getActiveQueryResults() {
  const state = useWorkspaceStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  return activeTab?.queryResults ?? null;
}

function inferLoadedNumericColumns(
  rows: Record<string, unknown>[],
  fields: Array<{ name: string }>,
): string[] {
  return fields
    .map((field) => field.name)
    .filter((column) =>
      rows.some((row) => {
        const value = row[column];
        return value !== null && value !== undefined && Number.isFinite(Number(value));
      }),
    );
}

function coerceLoadedNumericVector(
  rows: Record<string, unknown>[],
  column: string,
): Array<number | null> {
  return rows.map((row) => {
    const value = row[column];
    if (value === null || value === undefined || value === "") return null;
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  });
}

function buildLoadedCorrelationResult(args: {
  rows: Record<string, unknown>[];
  fields: Array<{ name: string }>;
  targetColumn?: string;
  columns?: string[];
}): unknown | null {
  const numericColumns = inferLoadedNumericColumns(args.rows, args.fields);
  const requestedColumns = (args.columns ?? numericColumns).filter((column) => numericColumns.includes(column));

  if (args.targetColumn) {
    if (!numericColumns.includes(args.targetColumn)) return null;
    const targetVector = coerceLoadedNumericVector(args.rows, args.targetColumn);
    const features = requestedColumns.length > 0
      ? requestedColumns.filter((column) => column !== args.targetColumn)
      : numericColumns.filter((column) => column !== args.targetColumn);

    const ranked = features
      .map((feature) => {
        const featureVector = coerceLoadedNumericVector(args.rows, feature);
        const pairedX: number[] = [];
        const pairedY: number[] = [];
        for (let index = 0; index < targetVector.length; index += 1) {
          const x = featureVector[index];
          const y = targetVector[index];
          if (x == null || y == null) continue;
          pairedX.push(x);
          pairedY.push(y);
        }
        const correlation = pairedX.length >= 2 ? pearsonCorrelation(pairedX, pairedY) : 0;
        return {
          feature,
          correlation: Number(correlation.toFixed(6)),
          strength: Number(Math.abs(correlation).toFixed(6)),
          samples: pairedX.length,
        };
      })
      .sort((left, right) => right.strength - left.strength);

    return {
      targetColumn: args.targetColumn,
      rankedCorrelations: ranked,
      topFeatures: ranked.slice(0, 5).map((item) => item.feature),
      n_features: ranked.length,
      n_samples: args.rows.length,
      analysis_type: "target_correlation_ranking",
    };
  }

  const columns = requestedColumns.slice(0, 8);
  if (columns.length < 2) return null;
  const matrix = columns.map((left) => ({
    column: left,
    correlations: columns.map((right) => {
      if (left === right) return { column: right, correlation: 1 };
      const leftVector = coerceLoadedNumericVector(args.rows, left);
      const rightVector = coerceLoadedNumericVector(args.rows, right);
      const pairedLeft: number[] = [];
      const pairedRight: number[] = [];
      for (let index = 0; index < leftVector.length; index += 1) {
        const l = leftVector[index];
        const r = rightVector[index];
        if (l == null || r == null) continue;
        pairedLeft.push(l);
        pairedRight.push(r);
      }
      const correlation = pairedLeft.length >= 2 ? pearsonCorrelation(pairedLeft, pairedRight) : 0;
      return { column: right, correlation: Number(correlation.toFixed(6)) };
    }),
  }));

  return {
    columns,
    matrix,
    n_samples: args.rows.length,
    analysis_type: "correlation_matrix",
  };
}

async function buildLoadedFeatureImportanceResult(args: {
  rows: Record<string, unknown>[];
  fields: Array<{ name: string }>;
  targetColumn: string;
  featureColumns?: string[];
}): Promise<unknown | null> {
  const numericColumns = inferLoadedNumericColumns(args.rows, args.fields);
  if (!numericColumns.includes(args.targetColumn)) return null;

  const features = (args.featureColumns?.length ? args.featureColumns : numericColumns)
    .filter((column) => column !== args.targetColumn)
    .filter((column) => numericColumns.includes(column));
  if (features.length === 0) return null;

  const matrix: number[][] = [];
  const target: number[] = [];
  for (const row of args.rows) {
    const rowValues = features.map((feature) => {
      const raw = row[feature];
      const numeric = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(numeric) ? numeric : null;
    });
    const targetRaw = row[args.targetColumn];
    const targetValue = typeof targetRaw === "number" ? targetRaw : Number(targetRaw);
    if (!Number.isFinite(targetValue) || rowValues.some((value) => value == null)) continue;
    matrix.push(rowValues as number[]);
    target.push(targetValue);
  }

  if (matrix.length < 3) return null;

  try {
    const rawResult = await PyodideRuntime.getInstance().run(STAT_KERNELS.feature_importance, {
      X: matrix,
      y: target,
      feature_names: features,
      n_estimators: 100,
      random_state: 42,
    });
    return enrichFeatureImportanceResult(rawResult, matrix, target, features, args.targetColumn);
  } catch {
    return enrichFeatureImportanceResult(buildFeatureImportanceFallback({
      X: matrix,
      y: target,
      feature_names: features,
    }), matrix, target, features, args.targetColumn);
  }
}

async function buildLoadedRegressionResult(args: {
  rows: Record<string, unknown>[];
  fields: Array<{ name: string }>;
  targetColumn: string;
  featureColumns?: string[];
}): Promise<unknown | null> {
  const numericColumns = inferLoadedNumericColumns(args.rows, args.fields);
  if (!numericColumns.includes(args.targetColumn)) return null;

  const features = (args.featureColumns?.length ? args.featureColumns : numericColumns)
    .filter((column) => column !== args.targetColumn)
    .filter((column) => numericColumns.includes(column));
  if (features.length === 0) return null;

  const matrix: number[][] = [];
  const target: number[] = [];
  for (const row of args.rows) {
    const rowValues = features.map((feature) => {
      const raw = row[feature];
      const numeric = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(numeric) ? numeric : null;
    });
    const targetRaw = row[args.targetColumn];
    const targetValue = typeof targetRaw === "number" ? targetRaw : Number(targetRaw);
    if (!Number.isFinite(targetValue) || rowValues.some((value) => value == null)) continue;
    matrix.push(rowValues as number[]);
    target.push(targetValue);
  }

  if (matrix.length < 3) return null;

  try {
    const raw = await PyodideRuntime.getInstance().run(STAT_KERNELS.multi_regression, {
      X: matrix,
      y: target,
      feature_names: features,
      cv_folds: 5,
    });
    return enrichRegressionResult(raw, matrix, target, features, args.targetColumn);
  } catch {
    return null;
  }
}

function enrichRegressionResult(
  rawResult: unknown,
  matrix: number[][],
  target: number[],
  features: string[],
  targetColumn: string,
): unknown {
  const base = rawResult && typeof rawResult === "object" ? { ...(rawResult as Record<string, unknown>) } : {};
  const coefficients = Array.isArray(base.coefficients)
    ? (base.coefficients as Array<Record<string, unknown>>)
    : [];
  const enriched = features.map((feature, featureIndex) => {
    const coefEntry = coefficients.find((item) => String(item.feature) === feature);
    const coefficient = Number(coefEntry?.coef ?? 0);
    const featureVector = matrix.map((row) => row[featureIndex] ?? 0);
    const correlation = pearsonCorrelation(featureVector, target);
    const vif = Number(coefEntry?.vif ?? 0);
    const significance = Math.abs(correlation) >= 0.7 ? "high"
      : Math.abs(correlation) >= 0.4 ? "medium"
      : "low";
    return {
      feature,
      coefficient: Number(coefficient.toFixed(6)),
      correlation: Number(correlation.toFixed(6)),
      effect_direction: coefficient > 0 ? "positive" : coefficient < 0 ? "negative" : "neutral",
      significance_band: significance,
      vif: Number.isFinite(vif) ? Number(vif.toFixed(6)) : null,
    };
  }).sort((left, right) => Math.abs(right.coefficient) - Math.abs(left.coefficient));

  return {
    ...base,
    target_column: targetColumn,
    enriched_coefficients: enriched,
    summary:
      enriched.length > 0
        ? `${enriched[0]!.feature} shows the strongest modeled effect on ${targetColumn} with a ${enriched[0]!.effect_direction} coefficient of ${enriched[0]!.coefficient}. Model R² is ${Number(Number(base.r_squared ?? 0).toFixed(4))}.`
        : `No multivariate regression explanation was derived for ${targetColumn}.`,
  };
}

function enrichFeatureImportanceResult(
  rawResult: unknown,
  matrix: number[][],
  target: number[],
  features: string[],
  targetColumn: string,
): unknown {
  const base = rawResult && typeof rawResult === "object" ? { ...(rawResult as Record<string, unknown>) } : {};
  const importances = Array.isArray(base.importances)
    ? (base.importances as Array<Record<string, unknown>>)
    : [];
  const totalImportance = importances.reduce((sum, item) => {
    const value = Number(item.importance ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const detailedFactors = features.map((feature, featureIndex) => {
    const featureVector = matrix.map((row) => row[featureIndex] ?? 0);
    const correlation = pearsonCorrelation(featureVector, target);
    const importanceEntry = importances.find((item) => String(item.feature) === feature);
    const importance = Number(importanceEntry?.importance ?? Math.abs(correlation));
    const contributionPct = totalImportance > 0 ? (importance / totalImportance) * 100 : 0;
    return {
      feature,
      importance: Number(importance.toFixed(6)),
      contribution_pct: Number(contributionPct.toFixed(2)),
      correlation: Number(correlation.toFixed(6)),
      effect_direction: correlation > 0 ? "positive" : correlation < 0 ? "negative" : "neutral",
      effect_strength: Number(Math.abs(correlation).toFixed(6)),
    };
  }).sort((left, right) => right.importance - left.importance);

  return {
    ...base,
    target_column: targetColumn,
    top_features: detailedFactors.slice(0, 5).map((item) => item.feature),
    detailed_factors: detailedFactors,
    summary:
      detailedFactors.length > 0
        ? `${detailedFactors[0]!.feature} is the strongest driver of ${targetColumn} with ${detailedFactors[0]!.contribution_pct}% relative importance and a ${detailedFactors[0]!.effect_direction} relationship.`
        : `No significant loaded factors were derived for ${targetColumn}.`,
  };
}

export function registerHandlers() {
  const runStreamingQuery = async (connectionId: string, sql: string): Promise<CommandResult> => {
    const { setEditorSql, setTabExecuting, setQueryResults } =
      useWorkspaceStore.getState();

    setEditorSql(sql);
    setTabExecuting(true);
    QueryManager.setBaseQuery(sql, connectionId);

    try {
      return await new Promise((resolve) => {
        const allRows: Record<string, unknown>[] = [];
        let fields: { name: string }[] = [];
        let queryId: string | null = null;
        let sourceTables: string[] = [];
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const finish = (payload: CommandResult) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unlistenFn?.();
          resolve(payload);
        };

        const onError = (message: string) => {
          rowStore.finalize();
          setTabExecuting(false);
          finish({ success: false, error: message });
        };

        let unlistenFn: (() => void) | null = null;
        timeoutHandle = setTimeout(() => {
          onError("Query execution timed out. Try narrowing the query, lowering the row count, or running a more targeted aggregate first.");
        }, STREAMING_QUERY_TIMEOUT_MS);
        listen<QueryBatch>("query_batch", (event) => {
          const batch = event.payload;
          if (!queryId || batch.query_id !== queryId) return;

          rowStore.appendBatch(batch);

          if (batch.columns && fields.length === 0) {
            fields = batch.columns.map((c) => ({ name: c.name }));
            QueryManager.setColumns(fields.map((field) => field.name));
          }
          allRows.push(...batch.rows);

          if (batch.error) {
            onError(batch.error);
          } else if (batch.is_final) {
            setTabExecuting(false);
            setQueryResults({
              rows: allRows,
              fields,
              rowCount: allRows.length,
              elapsedMs: batch.total_elapsed_ms,
              queryId,
              source_tables: sourceTables,
            });
            finish({
              success: true,
              result: {
                rowCount: allRows.length,
                elapsedMs: batch.total_elapsed_ms,
                preview: allRows.slice(0, 5),
                columns: fields.map((field) => field.name),
                sourceTables,
              },
            });
          }
        }).then(async (fn) => {
          unlistenFn = fn;
          try {
            const response = await DbClient.executeStreaming(connectionId, sql);
            queryId = response.query_id;
            sourceTables = response.source_tables;
            rowStore.reset(queryId);
          } catch (e: any) {
            onError(e.message ?? "Query failed");
          }
        }).catch((e: any) => {
          onError(e?.message ?? "Failed to listen for query results");
        });
      });
    } catch (e: any) {
      setTabExecuting(false);
      rowStore.finalize();
      return { success: false, error: e.message ?? "Query failed" };
    }
  };
  // ── SQL ───────────────────────────────────────────────────────────────────

  commandBus.register<SetEditorContentCmd>("set_editor_content", async (cmd) => {
    useWorkspaceStore.getState().setEditorSql(cmd.sql);
    return { success: true, result: "SQL written to editor" };
  });

  commandBus.register<ExecuteSqlCmd>("execute_sql", async (cmd) => {
    return runStreamingQuery(cmd.connectionId, cmd.sql);
  });

  commandBus.register<CancelQueryCmd>("cancel_query", async () => {
    useWorkspaceStore.getState().setTabExecuting(false);
    rowStore.finalize();
    return { success: true, result: "Query cancelled" };
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  commandBus.register<OpenTableCmd>("open_table", async (cmd) => {
    const state = useWorkspaceStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
    const effectiveConnectionId = activeTab?.connectionId ?? state.activeConnectionId;
    const { connections } = state;
    if (!effectiveConnectionId) return { success: false, error: "No active connection" };
    const conn = connections.find((c) => c.id === effectiveConnectionId);
    const driver = conn?.driver ?? "postgres";

    let sql: string;
    if (driver === "mongodb") {
      // MongoDB streaming uses collection name as the "SQL" parameter
      sql = cmd.table;
    } else if (driver === "redis") {
      // Redis streaming uses prefix (part before first ':')
      sql = cmd.table;
    } else {
      sql = `SELECT * FROM "${cmd.schema}"."${cmd.table}" LIMIT 500;`;
    }

    const result = await runStreamingQuery(effectiveConnectionId, sql);
    if (!result.success) return result;
    return {
      success: true,
      result: {
        ...(typeof result.result === "object" && result.result !== null ? result.result : {}),
        openedTable: `${cmd.schema}.${cmd.table}`,
        message: `Opened ${cmd.schema}.${cmd.table} and loaded preview rows`,
      },
    };
  });

  commandBus.register<OpenNewTabCmd>("open_new_tab", async (cmd) => {
    const { addTab } = useWorkspaceStore.getState();
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      type: "sql_editor",
      title: cmd.title ?? "New Query",
      sql: "",
      connectionId: useWorkspaceStore.getState().activeConnectionId,
      queryResults: null,
      isExecuting: false,
    });
    return { success: true, result: `Opened new tab: ${cmd.title ?? "New Query"}` };
  });

  // ── Schema mutation ───────────────────────────────────────────────────────

  commandBus.register<AddColumnCmd>("add_column", async (cmd) => {
    const { activeConnectionId, pushUndo, setSchema } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    try {
      await DbClient.addColumn(
        activeConnectionId,
        cmd.schema,
        cmd.table,
        cmd.columnName,
        cmd.dataType,
        cmd.nullable,
        cmd.defaultValue,
      );
      pushUndo({
        id: `undo-${Date.now()}`,
        humanReadable: `Added column ${cmd.columnName} to ${cmd.schema}.${cmd.table}`,
        command: cmd,
        timestamp: Date.now(),
      });
      const schema = await DbClient.getSchema(activeConnectionId);
      setSchema(activeConnectionId, schema);
      return { success: true, result: `Added column ${cmd.columnName} to ${cmd.schema}.${cmd.table}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<DropColumnCmd>("drop_column", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === activeConnectionId)?.driver;
    const noSqlDrivers = ["mongodb", "redis", "clickhouse"];
    if (driver && noSqlDrivers.includes(driver)) {
      return { success: false, error: `DROP COLUMN is not supported for ${driver}. Use the native shell or driver tools.` };
    }
    try {
      await DbClient.execute(
        activeConnectionId,
        `ALTER TABLE "${cmd.schema}"."${cmd.table}" DROP COLUMN "${cmd.columnName}";`,
      );
      const schema = await DbClient.getSchema(activeConnectionId);
      useWorkspaceStore.getState().setSchema(activeConnectionId, schema);
      return { success: true, result: `Dropped column ${cmd.columnName}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<RenameTableCmd>("rename_table", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === connectionId)?.driver;
    const noSqlDrivers = ["mongodb", "redis", "clickhouse"];
    if (driver && noSqlDrivers.includes(driver)) {
      return { success: false, error: `RENAME TABLE is not supported for ${driver}. Use the native shell or driver tools.` };
    }
    try {
      await DbClient.execute(
        connectionId,
        `ALTER TABLE "${cmd.schema}"."${cmd.oldName}" RENAME TO "${cmd.newName}";`,
      );
      const schema = await DbClient.getSchema(connectionId);
      useWorkspaceStore.getState().setSchema(connectionId, schema);
      return { success: true, result: `Renamed ${cmd.oldName} to ${cmd.newName}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Data mutation ─────────────────────────────────────────────────────────

  commandBus.register<DeleteRowsCmd>("delete_rows", async (cmd) => {
    const { activeConnectionId, pushUndo } = useWorkspaceStore.getState();
    if (!activeConnectionId) return { success: false, error: "No active connection" };
    try {
      const affected = await DbClient.execute(
        activeConnectionId,
        `DELETE FROM "${cmd.schema}"."${cmd.table}" WHERE ${cmd.where};`,
      );
      pushUndo({
        id: `undo-${Date.now()}`,
        humanReadable: `Deleted rows from ${cmd.schema}.${cmd.table} WHERE ${cmd.where}`,
        command: cmd,
        timestamp: Date.now(),
      });
      return { success: true, result: `Deleted ${affected} rows` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<BulkTransformCmd>("bulk_transform", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const affected = await DbClient.execute(connectionId, cmd.sql);
      return { success: true, result: `${affected} rows affected` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Schema helpers ────────────────────────────────────────────────────────

  commandBus.register<CreateIndexCmd>("create_index", async (cmd) => {
    const { activeConnectionId, connections } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    const driver = connections.find((c) => c.id === connectionId)?.driver;
    if (driver === "mongodb") return { success: false, error: "Use MongoDB's createIndex() via the shell for index management." };
    if (driver === "redis") return { success: false, error: "Redis does not support SQL indexes." };
    if (driver === "clickhouse") return { success: false, error: "ClickHouse does not support CREATE INDEX — use ORDER BY / MergeTree settings instead." };
    try {
      const uniqueStr = cmd.unique ? "UNIQUE " : "";
      const namePart = cmd.indexName ? `"${cmd.indexName}"` : "";
      const colsPart = cmd.columns.map((c) => `"${c}"`).join(", ");
      const sql = `CREATE ${uniqueStr}INDEX ${namePart} ON "${cmd.schema}"."${cmd.table}" (${colsPart});`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Created index on ${cmd.schema}.${cmd.table}(${cmd.columns.join(", ")})` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<FocusSchemaNodeCmd>("focus_schema_node", async (cmd) => {
    useWorkspaceStore.getState().setFocusedNode(`${cmd.schema}.${cmd.table}`);
    toast.info(`Focusing ${cmd.schema}.${cmd.table} in schema tree`);
    return { success: true, result: `Focused ${cmd.schema}.${cmd.table}` };
  });

  // ── Single-row mutations ──────────────────────────────────────────────────

  commandBus.register<InsertRowCmd>("insert_row", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const cols = Object.keys(cmd.values).map((c) => `"${c}"`).join(", ");
      const vals = Object.values(cmd.values)
        .map((v) => (v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v)))
        .join(", ");
      const sql = `INSERT INTO "${cmd.schema}"."${cmd.table}" (${cols}) VALUES (${vals});`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Inserted 1 row into ${cmd.schema}.${cmd.table}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  commandBus.register<UpdateCellCmd>("update_cell", async (cmd) => {
    const connectionId = useWorkspaceStore.getState().activeConnectionId;
    if (!connectionId) return { success: false, error: "No active connection" };
    try {
      const newVal = cmd.newValue === null ? "NULL" : typeof cmd.newValue === "string"
        ? `'${String(cmd.newValue).replace(/'/g, "''")}'`
        : String(cmd.newValue);
      const pkVal = typeof cmd.pkValue === "string"
        ? `'${String(cmd.pkValue).replace(/'/g, "''")}'`
        : String(cmd.pkValue);
      const sql = `UPDATE "${cmd.schema}"."${cmd.table}" SET "${cmd.column}" = ${newVal} WHERE "${cmd.pkColumn}" = ${pkVal};`;
      await DbClient.execute(connectionId, sql);
      return { success: true, result: `Updated ${cmd.schema}.${cmd.table}.${cmd.column}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Statistical Analysis (Pyodide) ───────────────────────────────────────

  commandBus.register<RunStatToolCmd>("run_stat_tool", async (cmd) => {
    const kernelCode = STAT_KERNELS[cmd.method];
    if (!kernelCode) {
      return { success: false, error: `Unknown stat method: ${cmd.method}` };
    }
    try {
      const result = await PyodideRuntime.getInstance().run(kernelCode, cmd.params);
      return { success: true, result };
    } catch (e: any) {
      if (cmd.method === "feature_importance") {
        const fallback = buildFeatureImportanceFallback(cmd.params);
        if (fallback) {
          return { success: true, result: fallback };
        }
      }
      return { success: false, error: e.message ?? "Stat kernel failed" };
    }
  });

  // ── User-Defined Tools ────────────────────────────────────────────────────

  commandBus.register<AnalyzeLoadedCorrelationCmd>("analyze_loaded_correlation", async (cmd) => {
    const currentResults = getActiveQueryResults();
    if (!currentResults || currentResults.rowCount === 0) {
      return {
        success: false,
        error: "No query results are currently loaded. Execute a query first, then analyze the loaded rows.",
      };
    }

    const result = buildLoadedCorrelationResult({
      rows: currentResults.rows,
      fields: currentResults.fields,
      targetColumn: cmd.targetColumn,
      columns: cmd.columns,
    });

    if (!result) {
      return {
        success: false,
        error: "Could not derive numeric loaded columns for correlation analysis. Ensure the active results include numeric fields.",
      };
    }

    return { success: true, result };
  });

  commandBus.register<AnalyzeLoadedFeatureImportanceCmd>("analyze_loaded_feature_importance", async (cmd) => {
    const currentResults = getActiveQueryResults();
    if (!currentResults || currentResults.rowCount === 0) {
      return {
        success: false,
        error: "No query results are currently loaded. Execute a query first, then analyze the loaded rows.",
      };
    }

    const result = await buildLoadedFeatureImportanceResult({
      rows: currentResults.rows,
      fields: currentResults.fields,
      targetColumn: cmd.targetColumn,
      featureColumns: cmd.featureColumns,
    });

    if (!result) {
      return {
        success: false,
        error: `Could not compute feature ranking from the loaded results for ${cmd.targetColumn}. Ensure the active results contain that numeric target and at least one numeric feature column.`,
      };
    }

    // Auto-create a bar chart from detailed_factors so the LLM doesn't need
    // to copy large row arrays into a separate create_analysis_chart call.
    const resultRecord = result as Record<string, unknown>;
    const factors: Array<Record<string, unknown>> = Array.isArray(resultRecord.detailed_factors)
      ? (resultRecord.detailed_factors as Array<Record<string, unknown>>)
      : [];
    if (factors.length > 0) {
      console.log('[featureImportance] auto-charting', factors.length, 'factors:', factors.map(f => f['feature']));
      toast.success(`Feature importance chart ready — ${factors.length} factors computed`, { duration: 4000 });
      const now = Date.now();
      const chartFields = Array.from(new Set(factors.flatMap(Object.keys))).map((name) => ({ name }));
      const snapshotResults = {
        rows: factors,
        fields: chartFields,
        rowCount: factors.length,
        elapsedMs: 0,
        queryId: `feature-importance-${now}`,
        source_tables: ["analysis.output"],
      };
      const chartTitle = `Feature Importance for ${cmd.targetColumn}`;
      const artifact = createChartArtifact({
        name: chartTitle,
        chartType: "bar",
        assignments: {
          x: "feature",
          y: "importance",
          color: null,
          size: null,
          facet: null,
        },
        options: createDefaultChartArtifactOptions({
          xLabel: "Feature",
          yLabel: "Importance",
        }),
        results: snapshotResults,
        sql: "",
        connectionId: null,
        sourceTabId: null,
      });
      useWorkspaceStore.getState().commitArtifactRevision(artifact);
      useWorkspaceStore.getState().setGraphBuilderRequest({
        requestId: `gb-importance-${now}-${Math.random().toString(36).slice(2, 8)}`,
        artifactId: artifact.id,
        chartType: "bar",
        xColumn: "feature",
        yColumn: "importance",
        title: chartTitle,
        xLabel: "Feature",
        yLabel: "Importance",
      });
    }

    return { success: true, result };
  });

  commandBus.register<AnalyzeLoadedRegressionCmd>("analyze_loaded_regression", async (cmd) => {
    const currentResults = getActiveQueryResults();
    if (!currentResults || currentResults.rowCount === 0) {
      return {
        success: false,
        error: "No query results are currently loaded. Execute a query first, then analyze the loaded rows.",
      };
    }

    const result = await buildLoadedRegressionResult({
      rows: currentResults.rows,
      fields: currentResults.fields,
      targetColumn: cmd.targetColumn,
      featureColumns: cmd.featureColumns,
    });

    if (!result) {
      return {
        success: false,
        error: `Could not compute regression detail from the loaded results for ${cmd.targetColumn}. Ensure the active results contain that numeric target and enough numeric feature columns.`,
      };
    }

    return { success: true, result };
  });

  commandBus.register<RunUserToolCmd>("run_user_tool", async (cmd) => {
    const tool = useUserToolStore.getState().tools.find((t) => t.id === cmd.toolId);
    if (!tool) {
      return { success: false, error: `User tool not found: ${cmd.toolId}` };
    }

    const { body } = tool;

    if (body.type === "notify") {
      return commandBus.dispatch({
        type: "notify_user",
        message: fillTemplate(body.message, cmd.params),
        level: body.level,
        risk: "safe",
      });
    }

    if (body.type === "sql_template") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      return commandBus.dispatch({
        type: "execute_sql",
        sql: fillTemplate(body.sql, cmd.params),
        connectionId: cmd.connectionId,
        risk: "safe",
      });
    }

    if (body.type === "chart") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      const queryResult = await commandBus.dispatch({
        type: "execute_sql",
        sql: fillTemplate(body.sql, cmd.params),
        connectionId: cmd.connectionId,
        risk: "safe",
      });
      if (!queryResult.success) return queryResult;
      return commandBus.dispatch({
        type: "create_chart",
        chartType: body.chartType,
        xColumn: body.xColumn,
        yColumn: body.yColumn,
        title: body.title ?? tool.displayName,
        risk: "safe",
      });
    }

    if (body.type === "report") {
      if (!cmd.connectionId) {
        return { success: false, error: "No active database connection" };
      }
      const results: Array<{ label: string; data: unknown }> = [];
      for (const step of body.steps) {
        const r = await commandBus.dispatch({
          type: "execute_sql",
          sql: fillTemplate(step.sql, cmd.params),
          connectionId: cmd.connectionId,
          risk: "safe",
        });
        if (!r.success) return r;
        results.push({ label: step.label, data: r.result });
      }
      return { success: true, result: results };
    }

    return { success: false, error: "Unknown user tool body type" };
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  commandBus.register<RunDuckDbAnalysisCmd>("run_duckdb_analysis", async (cmd) => {
    try {
      const queryId = await DbClient.duckdbQuery(cmd.sql);
      rowStore.reset(queryId);

      return new Promise((resolve) => {
        let unlistenFn: (() => void) | null = null;
        let settled = false;
        const finish = (payload: CommandResult) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          unlistenFn?.();
          resolve(payload);
        };
        const timeoutHandle = setTimeout(() => {
          rowStore.finalize();
          finish({
            success: false,
            error: "DuckDB analysis timed out. Try reducing the data volume or using a narrower SQL query first.",
          });
        }, DUCKDB_QUERY_TIMEOUT_MS);

        listen<QueryBatch>("query_batch", (event) => {
          const batch = event.payload;
          if (batch.query_id !== queryId) return;

          rowStore.appendBatch(batch);

          if (batch.error) {
            rowStore.finalize();
            finish({ success: false, error: batch.error });
          } else if (batch.is_final) {
            finish({ success: true, result: `DuckDB analysis complete: ${batch.rows_so_far} rows` });
          }
        }).then((fn) => {
          unlistenFn = fn;
        });
      });
    } catch (e: any) {
      return { success: false, error: e.message ?? "DuckDB query failed" };
    }
  });

  // ── Tab management ────────────────────────────────────────────────────────

  commandBus.register<CloseTabCmd>("close_tab", async (cmd) => {
    const { activeTabId, closeTab } = useWorkspaceStore.getState();
    const targetId = cmd.tabId ?? activeTabId;
    if (!targetId) return { success: false, error: "No tab to close" };
    closeTab(targetId);
    return { success: true, result: `Closed tab ${targetId}` };
  });

  // ── Charts (stub — renders in future ChartPanel) ──────────────────────────

  commandBus.register<CreateChartCmd>("create_chart", async (cmd) => {
    const { activeTabId, tabs, commitArtifactRevision } = useWorkspaceStore.getState();
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
    const currentResults = activeTab?.queryResults ?? null;

    if (!currentResults || currentResults.rowCount === 0) {
      return {
        success: false,
        error: "No query results are loaded yet. Run execute_sql first, then create the chart from those loaded rows.",
      };
    }

    const availableColumns = new Set(currentResults.fields.map((field) => field.name));
    const missing = [cmd.xColumn, cmd.yColumn, cmd.colorColumn]
      .filter((column): column is string => Boolean(column))
      .filter((column) => !availableColumns.has(column));
    if (missing.length > 0) {
      return {
        success: false,
        error: `The current query results do not include: ${missing.join(", ")}. Re-run a query that selects those columns before plotting.`,
      };
    }

    const artifact = createChartArtifact({
      name: cmd.title ?? `${cmd.yColumn} by ${cmd.xColumn}`,
      chartType: cmd.chartType,
      assignments: {
        x: cmd.xColumn,
        y: cmd.yColumn,
        color: cmd.colorColumn ?? null,
        size: null,
        facet: null,
      },
      options: createDefaultChartArtifactOptions({
        xLabel: cmd.xLabel ?? cmd.xColumn,
        yLabel: cmd.yLabel ?? cmd.yColumn,
      }),
      results: currentResults,
      sql: activeTab?.sql ?? "",
      connectionId: activeTab?.connectionId ?? null,
      sourceTabId: activeTab?.id ?? null,
    });
    commitArtifactRevision(artifact);

    useWorkspaceStore.getState().setGraphBuilderRequest({
      requestId: `gb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      artifactId: artifact.id,
      chartType: cmd.chartType,
      xColumn: cmd.xColumn,
      yColumn: cmd.yColumn,
      colorColumn: cmd.colorColumn,
      title: cmd.title,
      xLabel: cmd.xLabel ?? cmd.xColumn,
      yLabel: cmd.yLabel ?? cmd.yColumn,
    });
    toast.success(`Chart: ${cmd.chartType} — ${cmd.xColumn} vs ${cmd.yColumn}`);
    return {
      success: true,
      result: {
        target: "graph_builder",
        artifactId: artifact.id,
        chartType: cmd.chartType,
        rowCount: currentResults.rowCount,
        columns: [cmd.xColumn, cmd.yColumn, cmd.colorColumn].filter(Boolean),
        message: `Opened ${cmd.chartType} graph in Graph Builder`,
      },
    };
  });

  // ── Grammar-of-Graphics charts (billion-scale) ────────────────────────────

  commandBus.register<CreateAnalysisChartCmd>("create_analysis_chart", async (cmd) => {
    if (!Array.isArray(cmd.rows) || cmd.rows.length === 0) {
      return { success: false, error: "No analysis rows were provided to plot." };
    }

    const availableColumns = new Set(Object.keys(cmd.rows[0] ?? {}));
    const missing = [cmd.xKey, cmd.yKey, cmd.colorKey]
      .filter((column): column is string => Boolean(column))
      .filter((column) => !availableColumns.has(column));
    if (missing.length > 0) {
      return {
        success: false,
        error: `The provided analysis rows do not include: ${missing.join(", ")}.`,
      };
    }

    const fields = Array.from(availableColumns).map((name) => ({ name }));
    const now = Date.now();
    const snapshotResults = {
      rows: cmd.rows,
      fields,
      rowCount: cmd.rows.length,
      elapsedMs: 0,
      queryId: `analysis-chart-${now}`,
      source_tables: ["analysis.output"],
    };

    const artifact = createChartArtifact({
      name: cmd.title ?? `${cmd.yKey} by ${cmd.xKey}`,
      chartType: cmd.chartType,
      assignments: {
        x: cmd.xKey,
        y: cmd.yKey,
        color: cmd.colorKey ?? null,
        size: null,
        facet: null,
      },
      options: createDefaultChartArtifactOptions({
        xLabel: cmd.xLabel ?? cmd.xKey,
        yLabel: cmd.yLabel ?? cmd.yKey,
      }),
      results: snapshotResults,
      sql: "",
      connectionId: null,
      sourceTabId: null,
    });
    useWorkspaceStore.getState().commitArtifactRevision(artifact);
    useWorkspaceStore.getState().setGraphBuilderRequest({
      requestId: `gb-analysis-${now}-${Math.random().toString(36).slice(2, 8)}`,
      artifactId: artifact.id,
      chartType: cmd.chartType,
      xColumn: cmd.xKey,
      yColumn: cmd.yKey,
      colorColumn: cmd.colorKey,
      title: cmd.title,
      xLabel: cmd.xLabel ?? cmd.xKey,
      yLabel: cmd.yLabel ?? cmd.yKey,
    });

    return {
      success: true,
      result: {
        target: "graph_builder",
        artifactId: artifact.id,
        chartType: cmd.chartType,
        rowCount: cmd.rows.length,
        columns: [cmd.xKey, cmd.yKey, cmd.colorKey].filter(Boolean),
        message: `Opened ${cmd.chartType} analysis graph in Graph Builder`,
      },
    };
  });

  commandBus.register<CreateGoGChartCmd>("create_gog_chart", async (cmd) => {
    const { activeConnectionId } = useWorkspaceStore.getState();
    const connectionId = activeConnectionId ?? "";
    const schema = cmd.schema ?? "public";

    // 1. Build GoGSpec
    const spec: GoGSpec = {
      table: cmd.table,
      schema,
      connectionId,
      whereClause: cmd.where_clause,
      aes: {
        x: cmd.x,
        y: cmd.y,
        color: cmd.color,
      },
      geom: cmd.geom as GoGSpec["geom"],
      stat: "identity",
      guides: {
        title: cmd.title,
        xLabel: cmd.x_label ?? cmd.x,
        yLabel: cmd.y_label ?? cmd.y,
      },
      overlays: (cmd.overlays ?? []) as GoGSpec["overlays"],
    };

    // 2. Estimate row count
    let estimatedRows = 0;
    try {
      estimatedRows = await ScaleRouter.estimateRowCount(connectionId, cmd.table, schema, cmd.where_clause);
    } catch {
      estimatedRows = 0;
    }

    // 3. Decide strategy
    const decision = ScaleRouter.decide(estimatedRows, cmd.geom);
    const effectiveStrategy: "raw" | "binned" = decision.strategy === "binned" ? "binned" : "raw";
    spec._runtime = {
      strategy: effectiveStrategy,
      estimatedRows: decision.estimatedRows,
      generatedSQL: "",
    };

    if (estimatedRows <= 0) {
      return {
        success: false,
        error: `No rows are available for ${schema}.${cmd.table}${cmd.where_clause ? ` with filter (${cmd.where_clause})` : ""}.`,
      };
    }

    if (effectiveStrategy === "raw") {
      return {
        success: false,
        error: "This request is small enough for interactive Graph Builder. Execute a SQL query first, then use create_chart instead of create_gog_chart.",
      };
    }

    // 4. If binned: generate and execute bin SQL
    let binData: Record<string, unknown>[] | null = null;
    let binQueryError: string | null = null;
    if (decision.strategy === "binned" && connectionId) {
      let sql = "";
      try {
        if (cmd.geom === "scatter" && cmd.y) {
          sql = BinQueryBuilder.scatter(cmd.table, schema, cmd.x, cmd.y, cmd.color ?? undefined, decision.bins, cmd.where_clause);
        } else if (cmd.geom === "line" && cmd.y) {
          // Detect column type from schema
          const { schemas } = useWorkspaceStore.getState();
          const schemaData = schemas[connectionId];
          const colKey = `${schema}.${cmd.table}`;
          const col = (schemaData?.columns[colKey] ?? []).find((c) => c.name === cmd.x);
          const xType = col?.type_name ?? "numeric";

          // Phase 1: coarse (100 buckets) — render immediately
          const coarseSQL = BinQueryBuilder.line(cmd.table, schema, cmd.x, cmd.y, xType, 100, cmd.where_clause);
          const coarseRows = await DbClient.query(connectionId, coarseSQL);
          useWorkspaceStore.getState().setGogChartRequest({
            spec: { ...spec, _runtime: { ...spec._runtime!, generatedSQL: coarseSQL } },
            binData: coarseRows,
            strategy: effectiveStrategy,
            estimatedRows: decision.estimatedRows,
          });

          // Phase 2: fine (1000 buckets) — refine asynchronously
          // Use setTimeout(0) to yield to the render loop first
          setTimeout(async () => {
            try {
              const fineSQL = BinQueryBuilder.line(cmd.table, schema, cmd.x, cmd.y!, xType, 1000, cmd.where_clause);
              const fineRows = await DbClient.query(connectionId, fineSQL);
              useWorkspaceStore.getState().setGogChartRequest({
                spec: { ...spec, _runtime: { ...spec._runtime!, generatedSQL: fineSQL } },
                binData: fineRows,
                strategy: effectiveStrategy,
                estimatedRows: decision.estimatedRows,
              });
            } catch (e) {
              console.error("Phase 2 line refinement failed:", e);
            }
          }, 0);

          toast.success(`Line chart created: ${decision.reason}`);
          return {
            success: true,
            result: {
              target: "chart_panel",
              chartType: cmd.geom,
              strategy: effectiveStrategy,
              estimatedRows: decision.estimatedRows,
              binRows: coarseRows.length,
              message: `Created line chart from ${schema}.${cmd.table}. Phase 1 (100 buckets) shown, refining to 1000 buckets in background.`,
            },
          };
        } else if (cmd.geom === "box" && cmd.y) {
          sql = BinQueryBuilder.boxPlot(cmd.table, schema, cmd.x, cmd.y, decision.bins, cmd.where_clause);
        } else if (cmd.geom === "histogram") {
          sql = BinQueryBuilder.histogram(cmd.table, schema, cmd.x, decision.bins, cmd.where_clause);
        }
        if (sql) {
          spec._runtime!.generatedSQL = sql;
          const rows = await DbClient.query(connectionId, sql);
          binData = rows;
        }
      } catch (e: any) {
        binQueryError = e?.message ?? String(e);
        console.error("BinQuery failed:", e);
      }
    }

    if (binQueryError) {
      return {
        success: false,
        error: `Chart aggregation failed: ${binQueryError}`,
      };
    }

    if (!binData || binData.length === 0) {
      return {
        success: false,
        error: `The chart query produced no renderable rows for ${schema}.${cmd.table}. Try execute_sql plus create_chart, or narrow the filters.`,
      };
    }

    // 5. Store in WorkspaceStore for ChartPanel to pick up
    useWorkspaceStore.getState().setGogChartRequest({
      spec,
      binData,
      strategy: effectiveStrategy,
      estimatedRows: decision.estimatedRows,
    });

    const strategyMsg =
      decision.strategy === "binned"
        ? `${(estimatedRows / 1e6).toFixed(1)}M rows → aggregated to ${decision.bins}×${decision.bins} bins`
        : `${estimatedRows.toLocaleString()} rows — raw data`;

    toast.success(`Chart created: ${cmd.geom} — ${strategyMsg}`);
    return {
      success: true,
      result: {
        target: "chart_panel",
        chartType: cmd.geom,
        strategy: effectiveStrategy,
        estimatedRows: decision.estimatedRows,
        binRows: binData.length,
        message: `Created ${cmd.geom} chart from ${schema}.${cmd.table}. Data: ${strategyMsg}.`,
      },
    };
  });

  // ── UI ────────────────────────────────────────────────────────────────────

  commandBus.register<CreatePipelineCmd>("create_pipeline", async (cmd) => {
    try {
      await ensurePipelinesLoaded();
      const pipeline = await createPipelineDefinition({
        name: cmd.name,
        sourceConnectionId: cmd.sourceConnectionId,
        sourceQuery: cmd.sourceQuery,
        targetConnectionId: cmd.targetConnectionId,
        targetTable: cmd.targetTable,
      });
      toast.success(`Pipeline "${pipeline.name}" saved`);
      return {
        success: true,
        result: {
          id: pipeline.id,
          name: pipeline.name,
          targetTable: pipeline.targetTable,
          sourceConnectionId: pipeline.sourceConnectionId,
          targetConnectionId: pipeline.targetConnectionId,
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message ?? "Failed to save pipeline" };
    }
  });

  commandBus.register<ListPipelinesCmd>("list_pipelines", async () => {
    try {
      await ensurePipelinesLoaded();
      return {
        success: true,
        result: inspectPipelines(),
      };
    } catch (error: any) {
      return { success: false, error: error?.message ?? "Failed to list pipelines" };
    }
  });

  commandBus.register<RunPipelineCmd>("run_pipeline", async (cmd) => {
    try {
      await ensurePipelinesLoaded();
      const run = await runPipelineDefinition(cmd.pipelineId);
      toast.success("Pipeline run completed", {
        description: `${run.rowCount ?? 0} row${run.rowCount === 1 ? "" : "s"} materialized to ${run.targetTable}.`,
      });
      return {
        success: true,
        result: run,
      };
    } catch (error: any) {
      toast.error("Pipeline run failed", {
        description: error?.message ?? "Unable to complete pipeline run.",
      });
      return { success: false, error: error?.message ?? "Failed to run pipeline" };
    }
  });

  commandBus.register<SearchWorkspaceCmd>("search_workspace", async (cmd) => {
    try {
      await Promise.all([
        ensurePipelinesLoaded(),
        ensureBackgroundAgentsLoaded(),
        ensureHistoryLoaded(),
        useWorkspaceRuleStore.getState().ensureLoaded(),
      ]);
      const workspace = useWorkspaceStore.getState();
      const docs = buildWorkspaceSearchDocuments({
        schemas: workspace.schemas,
        connections: workspace.connections,
        artifacts: workspace.artifacts,
        pipelines: inspectPipelines().pipelines,
        pipelineRuns: inspectPipelines().pipelines.flatMap((pipeline) => getPipelineRuns(pipeline.id)),
        backgroundAgents: listBackgroundAgents(),
        backgroundAgentEnvironments: listBackgroundAgentEnvironments(),
        backgroundAgentRuns: listBackgroundAgents().flatMap((agent) => getBackgroundAgentRuns(agent.id)),
        backgroundAgentApprovals: listBackgroundAgentApprovals(),
        queryHistory: loadHistory().map((entry) => ({
          query_id: entry.id,
          sql: entry.sql,
          source_table: null,
          source_tables: [],
          row_count: entry.rowCount,
          duration_ms: entry.elapsedMs,
          success: !entry.error,
          error_message: entry.error ?? null,
          executed_at: new Date(entry.timestamp).toISOString(),
        })),
        memoryEpisodes: await EpisodicMemory.getRecent(50).catch(() => []),
        workspaceRules: useWorkspaceRuleStore.getState().rules,
      });

      const kindsByScope: Record<
        NonNullable<SearchWorkspaceCmd["kind"]>,
        WorkspaceSearchDocumentKind[]
      > = {
        schema: ["schema_table", "schema_view", "schema_column", "schema_index"],
        artifacts: ["artifact_query", "artifact_chart", "artifact_report"],
        pipelines: ["pipeline", "pipeline_run"],
        background_agents: ["background_agent", "background_agent_run", "background_agent_approval"],
        history: ["query_history"],
        memory: ["memory_episode", "workspace_rule"],
      };
      return {
        success: true,
        result: searchWorkspaceDocuments(docs, cmd.query, {
          limit: cmd.limit ?? 8,
          kinds: cmd.kind ? kindsByScope[cmd.kind] : undefined,
          connectionId: cmd.connectionId ?? null,
          recentDays: cmd.recentDays ?? null,
        }).map((match) => ({
          id: match.document.id,
          kind: match.document.kind,
          title: match.document.title,
          subtitle: match.document.subtitle,
          score: Math.round(match.score),
          action: match.document.action.type,
          snippet: match.snippet,
          reasons: match.reasons,
          related: match.relatedDocuments.slice(0, 3),
        })),
      };
    } catch (error: any) {
      return { success: false, error: error?.message ?? "Failed to search workspace" };
    }
  });

  commandBus.register<ProposeWorkspaceRuleCmd>("propose_workspace_rule", async (cmd) => {
    try {
      await useWorkspaceRuleStore.getState().ensureLoaded();
      const rule = useWorkspaceRuleStore.getState().createRule({
        title: cmd.title,
        instruction: cmd.instruction,
        kind: cmd.kind,
        scope: cmd.scope,
        connectionId: cmd.scope === "connection" ? cmd.connectionId ?? useWorkspaceStore.getState().activeConnectionId ?? null : null,
        source: "agent",
        status: "suggested",
        rationale: cmd.rationale ?? null,
        evidence: cmd.evidence ?? [],
      });
      toast.info("AI suggested a workspace rule", {
        description: `${rule.title} is waiting for review in Memory.`,
      });
      return {
        success: true,
        result: {
          id: rule.id,
          title: rule.title,
          status: rule.status,
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message ?? "Failed to suggest workspace rule" };
    }
  });

  commandBus.register<NotifyUserCmd>("notify_user", async (cmd) => {
    const fn = {
      info: toast.info,
      success: toast.success,
      warning: toast.warning,
      error: toast.error,
    }[cmd.level];
    fn(cmd.message);
    return { success: true };
  });

  // ── Hypothesis Engine ─────────────────────────────────────────────────────

  commandBus.register<DeclareHypothesesCmd>("declare_hypotheses", async (cmd) => {
    useWorkspaceStore.getState().setActiveHypotheses(cmd.hypotheses, cmd.problemFrame);
    return { success: true, result: "Hypotheses declared" };
  });

  // ── Confidence Scoring ────────────────────────────────────────────────────

  commandBus.register<DeclareConfidenceCmd>("declare_confidence", async (cmd) => {
    const { type, risk, ...declaration } = cmd;
    useWorkspaceStore.getState().setActiveConfidence(declaration as ConfidenceDeclaration);
    return { success: true, result: "Confidence declared" };
  });

  // ── OSIsoft PI Historian ──────────────────────────────────────────────────

  commandBus.register<PISearchTagsCmd>("pi_search_tags", async (cmd) => {
    try {
      const tags = await invoke("pi_search_tags", {
        connectionId: cmd.connectionId,
        query: cmd.query,
        maxCount: cmd.maxCount,
      });
      return { success: true, result: tags };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  commandBus.register<PIGetHistoryCmd>("pi_get_history", async (cmd) => {
    try {
      const data = await invoke("pi_get_history", {
        connectionId: cmd.connectionId,
        webIds: cmd.webIds,
        start: cmd.start,
        end: cmd.end,
        interval: cmd.interval,
      });
      return { success: true, result: data };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  commandBus.register<PIGetCurrentCmd>("pi_get_current", async (cmd) => {
    try {
      const values = await invoke("pi_get_current", {
        connectionId: cmd.connectionId,
        webIds: cmd.webIds,
      });
      return { success: true, result: values };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  commandBus.register<CreateDerivedTableCmd>("create_derived_table", async (cmd) => {
    if (!Array.isArray(cmd.rows) || cmd.rows.length === 0) {
      return { success: false, error: "No rows provided to create_derived_table." };
    }

    const columns =
      cmd.columns && cmd.columns.length > 0
        ? cmd.columns
        : Object.keys(cmd.rows[0] ?? {});

    if (columns.length === 0) {
      return { success: false, error: "Cannot determine columns from rows." };
    }

    const rowsJson = JSON.stringify(cmd.rows);
    let savedName = cmd.name;

    try {
      const result = await invoke<{ name: string; row_count: number; permanent: boolean }>(
        "save_derived_table",
        {
          input: {
            name: cmd.name,
            display_title: cmd.title ?? null,
            columns,
            rows_json: rowsJson,
            permanent: cmd.permanent ?? false,
          },
        }
      );
      savedName = result.name;
    } catch (err) {
      console.error("[create_derived_table] Tauri invoke failed:", err);
    }

    const openInTab = cmd.openInTab !== false;
    if (openInTab) {
      const title = cmd.title ?? savedName.replace(/_/g, " ");
      const fields = columns.map((name) => ({ name }));
      const queryResults = {
        rows: cmd.rows,
        fields,
        rowCount: cmd.rows.length,
        elapsedMs: 0,
        queryId: `derived-${savedName}-${Date.now()}`,
        source_tables: [`derived__${savedName}`],
      };
      const store = useWorkspaceStore.getState();
      const tabId = `tab-derived-${Date.now()}`;
      store.addTab({
        id: tabId,
        type: "sql_editor",
        isSheet: true,
        title,
        sql: "",
        connectionId: store.activeConnectionId,
        queryResults,
        isExecuting: false,
      });
      toast.success(`Derived table "${title}" ready — ${cmd.rows.length} rows`, {
        duration: 4000,
      });
    }

    return {
      success: true,
      tableName: savedName,
      rowCount: cmd.rows.length,
      columns,
    };
  });
}
