import type { CheckpointType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export interface WriteCheckpointInput {
  runId: string;
  sessionId: string;
  checkpointType: CheckpointType;
  summary: string;
  state: Record<string, unknown>;
}

export async function writeCheckpoint(input: WriteCheckpointInput) {
  return prisma.agentCheckpoint.create({
    data: {
      runId: input.runId,
      sessionId: input.sessionId,
      checkpointType: input.checkpointType,
      summary: input.summary,
      state: input.state as any,
    },
  });
}

export async function latestCheckpoint(runId: string) {
  return prisma.agentCheckpoint.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });
}
