import { loadJsonDocument, saveJsonDocument } from "../persistence/NativeJsonStore";

import type { ChartType } from "./chartAutoSelect";

export interface ChartPresetAssignments {
  x: string | null;
  y: string | null;
  color: string | null;
  size: string | null;
  facet: string | null;
}

export interface ChartPresetOptions {
  showDataPoints: boolean;
  showTrendLine: boolean;
  logScaleX: boolean;
  logScaleY: boolean;
  xAxisMode: "auto" | "fit" | "zero" | "manual";
  yAxisMode: "auto" | "fit" | "zero" | "manual";
  xAxisMin: string;
  xAxisMax: string;
  yAxisMin: string;
  yAxisMax: string;
  xAxisLabel: string;
  yAxisLabel: string;
  refLineValue: string;
  refLineLabel: string;
  confidenceInterval: "none" | "95" | "99";
}

export interface SavedChartConfig {
  id: string;
  name: string;
  assignments: ChartPresetAssignments;
  chartType: ChartType | "auto";
  options: ChartPresetOptions;
  savedAt: number;
}

const LEGACY_STORAGE_KEY = "daitalk_saved_charts";
const DOC_KEY = "chart_presets";

let presetCache: SavedChartConfig[] | null = null;
const listeners = new Set<() => void>();

export function loadChartPresets(): SavedChartConfig[] {
  if (presetCache) return presetCache;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      presetCache = JSON.parse(raw) as SavedChartConfig[];
      return presetCache;
    }
  } catch {}
  presetCache = [];
  return presetCache;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

async function persistChartPresets(presets: SavedChartConfig[]): Promise<void> {
  try {
    await saveJsonDocument(DOC_KEY, presets);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(presets));
  }
}

export function saveChartPresets(presets: SavedChartConfig[]): void {
  presetCache = presets;
  notifyListeners();
  void persistChartPresets(presets);
}

export async function ensureChartPresetsLoaded(): Promise<SavedChartConfig[]> {
  const fallback = loadChartPresets();
  const presets = await loadJsonDocument<SavedChartConfig[]>(DOC_KEY, fallback);
  presetCache = presets;
  if (presets === fallback) {
    await persistChartPresets(presets);
  }
  notifyListeners();
  return presets;
}

export function subscribeChartPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
