import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJsonObject, safeGenerateJSON, SafeJsonError } from "@/lib/models/safe-json";

describe("extractJsonObject", () => {
  it("returns clean JSON when input is already JSON", () => {
    expect(extractJsonObject(`{"a":1}`)).toBe(`{"a":1}`);
  });
  it("strips ```json fences", () => {
    expect(extractJsonObject("```json\n{\n  \"a\": 1\n}\n```")).toContain('"a"');
  });
  it("finds embedded JSON object inside prose", () => {
    const out = extractJsonObject("Here you go:\n{\"a\":1,\"b\":[2,3]}\nthanks");
    expect(out).toBe('{"a":1,"b":[2,3]}');
  });
  it("returns null on no JSON", () => {
    expect(extractJsonObject("no json here")).toBe(null);
  });
});

describe("safeGenerateJSON repair flow", () => {
  it("validates good output without retry", async () => {
    const provider = {
      name: "fake",
      model: "fake-1",
      generateJSON: async () => ({ text: '{"x": "ok"}', latencyMs: 1, model: "fake-1", provider: "fake" }),
      generateText: async () => ({ text: "", latencyMs: 1, model: "fake-1", provider: "fake" }),
      healthCheck: async () => ({ ok: true, message: "ok" }),
    } as any;
    const result = await safeGenerateJSON({
      provider,
      schema: z.object({ x: z.string() }),
      userPrompt: "give me JSON",
    });
    expect(result.data.x).toBe("ok");
    expect(result.attempts).toBe(1);
  });

  it("repairs once when first reply is invalid JSON", async () => {
    let call = 0;
    const provider = {
      name: "fake",
      model: "fake-1",
      generateJSON: async () => {
        call++;
        return {
          text: call === 1 ? "not json" : '{"x":"ok"}',
          latencyMs: 1,
          model: "fake-1",
          provider: "fake",
        };
      },
      generateText: async () => ({ text: "", latencyMs: 1, model: "fake-1", provider: "fake" }),
      healthCheck: async () => ({ ok: true, message: "ok" }),
    } as any;
    const r = await safeGenerateJSON({
      provider,
      schema: z.object({ x: z.string() }),
      userPrompt: "give me JSON",
    });
    expect(r.data.x).toBe("ok");
    expect(r.attempts).toBe(2);
  });

  it("throws SafeJsonError after exhausting retries", async () => {
    const provider = {
      name: "fake",
      model: "fake-1",
      generateJSON: async () => ({ text: "still bad", latencyMs: 1, model: "fake-1", provider: "fake" }),
      generateText: async () => ({ text: "", latencyMs: 1, model: "fake-1", provider: "fake" }),
      healthCheck: async () => ({ ok: true, message: "ok" }),
    } as any;
    await expect(
      safeGenerateJSON({
        provider,
        schema: z.object({ x: z.string() }),
        userPrompt: "give me JSON",
        maxRetries: 1,
      }),
    ).rejects.toBeInstanceOf(SafeJsonError);
  });
});
