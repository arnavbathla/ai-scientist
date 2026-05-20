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
  const memories = await prisma.agentMemory.findMany({
    where: { runId: id },
    orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ memories });
});
