/**
 * WorkingMemory — Session-scoped in-memory context store
 * 
 * Tracks what has happened in the current agent session:
 * - What question are we working on?
 * - What tools have been called?
 * - What have we learned so far?
 */

export class WorkingMemory {
  private static activeQuestions = new Map<string, string>();
  private static toolsUsed = new Map<string, Set<string>>();
  private static learnings = new Map<string, string[]>();

  static async setActiveQuestion(sessionId: string, question: string): Promise<void> {
    this.activeQuestions.set(sessionId, question);
    if (!this.toolsUsed.has(sessionId)) {
      this.toolsUsed.set(sessionId, new Set());
    }
    if (!this.learnings.has(sessionId)) {
      this.learnings.set(sessionId, []);
    }
  }

  static recordToolUsed(sessionId: string, toolName: string): void {
    const tools = this.toolsUsed.get(sessionId) || new Set();
    tools.add(toolName);
    this.toolsUsed.set(sessionId, tools);
  }

  static recordLearning(sessionId: string, learning: string): void {
    const list = this.learnings.get(sessionId) || [];
    list.push(learning);
    this.learnings.set(sessionId, list);
  }

  static getActiveQuestion(sessionId: string): string | undefined {
    return this.activeQuestions.get(sessionId);
  }

  static getToolsUsed(sessionId: string): string[] {
    return Array.from(this.toolsUsed.get(sessionId) || []);
  }

  static getLearnings(sessionId: string): string[] {
    return this.learnings.get(sessionId) || [];
  }

  static clearSession(sessionId: string): void {
    this.activeQuestions.delete(sessionId);
    this.toolsUsed.delete(sessionId);
    this.learnings.delete(sessionId);
  }
}
