import { getVersion } from "@tauri-apps/api/app";

export type UpdateCheckState =
  | { kind: "checking" }
  | { kind: "up_to_date"; currentVersion: string }
  | { kind: "available"; currentVersion: string; version: string; body?: string | null; date?: string | null }
  | { kind: "unavailable"; currentVersion: string | null; reason: string }
  | { kind: "error"; currentVersion: string | null; reason: string };

type UpdaterModule = {
  check: () => Promise<{
    available?: boolean;
    version?: string;
    body?: string | null;
    date?: string | null;
    downloadAndInstall?: () => Promise<void>;
  } | null>;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function loadUpdaterModule(): Promise<UpdaterModule | null> {
  try {
    const mod = await import("@tauri-apps/plugin-updater");
    return mod as UpdaterModule;
  } catch {
    return null;
  }
}

export async function checkForUpdates(): Promise<UpdateCheckState> {
  let currentVersion: string | null = null;

  try {
    currentVersion = await getVersion();
  } catch {
    currentVersion = null;
  }

  if (!hasTauriRuntime()) {
    return {
      kind: "unavailable",
      currentVersion,
      reason: "Update checks are only available in desktop builds.",
    };
  }

  const updater = await loadUpdaterModule();
  if (!updater) {
    return {
      kind: "unavailable",
      currentVersion,
      reason: "Updater support is not bundled in this build.",
    };
  }

  try {
    const update = await updater.check();
    if (update?.available) {
      return {
        kind: "available",
        currentVersion: currentVersion ?? "unknown",
        version: update.version ?? "unknown",
        body: update.body ?? null,
        date: update.date ?? null,
      };
    }

    return {
      kind: "up_to_date",
      currentVersion: currentVersion ?? "unknown",
    };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    const lowered = message.toLowerCase();
    if (
      lowered.includes("plugin") ||
      lowered.includes("updater") ||
      lowered.includes("endpoint") ||
      lowered.includes("public key") ||
      lowered.includes("not configured")
    ) {
      return {
        kind: "unavailable",
        currentVersion,
        reason: "Updater is not configured for this build yet.",
      };
    }

    return {
      kind: "error",
      currentVersion,
      reason: message,
    };
  }
}

export async function installAvailableUpdate(): Promise<void> {
  const updater = await loadUpdaterModule();
  if (!updater) {
    throw new Error("Updater support is not bundled in this build.");
  }

  const update = await updater.check();
  if (!update?.available || !update.downloadAndInstall) {
    throw new Error("No update is currently available.");
  }

  await update.downloadAndInstall();
}
