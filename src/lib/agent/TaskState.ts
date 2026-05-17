// src/lib/agent/TaskState.ts

export type SubTaskStatus =
  | "pending"
  | "planning"
  | "executing"
  | "verifying"
  | "complete"
  | "failed"
  | "retry_requested"
  | "awaiting_approval";

export type VerificationMode = "deterministic" | "best_effort";

export interface TaskProvenance {
  connectionId: string | null;
  activeTabId: string | null;
  latestSql?: string;
  latestQueryId?: string | null;
  latestSourceTables?: string[];
  toolNames?: string[];
  commandTypes?: string[];
}

export interface AuditEntry {
  state: SubTaskStatus;
  timestamp: number;
  sql?: string;
  verificationPassed?: boolean;
  verificationMode?: VerificationMode;
  retryAttempt?: number;
  commandTypes?: string[];
  queryId?: string | null;
  sourceTables?: string[];
  note?: string;
}

export interface SubTask {
  id: string;
  goal: string;
  status: SubTaskStatus;
  /** Last SQL executed by this subtask (for idempotency checks) */
  sql?: string;
  /** Last tool result from AgentLoop (for idempotency checks) */
  result?: unknown;
  verificationPassed?: boolean;
  verificationMode?: VerificationMode;
  /** Why verification failed (streamed to user on auto-retry) */
  diagnosis?: string;
  retryCount: number;
  maxRetries: 3;
  /** True for mutations on existing data (UPDATE, DELETE, DROP) */
  isRisky: boolean;
  provenance?: TaskProvenance;
  auditLog: AuditEntry[];
}

export interface Task {
  id: string;
  userGoal: string;
  subtasks: SubTask[];
  currentIndex: number;
  status: "running" | "complete" | "failed" | "awaiting_input";
}

export interface TaskCheckpoint {
  task: Task;
  lifecycle: "running" | "interrupted" | "abandoned";
  interruptedAt: number | null;
  updatedAt: number;
  resumeEligible: boolean;
  resumeRisk: "safe" | "approval_required" | "non_resumable";
  connectionId: string | null;
  activeTabId: string | null;
  lastCheckpointNote?: string;
}

export interface VerificationResult {
  passed: boolean;
  actual: unknown;
  diagnosis: string;
  verificationMode: VerificationMode;
}

export type RetryDecision =
  | { action: "auto_retry"; streamDiagnosis: boolean }
  | { action: "ask_user"; proposal: string }
  | { action: "fail"; reason: string };

/** Parameters the LLM passes when calling verify_result tool */
export interface VerifyResultParams {
  description: string;
  sql?: string;
  expectedMinRows?: number;
  expectedColumns?: string[];
  requireResults?: boolean;
}
