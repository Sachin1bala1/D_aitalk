import { useState } from "react";
import { X, Plus, Pencil, Trash2, Wrench } from "lucide-react";
import { useUserToolStore } from "../../lib/stores/UserToolStore";
import { UserToolForm } from "./UserToolForm";
import type { UserTool } from "../../lib/tools/user.tools";

interface Props {
  onClose: () => void;
}

const BODY_TYPE_LABEL: Record<UserTool["body"]["type"], string> = {
  sql_template: "SQL Query",
  chart: "Chart",
  report: "Report",
  notify: "Notification",
};

const BODY_TYPE_COLOR: Record<UserTool["body"]["type"], string> = {
  sql_template: "#00d2ff",
  chart: "#FF6B35",
  report: "#7B61FF",
  notify: "#FFD700",
};

export function UserToolsPanel({ onClose }: Props) {
  const { tools, addTool, updateTool, deleteTool } = useUserToolStore();
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [editingTool, setEditingTool] = useState<UserTool | null>(null);

  const handleSave = (tool: UserTool) => {
    if (view === "create") {
      addTool(tool);
    } else if (view === "edit") {
      const { id, ...updates } = tool;
      updateTool(id, updates);
    }
    setView("list");
    setEditingTool(null);
  };

  const handleEdit = (tool: UserTool) => {
    setEditingTool(tool);
    setView("edit");
  };

  const handleDelete = (id: string) => {
    if (window.confirm("Delete this tool? APEX will no longer be able to call it.")) {
      deleteTool(id);
    }
  };

  const handleCancel = () => {
    setView("list");
    setEditingTool(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#111] border border-[#262626] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626] shrink-0">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#00d2ff]" />
            <span className="text-sm font-semibold text-white/80">
              {view === "list" ? "My Tools" : view === "create" ? "New Tool" : `Edit: ${editingTool?.displayName}`}
            </span>
            {view === "list" && tools.length > 0 && (
              <span className="text-[10px] text-white/30 ml-1">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view === "list" && (
              <button
                onClick={() => setView("create")}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00d2ff]/10 border border-[#00d2ff]/30 text-[#00d2ff] text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-[#00d2ff]/20 transition-colors"
              >
                <Plus className="w-3 h-3" /> New Tool
              </button>
            )}
            <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* List view */}
          {view === "list" && (
            <>
              {tools.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                  <Wrench className="w-8 h-8 text-white/10" />
                  <p className="text-sm text-white/40">No custom tools yet.</p>
                  <p className="text-xs text-white/20 max-w-xs">
                    Create tools for your standard reports, charts, or alerts — APEX will call them automatically when relevant.
                  </p>
                  <button
                    onClick={() => setView("create")}
                    className="mt-2 px-4 py-2 bg-[#00d2ff] text-black text-xs font-bold rounded-lg hover:opacity-90"
                  >
                    Create Your First Tool
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-white/3 border border-[#262626] hover:border-white/10 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-white/80">{tool.displayName}</span>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              color: BODY_TYPE_COLOR[tool.body.type],
                              background: `${BODY_TYPE_COLOR[tool.body.type]}18`,
                            }}
                          >
                            {BODY_TYPE_LABEL[tool.body.type]}
                          </span>
                          <span className="text-[9px] text-white/20 uppercase tracking-widest">{tool.category}</span>
                        </div>
                        <p className="text-xs text-white/40 truncate">{tool.description}</p>
                        <p className="text-[9px] text-white/20 font-mono mt-0.5">user__{tool.id}</p>
                        {tool.parameters.length > 0 && (
                          <p className="text-[9px] text-white/25 mt-0.5">
                            Params: {tool.parameters.map((p) => p.name).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEdit(tool)}
                          className="p-1.5 text-white/30 hover:text-[#00d2ff] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(tool.id)}
                          className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Create / Edit view */}
          {(view === "create" || view === "edit") && (
            <UserToolForm initial={editingTool} onSave={handleSave} onCancel={handleCancel} />
          )}
        </div>
      </div>
    </div>
  );
}
