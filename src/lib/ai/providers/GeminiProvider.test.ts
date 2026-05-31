import { describe, expect, it } from "vitest";
import { unifiedParamsToGemini, GeminiProvider } from "./GeminiProvider";
import type { UnifiedTool } from "../types";

describe("GeminiProvider schema normalization", () => {
  it("handles loose tool parameters without explicit types", () => {
    const params: UnifiedTool["parameters"] = {
      type: "object",
      properties: {
        pkValue: { description: "Primary key value" } as any,
        newValue: { description: "Replacement value" } as any,
        values: {
          type: "object",
          description: "Key-value pairs",
          properties: {
            nested: { description: "Nested value" } as any,
          },
        } as any,
        columns: {
          type: "array",
          items: { type: "string" } as any,
        } as any,
      },
      required: ["pkValue", "newValue"],
    };

    const schema = unifiedParamsToGemini(params);
    expect(schema.type).toBe("OBJECT");
    expect(schema.required).toEqual(["pkValue", "newValue"]);
    expect(schema.properties?.pkValue?.type).toBe("STRING");
    expect(schema.properties?.newValue?.type).toBe("STRING");
    expect(schema.properties?.values?.type).toBe("OBJECT");
    expect(schema.properties?.values?.properties?.nested?.type).toBe("STRING");
    expect(schema.properties?.columns?.type).toBe("ARRAY");
    expect(schema.properties?.columns?.items?.type).toBe("STRING");
  });
});

import { vi } from "vitest";

vi.mock("@google/genai", () => {
  class MockGoogleGenAI {
    constructor(config: unknown) {
      // Store config for verification in tests if needed
    }
    models = {
      generateContentStream: vi.fn(),
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

describe("GeminiProvider constructor", () => {
  it("accepts apiKey string (legacy)", () => {
    const provider = new GeminiProvider("AIzaSytest");
    expect(provider.id).toBe("gemini");
    expect(provider.name).toBe("Gemini");
  });

  it("accepts { apiKey } object", () => {
    const provider = new GeminiProvider({ apiKey: "AIzaSytest2" });
    expect(provider.id).toBe("gemini");
    expect(provider.name).toBe("Gemini");
  });

  it("accepts { accessToken } object", () => {
    const provider = new GeminiProvider({ accessToken: "ya29.test" });
    expect(provider.id).toBe("gemini");
    expect(provider.name).toBe("Gemini");
  });
});
