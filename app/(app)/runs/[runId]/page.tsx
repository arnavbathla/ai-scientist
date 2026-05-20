import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/utils/env";
import { RunView } from "@/components/run/run-view";
import { listSkillsForUser, listRunSkills } from "@/lib/skills/service";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunPage({ params }: PageProps) {
  const session = await auth();
  const userId = session!.user.id;
  const { runId } = await params;

  const run = await prisma.researchRun.findUnique({
    where: { id: runId },
    include: { project: { select: { id: true, title: true } } },
  });
  if (!run) notFound();
  if (run.userId !== userId) redirect("/projects");

  const [agentSession, events, hypotheses, evidence, sources, tasks, report, latestAssessment, rankings, counts, allSkills, runSkills] =
    await Promise.all([
      prisma.agentSession.findFirst({
        where: { runId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.agentEvent.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
        take: 300,
      }),
      prisma.hypothesis.findMany({
        where: { runId },
        orderBy: [{ overallScore: "desc" }],
      }),
      prisma.evidence.findMany({
        where: { runId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { source: true },
      }),
      prisma.sourceDocument.findMany({
        where: { runId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, title: true, sourceType: true, year: true, doi: true, pmid: true, url: true },
      }),
      prisma.agentTask.findMany({ where: { runId }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.finalReport.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } }),
      prisma.completionAssessment.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } }),
      prisma.ranking.findMany({ where: { runId }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.$transaction([
        prisma.hypothesis.count({ where: { runId } }),
        prisma.evidence.count({ where: { runId } }),
        prisma.sourceDocument.count({ where: { runId } }),
        prisma.agentTask.count({ where: { runId } }),
        prisma.agentEvent.count({ where: { runId } }),
      ]),
      listSkillsForUser(userId, { projectId: run.projectId }),
      listRunSkills(runId),
    ]);

  const latestEloByHyp: Record<string, { eloScore: number; rank: number }> = {};
  for (const r of rankings) {
    if (!latestEloByHyp[r.hypothesisId]) {
      latestEloByHyp[r.hypothesisId] = { eloScore: r.eloScore, rank: r.rank };
    }
  }
  const hypothesesWithRanking = hypotheses.map((h) => ({
    ...h,
    latestRanking: latestEloByHyp[h.id] ?? null,
  }));

  return (
    <RunView
      initialRun={JSON.parse(JSON.stringify(run))}
      initialSession={JSON.parse(JSON.stringify(agentSession))}
      initialCounts={{
        hypotheses: counts[0],
        evidence: counts[1],
        sources: counts[2],
        tasks: counts[3],
        events: counts[4],
      }}
      initialLatestAssessment={JSON.parse(JSON.stringify(latestAssessment))}
      initialEvents={JSON.parse(JSON.stringify(events))}
      initialHypotheses={JSON.parse(JSON.stringify(hypothesesWithRanking))}
      initialEvidence={JSON.parse(JSON.stringify(evidence))}
      initialSources={JSON.parse(JSON.stringify(sources))}
      initialTasks={JSON.parse(JSON.stringify(tasks))}
      initialReport={report ? JSON.parse(JSON.stringify(report)) : null}
      initialSkills={JSON.parse(JSON.stringify(allSkills))}
      initialRunSkills={JSON.parse(JSON.stringify(runSkills))}
      modelLabel={`anthropic · ${env().ANTHROPIC_MODEL}`}
    />
  );
}
