import { logger } from "@/lib/utils/logger";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  acceptHeader?: string;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 600;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          "User-Agent": opts.userAgent ?? "ResearchOS/0.1 (+mailto:research@example.com)",
          ...(opts.acceptHeader ? { Accept: opts.acceptHeader } : {}),
          ...(init.headers ?? {}),
        },
      });
      clearTimeout(timer);
      if (res.status >= 500 || res.status === 429) {
        const text = await res.text().catch(() => "");
        lastErr = new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * Math.pow(2, attempt - 1));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      logger.warn({ err: String(err), url, attempt }, "http retry");
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * Math.pow(2, attempt - 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`fetchWithRetry exhausted for ${url}`);
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
