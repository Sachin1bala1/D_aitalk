import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { UserTool, UserToolBody, UserToolParameter } from "../../lib/tools/user.tools";

interface Props {
  initial: UserTool | null;
  onSave: (tool: UserTool) => void;
  onCancel: () => void;
}

const BODY_TYPES = [
  { value: "sql_template", label: "SQL Query" },
  { value: "chart", label: "Chart" },
  { value: "report", label: "Multi-step Report" },
  { value: "notify", label: "Notification" },
] as const;

const CHART_TYPES = ["bar", "line", "scatter", "pie", "area"] as const;
const NOTIFY_LEVELS = ["info", "success", "warning", "error"] as const;

function blankTool(): UserTool {
  return {
    id: "",
    displayName: "",
    description: "",
    category: "analysis",
    parameters: [],
    body: { type: "sql_template", sql: "" },
  };
}

export function UserToolForm({ initial, onSave, onCancel }: Props) {
  const [tool, setTool] = useState<UserTool>(initial ?? blankTool());
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof UserTool>(key: K, value: UserTool[K]) =>
    setTool((prev) => ({ ...prev, [key]: value }));

  const setBodyField = (updates: Partial<UserToolBody>) =>
    setTool((prev) => ({ ...prev, body: { ...prev.body, ...updates } as UserToolBody }));

  const addParam = () =>
    set("parameters", [
      ...tool.parameters,
      { name: "", description: "", type: "string", required: false },
    ]);

  const updateParam = (idx: number, patch: Partial<UserToolParameter>) =>
    set(
      "parameters",
      tool.parameters.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );

  const removeParam = (idx: number) =>
    set("parameters", tool.parameters.filter((_, i) => i !== idx));

  const handleBodyTypeChange = (type: UserToolBody["type"]) => {
    if (type === "sql_template") set("body", { type: "sql_template", sql: "" });
    else if (type === "chart") set("body", { type: "chart", sql: "", chartType: "bar", xColumn: "", yColumn: "" });
    else if (type === "report") set("body", { type: "report", steps: [{ label: "", sql: "" }] });
    else if (type === "notify") set("body", { type: "notify", message: "", level: "info" });
  };

  const addReportStep = () => {
    if (tool.body.type !== "report") return;
    setBodyField({ steps: [...tool.body.steps, { label: "", sql: "" }] });
  };

  const updateReportStep = (idx: number, patch: { label?: string; sql?: string }) => {
    if (tool.body.type !== "report") return;
    setBodyField({
      steps: tool.body.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };

  const removeReportStep = (idx: number) => {
    if (tool.body.type !== "report") return;
    if (tool.body.steps.length <= 1) return;
    setBodyField({ steps: tool.body.steps.filter((_, i) => i !== idx) });
  };

  const handleSave = () => {
    if (!tool.id.trim()) return setError("ID is required.");
    if (!/^[a-z0-9_]+$/.test(tool.id)) return setError("ID must be lowercase letters, digits, and underscores only.");
    if (!tool.displayName.trim()) return setError("Display name is required.");
    if (!tool.description.trim()) return setError("Description is required.");
    if (tool.body.type === "sql_template" && !tool.body.sql.trim()) return setError("SQL is required.");
    if (tool.body.type === "chart" && (!tool.body.sql.trim() || !tool.body.xColumn.trim() || !tool.body.yColumn.trim()))
      return setError("SQL, X column, and Y column are required for chart tools.");
    if (tool.body.type === "report" && tool.body.steps.some((s) => !s.sql.trim()))
      return setError("All report steps must have SQL.");
    if (tool.body.type === "notify" && !tool.body.message.trim())
      return setError("Message is required for notification tools.");
    setError(null);
    onSave(tool);
  };

  const inputCls =
    "w-full bg-[#1a1a1a] border border-[#262626] rounded px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-[#00d2ff]";
  const labelCls = "block text-[10px] uppercase tracking-widest text-white/30 mb-1";

  return (
    <div className="space-y-4 text-sm">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Tool ID *</label>
          <input
            className={inputCls}
            placeholder="weekly_oee_report"
            value={tool.id}
            onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            disabled={!!initial}
          />
          <p className="text-[9px] text-white/20 mt-0.5">Lowercase, underscores only. Cannot change after save.</p>
        </div>
        <div>
          <label className={labelCls}>Display Name *</label>
          <input className={inputCls} placeholder="Weekly OEE Report" value={tool.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Description * (what APEX sees)</label>
          <input className={inputCls} placeholder="Returns OEE metrics for a machine over 7 days." value={tool.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <input className={inputCls} placeholder="reports / analysis / alerts" value={tool.category} onChange={(e) => set("category", e.target.value)} />
        </div>
      </div>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={labelCls}>Parameters</label>
          <button onClick={addParam} className="flex items-center gap-1 text-[9px] text-[#00d2ff] hover:text-white uppercase tracking-widest">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {tool.parameters.length === 0 && (
          <p className="text-[10px] text-white/20 italic">No parameters — tool takes no inputs from APEX.</p>
        )}
        {tool.parameters.map((p, i) => (
          <div key={i} className="flex gap-2 mb-1.5 items-start">
            <input className={`${inputCls} w-24 flex-shrink-0`} placeholder="name" value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} />
            <input className={`${inputCls} flex-1`} placeholder="description" value={p.description} onChange={(e) => updateParam(i, { description: e.target.value })} />
            <select className={`${inputCls} w-24 flex-shrink-0`} value={p.type} onChange={(e) => updateParam(i, { type: e.target.value as UserToolParameter["type"] })}>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <label className="flex items-center gap-1 text-[10px] text-white/40 flex-shrink-0 mt-2">
              <input type="checkbox" checked={p.required} onChange={(e) => updateParam(i, { required: e.target.checked })} />
              req
            </label>
            <button onClick={() => removeParam(i)} className="text-red-400/50 hover:text-red-400 mt-2">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <p className="text-[9px] text-white/20 mt-0.5">Use &#123;&#123;param_name&#125;&#125; in SQL/message to substitute values.</p>
      </div>

      {/* Body type selector */}
      <div>
        <label className={labelCls}>Tool Type *</label>
        <div className="flex gap-1.5">
          {BODY_TYPES.map((bt) => (
            <button
              key={bt.value}
              onClick={() => handleBodyTypeChange(bt.value)}
              className={`px-3 py-1.5 rounded text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                tool.body.type === bt.value
                  ? "bg-[#00d2ff]/20 border-[#00d2ff] text-[#00d2ff]"
                  : "bg-transparent border-[#262626] text-white/30 hover:border-white/30"
              }`}
            >
              {bt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body config — SQL Template */}
      {tool.body.type === "sql_template" && (
        <div>
          <label className={labelCls}>SQL *</label>
          <textarea
            className={`${inputCls} font-mono min-h-[100px] resize-y`}
            placeholder={"SELECT * FROM oee\nWHERE machine_id = '{{machine_id}}'\nORDER BY ts DESC\nLIMIT 100"}
            value={tool.body.sql}
            onChange={(e) => setBodyField({ sql: e.target.value })}
          />
        </div>
      )}

      {/* Body config — Chart */}
      {tool.body.type === "chart" && (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>SQL * (must return at least xColumn and yColumn)</label>
            <textarea
              className={`${inputCls} font-mono min-h-[80px] resize-y`}
              placeholder={"SELECT shift, avg(oee) as avg_oee\nFROM oee_daily\nGROUP BY shift"}
              value={tool.body.sql}
              onChange={(e) => setBodyField({ sql: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Chart Type</label>
              <select className={inputCls} value={tool.body.chartType} onChange={(e) => setBodyField({ chartType: e.target.value as typeof tool.body.chartType })}>
                {CHART_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>X Column *</label>
              <input className={inputCls} placeholder="shift" value={tool.body.xColumn} onChange={(e) => setBodyField({ xColumn: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Y Column *</label>
              <input className={inputCls} placeholder="avg_oee" value={tool.body.yColumn} onChange={(e) => setBodyField({ yColumn: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Chart Title (optional)</label>
            <input className={inputCls} placeholder="OEE by Shift" value={tool.body.title ?? ""} onChange={(e) => setBodyField({ title: e.target.value || undefined })} />
          </div>
        </div>
      )}

      {/* Body config — Report (multi-step) */}
      {tool.body.type === "report" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Report Steps *</label>
            <button onClick={addReportStep} className="flex items-center gap-1 text-[9px] text-[#00d2ff] hover:text-white uppercase tracking-widest">
              <Plus className="w-3 h-3" /> Add Step
            </button>
          </div>
          {tool.body.steps.map((s, i) => (
            <div key={i} className="border border-[#262626] rounded p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input className={`${inputCls} flex-1`} placeholder={`Step ${i + 1} label (e.g. "Availability")`} value={s.label} onChange={(e) => updateReportStep(i, { label: e.target.value })} />
                {tool.body.type === "report" && tool.body.steps.length > 1 && (
                  <button onClick={() => removeReportStep(i)} className="text-red-400/50 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <textarea
                className={`${inputCls} font-mono min-h-[60px] resize-y`}
                placeholder="SELECT avg(availability) FROM oee WHERE ..."
                value={s.sql}
                onChange={(e) => updateReportStep(i, { sql: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {/* Body config — Notify */}
      {tool.body.type === "notify" && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Message * (&#123;&#123;params&#125;&#125; supported)</label>
            <textarea
              className={`${inputCls} min-h-[60px] resize-y`}
              placeholder="Machine {{machine_id}} has exceeded downtime threshold."
              value={tool.body.message}
              onChange={(e) => setBodyField({ message: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Level</label>
            <select className={inputCls} value={tool.body.level} onChange={(e) => setBodyField({ level: e.target.value as typeof tool.body.level })}>
              {NOTIFY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Error + actions */}
      {error && <p className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} className="px-4 py-2 bg-[#00d2ff] text-black text-xs font-bold rounded-lg hover:opacity-90">
          {initial ? "Save Changes" : "Create Tool"}
        </button>
      </div>
    </div>
  );
}
