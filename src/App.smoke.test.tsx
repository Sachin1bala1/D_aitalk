import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/search/WorkspaceSearchPanel", () => ({
  WorkspaceSearchPanel: () => <div data-testid="workspace-search-panel">search</div>,
}));
vi.mock("./components/artifacts/ArtifactsPanel", () => ({
  ArtifactsPanel: () => <div data-testid="artifacts-panel">artifacts</div>,
}));
vi.mock("./components/pipelines/PipelinePanel", () => ({
  PipelinePanel: () => <div data-testid="pipelines-panel">pipelines</div>,
}));
vi.mock("./components/agents/BackgroundAgentsPanel", () => ({
  BackgroundAgentsPanel: () => <div data-testid="background-agents-panel">agents</div>,
}));

import { SmokeWorkspaceShell } from "./components/app/SmokeWorkspaceShell";

describe("App smoke mode", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    window.history.pushState({}, "", "/");
  });

  it("renders the main workspace surfaces and allows panel switching", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<SmokeWorkspaceShell />);
    });

    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace-search-panel"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="panel-tab-artifacts"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="artifacts-panel"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="panel-tab-pipelines"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="pipelines-panel"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="panel-tab-background_agents"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="background-agents-panel"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="panel-tab-agent"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="ai-panel-stub"]')).not.toBeNull();
  });
});
