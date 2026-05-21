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

export interface CommandExecutionMeta {
  commandType: CommandType;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface CommandResult {
  success: boolean;
  result?: unknown;   // returned to the AI as tool_result content
  error?: string;     // returned to the AI as tool_result content on failure
  execution?: CommandExecutionMeta;
}

type Handler = (cmd: AgentCommand) => Promise<CommandResult>;

class CommandBus {
  private handlers = new Map<CommandType, Handler>();

  register<T extends AgentCommand>(type: T["type"], handler: (cmd: T) => Promise<CommandResult>) {
    this.handlers.set(type, handler as Handler);
  }

  async dispatch(cmd: AgentCommand): Promise<CommandResult> {
    const startedAt = Date.now();
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      const finishedAt = Date.now();
      return {
        success: false,
        error: `No handler registered for command: ${cmd.type}`,
        execution: {
          commandType: cmd.type,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        },
      };
    }
    try {
      const result = await handler(cmd);
      const finishedAt = Date.now();
      return {
        ...result,
        execution: result.execution ?? {
          commandType: cmd.type,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        },
      };
    } catch (e: any) {
      const finishedAt = Date.now();
      return {
        success: false,
        error: e?.message ?? String(e),
        execution: {
          commandType: cmd.type,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        },
      };
    }
  }

  hasHandler(type: CommandType): boolean {
    return this.handlers.has(type);
  }
}

/** Singleton — shared across the app. */
export const commandBus = new CommandBus();
