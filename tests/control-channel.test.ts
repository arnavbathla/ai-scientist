import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the local emitter fallback by ensuring REDIS_URL is unset for these tests.
delete process.env.REDIS_URL;

import {
  publishControl,
  subscribeControl,
  _resetLocalControlBus,
  type ControlMessage,
} from "@/lib/realtime/control";

describe("realtime control bus (local fallback)", () => {
  beforeEach(() => {
    _resetLocalControlBus();
  });

  it("delivers interrupt messages to subscribers", async () => {
    const runId = "run-int";
    const received: ControlMessage[] = [];
    const sub = await subscribeControl(runId, (m) => received.push(m));
    try {
      await publishControl(runId, { type: "interrupt", reason: "manual" });
      // Local emitter delivers synchronously inside the same tick.
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: "interrupt", reason: "manual" });
    } finally {
      await sub.unsubscribe();
    }
  });

  it("aborts an in-flight LLM call when interrupt arrives", async () => {
    const runId = "run-abort";
    const sub = await subscribeControl(runId, (m) => {
      if (m.type === "interrupt") {
        ac.abort(new DOMException("interrupt", "AbortError"));
      }
    });

    const ac = new AbortController();
    const fakeLLM = (signal: AbortSignal): Promise<void> =>
      new Promise((_, reject) => {
        const onAbort = () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort);
      });

    const llmPromise = fakeLLM(ac.signal).catch((e) => e);
    await publishControl(runId, { type: "interrupt" });
    const err = await llmPromise;
    expect((err as Error).name).toBe("AbortError");
    await sub.unsubscribe();
  });

  it("only delivers messages for the matching runId channel", async () => {
    const a: ControlMessage[] = [];
    const b: ControlMessage[] = [];
    const subA = await subscribeControl("run-A", (m) => a.push(m));
    const subB = await subscribeControl("run-B", (m) => b.push(m));
    await publishControl("run-A", { type: "skip", agentName: "EvolutionAgent" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    if (a[0]?.type === "skip") expect(a[0].agentName).toBe("EvolutionAgent");
    await subA.unsubscribe();
    await subB.unsubscribe();
  });

  it("unsubscribing stops further deliveries", async () => {
    const messages: ControlMessage[] = [];
    const sub = await subscribeControl("run-stop", (m) => messages.push(m));
    await publishControl("run-stop", { type: "interrupt" });
    expect(messages).toHaveLength(1);
    await sub.unsubscribe();
    await publishControl("run-stop", { type: "interrupt" });
    expect(messages).toHaveLength(1);
  });
});
