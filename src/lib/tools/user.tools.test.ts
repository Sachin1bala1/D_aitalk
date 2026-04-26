import { describe, it, expect } from "vitest";
import { userToolToUnifiedTool, fillTemplate } from "./user.tools";
import type { UserTool } from "./user.tools";

const SAMPLE_TOOL: UserTool = {
  id: "weekly_oee",
  displayName: "Weekly OEE Report",
  description: "Returns OEE metrics for a given machine over the last 7 days.",
  category: "reports",
  parameters: [
    { name: "machine_id", description: "Machine identifier", type: "string", required: true },
    { name: "limit", description: "Row limit", type: "number", required: false },
  ],
  body: { type: "sql_template", sql: "SELECT * FROM oee WHERE machine_id = '{{machine_id}}' LIMIT {{limit}}" },
};

describe("userToolToUnifiedTool", () => {
  it("uses user__ prefix", () => {
    expect(userToolToUnifiedTool(SAMPLE_TOOL).name).toBe("user__weekly_oee");
  });

  it("includes category in description", () => {
    const desc = userToolToUnifiedTool(SAMPLE_TOOL).description;
    expect(desc).toContain("[reports]");
    expect(desc).toContain("OEE metrics");
  });

  it("maps required parameters into required array", () => {
    const p = userToolToUnifiedTool(SAMPLE_TOOL).parameters;
    expect(p.required).toEqual(["machine_id"]);
  });

  it("omits optional parameters from required array", () => {
    const p = userToolToUnifiedTool(SAMPLE_TOOL).parameters;
    expect(p.required).not.toContain("limit");
  });

  it("maps parameter type correctly", () => {
    const p = userToolToUnifiedTool(SAMPLE_TOOL).parameters;
    expect(p.properties["machine_id"].type).toBe("string");
    expect(p.properties["limit"].type).toBe("number");
  });

  it("produces empty required array when no required parameters", () => {
    const tool: UserTool = { ...SAMPLE_TOOL, parameters: [] };
    expect(userToolToUnifiedTool(tool).parameters.required).toEqual([]);
  });
});

describe("fillTemplate", () => {
  it("replaces a single {{param}} placeholder", () => {
    expect(fillTemplate("WHERE id = '{{machine_id}}'", { machine_id: "M-42" }))
      .toBe("WHERE id = 'M-42'");
  });

  it("replaces multiple different placeholders", () => {
    expect(fillTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" }))
      .toBe("foo and bar");
  });

  it("replaces a placeholder that appears multiple times", () => {
    expect(fillTemplate("{{x}} + {{x}}", { x: "1" }))
      .toBe("1 + 1");
  });

  it("converts numeric values to string", () => {
    expect(fillTemplate("LIMIT {{n}}", { n: 10 })).toBe("LIMIT 10");
  });

  it("converts boolean values to string", () => {
    expect(fillTemplate("active={{flag}}", { flag: true })).toBe("active=true");
  });

  it("replaces unknown placeholder with empty string", () => {
    expect(fillTemplate("{{missing}}", {})).toBe("");
  });

  it("leaves text without placeholders unchanged", () => {
    expect(fillTemplate("SELECT 1", {})).toBe("SELECT 1");
  });
});
