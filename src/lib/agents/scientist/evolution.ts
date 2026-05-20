import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { runAgentJson } from "@/lib/agents/core/prompt";
import { writeMemory } from "@/lib/agents/core/memory";
import type { AgentInvocation, AgentExecResult } from "./context";

const EvolveSchema = z.object({
  evolved: z.array(
    z.object({
      parentIds: z.array(z.string()).min(1),
      title: z.string().min(8),
      summary: z.string().min(20),
      mechanism: z.string().min(20),
      noveltyRationale: z.string().min(20),
      testability: z.string().min(20),
      proposedExperimentHighLevel: z.string().min(20),
      improvements: z.array(z.string()).min(1),
      riskLevel: z.enum(["low", "medium", "high"]).default("low"),
      scores: z.object({
        novelty: z.number().min(0).max(1),
        feasibility: z.number().min(0).max(1),
        impact: z.number().min(0).max(1),
        evidence: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      }),
    }),
  ).min(1),
});

export async function runEvolution(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ evolvedCount: number; ids: string[] }>> {
  const remaining = await remainingBudget(ctx.run.id, ctx.run.maxHypotheses);
  if (remaining <= 0) {
    return {
      output: { evolvedCount: 0, ids: [] },
      summary: "Hypothesis budget exhausted; cannot evolve new ones.",
    };
  }
  const top = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id, status: { in: ["debated", "clustered", "evolved", "selected"] } },
    orderBy: { overallScore: "desc" },
    take: 6,
  });
  if (top.length === 0) {
    return { output: { evolvedCount: 0, ids: [] }, summary: "No hypotheses available to evolve." };
  }

  const provider = ModelRouter.for("hypothesisEvolution");
  const userPrompt = [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    "",
    "Top-ranked hypotheses to evolve:",
    top
      .map(
        (h) =>
          `id=${h.id} score=${h.overallScore.toFixed(2)}\n  title: ${h.title}\n  summary: ${h.summary.slice(0, 360)}\n  mechanism: ${h.mechanism.slice(0, 360)}\n  testability: ${h.testability.slice(0, 240)}`,
      )
      .join("\n"),
    "",
    `Produce up to ${Math.min(4, remaining)} evolved hypotheses. Improve mechanism specificity, evidence grounding,`,
    `and testability. Combine complementary hypotheses where useful. Preserve parentIds.`,
    "Do not merely rephrase — every evolved hypothesis must be meaningfully improved.",
    "",
    "Schema:",
    `{
  "evolved": [
    {
      "parentIds": ["hypId1", "hypId2"],
      "title": "...",
      "summary": "...",
      "mechanism": "...",
      "noveltyRationale": "...",
      "testability": "...",
      "proposedExperimentHighLevel": "...",
      "improvements": ["what got better and why"],
      "riskLevel": "low" | "medium" | "high",
      "scores": { "novelty": 0-1, "feasibility": 0-1, "impact": 0-1, "evidence": 0-1, "confidence": 0-1 }
    }
  ]
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await runAgentJson({
    provider,
    schema: EvolveSchema,
    systemPrompt:
      "You are the ResearchOS EvolutionAgent. You refine and combine top hypotheses to be more specific, grounded, and testable.",
    userPrompt,
    maxTokens: 3000,
    temperature: 0.4,
    signal: ctx.signal,
    runId: ctx.run.id,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "EvolutionAgent" },
  });

  const validIds = new Set(top.map((t) => t.id));
  const ids: string[] = [];
  for (const e of data.evolved.slice(0, remaining)) {
    const parents = e.parentIds.filter((pid) => validIds.has(pid));
    if (parents.length === 0) continue;
    const overall =
      0.25 * e.scores.novelty +
      0.2 * e.scores.feasibility +
      0.25 * e.scores.impact +
      0.15 * e.scores.evidence +
      0.15 * e.scores.confidence;
    const row = await prisma.hypothesis.create({
      data: {
        runId: ctx.run.id,
        title: e.title.slice(0, 280),
        summary: e.summary,
        mechanism: e.mechanism,
        noveltyRationale: e.noveltyRationale,
        testability: e.testability,
        proposedExperimentHighLevel: e.proposedExperimentHighLevel,
        riskLevel: e.riskLevel,
        confidenceScore: e.scores.confidence,
        noveltyScore: e.scores.novelty,
        feasibilityScore: e.scores.feasibility,
        impactScore: e.scores.impact,
        evidenceScore: e.scores.evidence,
        overallScore: overall,
        status: "evolved",
        parentHypothesisIds: parents as unknown as object,
        createdByAgent: "EvolutionAgent",
      },
    });
    ids.push(row.id);
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "decision",
    title: `Evolved ${ids.length} hypotheses`,
    content: data.evolved
      .slice(0, 4)
      .map((e, i) => `${i + 1}. ${e.title}\n   improvements: ${e.improvements.join("; ")}`)
      .join("\n"),
    importanceScore: 0.75,
  });

  return {
    output: { evolvedCount: ids.length, ids },
    summary: `Evolved ${ids.length} hypotheses with explicit improvements.`,
  };
}

async function remainingBudget(runId: string, max: number): Promise<number> {
  const c = await prisma.hypothesis.count({ where: { runId } });
  return Math.max(0, max - c);
}
