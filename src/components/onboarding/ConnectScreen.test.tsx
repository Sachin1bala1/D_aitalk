import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectScreen } from "./ConnectScreen";

vi.mock("../../lib/auth/googleOAuth", () => ({
  startGoogleOAuthFlow: vi.fn().mockResolvedValue({
    accessToken: "ya29.test",
    refreshToken: "1//test",
    expiresAt: Date.now() + 3600000,
  }),
}));

vi.mock("../../lib/ai/types", () => ({
  saveApiKeyToKeychain: vi.fn().mockResolvedValue(undefined),
  loadSettings: vi.fn().mockReturnValue({ activeProvider: "claude", keys: {}, models: {} }),
  saveSettings: vi.fn(),
  PROVIDER_CATALOG: [
    { id: "claude", name: "Claude (Anthropic)", keyPrefix: "sk-ant", keyPlaceholder: "sk-ant-api03-..." },
    { id: "openai", name: "OpenAI", keyPrefix: "sk-", keyPlaceholder: "sk-..." },
    { id: "gemini", name: "Gemini", keyPrefix: ["AIza", "AQ."], keyPlaceholder: "AIzaSy..." },
  ],
}));

// KeySetupWizard renders a portal-like overlay — mock it to avoid complexity
vi.mock("../ai/KeySetupWizard", () => ({
  KeySetupWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="key-setup-wizard" /> : null,
}));

describe("ConnectScreen", () => {
  const onComplete = vi.fn();
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  // Pretend we're running inside Tauri so the Google button renders
  beforeEach(() => {
    (window as any).__TAURI__ = {};
  });
  afterEach(() => {
    delete (window as any).__TAURI__;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  const render = () => {
    act(() => {
      root.render(<ConnectScreen onComplete={onComplete} />);
    });
  };

  it("renders three entry paths", () => {
    render();
    expect(container.textContent).toMatch(/Sign in with Google/i);
    expect(container.textContent).toMatch(/Claude key|API key/i);
    expect(container.textContent).toMatch(/Skip/i);
  });

  it("Skip calls onComplete immediately", () => {
    render();
    const skipBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => /skip/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => { skipBtn.click(); });
    expect(onComplete).toHaveBeenCalled();
  });

  it("Google Sign-In triggers OAuth flow and calls onComplete", async () => {
    vi.useFakeTimers();
    const { startGoogleOAuthFlow } = await import("../../lib/auth/googleOAuth");
    render();
    const googleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => /sign in with google/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      googleBtn.click();
      // Let the async OAuth flow resolve
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startGoogleOAuthFlow).toHaveBeenCalled();
    // Advance past the 1s "Connected!" delay
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(onComplete).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
