// src/lib/memory/UserCalibrationProfile.ts
import { invoke } from "@tauri-apps/api/core";

export type ExpertiseLevel = "operator" | "engineer" | "expert";

export interface CalibrationProfile {
  expertiseLevel: ExpertiseLevel;
  parameterPriorities: string[];  // column names user accesses most
  preferredChartTypes: string[];
  domainFocus: string[];
  correctionHistory: Array<{ original: string; corrected: string; ts: number }>;
  implicitInterests: Record<string, number>;  // column -> access count
  updatedAt: number;
}

interface RawProfile {
  id: string;
  expertise_level: string;
  parameter_priorities: string;
  preferred_chart_types: string;
  domain_focus: string;
  correction_history: string;
  implicit_interests: string;
  updated_at: number;
}

function safeParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

function fromRaw(r: RawProfile): CalibrationProfile {
  return {
    expertiseLevel: r.expertise_level as ExpertiseLevel,
    parameterPriorities: safeParse<string[]>(r.parameter_priorities, []),
    preferredChartTypes: safeParse<string[]>(r.preferred_chart_types, []),
    domainFocus: safeParse<string[]>(r.domain_focus, []),
    correctionHistory: safeParse(r.correction_history, []),
    implicitInterests: safeParse<Record<string, number>>(r.implicit_interests, {}),
    updatedAt: r.updated_at,
  };
}

export const UserCalibrationProfile = {
  async getProfile(): Promise<CalibrationProfile> {
    const raw = await invoke<RawProfile>("memory_get_calibration");
    return fromRaw(raw);
  },

  async updateExpertise(level: ExpertiseLevel): Promise<void> {
    await invoke("memory_update_calibration", { field: "expertise_level", value: level });
  },

  async recordColumnAccess(columnName: string): Promise<void> {
    const profile = await this.getProfile();
    const interests = { ...profile.implicitInterests };
    interests[columnName] = (interests[columnName] ?? 0) + 1;
    await invoke("memory_update_calibration", {
      field: "implicit_interests",
      value: JSON.stringify(interests),
    });
    // Promote columns with >= 10 accesses to parameterPriorities
    const priorities = Object.entries(interests)
      .filter(([, count]) => count >= 10)
      .sort((a, b) => b[1] - a[1])
      .map(([col]) => col);
    await invoke("memory_update_calibration", {
      field: "parameter_priorities",
      value: JSON.stringify(priorities),
    });
  },

  async addCorrection(original: string, corrected: string): Promise<void> {
    const profile = await this.getProfile();
    const history = [...profile.correctionHistory, { original, corrected, ts: Date.now() }];
    // Keep last 50 only
    const trimmed = history.slice(-50);
    await invoke("memory_update_calibration", {
      field: "correction_history",
      value: JSON.stringify(trimmed),
    });
  },

  async getPriorityParameters(): Promise<string[]> {
    const profile = await this.getProfile();
    return profile.parameterPriorities;
  },
};
