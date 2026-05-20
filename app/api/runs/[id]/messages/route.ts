import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { appendRunMessage } from "@/lib/runs/service";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const postSchema = z.object({
  content: z.string().min(1).max(8000),
});

export const POST = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid_body");
  const message = await appendRunMessage(id, userId, parsed.data.content);
  return NextResponse.json({ message }, { status: 201 });
});

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await getRunForUser(id, userId);
  const messages = await prisma.runMessage.findMany({
    where: { runId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return NextResponse.json({ messages });
});
