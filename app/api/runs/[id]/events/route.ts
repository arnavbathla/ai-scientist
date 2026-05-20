import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export const GET = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await getRunForUser(id, userId);
  const { searchParams } = new URL(req.url);
  const sinceId = searchParams.get("sinceId") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);
  const events = await prisma.agentEvent.findMany({
    where: {
      runId: id,
      ...(sinceId ? { id: { gt: sinceId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ events: events.reverse() });
});
