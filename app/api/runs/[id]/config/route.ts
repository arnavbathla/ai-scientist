import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest } from "@/lib/auth/session";
import { updateRunConfig } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

const patchSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(500).optional(),
    maxRuntimeMinutes: z.number().int().min(1).max(60 * 24).optional(),
    maxSources: z.number().int().min(5).max(1000).optional(),
    maxHypotheses: z.number().int().min(3).max(500).optional(),
    addIterations: z.number().int().min(1).max(200).optional(),
    addRuntimeMinutes: z.number().int().min(1).max(60 * 12).optional(),
    finishNow: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.maxIterations !== undefined ||
      v.maxRuntimeMinutes !== undefined ||
      v.maxSources !== undefined ||
      v.maxHypotheses !== undefined ||
      v.addIterations !== undefined ||
      v.addRuntimeMinutes !== undefined ||
      v.finishNow === true,
    { message: "no_changes" },
  );

export const PATCH = withApiErrors(async (req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw badRequest(`invalid_body:${parsed.error.issues[0]?.path?.join(".") ?? "shape"}`);
  const run = await updateRunConfig(id, userId, parsed.data);
  return NextResponse.json({ run });
});
