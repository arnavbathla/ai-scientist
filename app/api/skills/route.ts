import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { createSkill, listSkillsForUser } from "@/lib/skills/service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(1).max(1000),
  body: z.string().min(1).max(12_000),
  scope: z.enum(["global", "project"]).optional(),
  projectId: z.string().optional().nullable(),
});

export const GET = withApiErrors(async (req: Request) => {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const skills = await listSkillsForUser(userId, projectId !== undefined ? { projectId } : undefined);
  return NextResponse.json({ skills });
});

export const POST = withApiErrors(async (req: Request) => {
  const userId = await requireUserId();
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) throw badRequest(`invalid_body:${parsed.error.issues[0]?.path?.join(".") ?? "shape"}`);
  const skill = await createSkill(userId, {
    name: parsed.data.name,
    description: parsed.data.description,
    body: parsed.data.body,
    scope: parsed.data.scope,
    projectId: parsed.data.projectId,
  });
  return NextResponse.json({ skill }, { status: 201 });
});
