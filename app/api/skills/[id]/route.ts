import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { deleteSkill, getSkillForUser, updateSkill } from "@/lib/skills/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().min(1).max(1000).optional(),
  body: z.string().min(1).max(12_000).optional(),
  scope: z.enum(["global", "project"]).optional(),
  projectId: z.string().nullable().optional(),
});

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const skill = await getSkillForUser(id, userId);
  return NextResponse.json({ skill });
});

export const PATCH = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid_body");
  const skill = await updateSkill(id, userId, parsed.data);
  return NextResponse.json({ skill });
});

export const DELETE = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await deleteSkill(id, userId);
  return NextResponse.json({ ok: true });
});
