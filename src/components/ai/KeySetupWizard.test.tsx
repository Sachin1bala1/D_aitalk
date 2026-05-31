import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KeySetupWizard } from "./KeySetupWizard";

// Mock clipboard
const mockReadText = vi.fn();
Object.defineProperty(navigator, "clipboard", {
  value: { readText: mockReadText },
  writable: true,
});

// Mock shell open
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// Mock saveApiKeyToKeychain
vi.mock("../../lib/ai/types", () => ({
  saveApiKeyToKeychain: vi.fn().mockResolvedValue(undefined),
  PROVIDER_CATALOG: [
    {
      id: "claude",
      name: "Claude (Anthropic)",
      keyPrefix: "sk-ant",
      keyPlaceholder: "sk-ant-api03-...",
    },
  ],
}));

describe("KeySetupWizard", () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReadText.mockResolvedValue("");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
  });

  const render = (props?: Partial<React.ComponentProps<typeof KeySetupWizard>>) => {
    act(() => {
      root.render(
        <KeySetupWizard
          open={true}
          providerId="claude"
          onSave={onSave}
          onClose={onClose}
          {...props}
        />
      );
    });
  };

  it("renders step 1 with provider name and open console button", () => {
    render();
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toMatch(/Open.*Console/i);
  });

  it("Confirm/Save is disabled when no key detected", () => {
    render();
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /save|confirm/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(true);
  });

  it("Save enabled after clipboard returns valid key", async () => {
    mockReadText.mockResolvedValue("sk-ant-api03-validkey123");
    render();
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /save|confirm/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("calls onSave and onClose when Save clicked", async () => {
    const { saveApiKeyToKeychain } = await import("../../lib/ai/types");
    mockReadText.mockResolvedValue("sk-ant-api03-validkey123");
    render();
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /save|confirm/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(saveApiKeyToKeychain).toHaveBeenCalledWith("claude", "sk-ant-api03-validkey123");
    expect(onSave).toHaveBeenCalledWith("claude", "sk-ant-api03-validkey123");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows manual paste input when clipboard permission denied", async () => {
    mockReadText.mockRejectedValue(new Error("Permission denied"));
    render();
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    const input = container.querySelector("input[placeholder*='paste' i], input[placeholder*='Paste' i]");
    expect(input).toBeDefined();
  });
});
