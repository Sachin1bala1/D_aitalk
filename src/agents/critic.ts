/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 3 — Critic Sub-Agent */

import Anthropic from "@anthropic-ai/sdk";
import type { CriticVerdict, FileDiff, TaskNode } from "./types";

/**
 * criticAgent — adversarially reviews FileDiff[] produced by the coder for a TaskNode.
 *
 * The critic did NOT write the code and actively looks for problems:
 * logic errors, unhandled edge cases, broken imports, missing type annotations,
 * and any test_assertion that is not fully satisfied.
 *
 * @param node           The TaskNode that drove the coder (includes test_assertions)
 * @param diffs          FileDiff[] produced by coderAgent — what will be reviewed
 * @param originalFiles  Optional original source files for fuller context
 * @returns              CriticVerdict — APPROVE or REQUEST_CHANGES with specific reasons
 */
export async function criticAgent(
  node: TaskNode,
  diffs: FileDiff[],
  originalFiles?: Array<{ filename: string; content: string }>
): Promise<CriticVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Please set it before invoking criticAgent."
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the diffs section
  const diffsSection = diffs
    .map(
      (d) =>
        `=== DIFF: ${d.filename} ===\n` +
        `--- ORIGINAL ---\n${d.original}\n` +
        `+++ MODIFIED +++\n${d.modified}\n` +
        `=== END DIFF: ${d.filename} ===`
    )
    .join("\n\n");

  // Build optional original-files section
  const originalsSection =
    originalFiles && originalFiles.length > 0
      ? "\n\nFull original source files for additional context:\n" +
        originalFiles
          .map(
            (f) =>
              `=== FILE: ${f.filename} ===\n${f.content}\n=== END: ${f.filename} ===`
          )
          .join("\n\n")
      : "";

  const userPrompt = `TaskNode under review:
${JSON.stringify(node, null, 2)}

Test assertions that the code MUST satisfy (check each one explicitly):
${node.test_assertions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

FileDiffs to review (original → modified for each changed file):
${diffsSection}${originalsSection}

Review instructions:
- Assume the coder made at least one mistake. Look hard.
- For each test_assertion, verify it is fully satisfied by the modified code.
- Flag logic errors, unhandled edge cases, broken or missing imports, missing TypeScript type annotations.
- Be specific and actionable: quote the problematic code and explain exactly what must change.
- If every test_assertion is satisfied and no meaningful issues remain, you may APPROVE.
- Output ONLY valid JSON matching this exact schema — no markdown, no explanation:

{
  "verdict": "APPROVE" | "REQUEST_CHANGES",
  "reasons": string[]
}

If verdict is "APPROVE", reasons may be an empty array or list minor notes.
If verdict is "REQUEST_CHANGES", reasons must list every specific problem found.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system:
      "You are a senior code reviewer who did NOT write this code. Find problems. Be specific. Output ONLY CriticVerdict JSON.",
    messages: [{ role: "user", content: userPrompt }],
  });

  // Guard: truncated response
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "criticAgent: Claude response was truncated (max_tokens reached). " +
        "Increase max_tokens or reduce the size of diffs / originalFiles."
    );
  }

  // Extract text content
  const content = message.content[0];
  if (!content || content.type !== "text") {
    throw new Error(
      `criticAgent: Unexpected response content type from Claude. ` +
        `Expected 'text', got '${content?.type ?? "none"}'.`
    );
  }

  // Strip markdown fences before JSON.parse
  const rawText = content.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  // Find first { and last } as final fallback
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  const jsonText =
    jsonStart !== -1 && jsonEnd > jsonStart
      ? rawText.slice(jsonStart, jsonEnd + 1)
      : rawText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `criticAgent: Failed to parse Claude response as CriticVerdict JSON. ` +
        `Parse error: ${(err as Error).message}. ` +
        `Raw response (first 500 chars): ${rawText.slice(0, 500)}`
    );
  }

  // Validate structure
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `criticAgent: Claude response is not a JSON object. ` +
        `Got: ${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.verdict !== "APPROVE" && obj.verdict !== "REQUEST_CHANGES") {
    throw new Error(
      `criticAgent: Invalid verdict value '${String(obj.verdict)}'. ` +
        `Must be exactly "APPROVE" or "REQUEST_CHANGES".`
    );
  }

  if (
    !Array.isArray(obj.reasons) ||
    !obj.reasons.every((r) => typeof r === "string")
  ) {
    throw new Error(
      `criticAgent: 'reasons' field must be string[]. ` +
        `Got: ${JSON.stringify(obj.reasons).slice(0, 300)}`
    );
  }

  return { verdict: obj.verdict, reasons: obj.reasons } as CriticVerdict;
}
