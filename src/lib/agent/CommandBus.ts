/**
 * CommandBus — typed command dispatcher.
 *
 * Handlers are registered once at app startup (registerHandlers.ts).
 * The AI agent and UI both dispatch commands through this bus.
 *
 * Each command returns a CommandResult — the agent uses this to
 * feed tool_results back into the conversation.
 */
import type { AgentCommand, CommandType } from "./commands";

export interface CommandResult {
  success: boolean;
  result?: unknown;   // returned to the AI as tool_result content
  error?: string;     // returned to the AI as tool_result content on failure
}

type Handler = (cmd: AgentCommand) => Promise<CommandResult>;

class CommandBus {
  private handlers = new Map<CommandType, Handler>();

  register<T extends AgentCommand>(type: T["type"], handler: (cmd: T) => Promise<CommandResult>) {
    this.handlers.set(type, handler as Handler);
  }

  async dispatch(cmd: AgentCommand): Promise<CommandResult> {
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      return { success: false, error: `No handler registered for command: ${cmd.type}` };
    }
    try {
      return await handler(cmd);
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) };
    }
  }

  hasHandler(type: CommandType): boolean {
    return this.handlers.has(type);
  }
}

/** Singleton — shared across the app. */
export const commandBus = new CommandBus();
