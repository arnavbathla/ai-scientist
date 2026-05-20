import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (_req: Request, ctx: Ctx) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const run = await getRunForUser(id, userId);
  const [session, latestAssessment, counts] = await Promise.all([
    prisma.agentSession.findFirst({
      where: { runId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.completionAssessment.findFirst({
      where: { runId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$transaction([
      prisma.hypothesis.count({ where: { runId: id } }),
      prisma.evidence.count({ where: { runId: id } }),
      prisma.sourceDocument.count({ where: { runId: id } }),
      prisma.safetyFlag.count({ where: { runId: id } }),
      prisma.agentTask.count({ where: { runId: id } }),
      prisma.agentEvent.count({ where: { runId: id } }),
      prisma.finalReport.findFirst({ where: { runId: id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]),
  ]);
  const [hypothesisCount, evidenceCount, sourceCount, safetyCount, taskCount, eventCount, report] = counts;
  return NextResponse.json({
    run,
    session,
    latestAssessment,
    finalReportId: report?.id ?? null,
    counts: {
      hypotheses: hypothesisCount,
      evidence: evidenceCount,
      sources: sourceCount,
      safetyFlags: safetyCount,
      tasks: taskCount,
      events: eventCount,
    },
  });
});
