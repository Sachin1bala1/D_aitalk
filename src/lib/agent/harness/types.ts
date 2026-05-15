/**
 * Shared types used across the DataIQ harness system
 */
import type { PolicyContext } from "./PolicyEngine";

export interface SessionContext {
  sessionId: string;
  userId?: string;
  connectionId: string | null;
  question: string;
  toolsCalledSoFar: string[];
  errorsSoFar: Array<{ tool: string; error: string }>;
  startTime: number;
  iterationCount: number;
  policyContext?: PolicyContext;
  schemaTableCount?: number;
}

export interface StruggleEvidence {
  type:
    | "repeated_tool_errors"
    | "same_tool_called_3x"
    | "no_progress_5_iters"
    | "low_confidence_declared"
    | "contradicting_hypotheses";
  details: string;
}

export interface SessionResult {
  success: boolean;
  toolsUsed: string[];
  totalDurationMs: number;
  tokenEstimate: number;
  finalConfidence?: number;
  errorCount: number;
}

export interface AnalysisImpactMap {
  sessionId: string;
  question: string;
  plannedSteps: Array<{
    order: number;
    action: "query_table" | "run_analysis" | "create_chart" | "generate_report";
    target: string;
    reason: string;
    estimatedRows?: number;
    estimatedDurationMs?: number;
  }>;
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
  expectedOutputs: string[];
  clarifyingQuestions: string[];
}

export interface HarnessFailureTrace {
  sessionId: string;
  question: string;
  toolsUsed: string[];
  errors: Array<{ tool: string; error: string }>;
  finalSuccess: boolean;
  tokenEstimate: number;
  durationMs: number;
}

export interface HarnessVersion {
  id: string;
  versionTag: string;
  systemPromptAdditions: string;
  successRate?: number;
  avgTokenEstimate?: number;
  failureCount: number;
  isActive: boolean;
  createdAt: number;
}

export interface OptimizationResult {
  skipped: boolean;
  reason?: string;
  candidateId?: string;
  analysis?: string;
  proposedAdditions?: string;
  expectedImprovement?: string;
  confidence?: number;
  failuresAnalyzed?: number;
}

export interface SessionTrace {
  sessionId: string;
  question: string;
  startTime: number;
  toolEvents: Array<{
    tool: string;
    durationMs: number;
    success: boolean;
    ts: number;
  }>;
  errors: Array<{
    tool: string;
    error: string;
    ts: number;
  }>;
  struggles: StruggleEvidence[];
  tokenEstimates: Array<{
    system: number;
    history: number;
    total: number;
  }>;
  toolCallStartTimes: Map<string, number>;
}
