import { invoke } from "@tauri-apps/api/core";

export interface OutcomeRecord {
  id: string;
  episode_id: string;
  session_id: string;
  title: string;
  status: "pending" | "in_progress" | "blocked" | "resolved";
  notes?: string | null;
  owner?: string | null;
  due_at?: number | null;
  resolved_at?: number | null;
  confidence_delta?: number | null;
  created_at: number;
  updated_at: number;
}

export interface UsageEventInput {
  event_type: string;
  feature: string;
  connection_id?: string | null;
  driver?: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: number;
}

export interface CountBucket {
  key: string;
  count: number;
}

export interface UsageSummary {
  total_events: number;
  events_today: number;
  top_features: CountBucket[];
  top_event_types: CountBucket[];
  top_drivers: CountBucket[];
  recent_errors: string[];
}

export interface CustomerRecord {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  stage: string;
  status: string;
  priority: string;
  notes?: string | null;
  last_contact_at?: number | null;
  created_at: number;
  updated_at: number;
}

export interface CustomerInteractionRecord {
  id: string;
  customer_id: string;
  kind: string;
  summary: string;
  sentiment?: string | null;
  action_items?: string | null;
  created_at: number;
}

export interface PipelineSummary {
  total_customers: number;
  high_priority_count: number;
  by_stage: CountBucket[];
  recent_interactions: CustomerInteractionRecord[];
}

export interface MonitoringRuleRecord {
  id: string;
  name: string;
  connection_id: string;
  sql: string;
  cadence_minutes: number;
  notify_on_nonzero: boolean;
  is_active: boolean;
  last_run_at?: number | null;
  last_status?: string | null;
  created_at: number;
  updated_at: number;
}

export interface MonitoringRunRecord {
  id: string;
  rule_id: string;
  connection_id: string;
  status: string;
  row_count: number;
  message?: string | null;
  started_at: number;
  finished_at: number;
}

export interface DailyBrief {
  generated_at: number;
  pending_outcomes: number;
  overdue_outcomes: number;
  active_customers: number;
  monitoring_alerts: number;
  top_features: CountBucket[];
  summary_lines: string[];
}

export interface ProactiveSuggestion {
  id: string;
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
  source: string;
}

export interface CustomerBriefRecord {
  id: string;
  name: string;
  company?: string | null;
  stage: string;
  priority: string;
  notes?: string | null;
}

export const BusinessClient = {
  initMemoryDb(): Promise<void> {
    return invoke("init_memory_db");
  },

  trackUsageEvent(event: UsageEventInput): Promise<void> {
    return invoke("memory_track_usage_event", { event });
  },

  getUsageSummary(): Promise<UsageSummary> {
    return invoke("memory_get_usage_summary");
  },

  getPendingOutcomes(limit = 50): Promise<OutcomeRecord[]> {
    return invoke("memory_get_pending_outcomes", { limit });
  },

  upsertOutcome(outcome: OutcomeRecord): Promise<void> {
    return invoke("memory_upsert_outcome", { outcome });
  },

  listCustomers(): Promise<CustomerRecord[]> {
    return invoke("memory_list_customers");
  },

  upsertCustomer(customer: CustomerRecord): Promise<void> {
    return invoke("memory_upsert_customer", { customer });
  },

  addCustomerInteraction(interaction: CustomerInteractionRecord): Promise<void> {
    return invoke("memory_add_customer_interaction", { interaction });
  },

  getCustomerInteractions(customerId: string): Promise<CustomerInteractionRecord[]> {
    return invoke("memory_get_customer_interactions", { customerId });
  },

  getCustomerPipelineSummary(): Promise<PipelineSummary> {
    return invoke("memory_get_customer_pipeline_summary");
  },

  listMonitoringRules(): Promise<MonitoringRuleRecord[]> {
    return invoke("memory_list_monitoring_rules");
  },

  upsertMonitoringRule(rule: MonitoringRuleRecord): Promise<void> {
    return invoke("memory_upsert_monitoring_rule", { rule });
  },

  recordMonitoringRun(run: MonitoringRunRecord): Promise<void> {
    return invoke("memory_record_monitoring_run", { run });
  },

  getRecentMonitoringRuns(limit = 20): Promise<MonitoringRunRecord[]> {
    return invoke("memory_get_recent_monitoring_runs", { limit });
  },

  generateDailyBrief(): Promise<DailyBrief> {
    return invoke("memory_generate_daily_brief");
  },

  getProactiveSuggestions(connectionId: string | null, sql: string): Promise<ProactiveSuggestion[]> {
    return invoke("memory_get_proactive_suggestions", {
      connectionId,
      sql,
    });
  },

  getCustomerBrief(): Promise<CustomerBriefRecord[]> {
    return invoke("memory_get_customer_brief");
  },
};
