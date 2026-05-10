import React, { useEffect, useState } from "react";
import { BarChart3, Briefcase, RefreshCw, Siren, Users } from "lucide-react";
import { BusinessClient, type CustomerRecord, type DailyBrief, type MonitoringRuleRecord, type MonitoringRunRecord, type OutcomeRecord, type UsageSummary } from "../../lib/business/BusinessClient";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";

function Section({ title, icon: Icon, children }: { title: string; icon: React.FC<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#1a1a1a] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-[#00d2ff]/80" />
        <p className="text-[10px] uppercase tracking-widest text-white/35 font-bold">{title}</p>
      </div>
      {children}
    </section>
  );
}

export function FounderDashboard() {
  const { connections, activeConnectionId } = useWorkspaceStore();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [rules, setRules] = useState<MonitoringRuleRecord[]>([]);
  const [runs, setRuns] = useState<MonitoringRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [interactionCustomerId, setInteractionCustomerId] = useState("");
  const [interactionSummary, setInteractionSummary] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleSql, setRuleSql] = useState("SELECT 1 WHERE 1 = 0;");

  const load = async () => {
    setLoading(true);
    try {
      const [usageSummary, dailyBrief, customerRows, outcomeRows, ruleRows, runRows] = await Promise.all([
        BusinessClient.getUsageSummary(),
        BusinessClient.generateDailyBrief(),
        BusinessClient.listCustomers(),
        BusinessClient.getPendingOutcomes(8),
        BusinessClient.listMonitoringRules(),
        BusinessClient.getRecentMonitoringRuns(8),
      ]);
      setUsage(usageSummary);
      setBrief(dailyBrief);
      setCustomers(customerRows);
      setOutcomes(outcomeRows);
      setRules(ruleRows);
      setRuns(runRows);
    } finally {
      setLoading(false);
    }
  };

  const addCustomer = async () => {
    if (!customerName.trim()) return;
    await BusinessClient.upsertCustomer({
      id: `cust-${Date.now()}`,
      name: customerName.trim(),
      company: customerCompany.trim() || null,
      email: null,
      stage: "discovery",
      status: "active",
      priority: "medium",
      notes: customerNotes.trim() || null,
      last_contact_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    setCustomerName("");
    setCustomerCompany("");
    setCustomerNotes("");
    await load();
  };

  const addInteraction = async () => {
    if (!interactionCustomerId || !interactionSummary.trim()) return;
    await BusinessClient.addCustomerInteraction({
      id: `interaction-${Date.now()}`,
      customer_id: interactionCustomerId,
      kind: "note",
      summary: interactionSummary.trim(),
      sentiment: null,
      action_items: null,
      created_at: Date.now(),
    });
    setInteractionSummary("");
    await load();
  };

  const addRule = async () => {
    if (!ruleName.trim() || !ruleSql.trim() || !activeConnectionId) return;
    await BusinessClient.upsertMonitoringRule({
      id: `rule-${Date.now()}`,
      name: ruleName.trim(),
      connection_id: activeConnectionId,
      sql: ruleSql,
      cadence_minutes: 60,
      notify_on_nonzero: true,
      is_active: true,
      last_run_at: null,
      last_status: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    setRuleName("");
    setRuleSql("SELECT 1 WHERE 1 = 0;");
    await load();
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a]">
        <div>
          <p className="text-[9px] uppercase tracking-widest text-white/25 font-bold">Founder Dashboard</p>
          <p className="text-xs text-[#00d2ff]/70 font-mono">Usage, customer, monitoring, and loop health</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="p-1.5 rounded text-white/25 hover:text-white/60 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Daily Brief" icon={Briefcase}>
          {brief ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Open Outcomes</p>
                  <p className="text-sm font-mono text-white/75">{brief.pending_outcomes}</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Alerts 24h</p>
                  <p className="text-sm font-mono text-amber-400/80">{brief.monitoring_alerts}</p>
                </div>
              </div>
              <div className="space-y-1">
                {brief.summary_lines.map((line) => (
                  <p key={line} className="text-xs text-white/60 leading-snug">{line}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/25">No brief yet.</p>
          )}
        </Section>

        <Section title="Usage Analytics" icon={BarChart3}>
          {usage ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Events</p>
                  <p className="text-sm font-mono text-white/75">{usage.total_events}</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-[9px] text-white/25 uppercase tracking-widest">Today</p>
                  <p className="text-sm font-mono text-[#00d2ff]/80">{usage.events_today}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-white/25 uppercase tracking-widest mb-1">Top Features</p>
                <div className="flex flex-wrap gap-1">
                  {usage.top_features.map((item) => (
                    <span key={item.key} className="rounded-full border border-[#262626] px-2 py-1 text-[10px] text-white/60 font-mono">
                      {item.key} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/25">No usage data captured yet.</p>
          )}
        </Section>

        <Section title="Customer Intelligence" icon={Users}>
          <div className="space-y-2 mb-3">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none"
            />
            <input
              value={customerCompany}
              onChange={(e) => setCustomerCompany(e.target.value)}
              placeholder="Company"
              className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none"
            />
            <textarea
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              placeholder="Pain points, requests, or context"
              className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none min-h-20"
            />
            <button onClick={() => void addCustomer()} className="rounded-lg bg-[#00d2ff] px-3 py-2 text-xs font-bold text-black">
              Add Customer
            </button>
            {customers.length > 0 && (
              <>
                <select
                  value={interactionCustomerId}
                  onChange={(e) => setInteractionCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none"
                >
                  <option value="">Select customer for interaction note</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
                <textarea
                  value={interactionSummary}
                  onChange={(e) => setInteractionSummary(e.target.value)}
                  placeholder="Latest call, pain point, request, or commitment"
                  className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none min-h-20"
                />
                <button onClick={() => void addInteraction()} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white/75">
                  Add Interaction
                </button>
              </>
            )}
          </div>
          {customers.length > 0 ? (
            <div className="space-y-2">
              {customers.slice(0, 6).map((customer) => (
                <div key={customer.id} className="rounded-lg border border-[#262626] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-white/75 truncate">{customer.name}{customer.company ? ` · ${customer.company}` : ""}</p>
                      <p className="text-[10px] text-white/30 font-mono">{customer.stage} · {customer.priority} · {customer.status}</p>
                    </div>
                  </div>
                  {customer.notes && (
                    <p className="text-[10px] text-white/45 mt-1 leading-snug">{customer.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/25">No customers tracked yet.</p>
          )}
        </Section>

        <Section title="Closed Loops" icon={Siren}>
          {outcomes.length > 0 ? (
            <div className="space-y-2">
              {outcomes.slice(0, 6).map((outcome) => (
                <div key={outcome.id} className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-xs text-white/70">{outcome.title}</p>
                  <p className="text-[10px] text-white/25 font-mono">{outcome.status}{outcome.due_at ? ` · due ${new Date(outcome.due_at).toLocaleDateString()}` : ""}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/25">No open outcomes.</p>
          )}
        </Section>

        <Section title="Scheduled Monitoring" icon={RefreshCw}>
          <div className="space-y-2">
            <div className="space-y-2 mb-3">
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Rule name"
                className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none"
              />
              <textarea
                value={ruleSql}
                onChange={(e) => setRuleSql(e.target.value)}
                placeholder="SQL that returns rows when attention is required"
                className="w-full rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-xs text-white/75 focus:outline-none min-h-24 font-mono"
              />
              <p className="text-[10px] text-white/25 font-mono">
                Connection: {connections.find((c) => c.id === activeConnectionId)?.display_name ?? "none"}
              </p>
              <button
                onClick={() => void addRule()}
                disabled={!activeConnectionId}
                className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white/70 disabled:opacity-40"
              >
                Add Monitoring Rule
              </button>
            </div>
            {rules.length === 0 ? (
              <p className="text-xs text-white/25">No monitoring rules configured.</p>
            ) : (
              rules.slice(0, 6).map((rule) => (
                <div key={rule.id} className="rounded-lg border border-[#262626] p-2">
                  <p className="text-xs text-white/75">{rule.name}</p>
                  <p className="text-[10px] text-white/25 font-mono">
                    every {rule.cadence_minutes}m · {rule.last_status ?? "never run"}
                  </p>
                </div>
              ))
            )}
            {runs.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] text-white/25 uppercase tracking-widest mb-1">Recent Runs</p>
                {runs.slice(0, 4).map((run) => (
                  <p key={run.id} className="text-[10px] text-white/45 font-mono">
                    {run.status} · {run.row_count} rows · {new Date(run.finished_at).toLocaleString()}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
