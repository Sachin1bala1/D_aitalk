/** @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 6 — Trace Logger */
import * as fs from "fs";
import * as path from "path";
import type { AgentTraceEntry } from "./types";

const TRACE_FILE = path.join(process.cwd(), "agent_trace.jsonl");

export const traceLogger = {
  append(entry: AgentTraceEntry): void {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(TRACE_FILE, line, "utf-8");
  },
  getPath(): string {
    return TRACE_FILE;
  }
};
