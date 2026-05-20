import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

/**
 * On worker boot, find sessions whose lastHeartbeatAt is older than the stale
 * threshold and re-enqueue their runs. Avoids duplicate execution by relying on
 * the per-run Redis lock in the harness.
 */
export interface StaleSession {
  runId: string;
  sessionId: string;
}

export async function findStaleSessions(): Promise<StaleSession[]> {
  const cutoff = new Date(Date.now() - env().RESEARCH_STALE_SESSION_AGE_MS);
  const sessions = await prisma.agentSession.findMany({
    where: {
      status: { in: ["active"] },
      lastHeartbeatAt: { lt: cutoff },
      run: { status: "running" },
    },
    select: { id: true, runId: true },
  });
  if (sessions.length) {
    logger.info({ count: sessions.length, cutoff }, "found stale sessions to resume");
  }
  return sessions.map((s) => ({ runId: s.runId, sessionId: s.id }));
}
