import { NextResponse } from "next/server";
import { redisClient } from "@/lib/agents/core/locks";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  try {
    const pong = await redisClient().ping();
    return NextResponse.json({ ok: pong === "PONG", latencyMs: Date.now() - t0, pong });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
