import type { MemoryType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export interface WriteMemoryInput {
  runId: string;
  sessionId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  payload?: unknown;
  importanceScore?: number;
}

export async function writeMemory(input: WriteMemoryInput) {
  return prisma.agentMemory.create({
    data: {
      runId: input.runId,
      sessionId: input.sessionId,
      memoryType: input.memoryType,
      title: input.title,
      content: input.content,
      payload: (input.payload ?? undefined) as any,
      importanceScore: input.importanceScore ?? 0.5,
    },
  });
}

export interface ReadMemoryQuery {
  runId: string;
  types?: MemoryType[];
  limit?: number;
}

export async function readMemory({ runId, types, limit = 60 }: ReadMemoryQuery) {
  return prisma.agentMemory.findMany({
    where: {
      runId,
      ...(types && types.length ? { memoryType: { in: types } } : {}),
    },
    orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/**
 * Build a compact context block from memory for use as agent prompt prefix.
 */
export async function buildContextBlock(runId: string, maxChars = 6000): Promise<string> {
  const items = await readMemory({ runId, limit: 40 });
  const lines: string[] = [];
  let used = 0;
  for (const m of items) {
    const line = `- [${m.memoryType}] ${m.title}: ${m.content}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
