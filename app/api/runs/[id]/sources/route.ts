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
  const sources = await prisma.sourceDocument.findMany({
    where: { runId: id },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      title: true,
      sourceType: true,
      year: true,
      doi: true,
      pmid: true,
      url: true,
      authors: true,
      abstract: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ sources });
});
