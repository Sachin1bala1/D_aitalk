import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ConversationTurn, StreamResult, UnifiedTool } from "../types";

export class ClaudeProvider implements AIProvider {
  readonly id = "claude" as const;
  readonly name = "Claude";

  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 300_000 });
  }

  async stream(params: {
    system: string;
    history: ConversationTurn[];
    model: string;
    tools: UnifiedTool[];
    onToken: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<StreamResult> {
    const { system, history, model, tools, onToken, signal } = params;

    const messages = historyToAnthropic(history);
    const claudeTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    const stream = this.client.messages.stream({
      model,
      max_tokens: 4096,
      system,
      messages,
      tools: claudeTools,
    }, { signal });

    let text = "";
    for await (const event of await stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onToken(event.delta.text);
        text += event.delta.text;
      }
    }

    const response = await (await stream).finalMessage();
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
    };
  }
}

function historyToAnthropic(history: ConversationTurn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const turn of history) {
    if (turn.role === "user") {
      if (turn.toolResults && turn.toolResults.length > 0) {
        // Tool results go as a user message with tool_result blocks
        out.push({
          role: "user",
          content: turn.toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.toolCallId,
            is_error: r.isError,
            content: r.content,
          })),
        });
      } else if (turn.text) {
        out.push({ role: "user", content: turn.text });
      }
    } else {
      // assistant
      const content: Anthropic.ContentBlock[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        }
      }
      if (content.length > 0) out.push({ role: "assistant", content });
    }
  }

  return out;
}
