import { Queue, QueueEvents } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { env } from "@/lib/utils/env";

export const RESEARCH_QUEUE = "research-runs";

let _connection: Redis | null = null;

export function bullConnection(): Redis {
  if (_connection) return _connection;
  _connection = new IORedis(env().REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  return _connection;
}

let _queue: Queue | null = null;
export function researchQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(RESEARCH_QUEUE, { connection: bullConnection() });
  return _queue;
}

let _events: QueueEvents | null = null;
export function researchQueueEvents(): QueueEvents {
  if (_events) return _events;
  _events = new QueueEvents(RESEARCH_QUEUE, { connection: bullConnection() });
  return _events;
}

export interface EnqueueRunInput {
  runId: string;
  reason?: string;
}

export async function enqueueRun({ runId, reason }: EnqueueRunInput) {
  return researchQueue().add(
    "run-session",
    { runId, reason: reason ?? "user_requested" },
    {
      jobId: `run-${runId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 200, age: 60 * 60 * 24 * 7 },
      removeOnFail: { count: 200, age: 60 * 60 * 24 * 7 },
    },
  );
}

export async function removeRunFromQueue(runId: string) {
  const job = await researchQueue().getJob(`run-${runId}`);
  if (job) {
    try {
      await job.remove();
    } catch {
      // ignore
    }
  }
}
