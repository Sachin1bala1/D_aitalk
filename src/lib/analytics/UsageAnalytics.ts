export interface UsageAnalyticsEvent {
  event_type: string;
  feature: string;
  duration_ms?: number;
  success?: boolean;
  metadata?: string;
}

const events: UsageAnalyticsEvent[] = [];

export const UsageAnalytics = {
  track(event: UsageAnalyticsEvent): void {
    events.push(event);
  },

  list(): UsageAnalyticsEvent[] {
    return [...events];
  },

  clear(): void {
    events.length = 0;
  },
};
