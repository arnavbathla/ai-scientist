/**
 * ResearchOS worker.
 *
 * Started with `pnpm worker`. Subscribes to the `research-runs` BullMQ queue,
 * runs the long-horizon supervisor loop for each job, and on startup resumes
 * any sessions whose heartbeat went stale (e.g. previous worker crashed).
 */

import "dotenv/config";

import { Worker, type Job } from "bullmq";
import { bullConnection, enqueueRun, RESEARCH_QUEUE } from "@/lib/jobs/queue";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { runSession } from "@/lib/agents/core/harness";
import { findStaleSessions } from "@/lib/agents/core/resume";

async function processJob(job: Job<{ runId: string; reason?: string }>) {
  const { runId, reason } = job.data;
  logger.info({ jobId: job.id, runId, reason }, "worker received job");
  await runSession({ runId });
}

async function bootstrap() {
  const cfg = env();
  logger.info(
    {
      concurrency: cfg.RESEARCH_WORKER_CONCURRENCY,
      heartbeatMs: cfg.RESEARCH_HEARTBEAT_INTERVAL_MS,
      staleMs: cfg.RESEARCH_STALE_SESSION_AGE_MS,
      anthropicConfigured: Boolean(cfg.ANTHROPIC_API_KEY),
    },
    "researchos worker starting",
  );

  // Resume any stale sessions immediately on boot, and then periodically. The
  // periodic scan catches sessions whose worker died after this one had
  // already booted — durability is the whole point of this harness.
  async function scanForStale(label: string) {
    try {
      const stale = await findStaleSessions();
      for (const s of stale) {
        await enqueueRun({ runId: s.runId, reason: `resume:${label}` });
        logger.info({ runId: s.runId, label }, "resumed stale session");
      }
    } catch (err) {
      logger.error({ err, label }, "stale session scan failed");
    }
  }
  await scanForStale("boot");
  const staleScanIntervalMs = Math.max(30_000, Math.floor(cfg.RESEARCH_STALE_SESSION_AGE_MS / 3));
  const staleScanTimer = setInterval(() => {
    void scanForStale("periodic");
  }, staleScanIntervalMs);
  // Don't keep the event loop alive solely for this timer.
  staleScanTimer.unref?.();

  const worker = new Worker(RESEARCH_QUEUE, processJob, {
    connection: bullConnection(),
    concurrency: cfg.RESEARCH_WORKER_CONCURRENCY,
    lockDuration: Math.max(60_000, cfg.RESEARCH_HEARTBEAT_INTERVAL_MS * 4),
  });

  worker.on("error", (err) => logger.error({ err }, "worker error"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, runId: job?.data?.runId, err: err?.message }, "job failed"),
  );
  worker.on("completed", (job) =>
    logger.info({ jobId: job.id, runId: job.data.runId }, "job completed"),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutdown");
    clearInterval(staleScanTimer);
    try {
      await worker.close();
    } catch (err) {
      logger.error({ err }, "worker close failed");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("worker bootstrap failed:", err);
  process.exit(1);
});
