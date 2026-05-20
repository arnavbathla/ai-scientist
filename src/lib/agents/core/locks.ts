import IORedis, { type Redis } from "ioredis";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

let _redis: Redis | null = null;

export function redisClient(): Redis {
  if (_redis) return _redis;
  const url = env().REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not configured");
  _redis = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  _redis.on("error", (e) => logger.error({ err: e }, "redis error"));
  return _redis;
}

/**
 * Acquires a distributed lock for a research run so two workers don't process
 * the same session concurrently.
 *
 * Usage:
 *   const lock = await acquireRunLock(runId, 30_000);
 *   if (!lock) return; // someone else has it
 *   try { ... } finally { await lock.release(); }
 *
 * The lock value is unique per acquisition, so release won't drop another
 * worker's lock if expiry happened to lapse.
 */
export interface RunLock {
  release: () => Promise<void>;
  renew: (ttlMs: number) => Promise<boolean>;
  key: string;
  value: string;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export async function acquireRunLock(runId: string, ttlMs: number): Promise<RunLock | null> {
  const redis = redisClient();
  const key = `researchos:lock:run:${runId}`;
  const value = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, value, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  return {
    key,
    value,
    release: async () => {
      try {
        await redis.eval(RELEASE_SCRIPT, 1, key, value);
      } catch (err) {
        logger.warn({ err: String(err), key }, "lock release failed");
      }
    },
    renew: async (newTtl: number) => {
      try {
        const r = (await redis.eval(RENEW_SCRIPT, 1, key, value, String(newTtl))) as number;
        return r === 1;
      } catch {
        return false;
      }
    },
  };
}
