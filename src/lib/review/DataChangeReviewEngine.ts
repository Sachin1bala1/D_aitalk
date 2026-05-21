import type { AgentCommand } from "../agent/commands";
import { buildRefreshedReportArtifact, getReportSectionStatuses } from "../artifacts/reportRefresh";
import { describeArtifactDiff } from "../artifacts/artifactDiff";
import type { BackgroundAgentDefinition } from "../backgroundAgents/BackgroundAgentStore";
import type { PipelineDefinition, PipelineRunRecord } from "../pipelines/PipelineStore";
import type {
  AnalysisArtifact,
  ReportArtifact,
  WorkspaceState,
} from "../stores/WorkspaceStore";

export type ReviewSeverity = "info" | "warning" | "critical";
export type ReviewCategory = "risk" | "lineage" | "policy" | "verification" | "impact";

export interface ReviewFinding {
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  detail: string;
  evidence?: string[];
}

export interface ReviewDossier {
  id: string;
  title: string;
  summary: string;
  targetType: "command" | "pipeline_run" | "report_refresh";
  subjectId: string;
  sqlPreview?: string;
  findings: ReviewFinding[];
}

interface TableImpactSummary {
  affectedArtifacts: string[];
  affectedReports: string[];
  affectedPipelines: string[];
  affectedAgents: string[];
}

function quoteSchemaTable(schema: string, table: string) {
  return `${schema}.${table}`;
}

function includesTable(text: string | null | undefined, tableKey: string, tableName: string) {
  const source = (text ?? "").toLowerCase();
  return source.includes(tableKey.toLowerCase()) || source.includes(tableName.toLowerCase());
}

function getTableImpactSummary(
  tableKey: string,
  tableName: string,
  artifacts: Record<string, AnalysisArtifact>,
  pipelines: PipelineDefinition[],
  backgroundAgents: BackgroundAgentDefinition[],
): TableImpactSummary {
  const affectedArtifacts = Object.values(artifacts)
    .filter((artifact) =>
      artifact.kind !== "report" &&
      artifact.lineage.sourceTables.some(
        (sourceTable) =>
          sourceTable.toLowerCase() === tableKey.toLowerCase() ||
          sourceTable.toLowerCase() === tableName.toLowerCase(),
      ),
    )
    .map((artifact) => artifact.name);

  const affectedReports = Object.values(artifacts)
    .filter((artifact) => artifact.kind === "report")
    .filter((artifact) =>
      artifact.sourceArtifactIds.some((artifactId) =>
        affectedArtifacts.includes(artifacts[artifactId]?.name ?? ""),
      ),
    )
    .map((artifact) => artifact.name);

  const affectedPipelines = pipelines
    .filter(
      (pipeline) =>
        pipeline.targetTable.toLowerCase() === tableKey.toLowerCase() ||
        includesTable(pipeline.sourceQuery, tableKey, tableName),
    )
    .map((pipeline) => pipeline.name);

  const affectedAgents = backgroundAgents
    .filter((agent) => includesTable(agent.prompt, tableKey, tableName))
    .map((agent) => agent.name);

  return {
    affectedArtifacts,
    affectedReports,
    affectedPipelines,
    affectedAgents,
  };
}

function pushLineageFinding(findings: ReviewFinding[], impact: TableImpactSummary, tableKey: string) {
  const affectedCount =
    impact.affectedArtifacts.length +
    impact.affectedReports.length +
    impact.affectedPipelines.length +
    impact.affectedAgents.length;

  if (affectedCount === 0) return;

  const evidence = [
    ...impact.affectedArtifacts.slice(0, 3).map((name) => `Artifact: ${name}`),
    ...impact.affectedReports.slice(0, 3).map((name) => `Report: ${name}`),
    ...impact.affectedPipelines.slice(0, 3).map((name) => `Pipeline: ${name}`),
    ...impact.affectedAgents.slice(0, 3).map((name) => `Agent: ${name}`),
  ];

  findings.push({
    severity: "warning",
    category: "lineage",
    title: "Workspace objects reference this table",
    detail: `${affectedCount} downstream workspace object(s) may need follow-up after changing ${tableKey}.`,
    evidence,
  });
}

function parseBulkTransformSql(sql: string) {
  const trimmed = sql.trim().replace(/;$/, "");
  const deleteMatch = trimmed.match(
    /^delete\s+from\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?(?:\s+where\s+(.+))?$/i,
  );
  if (deleteMatch) {
    return {
      mode: "delete" as const,
      schema: deleteMatch[1] ?? "public",
      table: deleteMatch[2],
      whereClause: deleteMatch[3] ?? null,
    };
  }

  const updateMatch = trimmed.match(
    /^update\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s+set\s+(.+?)(?:\s+where\s+(.+))?$/i,
  );
  if (updateMatch) {
    return {
      mode: "update" as const,
      schema: updateMatch[1] ?? "public",
      table: updateMatch[2],
      setClause: updateMatch[3],
      whereClause: updateMatch[4] ?? null,
    };
  }

  const insertMatch = trimmed.match(
    /^insert\s+into\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?/i,
  );
  if (insertMatch) {
    return {
      mode: "insert" as const,
      schema: insertMatch[1] ?? "public",
      table: insertMatch[2],
    };
  }

  return null;
}

export function buildCommandReview(
  command: AgentCommand,
  workspace: Pick<WorkspaceState, "artifacts" | "connections" | "schemas">,
  options?: {
    pipelines?: PipelineDefinition[];
    backgroundAgents?: BackgroundAgentDefinition[];
  },
): ReviewDossier | null {
  const findings: ReviewFinding[] = [];
  const pipelines = options?.pipelines ?? [];
  const backgroundAgents = options?.backgroundAgents ?? [];
  let summary = "Review required before executing this change.";
  let title: string = command.type;
  let sqlPreview: string | undefined;

  const addVerificationLimitation = (detail: string) => {
    findings.push({
      severity: "warning",
      category: "verification",
      title: "Verification limitation",
      detail,
    });
  };

  switch (command.type) {
    case "delete_rows": {
      const tableKey = quoteSchemaTable(command.schema, command.table);
      title = `Delete rows from ${tableKey}`;
      sqlPreview = `DELETE FROM "${command.schema}"."${command.table}" WHERE ${command.where};`;
      summary = `This action permanently removes matching rows from ${tableKey}.`;
      findings.push({
        severity: "critical",
        category: "risk",
        title: "Permanent row loss",
        detail: "Deleted rows cannot be reconstructed automatically from the approval flow.",
        evidence: [command.where],
      });
      if (!command.where || /\b1\s*=\s*1\b/i.test(command.where)) {
        findings.push({
          severity: "critical",
          category: "policy",
          title: "Broad delete predicate",
          detail: "The WHERE clause appears broad enough to delete most or all rows in the table.",
          evidence: [command.where],
        });
      }
      if (typeof command.estimatedCount === "number") {
        findings.push({
          severity: command.estimatedCount > 1000 ? "critical" : "warning",
          category: "impact",
          title: "Estimated affected rows",
          detail: `The change is expected to affect approximately ${command.estimatedCount.toLocaleString()} row(s).`,
        });
      }
      pushLineageFinding(
        findings,
        getTableImpactSummary(tableKey, command.table, workspace.artifacts, pipelines, backgroundAgents),
        tableKey,
      );
      break;
    }
    case "drop_column": {
      const tableKey = quoteSchemaTable(command.schema, command.table);
      title = `Drop column ${command.columnName}`;
      sqlPreview = `ALTER TABLE "${command.schema}"."${command.table}" DROP COLUMN "${command.columnName}";`;
      summary = `This removes ${command.columnName} from ${tableKey} and can break downstream SQL, charts, and reports.`;
      findings.push({
        severity: "critical",
        category: "risk",
        title: "Schema-breaking change",
        detail: `Dropping ${command.columnName} can invalidate existing SQL and visualizations that expect this column.`,
      });
      pushLineageFinding(
        findings,
        getTableImpactSummary(tableKey, command.table, workspace.artifacts, pipelines, backgroundAgents),
        tableKey,
      );
      addVerificationLimitation("Column absence is verifiable, but downstream breakage is only inferred from local workspace lineage.");
      break;
    }
    case "rename_table": {
      const oldKey = quoteSchemaTable(command.schema, command.oldName);
      title = `Rename table ${command.oldName}`;
      sqlPreview = `ALTER TABLE "${command.schema}"."${command.oldName}" RENAME TO "${command.newName}";`;
      summary = `Renaming ${oldKey} can invalidate downstream queries and pipelines that still reference the old name.`;
      findings.push({
        severity: "critical",
        category: "risk",
        title: "Reference-breaking rename",
        detail: `Any downstream object that still refers to ${command.oldName} must be updated after this rename.`,
      });
      pushLineageFinding(
        findings,
        getTableImpactSummary(oldKey, command.oldName, workspace.artifacts, pipelines, backgroundAgents),
        oldKey,
      );
      break;
    }
    case "bulk_transform": {
      title = "Run bulk SQL transform";
      sqlPreview = command.sql;
      summary = "This SQL can modify many rows or objects at once and needs careful review.";
      findings.push({
        severity: "critical",
        category: "risk",
        title: "Broad write surface",
        detail: "Bulk SQL can affect multiple rows or objects in one operation.",
      });
      const parsed = parseBulkTransformSql(command.sql);
      if (!parsed) {
        addVerificationLimitation("The SQL shape is too broad or ambiguous for deterministic pre-review classification.");
      } else {
        const tableKey = quoteSchemaTable(parsed.schema, parsed.table);
        pushLineageFinding(
          findings,
          getTableImpactSummary(tableKey, parsed.table, workspace.artifacts, pipelines, backgroundAgents),
          tableKey,
        );
        if ((parsed.mode === "delete" || parsed.mode === "update") && !parsed.whereClause) {
          findings.push({
            severity: "critical",
            category: "policy",
            title: "Missing WHERE clause",
            detail: `This ${parsed.mode.toUpperCase()} statement appears to target the entire table.`,
          });
        }
        if (parsed.mode === "insert") {
          findings.push({
            severity: "info",
            category: "impact",
            title: "Insert operation",
            detail: `The SQL inserts new rows into ${tableKey}.`,
          });
        }
      }
      break;
    }
    case "run_pipeline": {
      return null;
    }
    default:
      return null;
  }

  return {
    id: `review-command-${command.type}-${Date.now()}`,
    title,
    summary,
    targetType: "command",
    subjectId: command.type,
    sqlPreview,
    findings,
  };
}

export function buildPipelineRunReview(
  pipeline: PipelineDefinition,
  latestRun: PipelineRunRecord | null,
  artifacts: Record<string, AnalysisArtifact>,
): ReviewDossier {
  const findings: ReviewFinding[] = [
    {
      severity: "critical",
      category: "risk",
      title: "Materialization overwrite",
      detail: `Running this pipeline replaces the contents of ${pipeline.targetTable} with the current source query output.`,
    },
    {
      severity: "warning",
      category: "impact",
      title: "Cross-connection write",
      detail: `${pipeline.sourceConnectionId} → ${pipeline.targetConnectionId}`,
    },
  ];

  if (latestRun?.rowCount != null) {
    findings.push({
      severity: latestRun.rowCount > 1000 ? "warning" : "info",
      category: "impact",
      title: "Last run volume",
      detail: `The last successful run materialized ${latestRun.rowCount.toLocaleString()} row(s).`,
    });
  }

  const steps = pipeline.steps ?? [];
  const assertionSteps = steps.filter((step) => step.type === "assert_row_count");
  if (assertionSteps.length === 0) {
    findings.push({
      severity: "warning",
      category: "verification",
      title: "No validation step",
      detail: "This pipeline writes data without an explicit row-count assertion step.",
    });
  } else {
    findings.push({
      severity: "info",
      category: "verification",
      title: "Validation steps present",
      detail: `${assertionSteps.length} assertion step(s) will validate source results before materialization.`,
    });
  }

  findings.push({
    severity: "info",
    category: "impact",
    title: "Workflow depth",
    detail: `${steps.length} step(s) are defined in this pipeline.`,
    evidence: steps.map((step) => `${step.type}: ${step.name}`),
  });

  if (pipeline.lastRunArtifactId && artifacts[pipeline.lastRunArtifactId]) {
    findings.push({
      severity: "info",
      category: "lineage",
      title: "Existing output artifact",
      detail: `The last run is linked to artifact "${artifacts[pipeline.lastRunArtifactId]?.name}".`,
    });
  }

  return {
    id: `review-pipeline-${pipeline.id}-${Date.now()}`,
    title: `Run pipeline ${pipeline.name}`,
    summary: `Review the source query and target table before rerunning this materialization pipeline.`,
    targetType: "pipeline_run",
    subjectId: pipeline.id,
    sqlPreview: pipeline.sourceQuery,
    findings,
  };
}

export function buildReportRefreshReview(
  artifact: ReportArtifact,
  artifacts: Record<string, AnalysisArtifact>,
  artifactRevisions: Record<string, import("../stores/WorkspaceStore").ArtifactRevision[]>,
  mode: "stale" | "all",
): ReviewDossier {
  const nextArtifact = buildRefreshedReportArtifact(
    artifact,
    artifacts,
    artifactRevisions,
    mode === "stale" ? { sectionKeys: getReportSectionStatuses(artifact, artifacts, artifactRevisions)
      .filter((status) => status.stale && !status.missing)
      .map((status) => status.sectionKey) } : undefined,
  );
  const diff = describeArtifactDiff(artifact, nextArtifact);
  const statuses = getReportSectionStatuses(artifact, artifacts, artifactRevisions);
  const staleSections = statuses.filter((status) => status.stale && !status.missing);
  const missingSections = statuses.filter((status) => status.missing);

  const findings: ReviewFinding[] = [];

  if (staleSections.length > 0) {
    findings.push({
      severity: "warning",
      category: "lineage",
      title: "Upstream artifacts changed",
      detail: `${staleSections.length} report section(s) are bound to newer upstream artifact revisions.`,
      evidence: staleSections.slice(0, 4).map((status) => status.sectionKey),
    });
  }

  if (missingSections.length > 0) {
    findings.push({
      severity: "critical",
      category: "policy",
      title: "Missing section bindings",
      detail: `${missingSections.length} report section binding(s) are missing linked source artifacts.`,
      evidence: missingSections.slice(0, 4).map((status) => status.sectionKey),
    });
  }

  findings.push({
    severity: diff.summary.length === 0 ? "info" : "warning",
    category: "impact",
    title: "Expected report diff",
    detail: diff.summary.length > 0 ? diff.summary.join("; ") : "No changes detected.",
  });

  return {
    id: `review-report-refresh-${artifact.id}-${Date.now()}`,
    title: `Refresh report ${artifact.name}`,
    summary:
      mode === "stale"
        ? "Only stale bound sections will be rebuilt from newer upstream artifacts."
        : "All bound sections will be rebuilt from current upstream artifacts.",
    targetType: "report_refresh",
    subjectId: artifact.id,
    findings,
  };
}
