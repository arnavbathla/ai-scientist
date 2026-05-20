import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { interruptRun } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const bodySchema = z.object({ reason: z.string().max(500).optional() }).optional();

export const POST = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json ?? {});
  const reason = parsed.success ? parsed.data?.reason : undefined;
  await interruptRun(id, userId, reason);
  return NextResponse.json({ ok: true });
});
