/** @spec AGENT_ARCHITECTURE_UPGRADE.md §3 — Data Structures */

// TaskGraph and TaskNode
export interface TaskGraph {
  goal_id: string;
  goal_description: string;
  created_at: string;               // ISO 8601
  status: "pending" | "in_progress" | "complete" | "failed";
  nodes: TaskNode[];
  success_criteria: string[];
}

export interface TaskNode {
  node_id: string;
  parent_id: string | null;
  description: string;
  agent_role: "planner" | "coder" | "critic" | "tester" | "patcher";
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  test_assertions: string[];
  attempts: number;
  max_attempts: number;
  error_log: string[];
}

// Trace schema
export interface AgentTraceEntry {
  timestamp: string;
  goal_id: string;
  node_id: string;
  agent_role: string;
  action: string;
  input_summary: string;
  output_summary: string;
  test_results: TestResult[];
  status: "success" | "failure" | "halted";
}

export interface TestResult {
  test_id: string;
  assertion: string;
  passed: boolean;
  actual_output: string;
}

// Diff types
export interface FileDiff {
  filename: string;
  original: string;
  modified: string;
}

export interface CriticVerdict {
  verdict: "APPROVE" | "REQUEST_CHANGES";
  reasons: string[];
}

export interface HaltReport {
  halt_reason: string;
  goal_id: string;
  node_id: string;
  agent_role: string;
  attempt_count: number;
  last_critic_reasons: string[];
  last_test_failures: string[];
  recommended_human_action: string;
  trace_file: string;
}
