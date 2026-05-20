import { z, type ZodTypeAny } from "zod";
import type { GenerateJSONOptions, ModelCallContext, ModelProvider } from "./provider";
import { logger } from "@/lib/utils/logger";

export interface SafeJsonOptions<TSchema extends ZodTypeAny> {
  provider: ModelProvider;
  schema: TSchema;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  repairOnFailure?: boolean;
  maxRetries?: number;
  signal?: AbortSignal;
  ctx?: ModelCallContext;
}

export interface SafeJsonResult<T> {
  data: T;
  raw: string;
  attempts: number;
}

export class SafeJsonError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * safeGenerateJSON
 *
 * 1) Asks the provider for JSON.
 * 2) If JSON.parse fails, optionally asks the model to repair the JSON once.
 * 3) Validates the parsed object with the provided Zod schema.
 * 4) On schema failure, optionally repairs again.
 * 5) Throws SafeJsonError if it still cannot validate, so the harness can fail
 *    the task cleanly with a persisted error.
 */
export async function safeGenerateJSON<TSchema extends ZodTypeAny>(
  opts: SafeJsonOptions<TSchema>,
): Promise<SafeJsonResult<z.infer<TSchema>>> {
  const maxRetries = opts.maxRetries ?? 1;
  const repair = opts.repairOnFailure ?? true;

  let attempts = 0;
  let lastRaw = "";
  let lastError: unknown;

  const baseOpts: GenerateJSONOptions = {
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    maxTokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.3,
    jsonOnly: true,
    signal: opts.signal,
  };

  while (attempts <= maxRetries) {
    attempts++;
    let userPrompt = baseOpts.userPrompt;

    if (attempts > 1 && repair) {
      // Ask the model to repair its previous attempt.
      userPrompt = repairPrompt(opts.userPrompt, lastRaw, lastError);
    }

    const res = await opts.provider.generateJSON(
      { ...baseOpts, userPrompt },
      opts.ctx,
    );
    lastRaw = res.text;

    const extracted = extractJsonObject(res.text);
    if (!extracted) {
      lastError = new Error("Provider did not return JSON.");
      logger.warn({ attempts, agent: opts.ctx?.agentName }, "safeJSON: extract failed");
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempts, agent: opts.ctx?.agentName }, "safeJSON: parse failed");
      continue;
    }

    const validated = opts.schema.safeParse(parsed);
    if (validated.success) {
      return { data: validated.data, raw: res.text, attempts };
    }
    lastError = validated.error;
    logger.warn(
      { issues: validated.error.issues.slice(0, 6), attempts, agent: opts.ctx?.agentName },
      "safeJSON: schema validation failed",
    );
  }

  throw new SafeJsonError(
    `safeGenerateJSON: model output did not match schema after ${attempts} attempts`,
    lastRaw,
    lastError,
  );
}

/**
 * Pull the first balanced top-level JSON object/array out of free-form text.
 * Handles common cases like leading ```json fences, prose, multiple objects.
 */
export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  // Strip code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = fenceMatch ? fenceMatch[1] : text;
  const trimmed = cleaned.trim();

  // Quick path: pure JSON
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }

  // Find balanced object
  const start = trimmed.indexOf("{");
  const startArr = trimmed.indexOf("[");
  const startIdx = pickFirst(start, startArr);
  if (startIdx < 0) return null;

  const open = trimmed[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return trimmed.slice(startIdx, i + 1);
    }
  }
  return null;
}

function pickFirst(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

function repairPrompt(originalUserPrompt: string, lastRaw: string, lastError: unknown): string {
  const errStr =
    lastError instanceof z.ZodError
      ? JSON.stringify(lastError.issues.slice(0, 8), null, 2)
      : lastError instanceof Error
        ? lastError.message
        : String(lastError);
  return [
    "Your previous reply could not be parsed as the required JSON object.",
    "",
    "Original request:",
    originalUserPrompt,
    "",
    "Your previous (invalid) reply was:",
    lastRaw.slice(0, 4000),
    "",
    "Parser/validator complained:",
    errStr,
    "",
    "Reply ONLY with a single JSON object that matches the schema. No markdown. No prose.",
  ].join("\n");
}
