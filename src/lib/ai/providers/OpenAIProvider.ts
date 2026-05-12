/**
 * OpenAIProvider — handles both OpenAI (GPT-4o etc.) and NVIDIA NIM.
 * NVIDIA NIM is fully OpenAI-API compatible; only the baseURL and model differ.
 */
import OpenAI from "openai";
import { invoke } from "@tauri-apps/api/core";
import type { AIProvider, ConversationTurn, StreamResult, UnifiedTool } from "../types";

export class OpenAIProvider implements AIProvider {
  readonly id;
  readonly name;

  private client: OpenAI;
  private apiKey: string;

  constructor(apiKey: string, providerId: "openai" | "nvidia", baseURL?: string) {
    this.id = providerId;
    this.name = providerId === "nvidia" ? "NVIDIA NIM" : "OpenAI";
    this.apiKey = apiKey;
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL ?? undefined,
      dangerouslyAllowBrowser: true,
    });
  }

  async stream(params: {
    system: string;
    history: ConversationTurn[];
    model: string;
    tools: UnifiedTool[];
    onToken: (text: string) => void;
  }): Promise<StreamResult> {
    const { system, history, model, tools, onToken } = params;

    const messages = historyToOpenAI(system, history);
    const openAITools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    if (this.id === "nvidia") {
      const response = await invoke<{
        text: string;
        tool_calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
        stop_reason: string;
      }>("nvidia_chat_completion", {
        request: {
          apiKey: this.apiKey,
          model,
          messages,
          tools: openAITools.length > 0 ? openAITools : null,
        },
      });

      if (response.text) {
        onToken(response.text);
      }

      return {
        text: response.text ?? "",
        toolCalls: response.tool_calls ?? [],
        stopReason: response.tool_calls?.length ? "tool_use" : "end_turn",
      };
    }

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      tools: openAITools.length > 0 ? openAITools : undefined,
      stream: true,
    });

    let text = "";
    // Accumulate fragmented tool call deltas
    const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        onToken(delta.content);
        text += delta.content;
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccum[idx]) {
            toolCallAccum[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" };
          }
          if (tc.id) toolCallAccum[idx].id = tc.id;
          if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallAccum[idx].args += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallAccum).map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.args);
      } catch {}
      return { id: tc.id || `call-${Date.now()}`, name: tc.name, input };
    });

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }
}

function historyToOpenAI(
  system: string,
  history: ConversationTurn[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const turn of history) {
    if (turn.role === "user") {
      if (turn.toolResults && turn.toolResults.length > 0) {
        // Each tool result is its own "tool" role message
        for (const r of turn.toolResults) {
          out.push({
            role: "tool",
            tool_call_id: r.toolCallId,
            content: r.content,
          });
        }
      } else if (turn.text) {
        out.push({ role: "user", content: turn.text });
      }
    } else {
      // assistant
      const msg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: turn.text ?? null,
      };
      if (turn.toolCalls && turn.toolCalls.length > 0) {
        msg.tool_calls = turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      out.push(msg);
    }
  }

  return out;
}
