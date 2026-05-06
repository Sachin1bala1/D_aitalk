/**
 * EpisodicMemory — Long-term storage of past analysis sessions
 * 
 * Stores completed episodes for learning and pattern recognition
 */

export interface Episode {
  sessionId: string;
  connectionId: string;
  problem: string;
  toolsUsed: string[];
  findings: Record<string, any>;
  createdAt?: number;
}

export class EpisodicMemory {
  private static episodes: Episode[] = [];

  static async store(episode: Episode): Promise<void> {
    this.episodes.push({
      ...episode,
      createdAt: Date.now(),
    });
    // In production, persist to database
  }

  static async query(filter: Partial<Episode>): Promise<Episode[]> {
    return this.episodes.filter(ep => {
      if (filter.problem && !ep.problem.includes(filter.problem)) return false;
      if (filter.connectionId && ep.connectionId !== filter.connectionId) return false;
      return true;
    });
  }

  static async getRecent(limit: number = 20): Promise<Episode[]> {
    return [...this.episodes].reverse().slice(0, limit);
  }

  static async clear(): Promise<void> {
    this.episodes = [];
  }
}
