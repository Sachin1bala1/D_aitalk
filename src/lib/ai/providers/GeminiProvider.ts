import { GoogleGenAI } from "@google/genai";
import type { Content, Part, Schema, FunctionDeclaration } from "@google/genai";
import type { AIProvider, ConversationTurn, StreamResult, UnifiedTool } from "../types";

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly name = "Gemini";

  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async stream(params: {
    system: string;
    history: ConversationTurn[];
    model: string;
    tools: UnifiedTool[];
    onToken: (text: string) => void;
  }): Promise<StreamResult> {
    const { system, history, model, tools, onToken } = params;

    const contents = historyToGemini(history);
    const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: unifiedParamsToGemini(t.parameters),
    }));

    const geminiStream = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: system,
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
      },
    });

    let text = "";
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for await (const chunk of geminiStream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          onToken(part.text);
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini-${Date.now()}-${toolCalls.length}`,
            name: part.functionCall.name ?? "",
            input: (part.functionCall.args as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }
}

function historyToGemini(history: ConversationTurn[]): Content[] {
  const out: Content[] = [];

  for (const turn of history) {
    if (turn.role === "user") {
      const parts: Part[] = [];
      if (turn.text) parts.push({ text: turn.text });
      if (turn.toolResults) {
        for (const r of turn.toolResults) {
          parts.push({
            functionResponse: {
              name: r.name,
              response: r.isError ? { error: r.content } : { result: r.content },
            },
          });
        }
      }
      if (parts.length > 0) out.push({ role: "user", parts });
    } else {
      const parts: Part[] = [];
      if (turn.text) parts.push({ text: turn.text });
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.input } });
        }
      }
      if (parts.length > 0) out.push({ role: "model", parts });
    }
  }

  return out;
}

function unifiedParamsToGemini(params: UnifiedTool["parameters"]): Schema {
  return {
    type: "OBJECT" as any,
    properties: Object.fromEntries(
      Object.entries(params.properties).map(([key, val]) => [
        key,
        {
          type: val.type.toUpperCase() as any,
          description: val.description,
          enum: val.enum,
        } satisfies Schema,
      ])
    ),
    required: params.required ?? [],
  };
}
