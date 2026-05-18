import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphBuilderPanel } from "./GraphBuilderPanel";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

vi.mock("./GraphBuilder", () => ({
  GraphBuilder: () => <div data-testid="mock-graph-builder">graph</div>,
}));

vi.mock("../../lib/charts/ChartPresetStore", () => ({
  ensureChartPresetsLoaded: vi.fn().mockResolvedValue([]),
  loadChartPresets: vi.fn().mockReturnValue([]),
  saveChartPresets: vi.fn(),
  subscribeChartPresets: vi.fn().mockReturnValue(() => {}),
}));

const columns = [
  {
    name: "Torque [Nm]",
    type_name: "float8",
    display_type: { kind: "float" as const },
    nullable: true,
    is_primary_key: false,
  },
  {
    name: "Tool wear [min]",
    type_name: "float8",
    display_type: { kind: "float" as const },
    nullable: true,
    is_primary_key: false,
  },
  {
    name: "Type",
    type_name: "text",
    display_type: { kind: "text" as const },
    nullable: true,
    is_primary_key: false,
  },
];

const data = [
  { "Torque [Nm]": 42.8, "Tool wear [min]": 5, Type: "L" },
  { "Torque [Nm]": 46.1, "Tool wear [min]": 8, Type: "M" },
];

describe("GraphBuilderPanel assignment fallback", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      activeConnectionId: "conn-1",
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          type: "sql_editor",
          title: "Query 1",
          sql: "select 1",
          connectionId: "conn-1",
          queryResults: null,
          isExecuting: false,
          queryView: null,
          dashboard: null,
          restoredSnapshotAt: null,
        },
      ],
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("lets users click a column then click a zone to assign it", async () => {
    await act(async () => {
      root.render(<GraphBuilderPanel columns={columns} data={data} initialRequest={null} />);
    });

    await act(async () => {
      (Array.from(container.querySelectorAll("span")).find((node) => node.textContent === "Type") as HTMLElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="drop-zone-color"]') as HTMLDivElement).click();
    });

    expect(container.querySelector('[data-testid="drop-zone-color"]')?.textContent ?? "").toContain("Type");
  });

  it("lets users reassign an existing zone field by selecting it and clicking another zone", async () => {
    await act(async () => {
      root.render(<GraphBuilderPanel columns={columns} data={data} initialRequest={null} />);
    });

    const clickLabel = async (text: string) => {
      const node = Array.from(container.querySelectorAll("span")).find((candidate) => candidate.textContent === text) as HTMLElement | undefined;
      if (!node) throw new Error(`Could not find node with text: ${text}`);
      await act(async () => {
        node.click();
      });
    };

    await clickLabel("Torque [Nm]");
    await act(async () => {
      (container.querySelector('[data-testid="drop-zone-x"]') as HTMLDivElement).click();
    });
    await clickLabel("Tool wear [min]");
    await act(async () => {
      (container.querySelector('[data-testid="drop-zone-y"]') as HTMLDivElement).click();
    });

    expect(container.querySelector('[data-testid="drop-zone-x"]')?.textContent ?? "").toContain("Torque [Nm]");
    expect(container.querySelector('[data-testid="drop-zone-y"]')?.textContent ?? "").toContain("Tool wear [min]");

    await clickLabel("Tool wear [min]");
    await act(async () => {
      (container.querySelector('[data-testid="drop-zone-color"]') as HTMLDivElement).click();
    });

    expect(container.querySelector('[data-testid="drop-zone-color"]')?.textContent ?? "").toContain("Tool wear [min]");
    expect(container.querySelector('[data-testid="drop-zone-y"]')?.textContent ?? "").not.toContain("Tool wear [min]");
  });

  it("does not auto-assign a clicked column until the user chooses a zone", async () => {
    await act(async () => {
      root.render(<GraphBuilderPanel columns={columns} data={data} initialRequest={null} />);
    });

    await act(async () => {
      (Array.from(container.querySelectorAll("span")).find((node) => node.textContent === "Type") as HTMLElement).click();
    });

    expect(container.querySelector('[data-testid="drop-zone-x"]')?.textContent ?? "").not.toContain("Type");
    expect(container.querySelector('[data-testid="drop-zone-y"]')?.textContent ?? "").not.toContain("Type");
    expect(container.textContent ?? "").toContain("Selected: Type");
  });
});
