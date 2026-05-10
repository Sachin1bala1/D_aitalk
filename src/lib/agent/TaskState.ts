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

export interface AuditEntry {
  state: SubTaskStatus;
  timestamp: number;
  sql?: string;
  verificationPassed?: boolean;
  retryAttempt?: number;
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
  /** Why verification failed (streamed to user on auto-retry) */
  diagnosis?: string;
  retryCount: number;
  maxRetries: 3;
  /** True for mutations on existing data (UPDATE, DELETE, DROP) */
  isRisky: boolean;
  auditLog: AuditEntry[];
}

export interface Task {
  id: string;
  userGoal: string;
  subtasks: SubTask[];
  currentIndex: number;
  status: "running" | "complete" | "failed" | "awaiting_input";
}

export interface VerificationResult {
  passed: boolean;
  actual: unknown;
  diagnosis: string;
}

export type RetryDecision =
  | { action: "auto_retry"; streamDiagnosis: boolean }
  | { action: "ask_user"; proposal: string }
  | { action: "fail"; reason: string };

/** Parameters the LLM passes when calling verify_result tool */
export interface VerifyResultParams {
  sql: string;
  expectedMinRows?: number;
  description: string;
}
