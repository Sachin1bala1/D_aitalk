import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

export interface AppPreferences {
  onboardingDismissed: boolean;
  onboardingTourCompleted: boolean;
  objectPropertiesPanelHeight: number;
}

const STORAGE_KEY = "app_preferences";
const LEGACY_ONBOARDING_KEY = "daitalk_onboarding_dismissed";
const LEGACY_TOUR_KEY = "daitalk_tour_completed";
const LEGACY_PANEL_HEIGHT_KEY = "daitalk_props_panel_height";

const DEFAULT_PREFERENCES: AppPreferences = {
  onboardingDismissed: false,
  onboardingTourCompleted: false,
  objectPropertiesPanelHeight: 280,
};

let cachedPreferences: AppPreferences | null = null;
let loadPromise: Promise<AppPreferences> | null = null;

function readLegacyPreferences(): AppPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };

  const panelHeight = Number.parseInt(
    localStorage.getItem(LEGACY_PANEL_HEIGHT_KEY) ?? String(DEFAULT_PREFERENCES.objectPropertiesPanelHeight),
    10,
  );

  return {
    onboardingDismissed: localStorage.getItem(LEGACY_ONBOARDING_KEY) === "1",
    onboardingTourCompleted: localStorage.getItem(LEGACY_TOUR_KEY) === "1",
    objectPropertiesPanelHeight: Number.isFinite(panelHeight)
      ? panelHeight
      : DEFAULT_PREFERENCES.objectPropertiesPanelHeight,
  };
}

function writeLegacyPreferences(preferences: AppPreferences) {
  if (typeof window === "undefined") return;

  if (preferences.onboardingDismissed) {
    localStorage.setItem(LEGACY_ONBOARDING_KEY, "1");
  } else {
    localStorage.removeItem(LEGACY_ONBOARDING_KEY);
  }

  if (preferences.onboardingTourCompleted) {
    localStorage.setItem(LEGACY_TOUR_KEY, "1");
  } else {
    localStorage.removeItem(LEGACY_TOUR_KEY);
  }

  localStorage.setItem(
    LEGACY_PANEL_HEIGHT_KEY,
    String(Math.round(preferences.objectPropertiesPanelHeight)),
  );
}

function clearLegacyPreferences() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_ONBOARDING_KEY);
  localStorage.removeItem(LEGACY_TOUR_KEY);
  localStorage.removeItem(LEGACY_PANEL_HEIGHT_KEY);
}

function normalizePreferences(input: Partial<AppPreferences> | null | undefined): AppPreferences {
  return {
    onboardingDismissed: input?.onboardingDismissed ?? DEFAULT_PREFERENCES.onboardingDismissed,
    onboardingTourCompleted:
      input?.onboardingTourCompleted ?? DEFAULT_PREFERENCES.onboardingTourCompleted,
    objectPropertiesPanelHeight:
      typeof input?.objectPropertiesPanelHeight === "number" &&
      Number.isFinite(input.objectPropertiesPanelHeight)
        ? input.objectPropertiesPanelHeight
        : DEFAULT_PREFERENCES.objectPropertiesPanelHeight,
  };
}

async function persistPreferences(preferences: AppPreferences) {
  try {
    await saveJsonDocument(STORAGE_KEY, preferences);
    clearLegacyPreferences();
  } catch {
    writeLegacyPreferences(preferences);
    notifyNativePersistenceFallback("App preferences");
  }
}

export function loadAppPreferencesSync(): AppPreferences {
  if (cachedPreferences) return cachedPreferences;
  cachedPreferences = normalizePreferences(readLegacyPreferences());
  return cachedPreferences;
}

export async function ensureAppPreferencesLoaded(): Promise<AppPreferences> {
  if (cachedPreferences) return cachedPreferences;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const legacy = normalizePreferences(readLegacyPreferences());
    try {
      const stored = await loadJsonDocument<Partial<AppPreferences>>(STORAGE_KEY, legacy);
      const normalized = normalizePreferences(stored);
      cachedPreferences = normalized;

      const legacyExists =
        typeof window !== "undefined" &&
        (localStorage.getItem(LEGACY_ONBOARDING_KEY) !== null ||
          localStorage.getItem(LEGACY_TOUR_KEY) !== null ||
          localStorage.getItem(LEGACY_PANEL_HEIGHT_KEY) !== null);

      if (legacyExists) {
        await persistPreferences(normalized);
      }

      return normalized;
    } catch {
      cachedPreferences = legacy;
      return legacy;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function updateAppPreferences(
  updates: Partial<AppPreferences> | ((current: AppPreferences) => Partial<AppPreferences>),
): AppPreferences {
  const current = loadAppPreferencesSync();
  const patch = typeof updates === "function" ? updates(current) : updates;
  const next = normalizePreferences({ ...current, ...patch });
  cachedPreferences = next;
  void persistPreferences(next);
  return next;
}

export function resetAppPreferencesForTests() {
  cachedPreferences = null;
  loadPromise = null;
}
