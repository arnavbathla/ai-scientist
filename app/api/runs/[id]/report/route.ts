import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors, notFound } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await getRunForUser(id, userId);
  const report = await prisma.finalReport.findFirst({
    where: { runId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!report) throw notFound();
  return NextResponse.json({ report });
});
