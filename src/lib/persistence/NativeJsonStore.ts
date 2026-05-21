import { DbClient } from "../db/DbClient";
import { toast } from "sonner";

const degradedFeatures = new Set<string>();

export function notifyNativePersistenceFallback(feature: string): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  if (degradedFeatures.has(feature)) return;
  degradedFeatures.add(feature);
  toast.warning(`${feature} persistence is using local fallback storage.`, {
    description: "Native app storage is unavailable, so this data may not restore as reliably across sessions.",
  });
}

export async function loadJsonDocument<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await DbClient.loadAppDocument(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJsonDocument<T>(key: string, value: T): Promise<void> {
  await DbClient.saveAppDocument(key, JSON.stringify(value));
}

export async function deleteJsonDocument(key: string): Promise<void> {
  await DbClient.deleteAppDocument(key);
}
