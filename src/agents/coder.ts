/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 2 — Coder Sub-Agent */

import Anthropic from "@anthropic-ai/sdk";
import type { FileDiff, TaskNode } from "./types";

/**
 * coderAgent — generates targeted FileDiff[] for a coder TaskNode.
 *
 * @param node         The TaskNode with agent_role === "coder"
 * @param sourceFiles  Source files relevant to the task
 * @param criticReasons  Optional feedback from a prior critic REQUEST_CHANGES verdict
 * @returns            Array of FileDiff objects (staging buffer — no filesystem writes)
 */
export async function coderAgent(
  node: TaskNode,
  sourceFiles: Array<{ filename: string; content: string }>,
  criticReasons?: string[]
): Promise<FileDiff[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Please set it before invoking coderAgent."
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the source-files section of the prompt
  const sourceSection = sourceFiles
    .map(
      (f) =>
        `=== FILE: ${f.filename} ===\n${f.content}\n=== END: ${f.filename} ===`
    )
    .join("\n\n");

  // Build optional critic-feedback section
  const criticSection =
    criticReasons && criticReasons.length > 0
      ? `\nCritic feedback (address ALL of these):\n${criticReasons
          .map((r, i) => `${i + 1}. ${r}`)
          .join("\n")}\n`
      : "";

  const userPrompt = `TaskNode:
${JSON.stringify(node, null, 2)}

Test assertions (definition of done — every assertion must be satisfied):
${node.test_assertions.map((a, i) => `${i + 1}. ${a}`).join("\n")}
${criticSection}
Source files:
${sourceSection}

Instructions:
- Produce ONLY the minimal changes required to satisfy the TaskNode description and all test_assertions.
- Do NOT rewrite files wholesale — make targeted, surgical edits.
- In every changed code block add an inline comment: // AGENT[${node.node_id}]: <brief reason>
- Output ONLY a valid JSON array of FileDiff objects. No markdown, no explanation.
- Each FileDiff must have exactly these fields:
    "filename": string  — path relative to repo root
    "original": string  — the exact original text being replaced (may be empty string for new files)
    "modified": string  — the replacement text

FileDiff schema:
[
  {
    "filename": "src/example.ts",
    "original": "// old code here",
    "modified": "// new code here // AGENT[${node.node_id}]: reason"
  }
]`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    system:
      "You are a precise software engineer. Make only the changes described in TaskNode. Output JSON array of FileDiff objects only.",
    messages: [{ role: "user", content: userPrompt }],
  });

  // Check stop_reason before processing (same guard as planner)
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "coderAgent: Claude response was truncated (max_tokens reached). " +
        "Increase max_tokens or reduce sourceFiles length."
    );
  }

  // Extract text content from the response
  const content = message.content[0];
  if (!content || content.type !== "text") {
    throw new Error(
      `coderAgent: Unexpected response content type from Claude. ` +
        `Expected 'text', got '${content?.type ?? "none"}'.`
    );
  }

  // Strip markdown fences before JSON.parse (same as planner)
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
      `coderAgent: Failed to parse Claude response as JSON. ` +
        `Parse error: ${(err as Error).message}. ` +
        `Raw response (first 500 chars): ${rawText.slice(0, 500)}`
    );
  }

  // Validate parsed is an array
  if (!Array.isArray(parsed)) {
    throw new Error(
      `coderAgent: Claude response is not a JSON array. ` +
        `Expected FileDiff[], got: ${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  // Reject empty array
  if (parsed.length === 0) {
    throw new Error(
      "coderAgent: Claude returned an empty FileDiff array — no changes were produced."
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
        `coderAgent: FileDiff at index ${i} is invalid. ` +
          `Each FileDiff must have filename (string), original (string), and modified (string). ` +
          `Got: ${JSON.stringify(item).slice(0, 300)}`
      );
    }
  }

  return parsed as FileDiff[];
}
