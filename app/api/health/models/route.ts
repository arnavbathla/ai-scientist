import { NextResponse } from "next/server";
import { ModelRouter } from "@/lib/models/router";
import { hasAnthropicKey } from "@/lib/utils/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!hasAnthropicKey()) {
    return NextResponse.json({ ok: false, anthropic: { configured: false } }, { status: 503 });
  }
  const provider = ModelRouter.for("supervisorPlanning");
  try {
    const health = await provider.healthCheck();
    return NextResponse.json({ ok: health.ok, anthropic: { configured: true, ...health } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, anthropic: { configured: true, error: err instanceof Error ? err.message : String(err) } },
      { status: 503 },
    );
  }
}
