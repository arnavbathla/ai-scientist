import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { listRunSkills, setRunSkills } from "@/lib/skills/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const putSchema = z.object({
  skillIds: z.array(z.string().min(1)).max(20),
});

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  // Authorize via run-skills query (caller must own the run).
  const { getRunForUser } = await import("@/lib/runs/service");
  await getRunForUser(id, userId);
  const skills = await listRunSkills(id);
  return NextResponse.json({ skills });
});

export const PUT = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid_body");
  await setRunSkills(id, userId, parsed.data.skillIds);
  return NextResponse.json({ ok: true });
});
