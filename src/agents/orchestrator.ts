/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 6 — Orchestrator */

import { plannerAgent } from "./planner";
import { coderAgent } from "./coder";
import { criticAgent } from "./critic";
import { runTests } from "./test-runner";
import { patcherAgent, buildHaltReport } from "./patcher";
import { traceLogger } from "./trace-logger";
import type { TaskGraph, TaskNode, CriticVerdict, FileDiff } from "./types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function halt(node: TaskNode, verdict: CriticVerdict): never {
  throw new Error(`HALT: node ${node.node_id} — critic rejected: ${verdict.reasons.join("; ")}`);
}

export async function runAgentLoop(
  goal: string,
  codebaseContext: string,
  sourceFiles: Array<{ filename: string; content: string }> = []
): Promise<TaskGraph> {
  // 1. Call plannerAgent — HARD_GATE: throws if invalid
  const graph = await plannerAgent(goal, codebaseContext);
  graph.status = "in_progress";

  // 2. For each node in graph.nodes:
  for (const node of graph.nodes) {
    node.status = "running";
    node.attempts = 0;

    if (node.agent_role === "coder") {
      // 3. Coder generates diffs
      let diff: FileDiff[] = await coderAgent(node, sourceFiles);
      node.attempts++;

      // 4. Critic reviews — up to 2 attempts
      let verdict: CriticVerdict = await criticAgent(node, diff, sourceFiles);

      if (verdict.verdict === "REQUEST_CHANGES") {
        // Retry coder with critic reasons
        diff = await coderAgent(node, sourceFiles, verdict.reasons);
        node.attempts++;
        verdict = await criticAgent(node, diff, sourceFiles);

        if (verdict.verdict === "REQUEST_CHANGES") {
          // HARD_GATE: two REQUEST_CHANGES = HALT
          const haltReport = buildHaltReport(
            node,
            graph.goal_id,
            verdict.reasons,
            []
          );
          node.status = "failed";
          node.error_log.push(JSON.stringify(haltReport));
          graph.status = "failed";
          throw new Error(`HALT: Critic rejected twice for node ${node.node_id}: ${JSON.stringify(haltReport)}`);
        }
      }

      // 5. Run tests
      const { passed, results } = await runTests(diff, node.node_id);

      if (!passed) {
        const failures = results.filter(r => !r.passed);
        // 6. Patcher handles failures
        node.attempts++; // patcher counts as an attempt
        const patch: FileDiff[] = await patcherAgent(node, diff, failures);
        const patchVerdict: CriticVerdict = await criticAgent(node, patch, sourceFiles);

        if (patchVerdict.verdict === "REQUEST_CHANGES") {
          // Patcher's output also rejected
          const haltReport = buildHaltReport(node, graph.goal_id, patchVerdict.reasons, failures.map(r => r.assertion));
          node.status = "failed";
          node.error_log.push(JSON.stringify(haltReport));
          graph.status = "failed";
          throw new Error(`HALT: Patch rejected by critic for node ${node.node_id}`);
        }
        diff = patch;
      }

      // 7. Apply diff and log trace
      node.outputs = { diffs: diff };
      node.status = "passed";

      traceLogger.append({
        timestamp: new Date().toISOString(),
        goal_id: graph.goal_id,
        node_id: node.node_id,
        agent_role: node.agent_role,
        action: "coder_complete",
        input_summary: `goal: ${goal.slice(0, 100)}`,
        output_summary: `${diff.length} file(s) modified`,
        test_results: [],
        status: "success"
      });
    }
    // Non-coder nodes: mark passed immediately
    else {
      node.status = "passed";
    }
  }

  graph.status = "complete";
  return graph;
}
