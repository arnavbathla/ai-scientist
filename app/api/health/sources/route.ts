import { NextResponse } from "next/server";
import { SOURCE_REGISTRY } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const entries = await Promise.all(
    Object.entries(SOURCE_REGISTRY).map(async ([id, def]) => {
      try {
        const h = await def.health();
        return [id, h] as const;
      } catch (err) {
        return [
          id,
          { ok: false, message: err instanceof Error ? err.message : String(err) },
        ] as const;
      }
    }),
  );
  const result = Object.fromEntries(entries);
  const ok = Object.values(result).every((r) => (r as any).ok);
  return NextResponse.json({ ok, sources: result });
}
