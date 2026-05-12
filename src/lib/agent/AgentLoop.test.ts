import { describe, expect, it } from "vitest";
import {
  buildVisualizationClarifier,
  inferNumericColumns,
  isUnderspecifiedVisualizationRequest,
} from "./AgentLoop";
import type { QueryResults } from "../stores/WorkspaceStore";

const SAMPLE_RESULTS: QueryResults = {
  rows: [
    {
      "Torque [Nm]": 42.8,
      "Tool wear [min]": 0,
      "Air temperature [K]": 298.1,
      Type: "L",
    },
    {
      "Torque [Nm]": 46.3,
      "Tool wear [min]": 3,
      "Air temperature [K]": 298.2,
      Type: "M",
    },
  ],
  fields: [
    { name: "Torque [Nm]" },
    { name: "Tool wear [min]" },
    { name: "Air temperature [K]" },
    { name: "Type" },
  ],
  rowCount: 2,
  elapsedMs: 12,
  queryId: "q1",
  source_tables: ["public.sachin_test_data_table"],
};

describe("visualization clarification heuristics", () => {
  it("flags generic plot requests as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("make plot")).toBe(true);
    expect(isUnderspecifiedVisualizationRequest("plot data")).toBe(true);
  });

  it("does not flag explicit plot relationships as underspecified", () => {
    expect(isUnderspecifiedVisualizationRequest("plot Torque [Nm] vs Tool wear [min]")).toBe(false);
    expect(isUnderspecifiedVisualizationRequest("make a histogram of Torque [Nm]")).toBe(false);
  });

  it("infers numeric columns from current results", () => {
    expect(inferNumericColumns(SAMPLE_RESULTS)).toEqual([
      "Torque [Nm]",
      "Tool wear [min]",
      "Air temperature [K]",
    ]);
  });

  it("builds a clarifying question with concrete examples when results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", SAMPLE_RESULTS);
    expect(clarifier).toContain("Which relationship do you want plotted?");
    expect(clarifier).toContain("Torque [Nm] vs Tool wear [min]");
  });

  it("asks for columns when no results are loaded", () => {
    const clarifier = buildVisualizationClarifier("make plot", null);
    expect(clarifier).toContain("Which columns or relationship do you want plotted?");
  });
});
