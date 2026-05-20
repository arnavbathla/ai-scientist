import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";
import { buildRunPdf } from "@/lib/export/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx { params: Promise<{ id: string }> }

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await getRunForUser(id, userId);
  const { filename, buffer } = await buildRunPdf(id);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
});
