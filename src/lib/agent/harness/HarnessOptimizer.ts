// src/lib/agent/harness/HarnessOptimizer.ts
// Meta-harness (H-4): analyzes failure traces to generate improved system prompt additions.
// Manages creating and activating new harness versions based on observed failure patterns.
import { FailureTraceStore } from './FailureTraceStore';
import type { HarnessFailureTrace, HarnessVersion } from './FailureTraceStore';

export interface OptimizationReport {
  analyzedTraces: number;
  topFailingTools: string[];
  topStruggleTypes: string[];
  generatedVersion: HarnessVersion | null;
  promptAddition: string;
}

export class HarnessOptimizer {
  /**
   * Analyzes recent failures and generates a new harness version.
   * Returns null if there are fewer than minTraces failures to analyze.
   */
  static async optimize(minTraces = 3): Promise<OptimizationReport | null> {
    const traces = await FailureTraceStore.getFailures(100);

    if (traces.length < minTraces) {
      return null;
    }

    const toolCounts = HarnessOptimizer.countTools(traces);
    const struggleCounts = HarnessOptimizer.countStruggleTypes(traces);

    const topFailingTools = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool]) => tool);

    const topStruggleTypes = Array.from(struggleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);

    const versionTag = `v${Date.now().toString(36)}`;
    const promptAddition = HarnessOptimizer.generatePromptAddition(topFailingTools, topStruggleTypes);

    await FailureTraceStore.insertVersion(versionTag, promptAddition);

    const versions = await FailureTraceStore.getVersions();
    const generatedVersion = versions.find(v => v.version_tag === versionTag) ?? null;

    return {
      analyzedTraces: traces.length,
      topFailingTools,
      topStruggleTypes,
      generatedVersion,
      promptAddition,
    };
  }

  /**
   * Generates the system prompt addition string from analysis of top failing tools
   * and detected struggle patterns.
   */
  private static generatePromptAddition(
    topFailingTools: string[],
    topStruggleTypes: string[]
  ): string {
    if (topFailingTools.length === 0 && topStruggleTypes.length === 0) {
      return 'No common failure patterns detected.';
    }

    const lines: string[] = ['## Harness Self-Improvement Guidance', 'Based on recent session analysis:'];

    if (topFailingTools.length > 0) {
      const toolList = topFailingTools.join(', ');
      lines.push(
        `- Tools with high failure rates: ${toolList}.` +
        ' Verify connection status before calling these tools.' +
        ' If they fail once, switch approach.'
      );
    }

    if (topStruggleTypes.length > 0) {
      const struggleList = topStruggleTypes.join(', ');
      const sameToolNote = topStruggleTypes.includes('same_tool_called_3x')
        ? ' If you call the same tool 3 times, stop and ask the user for clarification instead.'
        : ' When you encounter these patterns, pause and reconsider your approach.';
      lines.push(`- Detected struggle patterns: ${struggleList}.${sameToolNote}`);
    }

    return lines.join('\n');
  }

  /**
   * Counts tool occurrences across traces (parses the JSON tools_used field).
   */
  private static countTools(traces: HarnessFailureTrace[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const trace of traces) {
      let tools: string[];
      try {
        tools = JSON.parse(trace.tools_used) as string[];
      } catch {
        continue;
      }
      if (!Array.isArray(tools)) continue;
      for (const tool of tools) {
        counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Counts struggle types across traces (parses the JSON struggle_events field).
   */
  private static countStruggleTypes(traces: HarnessFailureTrace[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const trace of traces) {
      let events: Array<{ type: string }>;
      try {
        events = JSON.parse(trace.struggle_events) as Array<{ type: string }>;
      } catch {
        continue;
      }
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (typeof event?.type === 'string') {
          counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
        }
      }
    }
    return counts;
  }
}
