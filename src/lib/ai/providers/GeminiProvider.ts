import { GoogleGenAI } from "@google/genai";
import type { Content, Part, Schema, FunctionDeclaration } from "@google/genai";
import type { AIProvider, ConversationTurn, StreamResult, ToolParameter, UnifiedTool } from "../types";

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly name = "Gemini";

  private client: GoogleGenAI;

  constructor(apiKey: string) {
    // Use v1 (stable) — Gemini 2.5 models are not available on v1beta
    this.client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1" } });
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
    try {
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
          abortSignal: signal,
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
    } catch (error) {
      throw normalizeGeminiError(error, model);
    }
  }
}

function normalizeGeminiError(error: unknown, model: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("quota exceeded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("free_tier") ||
    lower.includes("billing")
  ) {
    return new Error(
      `Gemini quota exceeded for model ${model}. This key currently has no usable quota for that model or billing is not enabled. Add billing, switch to a model/project with quota, or use another provider.`,
    );
  }

  if (lower.includes("api key")) {
    return new Error("Gemini rejected the API key. Check that the key is valid and enabled for the Gemini API.");
  }

  return error instanceof Error ? error : new Error(raw);
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

export function normalizeGeminiSchema(param: ToolParameter): Schema {
  const normalizedType = (param.type ?? "string").toUpperCase();
  const schema: Schema = {
    type: normalizedType as any,
  };

  if (param.description) schema.description = param.description;
  if (param.enum) schema.enum = param.enum;

  if (normalizedType === "OBJECT") {
    const nestedProperties = param.properties ?? {};
    schema.properties = Object.fromEntries(
      Object.entries(nestedProperties).map(([key, value]) => [key, normalizeGeminiSchema(value)]),
    );
    if (param.required?.length) schema.required = param.required;
  }

  if (normalizedType === "ARRAY") {
    const arrayParam = param as ToolParameter & { items?: ToolParameter };
    schema.items = normalizeGeminiSchema(arrayParam.items ?? { type: "string" });
  }

  return schema;
}

export function unifiedParamsToGemini(params: UnifiedTool["parameters"]): Schema {
  return {
    type: "OBJECT" as any,
    properties: Object.fromEntries(
      Object.entries(params.properties).map(([key, val]) => [key, normalizeGeminiSchema(val)]),
    ),
    required: params.required ?? [],
  };
}
