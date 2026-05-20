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
  const [hypotheses, rankings] = await Promise.all([
    prisma.hypothesis.findMany({
      where: { runId: id },
      orderBy: [{ overallScore: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.ranking.findMany({
      where: { runId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  // For each hypothesis, attach latest Elo (if any).
  const latestEloByHyp: Record<string, { eloScore: number; rank: number }> = {};
  for (const r of rankings) {
    if (!latestEloByHyp[r.hypothesisId]) {
      latestEloByHyp[r.hypothesisId] = { eloScore: r.eloScore, rank: r.rank };
    }
  }
  return NextResponse.json({
    hypotheses: hypotheses.map((h) => ({
      ...h,
      latestRanking: latestEloByHyp[h.id] ?? null,
    })),
  });
});
