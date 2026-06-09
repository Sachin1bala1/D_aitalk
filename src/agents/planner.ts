/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 1 — Planner Agent */

import Anthropic from "@anthropic-ai/sdk";
import type { TaskGraph } from "./types";

const TASK_GRAPH_SCHEMA = `{
  "goal_id": "string",
  "goal_description": "string",
  "created_at": "string (ISO 8601)",
  "status": "pending | in_progress | complete | failed",
  "nodes": [
    {
      "node_id": "string",
      "parent_id": "string | null",
      "description": "string",
      "agent_role": "planner | coder | critic | tester | patcher",
      "status": "pending | running | passed | failed | skipped",
      "inputs": {},
      "outputs": {},
      "test_assertions": ["string"],
      "attempts": 0,
      "max_attempts": 2,
      "error_log": []
    }
  ],
  "success_criteria": ["string"]
}`;

export async function plannerAgent(
  goal: string,
  codebaseContext: string
): Promise<TaskGraph> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Please set it before invoking plannerAgent."
    );
  }

  const client = new Anthropic({ apiKey });

  const userPrompt = `Goal: ${goal}

Codebase Context:
${codebaseContext}

TaskGraph JSON Schema:
${TASK_GRAPH_SCHEMA}

Instructions:
- Break the goal into at most 7 TaskNodes.
- Assign an appropriate agent_role to each node.
- Set max_attempts=2 for nodes with agent_role "coder" or "patcher".
- Write at least 1 test_assertion per node.
- Set goal_id to a short unique slug derived from the goal.
- Set created_at to the current ISO 8601 timestamp.
- Set status to "pending".
- Output ONLY a valid JSON object matching the TaskGraph schema. No markdown, no explanation.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system:
      "You are a senior software architect. Output ONLY valid JSON matching TaskGraph schema. No markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  // C3 — Check stop_reason before processing
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "plannerAgent: Claude response was truncated (max_tokens reached). " +
      "Increase max_tokens or reduce codebaseContext length."
    );
  }

  // Extract text content from the response
  const content = message.content[0];
  if (!content || content.type !== "text") {
    throw new Error(
      `plannerAgent: Unexpected response content type from Claude. ` +
        `Expected 'text', got '${content?.type ?? "none"}'.`
    );
  }

  // C1 — Strip markdown fences before JSON.parse
  const rawText = content.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  // Also find first { and last } as final fallback
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  const jsonText = jsonStart !== -1 && jsonEnd > jsonStart
    ? rawText.slice(jsonStart, jsonEnd + 1)
    : rawText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `plannerAgent: Failed to parse Claude response as JSON. ` +
        `Parse error: ${(err as Error).message}. ` +
        `Raw response (first 500 chars): ${rawText.slice(0, 500)}`
    );
  }

  // Validate the parsed object is a TaskGraph
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("goal_id" in parsed) ||
    typeof (parsed as Record<string, unknown>).goal_id !== "string" ||
    !("nodes" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).nodes) ||
    !("success_criteria" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).success_criteria)
  ) {
    throw new Error(
      `plannerAgent: Claude response is not a valid TaskGraph. ` +
        `Expected an object with 'goal_id' (string), 'nodes' (array), and 'success_criteria' (array). ` +
        `Got: ${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  // C2 — Reject empty nodes array
  if (((parsed as Record<string, unknown>).nodes as unknown[]).length === 0) {
    throw new Error(
      "plannerAgent: Claude returned a TaskGraph with zero nodes — cannot execute an empty plan."
    );
  }

  return parsed as TaskGraph;
}
