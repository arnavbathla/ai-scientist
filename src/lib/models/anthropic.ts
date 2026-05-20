import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import type {
  GenerateJSONOptions,
  GenerateTextOptions,
  GenerateTextResult,
  HealthCheckResult,
  ModelCallContext,
  ModelProvider,
} from "./provider";

/**
 * Real Anthropic provider.
 *
 * Wraps the official SDK, logs every call to ModelCall, and exposes a JSON-mode
 * helper that asks Claude to return a single JSON object (we extract it
 * defensively in safeGenerateJSON).
 *
 * Default model comes from ANTHROPIC_MODEL env (spec: claude-sonnet-4-5).
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(model?: string) {
    const e = env();
    if (!e.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    this.client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });
    this.model = model ?? e.ANTHROPIC_MODEL;
  }

  async generateText(
    opts: GenerateTextOptions,
    ctx?: ModelCallContext,
  ): Promise<GenerateTextResult> {
    return this.invoke(opts, ctx);
  }

  async generateJSON(
    opts: GenerateJSONOptions,
    ctx?: ModelCallContext,
  ): Promise<GenerateTextResult> {
    const system = [
      opts.systemPrompt ?? "",
      "You MUST reply with a single JSON object. No markdown. No prose. No code fences. Just the JSON.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return this.invoke({ ...opts, systemPrompt: system }, ctx);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const t0 = Date.now();
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with 'ok'." }],
      });
      const text = textFromContent(res.content);
      return {
        ok: text.toLowerCase().includes("ok"),
        message: text.slice(0, 60),
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - t0,
      };
    }
  }

  /** Rough estimate; refine per model later. */
  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    const promptUsdPerK = 0.003;
    const completionUsdPerK = 0.015;
    return (promptTokens / 1000) * promptUsdPerK + (completionTokens / 1000) * completionUsdPerK;
  }

  // ---- internals ----

  private async invoke(
    opts: GenerateTextOptions,
    ctx?: ModelCallContext,
  ): Promise<GenerateTextResult> {
    const t0 = Date.now();
    let status = "ok";
    let error: string | null = null;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let stopReason: string | undefined;
    let text = "";

    try {
      const res = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.4,
          system: opts.systemPrompt,
          stop_sequences: opts.stopSequences,
          messages: [{ role: "user", content: opts.userPrompt }],
        },
        opts.signal ? { signal: opts.signal } : undefined,
      );
      text = textFromContent(res.content);
      promptTokens = res.usage?.input_tokens;
      completionTokens = res.usage?.output_tokens;
      stopReason = res.stop_reason ?? undefined;
    } catch (err) {
      status = isAbortError(err) ? "aborted" : "error";
      error = err instanceof Error ? err.message : String(err);
      if (status !== "aborted") {
        logger.error({ err: error, ctx }, "anthropic.invoke failed");
      }
      throw err;
    } finally {
      const latencyMs = Date.now() - t0;
      if (ctx?.runId) {
        try {
          await prisma.modelCall.create({
            data: {
              runId: ctx.runId,
              sessionId: ctx.sessionId ?? null,
              taskId: ctx.taskId ?? null,
              agentName: ctx.agentName,
              provider: this.name,
              model: this.model,
              status,
              promptTokens,
              completionTokens,
              latencyMs,
              error,
            },
          });
        } catch (logErr) {
          logger.warn({ logErr }, "failed to log modelCall");
        }
      }
    }

    return {
      text,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - t0,
      model: this.model,
      provider: this.name,
      stopReason,
    };
  }
}

function textFromContent(content: Anthropic.Messages.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (/abort/i.test(err.message)) return true;
  }
  return false;
}
