import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async () => {
  const userId = await requireUserId();
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { runs: true } },
    },
  });
  return NextResponse.json({ projects });
});

const createSchema = z.object({
  title: z.string().min(2).max(280),
  description: z.string().max(2000).optional(),
  domain: z.string().max(100).optional(),
});

export const POST = withApiErrors(async (req: Request) => {
  const userId = await requireUserId();
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid_body");
  const project = await prisma.project.create({
    data: {
      userId,
      title: parsed.data.title,
      description: parsed.data.description,
      domain: parsed.data.domain ?? "General biology",
    },
  });
  return NextResponse.json({ project }, { status: 201 });
});
