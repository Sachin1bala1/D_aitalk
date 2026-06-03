import React, { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, X, Search, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../../lib/stores/WorkspaceStore";
import type { PITag } from "../../lib/stores/WorkspaceStore";

interface Props {
  onConnected?: (tags: PITag[]) => void;
}

export function PIConnectionPanel({ onConnected }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verifySsl, setVerifySsl] = useState(true);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [connected, setConnected] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PITag[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPiTags = useWorkspaceStore((s) => s.setPiTags);

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const msg = await invoke<string>("pi_test_connection_direct", {
        baseUrl,
        username,
        password,
        verifySsl,
      });
      setTestStatus("ok");
      setTestMessage(msg);
      setConnected(true);
    } catch (e: unknown) {
      setTestStatus("error");
      setTestMessage(e instanceof Error ? e.message : String(e));
      setConnected(false);
    }
  };

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const results = await invoke<PITag[]>("pi_search_tags_direct", {
            baseUrl,
            username,
            password,
            query,
            maxCount: 50,
          });
          setSearchResults(results);
        } catch {
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }, 300);
    },
    [baseUrl, username, password],
  );

  const toggleTag = (tag: PITag) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag.web_id)) next.delete(tag.web_id);
      else next.add(tag.web_id);
      return next;
    });
  };

  const handleAddToWorkspace = () => {
    const tags = searchResults.filter((t) => selectedTags.has(t.web_id));
    setPiTags(tags);
    onConnected?.(tags);
  };

  const inputCls =
    "w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-[#00d2ff]/40 placeholder:text-white/20";
  const labelCls = "block text-[10px] text-white/40 uppercase tracking-wider mb-1";

  return (
    <div className="space-y-4">
      {/* Connection config */}
      <div className="space-y-3">
        <div>
          <label className={labelCls}>PI Web API URL</label>
          <input
            className={inputCls}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://pi-server.plant.com/piwebapi"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Username</label>
            <input
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="domain\\user"
            />
          </div>
          <div>
            <label className={labelCls}>Password</label>
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={verifySsl}
            onChange={(e) => setVerifySsl(e.target.checked)}
            className="w-3 h-3 accent-[#00d2ff]"
          />
          <span className="text-xs text-white/50">Verify SSL certificate</span>
        </label>
        <button
          onClick={handleTest}
          disabled={!baseUrl || testStatus === "testing"}
          className="px-4 py-1.5 text-xs rounded bg-[#00d2ff]/10 border border-[#00d2ff]/30 text-[#00d2ff] hover:bg-[#00d2ff]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {testStatus === "testing" && <Loader2 className="w-3 h-3 animate-spin" />}
          Test connection
        </button>
        {testMessage && (
          <div
            className={`flex items-center gap-2 text-xs ${testStatus === "ok" ? "text-emerald-400" : "text-red-400"}`}
          >
            {testStatus === "ok" ? (
              <Check className="w-3 h-3 shrink-0" />
            ) : (
              <X className="w-3 h-3 shrink-0" />
            )}
            {testMessage}
          </div>
        )}
      </div>

      {/* Tag browser — shown after successful connection */}
      {connected && (
        <div className="border-t border-[#2a2a2a] pt-4 space-y-3">
          <p className="text-[10px] text-white/40 uppercase tracking-wider">Browse Tags</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
            <input
              className={`${inputCls} pl-8`}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search tags…"
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-white/30" />
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-[#2a2a2a] rounded divide-y divide-[#1a1a1a]">
              {searchResults.map((tag) => (
                <label
                  key={tag.web_id}
                  className="flex items-start gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedTags.has(tag.web_id)}
                    onChange={() => toggleTag(tag)}
                    className="mt-0.5 w-3 h-3 accent-[#00d2ff] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-white/80 font-mono truncate">{tag.name}</p>
                    {tag.description && (
                      <p className="text-[10px] text-white/40 truncate">{tag.description}</p>
                    )}
                    <p className="text-[9px] text-white/25">
                      {tag.engineering_units} · {tag.point_type}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {selectedTags.size > 0 && (
            <button
              onClick={handleAddToWorkspace}
              className="w-full py-1.5 text-xs rounded bg-[#00d2ff]/10 border border-[#00d2ff]/30 text-[#00d2ff] hover:bg-[#00d2ff]/20 transition-colors"
            >
              Add {selectedTags.size} tag{selectedTags.size !== 1 ? "s" : ""} to workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
