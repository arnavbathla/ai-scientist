import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/utils/logger";

export interface ToolCallContext {
  runId: string;
  sessionId?: string | null;
  taskId?: string | null;
  agentName: string;
}

/**
 * Wraps a side-effecting tool call (typically an HTTP fetch to a scientific
 * source) so that every invocation is recorded into the ToolCall audit table,
 * even if it throws.
 */
export async function logToolCall<T>(
  ctx: ToolCallContext,
  toolName: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  let output: T | null = null;
  let error: string | null = null;
  try {
    output = await fn();
    return output;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    try {
      await prisma.toolCall.create({
        data: {
          runId: ctx.runId,
          sessionId: ctx.sessionId ?? null,
          taskId: ctx.taskId ?? null,
          agentName: ctx.agentName,
          toolName,
          input: (input ?? {}) as any,
          output: error ? null : ((output ?? {}) as any),
          error,
          latencyMs: Date.now() - t0,
        },
      });
    } catch (logErr) {
      logger.warn({ logErr }, "failed to log toolCall");
    }
  }
}
