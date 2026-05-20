import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { runAgentJson } from "@/lib/agents/core/prompt";
import { writeMemory } from "@/lib/agents/core/memory";
import type { AgentInvocation, AgentExecResult } from "./context";

const CritiqueSchema = z.object({
  critiques: z
    .array(
      z.object({
        hypothesisId: z.string(),
        strengths: z.array(z.string()).default([]),
        weaknesses: z.array(z.string()).default([]),
        logicalGaps: z.array(z.string()).default([]),
        unsupportedAssumptions: z.array(z.string()).default([]),
        scores: z.object({
          novelty: z.number().min(0).max(1),
          feasibility: z.number().min(0).max(1),
          impact: z.number().min(0).max(1),
          evidence: z.number().min(0).max(1),
          confidence: z.number().min(0).max(1),
        }),
        recommendation: z.enum(["keep", "revise", "reject", "needs_more_evidence"]),
      }),
    )
    .min(1),
  retrievalNeeded: z.array(z.string()).optional().default([]),
});

export async function runReflection(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ critiqued: number; revisions: number }>> {
  const hyps = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id, status: { in: ["generated", "clustered", "evolved"] } },
    take: 30,
    orderBy: { overallScore: "desc" },
  });
  if (hyps.length === 0) {
    return { output: { critiqued: 0, revisions: 0 }, summary: "No hypotheses to reflect on." };
  }

  const provider = ModelRouter.for("hypothesisCritique");
  const sources = await prisma.sourceDocument.findMany({
    where: { runId: ctx.run.id },
    take: 8,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, abstract: true, year: true, doi: true, pmid: true, sourceType: true },
  });

  const userPrompt = [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    "",
    "Hypotheses to critique:",
    hyps
      .map(
        (h) =>
          `id=${h.id} risk=${h.riskLevel} score=${h.overallScore.toFixed(2)}\n  title: ${h.title}\n  summary: ${h.summary.slice(0, 360)}\n  mechanism: ${h.mechanism.slice(0, 360)}`,
      )
      .join("\n"),
    "",
    `Source corpus excerpts (${sources.length}):`,
    sources
      .map(
        (s, i) =>
          `[S${i + 1}] (${s.sourceType}) ${s.title}\n  ${(s.abstract ?? "").slice(0, 600)}`,
      )
      .join("\n"),
    "",
    "Schema:",
    `{
  "critiques": [
    {
      "hypothesisId": "...",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "logicalGaps": ["..."],
      "unsupportedAssumptions": ["..."],
      "scores": { "novelty": 0-1, "feasibility": 0-1, "impact": 0-1, "evidence": 0-1, "confidence": 0-1 },
      "recommendation": "keep" | "revise" | "reject" | "needs_more_evidence"
    }
  ],
  "retrievalNeeded": ["topics that would improve evidence"]
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await runAgentJson({
    provider,
    schema: CritiqueSchema,
    systemPrompt: "You are the ResearchOS ReflectionAgent. Critique each hypothesis rigorously and update scores.",
    userPrompt,
    maxTokens: 3000,
    temperature: 0.2,
    signal: ctx.signal,
    runId: ctx.run.id,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "ReflectionAgent" },
  });

  let revisions = 0;
  const validIds = new Set(hyps.map((h) => h.id));
  for (const c of data.critiques) {
    if (!validIds.has(c.hypothesisId)) continue;
    const overall = combinedScore(c.scores);
    await prisma.hypothesis.update({
      where: { id: c.hypothesisId },
      data: {
        noveltyScore: c.scores.novelty,
        feasibilityScore: c.scores.feasibility,
        impactScore: c.scores.impact,
        evidenceScore: c.scores.evidence,
        confidenceScore: c.scores.confidence,
        overallScore: overall,
        status: c.recommendation === "reject" ? "rejected" : "clustered",
      },
    });
    revisions++;
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "critique_summary",
    title: `Critiqued ${data.critiques.length} hypotheses`,
    content: data.critiques
      .slice(0, 8)
      .map((c) => `- ${c.hypothesisId.slice(0, 8)}: ${c.recommendation} (impact=${c.scores.impact.toFixed(2)}, evidence=${c.scores.evidence.toFixed(2)})`)
      .join("\n"),
    payload: { retrievalNeeded: data.retrievalNeeded },
    importanceScore: 0.7,
  });

  const recommendations =
    data.retrievalNeeded.length > 0
      ? [
          {
            kind: "phase" as const,
            target: "literature_retrieval",
            rationale: `Reflection requested more evidence on: ${data.retrievalNeeded.slice(0, 3).join("; ")}`,
            fromAgent: "ReflectionAgent",
          },
        ]
      : [];

  return {
    output: { critiqued: data.critiques.length, revisions },
    summary: `Critiqued ${data.critiques.length} hypotheses; updated ${revisions}.`,
    recommendations,
  };
}

function combinedScore(s: {
  novelty: number;
  feasibility: number;
  impact: number;
  evidence: number;
  confidence: number;
}): number {
  return (
    0.25 * s.novelty + 0.2 * s.feasibility + 0.25 * s.impact + 0.15 * s.evidence + 0.15 * s.confidence
  );
}
