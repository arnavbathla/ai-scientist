import type { ZodTypeAny } from "zod";
import { safeGenerateJSON, type SafeJsonResult } from "@/lib/models/safe-json";
import type { ModelProvider, ModelCallContext } from "@/lib/models/provider";
import { composeSystem } from "./skills";

export interface RunAgentJsonOptions<TSchema extends ZodTypeAny> {
  provider: ModelProvider;
  schema: TSchema;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  runId: string;
  ctx: ModelCallContext;
}

/**
 * runAgentJson — every scientist agent's single LLM entry point.
 *
 * Composes the agent's local SYSTEM prompt with the run-level skills block
 * and recent user follow-up instructions, plumbs the AbortSignal down to the
 * Anthropic SDK, and persists model-call rows via safeGenerateJSON.
 *
 * This is the seam that makes "skills" + "interrupt" + "follow-up" work for
 * every agent without each file having to know about either feature.
 */
export async function runAgentJson<TSchema extends ZodTypeAny>(
  opts: RunAgentJsonOptions<TSchema>,
): Promise<SafeJsonResult<import("zod").infer<TSchema>>> {
  const system = await composeSystem(opts.systemPrompt, opts.runId);
  return safeGenerateJSON({
    provider: opts.provider,
    schema: opts.schema,
    systemPrompt: system,
    userPrompt: opts.userPrompt,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    signal: opts.signal,
    ctx: opts.ctx,
  });
}
