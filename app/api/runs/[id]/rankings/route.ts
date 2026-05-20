import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await getRunForUser(id, userId);
  const [rankings, debates] = await Promise.all([
    prisma.ranking.findMany({
      where: { runId: id },
      orderBy: { rank: "asc" },
      include: {
        hypothesis: {
          select: { id: true, title: true, status: true },
        },
      },
      take: 200,
    }),
    prisma.debateRound.findMany({
      where: { runId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        hypothesisAId: true,
        hypothesisBId: true,
        winnerHypothesisId: true,
        verdict: true,
        scoreDeltaA: true,
        scoreDeltaB: true,
        createdAt: true,
      },
    }),
  ]);
  return NextResponse.json({ rankings, debates });
});
