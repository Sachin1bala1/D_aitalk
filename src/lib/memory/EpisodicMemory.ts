// src/lib/memory/EpisodicMemory.ts
import { invoke } from "@tauri-apps/api/core";
import { embed, cosineSimilarity } from "./MemoryStore";

export interface Episode {
  id: string;
  sessionId: string;
  connectionId?: string;
  problem: string;
  toolsUsed: string[];    // will be JSON.stringify'd for Rust
  findings: Record<string, unknown>;  // will be JSON.stringify'd
  outcome?: string;
  embedding?: number[];   // computed here, not sent from caller
  createdAt: number;      // unix timestamp ms
}

// Shape Rust sends back (snake_case JSON fields)
interface RawEpisode {
  id: string;
  session_id: string;
  connection_id: string | null;
  problem: string;
  tools_used: string;    // JSON array string
  findings: string;      // JSON object string
  outcome: string | null;
  embedding: string;     // JSON float[] string
  created_at: number;
}

function safeParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

function fromRaw(r: RawEpisode): Episode {
  return {
    id: r.id,
    sessionId: r.session_id,
    connectionId: r.connection_id ?? undefined,
    problem: r.problem,
    toolsUsed: safeParse<string[]>(r.tools_used, []),
    findings: safeParse<Record<string, unknown>>(r.findings, {}),
    outcome: r.outcome ?? undefined,
    embedding: safeParse<number[]>(r.embedding, []),
    createdAt: r.created_at,
  };
}

export const EpisodicMemory = {
  async store(ep: Omit<Episode, "id" | "embedding" | "createdAt">): Promise<void> {
    const vec = embed(ep.problem);
    const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await invoke("memory_insert_episode", {
      episode: {
        id,
        session_id: ep.sessionId,
        connection_id: ep.connectionId ?? null,
        problem: ep.problem,
        tools_used: JSON.stringify(ep.toolsUsed),
        findings: JSON.stringify(ep.findings),
        outcome: ep.outcome ?? null,
        embedding: JSON.stringify(vec),
        created_at: Date.now(),
      },
    });
  },

  async search(query: string, limit = 5, connectionId?: string): Promise<Episode[]> {
    const qvec = embed(query);
    const raw = await invoke<RawEpisode[]>("memory_get_episodes", {
      limit: 200,
      connection_id: connectionId ?? null,
    });
    const episodes = raw.map(fromRaw);
    // Score by cosine similarity
    const scored = episodes.map((ep) => ({
      ep,
      score: ep.embedding ? cosineSimilarity(qvec, ep.embedding) : 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.ep);
  },

  async getRecent(limit = 10): Promise<Episode[]> {
    const raw = await invoke<RawEpisode[]>("memory_get_episodes", {
      limit,
      connection_id: null,
    });
    return raw.map(fromRaw);
  },
};
