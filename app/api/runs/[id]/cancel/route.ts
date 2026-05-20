import { NextResponse } from "next/server";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { cancelRun } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export const POST = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await cancelRun(id, userId);
  return NextResponse.json({ ok: true });
});
