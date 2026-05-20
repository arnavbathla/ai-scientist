/**
 * Realtime control channel.
 *
 * Uses Redis Pub/Sub to deliver low-latency control signals (interrupt,
 * skip, config-updated) from API routes into the worker process so it can
 * abort an in-flight LLM call mid-stream.
 *
 * In-process emitter fallback: when REDIS_URL is unset (tests), control
 * messages are delivered locally via a Node EventEmitter so unit tests can
 * exercise the path without spinning up Redis.
 */
import IORedis, { type Redis } from "ioredis";
import { EventEmitter } from "events";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

export type ControlMessage =
  | { type: "interrupt"; reason?: string }
  | { type: "skip"; agentName?: string; reason?: string }
  | { type: "config_updated" }
  | { type: "user_message"; preview?: string };

export interface ControlSubscription {
  unsubscribe: () => Promise<void>;
}

const RUN_PREFIX = "researchos:control:run:";
const channelFor = (runId: string) => `${RUN_PREFIX}${runId}`;

const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(1000);

let _pub: Redis | null = null;
let _sub: Redis | null = null;

function pubClient(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) return null;
  if (_pub) return _pub;
  _pub = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  _pub.on("error", (e) => logger.warn({ err: String(e) }, "control pub redis error"));
  return _pub;
}

function subClient(): Redis | null {
  const url = env().REDIS_URL;
  if (!url) return null;
  if (_sub) return _sub;
  _sub = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  _sub.on("error", (e) => logger.warn({ err: String(e) }, "control sub redis error"));
  return _sub;
}

export async function publishControl(runId: string, msg: ControlMessage): Promise<void> {
  // Always emit locally so single-process scenarios (tests, dev) work even
  // if Redis hasn't connected yet.
  localEmitter.emit(channelFor(runId), msg);
  const r = pubClient();
  if (!r) return;
  try {
    await r.publish(channelFor(runId), JSON.stringify(msg));
  } catch (err) {
    logger.warn({ err: String(err), runId }, "publishControl failed");
  }
}

export async function subscribeControl(
  runId: string,
  onMessage: (m: ControlMessage) => void,
): Promise<ControlSubscription> {
  const channel = channelFor(runId);
  const localHandler = (m: ControlMessage) => {
    try {
      onMessage(m);
    } catch (err) {
      logger.warn({ err: String(err), runId }, "control local handler threw");
    }
  };
  localEmitter.on(channel, localHandler);

  const r = subClient();
  let remoteHandler: ((ch: string, msg: string) => void) | null = null;
  if (r) {
    remoteHandler = (ch, msg) => {
      if (ch !== channel) return;
      try {
        const parsed = JSON.parse(msg) as ControlMessage;
        onMessage(parsed);
      } catch (err) {
        logger.warn({ err: String(err), msg }, "control remote parse failed");
      }
    };
    r.on("message", remoteHandler);
    try {
      await r.subscribe(channel);
    } catch (err) {
      logger.warn({ err: String(err), runId }, "control subscribe failed");
    }
  }

  return {
    unsubscribe: async () => {
      localEmitter.off(channel, localHandler);
      if (r && remoteHandler) {
        try {
          r.off("message", remoteHandler);
          await r.unsubscribe(channel);
        } catch {
          // ignore
        }
      }
    },
  };
}

/** For tests that want to drain the in-process bus. */
export function _resetLocalControlBus(): void {
  localEmitter.removeAllListeners();
}
