import { redisClient } from "@/lib/agents/core/locks";

/**
 * Sliding-window-ish per-user rate limiter using Redis INCR + EXPIRE.
 * Simple and durable; good enough for protecting the run-creation endpoint.
 */
export async function checkRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ ok: boolean; remaining: number; retryAfter?: number }> {
  const redis = redisClient();
  const fullKey = `researchos:rl:${opts.key}`;
  const current = await redis.incr(fullKey);
  if (current === 1) {
    await redis.expire(fullKey, opts.windowSeconds);
  }
  const ttl = await redis.ttl(fullKey);
  const ok = current <= opts.limit;
  return {
    ok,
    remaining: Math.max(0, opts.limit - current),
    retryAfter: ok ? undefined : ttl > 0 ? ttl : opts.windowSeconds,
  };
}
