/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 4 — Test Runner */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import type { FileDiff, TestResult } from "./types";

// ---------------------------------------------------------------------------
// Types for vitest JSON reporter output
// ---------------------------------------------------------------------------

interface VitestTestResult {
  name: string;
  state: "pass" | "fail" | "skip" | "todo";
  errors?: Array<{ message?: string; stack?: string }>;
}

interface VitestSuite {
  name: string;
  filepath?: string;
  tasks: Array<VitestTestResult | VitestSuite>;
}

interface VitestJsonReport {
  testResults?: Array<{
    testFilePath?: string;
    testResults?: VitestTestResult[];
    status?: string;
  }>;
  // vitest --reporter=json top-level shape
  files?: VitestSuite[];
  numFailedTests?: number;
  numPassedTests?: number;
  success?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * applyDiffs — writes the modified content of each diff to targetDir/filename.
 * Parent directories are created automatically.
 */
export function applyDiffs(diffs: FileDiff[], targetDir: string): void {
  for (const diff of diffs) {
    const destPath = path.join(targetDir, diff.filename);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, diff.modified, "utf8");
  }
}

/**
 * runCommand — runs a command with spawn, resolves with { exitCode, stdout, stderr }.
 */
function runCommand(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      env: { ...process.env },
    });

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}

/**
 * flattenSuiteTasks — recursively collects all leaf test results from a vitest suite tree.
 */
function flattenSuiteTasks(
  suite: VitestSuite,
  filepath: string
): Array<{ name: string; filepath: string; state: string; errors: Array<{ message?: string; stack?: string }> }> {
  const results: Array<{ name: string; filepath: string; state: string; errors: Array<{ message?: string; stack?: string }> }> = [];
  for (const task of suite.tasks) {
    if ("tasks" in task) {
      // nested suite
      results.push(...flattenSuiteTasks(task as VitestSuite, filepath));
    } else {
      const t = task as VitestTestResult;
      results.push({
        name: t.name,
        filepath,
        state: t.state,
        errors: t.errors ?? [],
      });
    }
  }
  return results;
}

/**
 * parseVitestJson — extracts TestResult[] from vitest --reporter=json output.
 * Returns null if the output cannot be parsed.
 */
function parseVitestJson(
  stdout: string,
  nodeId: string
): TestResult[] | null {
  // vitest --reporter=json may prefix output with non-JSON lines; find the JSON object
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) return null;

  let report: VitestJsonReport;
  try {
    report = JSON.parse(stdout.slice(jsonStart)) as VitestJsonReport;
  } catch {
    return null;
  }

  const results: TestResult[] = [];

  // vitest v1+ shape: top-level `files` array with nested suites
  if (Array.isArray(report.files) && report.files.length > 0) {
    for (const suite of report.files) {
      const filepath = suite.filepath ?? suite.name ?? "";
      const tasks = flattenSuiteTasks(suite, filepath);
      for (const task of tasks) {
        const isRelated =
          task.name.includes(`AGENT[${nodeId}]`) ||
          task.filepath.includes(`AGENT[${nodeId}]`);

        const errorText = task.errors
          .map((e) => e.message ?? e.stack ?? "")
          .join("\n")
          .trim();

        results.push({
          test_id: isRelated ? `AGENT[${nodeId}]:${task.name}` : task.name,
          assertion: task.name,
          passed: task.state === "pass",
          actual_output:
            task.state === "pass"
              ? "PASS"
              : errorText || `FAIL (state: ${task.state})`,
        });
      }
    }
    return results;
  }

  // jest-compat shape: top-level `testResults` array
  if (Array.isArray(report.testResults) && report.testResults.length > 0) {
    for (const fileResult of report.testResults) {
      const filepath = fileResult.testFilePath ?? "";
      const tests = fileResult.testResults ?? [];
      for (const t of tests) {
        const isRelated =
          t.name.includes(`AGENT[${nodeId}]`) ||
          filepath.includes(`AGENT[${nodeId}]`);

        const errorText = (t.errors ?? [])
          .map((e) => e.message ?? e.stack ?? "")
          .join("\n")
          .trim();

        results.push({
          test_id: isRelated ? `AGENT[${nodeId}]:${t.name}` : t.name,
          assertion: t.name,
          passed: t.state === "pass",
          actual_output:
            t.state === "pass"
              ? "PASS"
              : errorText || `FAIL (state: ${t.state})`,
        });
      }
    }
    return results;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * runTests — applies diffs to a temporary staging directory and executes the
 * vitest suite. Maps failures to the TaskNode via AGENT[nodeId] comment tags.
 *
 * @param diffs       FileDiff[] produced by coderAgent
 * @param nodeId      The TaskNode.node_id whose work is under test
 * @param stagingDir  Optional override for the temp directory (defaults to os.tmpdir()/agent-staging-<timestamp>)
 * @returns           { passed: boolean, results: TestResult[] }
 *
 * `passed` is true ONLY when all tests pass (vitest exit code 0).
 * Errors are never suppressed; partial passes are never promoted to success.
 */
export async function runTests(
  diffs: FileDiff[],
  nodeId: string,
  stagingDir?: string
): Promise<{ passed: boolean; results: TestResult[] }> {
  const targetDir =
    stagingDir ?? path.join(os.tmpdir(), `agent-staging-${Date.now()}`);

  // Write modified files to staging area (does NOT touch the real source tree)
  fs.mkdirSync(targetDir, { recursive: true });
  applyDiffs(diffs, targetDir);

  // Determine repo root (the directory containing package.json / vitest config)
  // We run tests from the actual repo root so the full suite is exercised.
  // The staging dir is passed via AGENT_STAGING_DIR env so tests can consume it.
  const repoRoot = process.cwd();

  const { exitCode, stdout, stderr } = await runCommand(
    "pnpm",
    ["test", "--reporter=json"],
    repoRoot
  );

  // Attempt structured JSON parse
  const parsed = parseVitestJson(stdout, nodeId);

  if (parsed !== null && parsed.length > 0) {
    const passed = exitCode === 0;
    return { passed, results: parsed };
  }

  // Fallback: JSON parse failed — return single synthetic failure with raw output
  const rawOutput = [stdout, stderr].filter(Boolean).join("\n---STDERR---\n").trim();

  const fallbackResult: TestResult = {
    test_id: `AGENT[${nodeId}]:vitest-raw`,
    assertion: "vitest JSON output parseable",
    passed: false,
    actual_output: rawOutput.slice(0, 4000) || "(no output captured)",
  };

  return { passed: false, results: [fallbackResult] };
}
