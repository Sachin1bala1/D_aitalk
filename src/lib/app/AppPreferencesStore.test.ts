import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureAppPreferencesLoaded,
  loadAppPreferencesSync,
  resetAppPreferencesForTests,
  updateAppPreferences,
} from "./AppPreferencesStore";

const loadAppDocument = vi.fn();
const saveAppDocument = vi.fn();
const deleteAppDocument = vi.fn();

vi.mock("../db/DbClient", () => ({
  DbClient: {
    loadAppDocument: (...args: unknown[]) => loadAppDocument(...args),
    saveAppDocument: (...args: unknown[]) => saveAppDocument(...args),
    deleteAppDocument: (...args: unknown[]) => deleteAppDocument(...args),
  },
}));

describe("AppPreferencesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAppPreferencesForTests();
    loadAppDocument.mockReset();
    saveAppDocument.mockReset();
    deleteAppDocument.mockReset();
  });

  it("migrates legacy onboarding and panel state into native persistence", async () => {
    localStorage.setItem("daitalk_onboarding_dismissed", "1");
    localStorage.setItem("daitalk_tour_completed", "1");
    localStorage.setItem("daitalk_props_panel_height", "320");
    loadAppDocument.mockResolvedValueOnce(null);
    saveAppDocument.mockResolvedValue(undefined);

    const preferences = await ensureAppPreferencesLoaded();

    expect(preferences.onboardingDismissed).toBe(true);
    expect(preferences.onboardingTourCompleted).toBe(true);
    expect(preferences.objectPropertiesPanelHeight).toBe(320);
    expect(saveAppDocument).toHaveBeenCalled();
    expect(localStorage.getItem("daitalk_onboarding_dismissed")).toBeNull();
  });

  it("falls back to localStorage if native persistence fails", () => {
    saveAppDocument.mockRejectedValueOnce(new Error("native unavailable"));

    const next = updateAppPreferences({
      onboardingDismissed: true,
      objectPropertiesPanelHeight: 300,
    });

    expect(next.onboardingDismissed).toBe(true);
    expect(loadAppPreferencesSync().objectPropertiesPanelHeight).toBe(300);
  });
});
