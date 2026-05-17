import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

export type WorkspaceRuleKind = "analysis" | "sql" | "safety" | "reporting";
export type WorkspaceRuleScope = "workspace" | "connection";
export type WorkspaceRuleStatus = "suggested" | "approved" | "rejected";
export type WorkspaceRuleSource = "user" | "agent" | "memory";

export interface WorkspaceRule {
  id: string;
  title: string;
  instruction: string;
  kind: WorkspaceRuleKind;
  scope: WorkspaceRuleScope;
  connectionId: string | null;
  status: WorkspaceRuleStatus;
  source: WorkspaceRuleSource;
  rationale?: string | null;
  evidence: string[];
  createdAt: number;
  updatedAt: number;
  approvedAt?: number | null;
}

interface WorkspaceRuleDocument {
  version: 1;
  rules: WorkspaceRule[];
}

interface CreateWorkspaceRuleInput {
  title: string;
  instruction: string;
  kind: WorkspaceRuleKind;
  scope: WorkspaceRuleScope;
  connectionId?: string | null;
  source: WorkspaceRuleSource;
  status?: WorkspaceRuleStatus;
  rationale?: string | null;
  evidence?: string[];
}

export interface WorkspaceRuleState {
  rules: WorkspaceRule[];
  hydrated: boolean;
  ensureLoaded: () => Promise<void>;
  createRule: (input: CreateWorkspaceRuleInput) => WorkspaceRule;
  updateRule: (id: string, updates: Partial<Omit<WorkspaceRule, "id" | "createdAt">>) => void;
  approveRule: (id: string) => void;
  rejectRule: (id: string) => void;
  deleteRule: (id: string) => void;
  getApprovedRules: (connectionId?: string | null) => WorkspaceRule[];
  getSuggestedRules: (connectionId?: string | null) => WorkspaceRule[];
}

const DOC_KEY = "workspace_rules";
const LEGACY_KEY = "daitalk_workspace_rules";
const DEFAULT_DOC: WorkspaceRuleDocument = { version: 1, rules: [] };

let loadPromise: Promise<void> | null = null;

function normalizeRule(raw: WorkspaceRule): WorkspaceRule {
  return {
    ...raw,
    connectionId: raw.scope === "connection" ? raw.connectionId ?? null : null,
    rationale: raw.rationale ?? null,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    approvedAt: raw.approvedAt ?? null,
  };
}

function loadLegacyRules(): WorkspaceRule[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkspaceRule[];
    return Array.isArray(parsed) ? parsed.map(normalizeRule) : [];
  } catch {
    return [];
  }
}

async function persistRules(rules: WorkspaceRule[]): Promise<void> {
  const payload: WorkspaceRuleDocument = { version: 1, rules };
  try {
    await saveJsonDocument(DOC_KEY, payload);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    notifyNativePersistenceFallback("Workspace rules");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(rules));
  }
}

function ruleAppliesToConnection(rule: WorkspaceRule, connectionId?: string | null) {
  if (rule.status !== "approved" && rule.status !== "suggested") return false;
  if (rule.scope === "workspace") return true;
  if (!connectionId) return false;
  return rule.connectionId === connectionId;
}

export const useWorkspaceRuleStore = create<WorkspaceRuleState>()(
  immer((set, get) => ({
    rules: [],
    hydrated: false,

    ensureLoaded: async () => {
      if (get().hydrated) return;
      if (loadPromise) return loadPromise;

      loadPromise = (async () => {
        const fallback: WorkspaceRuleDocument = {
          version: 1,
          rules: loadLegacyRules(),
        };
        const doc = await loadJsonDocument<WorkspaceRuleDocument>(DOC_KEY, fallback);
        const rules = Array.isArray(doc.rules) ? doc.rules.map(normalizeRule) : [];
        set((state) => {
          state.rules = rules;
          state.hydrated = true;
        });
        if (doc === fallback) {
          await persistRules(rules);
        }
      })().finally(() => {
        loadPromise = null;
      });

      return loadPromise;
    },

    createRule: (input) => {
      const now = Date.now();
      const rule: WorkspaceRule = {
        id: `rule-${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: input.title.trim(),
        instruction: input.instruction.trim(),
        kind: input.kind,
        scope: input.scope,
        connectionId: input.scope === "connection" ? input.connectionId ?? null : null,
        status: input.status ?? "suggested",
        source: input.source,
        rationale: input.rationale ?? null,
        evidence: input.evidence ?? [],
        createdAt: now,
        updatedAt: now,
        approvedAt: input.status === "approved" ? now : null,
      };
      const nextRules = [rule, ...get().rules];
      set((state) => {
        state.rules = nextRules;
      });
      void persistRules(nextRules);
      return rule;
    },

    updateRule: (id, updates) => {
      const nextRules = get().rules.map((rule) =>
        rule.id === id
          ? normalizeRule({
              ...rule,
              ...updates,
              updatedAt: Date.now(),
            })
          : rule,
      );
      set((state) => {
        state.rules = nextRules;
      });
      void persistRules(nextRules);
    },

    approveRule: (id) => {
      const nextRules = get().rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              status: "approved" as const,
              approvedAt: Date.now(),
              updatedAt: Date.now(),
            }
          : rule,
      );
      set((state) => {
        state.rules = nextRules;
      });
      void persistRules(nextRules);
    },

    rejectRule: (id) => {
      const nextRules = get().rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              status: "rejected" as const,
              updatedAt: Date.now(),
            }
          : rule,
      );
      set((state) => {
        state.rules = nextRules;
      });
      void persistRules(nextRules);
    },

    deleteRule: (id) => {
      const nextRules = get().rules.filter((rule) => rule.id !== id);
      set((state) => {
        state.rules = nextRules;
      });
      void persistRules(nextRules);
    },

    getApprovedRules: (connectionId) =>
      get().rules.filter((rule) => rule.status === "approved" && ruleAppliesToConnection(rule, connectionId)),

    getSuggestedRules: (connectionId) =>
      get().rules.filter((rule) => rule.status === "suggested" && ruleAppliesToConnection(rule, connectionId)),
  })),
);

void useWorkspaceRuleStore.getState().ensureLoaded();
