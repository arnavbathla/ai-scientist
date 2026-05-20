import { prisma } from "@/lib/db/prisma";
import { writeCheckpoint } from "./checkpoint";
import { writeMemory } from "./memory";
import { emitEvent } from "./events";

/**
 * Context compaction.
 *
 * When event/memory counts grow beyond `MAX_EVENTS_KEPT`, fold older events
 * (oldest first) into a single AgentMemory of type "progress" and create a
 * `compaction` checkpoint. This preserves identifiers (PMIDs, DOIs, hypothesis
 * IDs, ranking IDs, safety flags, task IDs) and the rationale of past actions,
 * without dragging raw chat history forward.
 */
const MAX_EVENTS_KEPT = 200;
const FOLD_BATCH = 60;

export async function maybeCompact(runId: string, sessionId: string): Promise<{ compacted: boolean }> {
  const total = await prisma.agentEvent.count({ where: { runId, sessionId } });
  if (total <= MAX_EVENTS_KEPT) return { compacted: false };
  const olderEvents = await prisma.agentEvent.findMany({
    where: { runId, sessionId },
    orderBy: { createdAt: "asc" },
    take: Math.min(FOLD_BATCH, total - MAX_EVENTS_KEPT + 30),
  });
  if (olderEvents.length === 0) return { compacted: false };

  const summary = olderEvents
    .map((e) => `[${e.createdAt.toISOString()}] ${e.agentName}/${e.eventType}: ${e.title}`)
    .join("\n");

  // Preserve identifiers in the compaction payload
  const preserved = {
    sourceDocuments: await prisma.sourceDocument.findMany({
      where: { runId },
      select: { id: true, sourceType: true, pmid: true, doi: true, title: true },
    }),
    hypotheses: await prisma.hypothesis.findMany({
      where: { runId },
      select: { id: true, title: true, status: true, overallScore: true },
    }),
    rankings: await prisma.ranking.findMany({
      where: { runId },
      select: { hypothesisId: true, rank: true, eloScore: true },
      orderBy: { rank: "asc" },
    }),
    safetyFlags: await prisma.safetyFlag.findMany({
      where: { runId },
      select: { id: true, severity: true, category: true, message: true },
    }),
  };

  await writeMemory({
    runId,
    sessionId,
    memoryType: "progress",
    title: `Compaction (${olderEvents.length} events folded)`,
    content: summary,
    payload: preserved,
    importanceScore: 0.4,
  });

  await writeCheckpoint({
    runId,
    sessionId,
    checkpointType: "compaction",
    summary: `Folded ${olderEvents.length} earlier events into memory.`,
    state: {
      foldedFromId: olderEvents[0].id,
      foldedToId: olderEvents[olderEvents.length - 1].id,
      foldedCount: olderEvents.length,
      preserved: {
        sourceCount: preserved.sourceDocuments.length,
        hypothesisCount: preserved.hypotheses.length,
        rankingCount: preserved.rankings.length,
        safetyFlagCount: preserved.safetyFlags.length,
      },
    },
  });

  await emitEvent({
    runId,
    sessionId,
    agentName: "SupervisorAgent",
    eventType: "checkpoint",
    title: "Compaction checkpoint",
    message: `Folded ${olderEvents.length} earlier events into durable memory.`,
  });

  return { compacted: true };
}
