import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { skipStep } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const bodySchema = z
  .object({
    agentName: z.string().max(80).optional(),
    currentOnly: z.boolean().optional(),
    enable: z.boolean().optional(),
  })
  .optional();

export const POST = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) throw badRequest("invalid_body");
  const run = await skipStep(id, userId, parsed.data ?? {});
  return NextResponse.json({ run });
});
