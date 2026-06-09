/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 5 — Patcher Agent */

import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import type { FileDiff, HaltReport, TaskNode, TestResult } from "./types";

/**
 * buildHaltReport — constructs a HaltReport, logs it to stderr, and writes
 * halt_report.json in the current working directory.
 *
 * @param node               The TaskNode that hit max_attempts
 * @param goalId             The goal_id (falls back to node.node_id when not available)
 * @param lastCriticReasons  Reasons from the last critic REQUEST_CHANGES verdict
 * @param lastTestFailures   Assertion strings for all still-failing tests
 * @returns                  The constructed HaltReport
 */
export function buildHaltReport(
  node: TaskNode,
  goalId: string,
  lastCriticReasons: string[],
  lastTestFailures: string[]
): HaltReport {
  const report: HaltReport = {
    halt_reason: `patcherAgent exhausted max_attempts (${node.max_attempts}) without resolving all test failures.`,
    goal_id: goalId || node.node_id,
    node_id: node.node_id,
    agent_role: node.agent_role,
    attempt_count: node.attempts,
    last_critic_reasons: lastCriticReasons,
    last_test_failures: lastTestFailures,
    recommended_human_action:
      "Review the failing test assertions and the original diffs. " +
      "Consider breaking the task into smaller nodes, simplifying the test assertions, " +
      "or resolving any environment / dependency issues before re-running.",
    trace_file: "agent_trace.jsonl",
  };

  console.error(JSON.stringify(report, null, 2));
  fs.writeFileSync("halt_report.json", JSON.stringify(report, null, 2), "utf8");

  return report;
}

/**
 * patcherAgent — receives a TaskNode, the original FileDiff[] from the coder,
 * and the failing TestResult[] from the test-runner, then asks Claude to
 * produce a minimal patch resolving only the failing tests.
 *
 * HALT behaviour: if node.attempts >= node.max_attempts the agent does NOT
 * call Claude. Instead it builds a HaltReport and throws an Error whose
 * message is the JSON-stringified report.
 *
 * The caller is responsible for routing the returned FileDiff[] through
 * criticAgent and then re-running tests.
 *
 * @param node           TaskNode with agent_role === "patcher"
 * @param originalDiffs  FileDiff[] as produced by the most recent coderAgent call
 * @param failedResults  TestResult[] — the caller should pass ONLY failed results
 *                       (passed === false); patcherAgent will also filter internally
 * @returns              PatchedFileDiff[] (same FileDiff type)
 */
export async function patcherAgent(
  node: TaskNode,
  originalDiffs: FileDiff[],
  failedResults: TestResult[]
): Promise<FileDiff[]> {
  // HALT check — do not invoke Claude if attempts exhausted
  if (node.attempts >= node.max_attempts) {
    const failures = failedResults
      .filter((r) => !r.passed)
      .map((r) => r.assertion);

    const report = buildHaltReport(node, node.node_id, [], failures);

    throw new Error(JSON.stringify(report));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Please set it before invoking patcherAgent."
    );
  }

  const client = new Anthropic({ apiKey });

  // Filter to only the actually-failing results
  const onlyFailed = failedResults.filter((r) => !r.passed);

  // Build the diffs section
  const diffsSection = originalDiffs
    .map(
      (d) =>
        `=== DIFF: ${d.filename} ===\n` +
        `--- ORIGINAL ---\n${d.original}\n` +
        `+++ MODIFIED +++\n${d.modified}\n` +
        `=== END DIFF: ${d.filename} ===`
    )
    .join("\n\n");

  // Build the failures section
  const failuresSection = onlyFailed
    .map(
      (r, i) =>
        `${i + 1}. [${r.test_id}] assertion: ${r.assertion}\n   actual_output: ${r.actual_output}`
    )
    .join("\n");

  const userPrompt = `TaskNode:
${JSON.stringify(node, null, 2)}

Original FileDiffs (the code that was applied and then tested):
${diffsSection}

Failing test results (ONLY these must be fixed):
${failuresSection}

Instructions:
- Generate ONLY the minimal changes required to fix the failing tests listed above.
- Do NOT refactor, rename, or alter anything unrelated to the failures.
- In every changed code block add an inline comment: // PATCHER[${node.node_id}]: <brief reason>
- Output ONLY a valid JSON array of FileDiff objects. No markdown, no explanation.
- Each FileDiff must have exactly these fields:
    "filename": string  — path relative to repo root
    "original": string  — the exact text being replaced (from the modified side of the original diff)
    "modified": string  — the replacement text

FileDiff schema:
[
  {
    "filename": "src/example.ts",
    "original": "// broken code here",
    "modified": "// fixed code here // PATCHER[${node.node_id}]: reason"
  }
]`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    system:
      "You are a debugging specialist. Receive code diff and test failures. Generate minimal patch fixing ONLY failing tests. No refactoring. Output PatchedFileDiff[] JSON only.",
    messages: [{ role: "user", content: userPrompt }],
  });

  // Guard: truncated response
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "patcherAgent: Claude response was truncated (max_tokens reached). " +
        "Increase max_tokens or reduce the size of originalDiffs / failedResults."
    );
  }

  // Extract text content
  const content = message.content[0];
  if (!content || content.type !== "text") {
    throw new Error(
      `patcherAgent: Unexpected response content type from Claude. ` +
        `Expected 'text', got '${content?.type ?? "none"}'.`
    );
  }

  // Strip markdown fences before JSON.parse
  const rawText = content.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  // Find first [ and last ] as final fallback
  const jsonStart = rawText.indexOf("[");
  const jsonEnd = rawText.lastIndexOf("]");
  const jsonText =
    jsonStart !== -1 && jsonEnd > jsonStart
      ? rawText.slice(jsonStart, jsonEnd + 1)
      : rawText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `patcherAgent: Failed to parse Claude response as JSON. ` +
        `Parse error: ${(err as Error).message}. ` +
        `Raw response (first 500 chars): ${rawText.slice(0, 500)}`
    );
  }

  // Validate parsed is an array
  if (!Array.isArray(parsed)) {
    throw new Error(
      `patcherAgent: Claude response is not a JSON array. ` +
        `Expected FileDiff[], got: ${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  // Reject empty array
  if (parsed.length === 0) {
    throw new Error(
      "patcherAgent: Claude returned an empty FileDiff array — no patch was produced."
    );
  }

  // Validate each element has the required FileDiff fields
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>;
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.filename !== "string" ||
      typeof item.original !== "string" ||
      typeof item.modified !== "string"
    ) {
      throw new Error(
        `patcherAgent: FileDiff at index ${i} is invalid. ` +
          `Each FileDiff must have filename (string), original (string), and modified (string). ` +
          `Got: ${JSON.stringify(item).slice(0, 300)}`
      );
    }
  }

  return parsed as FileDiff[];
}
