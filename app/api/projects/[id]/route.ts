import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors, notFound, forbidden, badRequest } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          researchGoal: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          completionConfidence: true,
        },
      },
    },
  });
  if (!project) throw notFound();
  if (project.userId !== userId) throw forbidden();
  return NextResponse.json({ project });
});

const patchSchema = z.object({
  title: z.string().min(2).max(280).optional(),
  description: z.string().max(2000).optional(),
  domain: z.string().max(100).optional(),
});

export const PATCH = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid_body");
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.userId !== userId) throw forbidden();
  const project = await prisma.project.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ project });
});

export const DELETE = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.userId !== userId) throw forbidden();
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
