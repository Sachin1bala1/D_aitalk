# User-Defined Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create their own named tools (SQL report templates, chart builders, multi-step reports, desktop notifications) that the APEX agent can call by name just like built-in tools.

**Architecture:** Each user tool is stored as a `UserTool` JSON object (id, description, parameters, body) in a Zustand `persist` store (localStorage key `daitalk_user_tools`). At agent-loop time, user tools are converted to `UnifiedTool` objects with a `user__` prefix and merged into the tool list sent to the AI provider. The agent calls them like any other tool; the `run_user_tool` CommandBus handler resolves the body type and dispatches existing commands (`execute_sql`, `create_chart`, `notify_user`).

**Tech Stack:** TypeScript, React 19, Zustand + Immer + persist middleware, Tailwind CSS v4, lucide-react, existing CommandBus + AgentLoop patterns already in daitalk-v2.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/tools/user.tools.ts` | **Create** | `UserTool` types, `userToolToUnifiedTool()`, `fillTemplate()` |
| `src/lib/tools/user.tools.test.ts` | **Create** | Unit tests for above |
| `src/lib/stores/UserToolStore.ts` | **Create** | Zustand persist store — CRUD for `UserTool[]` |
| `src/lib/stores/UserToolStore.test.ts` | **Create** | Unit tests for store operations |
| `src/lib/agent/commands.ts` | **Modify** | Add `RunUserToolCmd` to `AgentCommand` union + `describeCommand` case |
| `src/lib/agent/AgentLoop.ts` | **Modify** | `user__` routing in `toolCallToCommand()`, dynamic tool merge, prompt section |
| `src/lib/agent/registerHandlers.ts` | **Modify** | Register `run_user_tool` handler |
| `src/components/ai/UserToolForm.tsx` | **Create** | Controlled form for create / edit a single tool |
| `src/components/ai/UserToolsPanel.tsx` | **Create** | Dialog: tool list + inline create/edit shell |
| `src/components/ai/AIChat.tsx` | **Modify** | Add "My Tools" footer button + `<UserToolsPanel>` dialog |

---

## Task 1: UserTool types and utilities

**Files:**
- Create: `src/lib/tools/user.tools.ts`
- Create: `src/lib/tools/user.tools.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tools/user.tools.test.ts` with this exact content:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd C:\Users\sachi\Documents\manufacturing_agent\daitalk-v2
npx vitest run src/lib/tools/user.tools.test.ts 2>&1
```

Expected: `FAIL` — `Cannot find module './user.tools'`

- [ ] **Step 3: Create `src/lib/tools/user.tools.ts`**

```typescript
import type { UnifiedTool } from "../ai/types";

// ── Parameter & body types ─────────────────────────────────────────────────────

export interface UserToolParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
}

export type UserToolBody =
  | { type: "sql_template"; sql: string }
  | {
      type: "chart";
      sql: string;
      chartType: "bar" | "line" | "scatter" | "pie" | "area";
      xColumn: string;
      yColumn: string;
      title?: string;
    }
  | { type: "report"; steps: Array<{ label: string; sql: string }> }
  | { type: "notify"; message: string; level: "info" | "success" | "warning" | "error" };

export interface UserTool {
  /** URL-safe identifier — becomes `user__<id>` in the tool name */
  id: string;
  displayName: string;
  description: string;
  category: string;
  parameters: UserToolParameter[];
  body: UserToolBody;
}

// ── Converters ────────────────────────────────────────────────────────────────

export function userToolToUnifiedTool(tool: UserTool): UnifiedTool {
  return {
    name: `user__${tool.id}`,
    description: `[${tool.category}] ${tool.description}`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
      ),
      required: tool.parameters.filter((p) => p.required).map((p) => p.name),
    },
  };
}

/** Replace {{param_name}} placeholders with values from params. Unknown keys become "". */
export function fillTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ""));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/tools/user.tools.test.ts 2>&1
```

Expected: `13 tests pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools/user.tools.ts src/lib/tools/user.tools.test.ts
git commit -m "feat: add UserTool types, userToolToUnifiedTool, fillTemplate"
```

---

## Task 2: UserToolStore

**Files:**
- Create: `src/lib/stores/UserToolStore.ts`
- Create: `src/lib/stores/UserToolStore.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stores/UserToolStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useUserToolStore } from "./UserToolStore";
import type { UserTool } from "../tools/user.tools";

const TOOL_A: UserTool = {
  id: "tool_a",
  displayName: "Tool A",
  description: "Does A",
  category: "analysis",
  parameters: [],
  body: { type: "notify", message: "Hello", level: "info" },
};

const TOOL_B: UserTool = {
  id: "tool_b",
  displayName: "Tool B",
  description: "Does B",
  category: "reports",
  parameters: [],
  body: { type: "sql_template", sql: "SELECT 1" },
};

beforeEach(() => {
  useUserToolStore.setState({ tools: [] });
});

describe("UserToolStore", () => {
  it("starts with an empty tools array", () => {
    expect(useUserToolStore.getState().tools).toEqual([]);
  });

  it("addTool appends a new tool", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0].id).toBe("tool_a");
  });

  it("addTool preserves existing tools", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().addTool(TOOL_B);
    expect(useUserToolStore.getState().tools).toHaveLength(2);
  });

  it("updateTool updates matching tool by id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("tool_a", { displayName: "Updated A" });
    expect(useUserToolStore.getState().tools[0].displayName).toBe("Updated A");
  });

  it("updateTool does not change other fields", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("tool_a", { displayName: "Updated A" });
    expect(useUserToolStore.getState().tools[0].category).toBe("analysis");
  });

  it("updateTool is a no-op for unknown id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().updateTool("nonexistent", { displayName: "X" });
    expect(useUserToolStore.getState().tools[0].displayName).toBe("Tool A");
  });

  it("deleteTool removes the matching tool", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().addTool(TOOL_B);
    useUserToolStore.getState().deleteTool("tool_a");
    expect(useUserToolStore.getState().tools).toHaveLength(1);
    expect(useUserToolStore.getState().tools[0].id).toBe("tool_b");
  });

  it("deleteTool is a no-op for unknown id", () => {
    useUserToolStore.getState().addTool(TOOL_A);
    useUserToolStore.getState().deleteTool("nonexistent");
    expect(useUserToolStore.getState().tools).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/stores/UserToolStore.test.ts 2>&1
```

Expected: `FAIL` — `Cannot find module './UserToolStore'`

- [ ] **Step 3: Create `src/lib/stores/UserToolStore.ts`**

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UserTool } from "../tools/user.tools";

interface UserToolState {
  tools: UserTool[];
  addTool: (tool: UserTool) => void;
  updateTool: (id: string, updates: Partial<Omit<UserTool, "id">>) => void;
  deleteTool: (id: string) => void;
}

export const useUserToolStore = create<UserToolState>()(
  persist(
    immer((set) => ({
      tools: [],

      addTool: (tool) =>
        set((state) => {
          state.tools.push(tool);
        }),

      updateTool: (id, updates) =>
        set((state) => {
          const idx = state.tools.findIndex((t) => t.id === id);
          if (idx >= 0) Object.assign(state.tools[idx], updates);
        }),

      deleteTool: (id) =>
        set((state) => {
          state.tools = state.tools.filter((t) => t.id !== id);
        }),
    })),
    { name: "daitalk_user_tools" }
  )
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/stores/UserToolStore.test.ts 2>&1
```

Expected: `8 tests pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/UserToolStore.ts src/lib/stores/UserToolStore.test.ts
git commit -m "feat: add UserToolStore with persist (CRUD for user-defined tools)"
```

---

## Task 3: RunUserToolCmd in commands.ts

**Files:**
- Modify: `src/lib/agent/commands.ts`

---

- [ ] **Step 1: Add `RunUserToolCmd` interface**

Open `src/lib/agent/commands.ts`. Find the block that contains `RunStatToolCmd`. Add the new interface directly after it:

```typescript
export interface RunUserToolCmd {
  type: "run_user_tool";
  /** Matches UserTool.id — used to look up the tool from UserToolStore */
  toolId: string;
  params: Record<string, unknown>;
  connectionId: string | null;
  risk: "caution";
}
```

- [ ] **Step 2: Add to the `AgentCommand` union**

In `commands.ts`, find the `AgentCommand` union (the `export type AgentCommand = ...` declaration). Add `| RunUserToolCmd` to the end of the union, alongside the existing `| RunStatToolCmd` line.

- [ ] **Step 3: Add to `describeCommand()`**

In the `describeCommand()` function's switch statement, find the `case "run_stat_tool"` block. Add the new case directly after it:

```typescript
case "run_user_tool":
  return `User tool: ${cmd.toolId}`;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/commands.ts
git commit -m "feat: add RunUserToolCmd to AgentCommand union"
```

---

## Task 4: user__ routing + dynamic tools + prompt in AgentLoop.ts

**Files:**
- Modify: `src/lib/agent/AgentLoop.ts`

---

- [ ] **Step 1: Add imports at the top of `AgentLoop.ts`**

Find the existing import block at the top. Add these two lines alongside the existing imports:

```typescript
import { useUserToolStore } from "../stores/UserToolStore";
import { userToolToUnifiedTool } from "../tools/user.tools";
```

Also add `RunUserToolCmd` to the import from `"./commands"`:

```typescript
import { isDestructive, describeCommand } from "./commands";
import type { AgentCommand, RunUserToolCmd } from "./commands";
```

(Replace the existing `import type { AgentCommand }` line.)

- [ ] **Step 2: Add `user__` routing in `toolCallToCommand()`**

In `toolCallToCommand()`, find the existing `stat__` prefix check:

```typescript
if (tc.name.startsWith("stat__")) {
  return { ... };
}
```

Add the `user__` check **directly after** the stat check, before the switch:

```typescript
if (tc.name.startsWith("user__")) {
  const toolId = tc.name.slice("user__".length);
  return {
    type: "run_user_tool",
    toolId,
    params: i as Record<string, unknown>,
    connectionId,
    risk: "caution",
  } satisfies RunUserToolCmd;
}
```

- [ ] **Step 3: Merge user tools into the tool list in `runAgentLoop()`**

In `runAgentLoop()`, find the `for (let round = 0; round < MAX_ROUNDS; round++)` loop. Find the line inside it that calls `provider.stream(...)`. Just **before** the call (but inside the loop), add:

```typescript
const userToolDefs = useUserToolStore.getState().tools.map(userToolToUnifiedTool);
const allTools = [...AGENT_TOOLS, ...userToolDefs];
```

Then change the `tools:` argument in the `provider.stream()` call from:

```typescript
tools: AGENT_TOOLS,
```

to:

```typescript
tools: allTools,
```

- [ ] **Step 4: Inject user tools into `buildSystemPrompt()`**

In `buildSystemPrompt()`, find the final `parts.push(` call that pushes the `GUIDELINES:` block. Add the following **before** that push:

```typescript
const userToolList = useUserToolStore.getState().tools;
if (userToolList.length > 0) {
  const lines = userToolList
    .map((t) => {
      const paramHint =
        t.parameters.length > 0
          ? `\n  Parameters: ${t.parameters.map((p) => p.name).join(", ")}`
          : "";
      return `- **user__${t.id}** (${t.category}) — ${t.description}${paramHint}`;
    })
    .join("\n");
  parts.push(`## Your Custom Tools (call these proactively when user intent matches)\n${lines}`);
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/AgentLoop.ts
git commit -m "feat: route user__ tools through AgentLoop, inject into prompt"
```

---

## Task 5: run_user_tool handler in registerHandlers.ts

**Files:**
- Modify: `src/lib/agent/registerHandlers.ts`

---

- [ ] **Step 1: Add imports at the top of `registerHandlers.ts`**

Find the existing import block. Add:

```typescript
import { useUserToolStore } from "../stores/UserToolStore";
import { fillTemplate } from "../tools/user.tools";
import type { RunUserToolCmd } from "./commands";
```

- [ ] **Step 2: Register the handler**

Find the existing `commandBus.register<RunStatToolCmd>("run_stat_tool", ...)` block. Add the new handler **directly after** it:

```typescript
commandBus.register<RunUserToolCmd>("run_user_tool", async (cmd) => {
  const tool = useUserToolStore.getState().tools.find((t) => t.id === cmd.toolId);
  if (!tool) {
    return { success: false, error: `User tool not found: ${cmd.toolId}` };
  }

  const { body } = tool;

  if (body.type === "notify") {
    return commandBus.dispatch({
      type: "notify_user",
      message: fillTemplate(body.message, cmd.params),
      level: body.level,
      risk: "safe",
    });
  }

  if (body.type === "sql_template") {
    if (!cmd.connectionId) {
      return { success: false, error: "No active database connection" };
    }
    return commandBus.dispatch({
      type: "execute_sql",
      sql: fillTemplate(body.sql, cmd.params),
      connectionId: cmd.connectionId,
      risk: "safe",
    });
  }

  if (body.type === "chart") {
    if (!cmd.connectionId) {
      return { success: false, error: "No active database connection" };
    }
    const queryResult = await commandBus.dispatch({
      type: "execute_sql",
      sql: fillTemplate(body.sql, cmd.params),
      connectionId: cmd.connectionId,
      risk: "safe",
    });
    if (!queryResult.success) return queryResult;
    return commandBus.dispatch({
      type: "create_chart",
      chartType: body.chartType,
      xColumn: body.xColumn,
      yColumn: body.yColumn,
      title: body.title ?? tool.displayName,
      risk: "safe",
    });
  }

  if (body.type === "report") {
    if (!cmd.connectionId) {
      return { success: false, error: "No active database connection" };
    }
    const results: Array<{ label: string; data: unknown }> = [];
    for (const step of body.steps) {
      const r = await commandBus.dispatch({
        type: "execute_sql",
        sql: fillTemplate(step.sql, cmd.params),
        connectionId: cmd.connectionId,
        risk: "safe",
      });
      if (!r.success) return r;
      results.push({ label: step.label, data: r.result });
    }
    return { success: true, result: results };
  }

  return { success: false, error: "Unknown user tool body type" };
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/registerHandlers.ts
git commit -m "feat: register run_user_tool CommandBus handler"
```

---

## Task 6: UserToolForm component

**Files:**
- Create: `src/components/ai/UserToolForm.tsx`

This is a controlled form. It receives the tool to edit (or `null` for a new tool), calls `onSave(tool)` on submit, and `onCancel()` on dismiss.

---

- [ ] **Step 1: Create `src/components/ai/UserToolForm.tsx`**

```typescript
import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { UserTool, UserToolBody, UserToolParameter } from "../../lib/tools/user.tools";

interface Props {
  initial: UserTool | null;
  onSave: (tool: UserTool) => void;
  onCancel: () => void;
}

const BODY_TYPES = [
  { value: "sql_template", label: "SQL Query" },
  { value: "chart", label: "Chart" },
  { value: "report", label: "Multi-step Report" },
  { value: "notify", label: "Notification" },
] as const;

const CHART_TYPES = ["bar", "line", "scatter", "pie", "area"] as const;
const NOTIFY_LEVELS = ["info", "success", "warning", "error"] as const;

function blankTool(): UserTool {
  return {
    id: "",
    displayName: "",
    description: "",
    category: "analysis",
    parameters: [],
    body: { type: "sql_template", sql: "" },
  };
}

export function UserToolForm({ initial, onSave, onCancel }: Props) {
  const [tool, setTool] = useState<UserTool>(initial ?? blankTool());
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof UserTool>(key: K, value: UserTool[K]) =>
    setTool((prev) => ({ ...prev, [key]: value }));

  const setBodyField = (updates: Partial<UserToolBody>) =>
    setTool((prev) => ({ ...prev, body: { ...prev.body, ...updates } as UserToolBody }));

  const addParam = () =>
    set("parameters", [
      ...tool.parameters,
      { name: "", description: "", type: "string", required: false },
    ]);

  const updateParam = (idx: number, patch: Partial<UserToolParameter>) =>
    set(
      "parameters",
      tool.parameters.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );

  const removeParam = (idx: number) =>
    set("parameters", tool.parameters.filter((_, i) => i !== idx));

  const handleBodyTypeChange = (type: UserToolBody["type"]) => {
    if (type === "sql_template") set("body", { type: "sql_template", sql: "" });
    else if (type === "chart") set("body", { type: "chart", sql: "", chartType: "bar", xColumn: "", yColumn: "" });
    else if (type === "report") set("body", { type: "report", steps: [{ label: "", sql: "" }] });
    else if (type === "notify") set("body", { type: "notify", message: "", level: "info" });
  };

  const addReportStep = () => {
    if (tool.body.type !== "report") return;
    setBodyField({ steps: [...tool.body.steps, { label: "", sql: "" }] });
  };

  const updateReportStep = (idx: number, patch: { label?: string; sql?: string }) => {
    if (tool.body.type !== "report") return;
    setBodyField({
      steps: tool.body.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };

  const removeReportStep = (idx: number) => {
    if (tool.body.type !== "report") return;
    setBodyField({ steps: tool.body.steps.filter((_, i) => i !== idx) });
  };

  const handleSave = () => {
    if (!tool.id.trim()) return setError("ID is required.");
    if (!/^[a-z0-9_]+$/.test(tool.id)) return setError("ID must be lowercase letters, digits, and underscores only.");
    if (!tool.displayName.trim()) return setError("Display name is required.");
    if (!tool.description.trim()) return setError("Description is required.");
    if (tool.body.type === "sql_template" && !tool.body.sql.trim()) return setError("SQL is required.");
    if (tool.body.type === "chart" && (!tool.body.sql.trim() || !tool.body.xColumn.trim() || !tool.body.yColumn.trim()))
      return setError("SQL, X column, and Y column are required for chart tools.");
    if (tool.body.type === "report" && tool.body.steps.some((s) => !s.sql.trim()))
      return setError("All report steps must have SQL.");
    if (tool.body.type === "notify" && !tool.body.message.trim())
      return setError("Message is required for notification tools.");
    setError(null);
    onSave(tool);
  };

  const inputCls =
    "w-full bg-[#1a1a1a] border border-[#262626] rounded px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-[#00d2ff]";
  const labelCls = "block text-[10px] uppercase tracking-widest text-white/30 mb-1";

  return (
    <div className="space-y-4 text-sm">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Tool ID *</label>
          <input
            className={inputCls}
            placeholder="weekly_oee_report"
            value={tool.id}
            onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            disabled={!!initial}
          />
          <p className="text-[9px] text-white/20 mt-0.5">Lowercase, underscores only. Cannot change after save.</p>
        </div>
        <div>
          <label className={labelCls}>Display Name *</label>
          <input className={inputCls} placeholder="Weekly OEE Report" value={tool.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Description * (what APEX sees)</label>
          <input className={inputCls} placeholder="Returns OEE metrics for a machine over 7 days." value={tool.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <input className={inputCls} placeholder="reports / analysis / alerts" value={tool.category} onChange={(e) => set("category", e.target.value)} />
        </div>
      </div>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={labelCls}>Parameters</label>
          <button onClick={addParam} className="flex items-center gap-1 text-[9px] text-[#00d2ff] hover:text-white uppercase tracking-widest">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {tool.parameters.length === 0 && (
          <p className="text-[10px] text-white/20 italic">No parameters — tool takes no inputs from APEX.</p>
        )}
        {tool.parameters.map((p, i) => (
          <div key={i} className="flex gap-2 mb-1.5 items-start">
            <input className={`${inputCls} w-24 flex-shrink-0`} placeholder="name" value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} />
            <input className={`${inputCls} flex-1`} placeholder="description" value={p.description} onChange={(e) => updateParam(i, { description: e.target.value })} />
            <select className={`${inputCls} w-24 flex-shrink-0`} value={p.type} onChange={(e) => updateParam(i, { type: e.target.value as UserToolParameter["type"] })}>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <label className="flex items-center gap-1 text-[10px] text-white/40 flex-shrink-0 mt-2">
              <input type="checkbox" checked={p.required} onChange={(e) => updateParam(i, { required: e.target.checked })} />
              req
            </label>
            <button onClick={() => removeParam(i)} className="text-red-400/50 hover:text-red-400 mt-2">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <p className="text-[9px] text-white/20 mt-0.5">Use &#123;&#123;param_name&#125;&#125; in SQL/message to substitute values.</p>
      </div>

      {/* Body type selector */}
      <div>
        <label className={labelCls}>Tool Type *</label>
        <div className="flex gap-1.5">
          {BODY_TYPES.map((bt) => (
            <button
              key={bt.value}
              onClick={() => handleBodyTypeChange(bt.value)}
              className={`px-3 py-1.5 rounded text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                tool.body.type === bt.value
                  ? "bg-[#00d2ff]/20 border-[#00d2ff] text-[#00d2ff]"
                  : "bg-transparent border-[#262626] text-white/30 hover:border-white/30"
              }`}
            >
              {bt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body config — SQL Template */}
      {tool.body.type === "sql_template" && (
        <div>
          <label className={labelCls}>SQL *</label>
          <textarea
            className={`${inputCls} font-mono min-h-[100px] resize-y`}
            placeholder={"SELECT * FROM oee\nWHERE machine_id = '{{machine_id}}'\nORDER BY ts DESC\nLIMIT 100"}
            value={tool.body.sql}
            onChange={(e) => setBodyField({ sql: e.target.value })}
          />
        </div>
      )}

      {/* Body config — Chart */}
      {tool.body.type === "chart" && (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>SQL * (must return at least xColumn and yColumn)</label>
            <textarea
              className={`${inputCls} font-mono min-h-[80px] resize-y`}
              placeholder={"SELECT shift, avg(oee) as avg_oee\nFROM oee_daily\nGROUP BY shift"}
              value={tool.body.sql}
              onChange={(e) => setBodyField({ sql: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Chart Type</label>
              <select className={inputCls} value={tool.body.chartType} onChange={(e) => setBodyField({ chartType: e.target.value as typeof tool.body.chartType })}>
                {CHART_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>X Column *</label>
              <input className={inputCls} placeholder="shift" value={tool.body.xColumn} onChange={(e) => setBodyField({ xColumn: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Y Column *</label>
              <input className={inputCls} placeholder="avg_oee" value={tool.body.yColumn} onChange={(e) => setBodyField({ yColumn: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Chart Title (optional)</label>
            <input className={inputCls} placeholder="OEE by Shift" value={tool.body.title ?? ""} onChange={(e) => setBodyField({ title: e.target.value || undefined })} />
          </div>
        </div>
      )}

      {/* Body config — Report (multi-step) */}
      {tool.body.type === "report" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Report Steps *</label>
            <button onClick={addReportStep} className="flex items-center gap-1 text-[9px] text-[#00d2ff] hover:text-white uppercase tracking-widest">
              <Plus className="w-3 h-3" /> Add Step
            </button>
          </div>
          {tool.body.steps.map((s, i) => (
            <div key={i} className="border border-[#262626] rounded p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input className={`${inputCls} flex-1`} placeholder={`Step ${i + 1} label (e.g. "Availability")`} value={s.label} onChange={(e) => updateReportStep(i, { label: e.target.value })} />
                {tool.body.type === "report" && tool.body.steps.length > 1 && (
                  <button onClick={() => removeReportStep(i)} className="text-red-400/50 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <textarea
                className={`${inputCls} font-mono min-h-[60px] resize-y`}
                placeholder="SELECT avg(availability) FROM oee WHERE ..."
                value={s.sql}
                onChange={(e) => updateReportStep(i, { sql: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {/* Body config — Notify */}
      {tool.body.type === "notify" && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Message * ({{params}} supported)</label>
            <textarea
              className={`${inputCls} min-h-[60px] resize-y`}
              placeholder="Machine {{machine_id}} has exceeded downtime threshold."
              value={tool.body.message}
              onChange={(e) => setBodyField({ message: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Level</label>
            <select className={inputCls} value={tool.body.level} onChange={(e) => setBodyField({ level: e.target.value as typeof tool.body.level })}>
              {NOTIFY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Error + actions */}
      {error && <p className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} className="px-4 py-2 bg-[#00d2ff] text-black text-xs font-bold rounded-lg hover:opacity-90">
          {initial ? "Save Changes" : "Create Tool"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/UserToolForm.tsx
git commit -m "feat: add UserToolForm controlled component"
```

---

## Task 7: UserToolsPanel component

**Files:**
- Create: `src/components/ai/UserToolsPanel.tsx`

This is the dialog shell: shows the tool list, inline create/edit via `UserToolForm`.

---

- [ ] **Step 1: Create `src/components/ai/UserToolsPanel.tsx`**

```typescript
import React, { useState } from "react";
import { X, Plus, Pencil, Trash2, Wrench } from "lucide-react";
import { useUserToolStore } from "../../lib/stores/UserToolStore";
import { UserToolForm } from "./UserToolForm";
import type { UserTool } from "../../lib/tools/user.tools";

interface Props {
  onClose: () => void;
}

const BODY_TYPE_LABEL: Record<UserTool["body"]["type"], string> = {
  sql_template: "SQL Query",
  chart: "Chart",
  report: "Report",
  notify: "Notification",
};

const BODY_TYPE_COLOR: Record<UserTool["body"]["type"], string> = {
  sql_template: "#00d2ff",
  chart: "#FF6B35",
  report: "#7B61FF",
  notify: "#FFD700",
};

export function UserToolsPanel({ onClose }: Props) {
  const { tools, addTool, updateTool, deleteTool } = useUserToolStore();
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [editingTool, setEditingTool] = useState<UserTool | null>(null);

  const handleSave = (tool: UserTool) => {
    if (view === "create") {
      addTool(tool);
    } else if (view === "edit") {
      const { id, ...updates } = tool;
      updateTool(id, updates);
    }
    setView("list");
    setEditingTool(null);
  };

  const handleEdit = (tool: UserTool) => {
    setEditingTool(tool);
    setView("edit");
  };

  const handleDelete = (id: string) => {
    if (window.confirm("Delete this tool? APEX will no longer be able to call it.")) {
      deleteTool(id);
    }
  };

  const handleCancel = () => {
    setView("list");
    setEditingTool(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#111] border border-[#262626] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626] shrink-0">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#00d2ff]" />
            <span className="text-sm font-semibold text-white/80">
              {view === "list" ? "My Tools" : view === "create" ? "New Tool" : `Edit: ${editingTool?.displayName}`}
            </span>
            {view === "list" && tools.length > 0 && (
              <span className="text-[10px] text-white/30 ml-1">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view === "list" && (
              <button
                onClick={() => setView("create")}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00d2ff]/10 border border-[#00d2ff]/30 text-[#00d2ff] text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-[#00d2ff]/20 transition-colors"
              >
                <Plus className="w-3 h-3" /> New Tool
              </button>
            )}
            <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* List view */}
          {view === "list" && (
            <>
              {tools.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                  <Wrench className="w-8 h-8 text-white/10" />
                  <p className="text-sm text-white/40">No custom tools yet.</p>
                  <p className="text-xs text-white/20 max-w-xs">
                    Create tools for your standard reports, charts, or alerts — APEX will call them automatically when relevant.
                  </p>
                  <button
                    onClick={() => setView("create")}
                    className="mt-2 px-4 py-2 bg-[#00d2ff] text-black text-xs font-bold rounded-lg hover:opacity-90"
                  >
                    Create Your First Tool
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-white/3 border border-[#262626] hover:border-white/10 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-white/80">{tool.displayName}</span>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              color: BODY_TYPE_COLOR[tool.body.type],
                              background: `${BODY_TYPE_COLOR[tool.body.type]}18`,
                            }}
                          >
                            {BODY_TYPE_LABEL[tool.body.type]}
                          </span>
                          <span className="text-[9px] text-white/20 uppercase tracking-widest">{tool.category}</span>
                        </div>
                        <p className="text-xs text-white/40 truncate">{tool.description}</p>
                        <p className="text-[9px] text-white/20 font-mono mt-0.5">user__{tool.id}</p>
                        {tool.parameters.length > 0 && (
                          <p className="text-[9px] text-white/25 mt-0.5">
                            Params: {tool.parameters.map((p) => p.name).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEdit(tool)}
                          className="p-1.5 text-white/30 hover:text-[#00d2ff] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(tool.id)}
                          className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Create / Edit view */}
          {(view === "create" || view === "edit") && (
            <UserToolForm initial={editingTool} onSave={handleSave} onCancel={handleCancel} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/UserToolsPanel.tsx
git commit -m "feat: add UserToolsPanel dialog (list + create + edit + delete)"
```

---

## Task 8: Wire UserToolsPanel into AIChat.tsx

**Files:**
- Modify: `src/components/ai/AIChat.tsx`

Add a "My Tools" button to the footer next to the existing "Provider" button, which opens `UserToolsPanel` as a modal overlay.

---

- [ ] **Step 1: Add import**

In `src/components/ai/AIChat.tsx`, find the existing import for `ProviderSettingsDialog`. Add after it:

```typescript
import { UserToolsPanel } from "./UserToolsPanel";
```

Also add `Wrench` to the lucide-react import line alongside the existing icons:

```typescript
import { Send, Sparkles, Settings2, Clock, Trash2, Wrench } from "lucide-react";
```

- [ ] **Step 2: Add state variable**

In the component body, find the line:

```typescript
const [settingsOpen, setSettingsOpen] = useState(false);
```

Add directly after it:

```typescript
const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
```

- [ ] **Step 3: Add the footer button**

Find the footer button for `Provider` settings:

```tsx
<button
  onClick={() => setSettingsOpen(true)}
  className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
>
  <Settings2 className="w-2.5 h-2.5" /> Provider
</button>
```

Add the "My Tools" button **directly before** the Provider button:

```tsx
<button
  onClick={() => setToolsPanelOpen(true)}
  className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest"
>
  <Wrench className="w-2.5 h-2.5" /> My Tools
</button>
```

- [ ] **Step 4: Add the dialog**

Find the existing `<ProviderSettingsDialog ... />` at the bottom of the return statement. Add `<UserToolsPanel>` directly after it:

```tsx
{toolsPanelOpen && <UserToolsPanel onClose={() => setToolsPanelOpen(false)} />}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: no `error TS` lines.

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run 2>&1
```

Expected: all tests pass (new user.tools tests: 13, new UserToolStore tests: 8, existing PyodideRuntime tests: 5 — 26 total).

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/AIChat.tsx
git commit -m "feat: wire UserToolsPanel into AIChat footer — user-defined tools complete"
```

---

## Self-Review

**Spec coverage check:**
- ✅ User can create tools (Task 6 + 7 — form + panel)
- ✅ SQL report template (sql_template body type with {{param}} substitution)
- ✅ Chart tool (chart body type — SQL + chart config)
- ✅ Multi-step report (report body type — sequential SQL steps)
- ✅ Notification/alert (notify body type)
- ✅ APEX sees and calls user tools automatically (Task 4 — dynamic merge + prompt injection)
- ✅ Tools persist across sessions (UserToolStore with Zustand persist → localStorage)
- ✅ Edit / delete existing tools (Task 7 — UserToolsPanel list view)
- ✅ Parameters with {{substitution}} (fillTemplate + parameter form UI)
- ✅ Tool routing through CommandBus (Task 5 — run_user_tool handler)

**Placeholder scan:** None found. Every code block is complete.

**Type consistency check:**
- `UserTool.id` → used as `user__${tool.id}` in `userToolToUnifiedTool()` ✅
- `RunUserToolCmd.toolId` → matched against `UserTool.id` in handler ✅
- `fillTemplate(template, params)` → called with `cmd.params` in handler ✅
- `UserToolBody` discriminated union → all 4 variants handled in handler and form ✅
- `useUserToolStore.getState().tools` → accessed outside React in AgentLoop and registerHandlers ✅ (Zustand supports this)
