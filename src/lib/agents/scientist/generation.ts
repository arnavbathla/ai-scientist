import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory, buildContextBlock } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const HypothesisSchema = z.object({
  title: z.string().min(8).max(280),
  summary: z.string().min(30),
  mechanism: z.string().min(30),
  noveltyRationale: z.string().min(20),
  testability: z.string().min(20),
  proposedExperimentHighLevel: z.string().min(20),
  evidenceNeeded: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  initialScores: z
    .object({
      novelty: z.number().min(0).max(1).default(0.5),
      feasibility: z.number().min(0).max(1).default(0.5),
      impact: z.number().min(0).max(1).default(0.5),
      evidence: z.number().min(0).max(1).default(0.3),
      confidence: z.number().min(0).max(1).default(0.5),
    })
    .default({ novelty: 0.5, feasibility: 0.5, impact: 0.5, evidence: 0.3, confidence: 0.5 }),
});

const GenerationSchema = z.object({
  hypotheses: z.array(HypothesisSchema).min(3).max(8),
});

type _GenerationOutput = z.infer<typeof GenerationSchema>;

export async function runGeneration(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ created: number; ids: string[] }>> {
  const remaining = await remainingHypothesisBudget(ctx.run.id, ctx.run.maxHypotheses);
  if (remaining <= 0) {
    return {
      output: { created: 0, ids: [] },
      summary: `Hypothesis budget exhausted (${ctx.run.maxHypotheses}).`,
    };
  }

  const provider = ModelRouter.for("hypothesisGeneration");
  const sources = await prisma.sourceDocument.findMany({
    where: { runId: ctx.run.id },
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  const memoryBlock = await buildContextBlock(ctx.run.id, 4000);
  const existing = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id },
    select: { title: true, summary: true },
    take: 20,
  });

  const userPrompt = [
    `Research goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    `Domain: ${ctx.run.domain ?? "unspecified"}`,
    `Constraints: ${JSON.stringify(ctx.run.constraints ?? {})}`,
    "",
    "Durable context (memory):",
    memoryBlock || "(empty)",
    "",
    `Source corpus (${sources.length} of ${await prisma.sourceDocument.count({
      where: { runId: ctx.run.id },
    })} total):`,
    sources
      .slice(0, 12)
      .map(
        (s, i) =>
          `[S${i + 1}] (${s.sourceType}) ${s.title}${s.year ? ` (${s.year})` : ""}${
            s.doi ? ` doi:${s.doi}` : ""
          }${s.pmid ? ` pmid:${s.pmid}` : ""}\n  abstract: ${(s.abstract ?? "").slice(0, 800)}`,
      )
      .join("\n"),
    "",
    existing.length > 0
      ? `Existing hypotheses to AVOID duplicating:\n${existing.map((e, i) => `  ${i + 1}. ${e.title}`).join("\n")}\n`
      : "",
    `Produce between 3 and ${Math.min(8, remaining)} new, distinct hypotheses.`,
    "",
    "Schema:",
    `{
  "hypotheses": [
    {
      "title": "concise hypothesis title",
      "summary": "1-2 sentence summary",
      "mechanism": "molecular / cellular / systems-level mechanism explanation",
      "noveltyRationale": "why this is non-obvious vs. existing literature",
      "testability": "how this could be falsified in principle, high level",
      "proposedExperimentHighLevel": "research direction or category of experiment (NOT a protocol)",
      "evidenceNeeded": ["data type 1", "data type 2"],
      "riskLevel": "low" | "medium" | "high",
      "initialScores": { "novelty": 0-1, "feasibility": 0-1, "impact": 0-1, "evidence": 0-1, "confidence": 0-1 }
    }
  ]
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await safeGenerateJSON({
    provider,
    schema: GenerationSchema,
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 3000,
    temperature: 0.6,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "GenerationAgent" },
  });

  const created: string[] = [];
  for (const h of data.hypotheses.slice(0, remaining)) {
    const row = await prisma.hypothesis.create({
      data: {
        runId: ctx.run.id,
        title: h.title.slice(0, 280),
        summary: h.summary,
        mechanism: h.mechanism,
        noveltyRationale: h.noveltyRationale,
        testability: h.testability,
        proposedExperimentHighLevel: h.proposedExperimentHighLevel,
        riskLevel: h.riskLevel,
        confidenceScore: h.initialScores.confidence,
        noveltyScore: h.initialScores.novelty,
        feasibilityScore: h.initialScores.feasibility,
        impactScore: h.initialScores.impact,
        evidenceScore: h.initialScores.evidence,
        overallScore: combinedScore(h.initialScores),
        status: "generated",
        createdByAgent: "GenerationAgent",
      },
    });
    created.push(row.id);
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "GenerationAgent",
      eventType: "hypothesis_created",
      title: `New hypothesis: ${h.title}`,
      message: h.summary,
      payload: { hypothesisId: row.id, overallScore: row.overallScore },
    });
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "hypothesis_summary",
    title: `Generated ${created.length} hypotheses`,
    content: data.hypotheses
      .slice(0, 6)
      .map((h, i) => `${i + 1}. ${h.title} — ${h.summary}`)
      .join("\n"),
    importanceScore: 0.7,
  });

  return {
    output: { created: created.length, ids: created },
    summary: `Generated ${created.length} new hypotheses.`,
  };
}

async function remainingHypothesisBudget(runId: string, max: number): Promise<number> {
  const existing = await prisma.hypothesis.count({ where: { runId } });
  return Math.max(0, max - existing);
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

const SYSTEM = `You are the ResearchOS GenerationAgent. You generate diverse, mechanism-grounded, testable
research hypotheses that address the user's goal.

Rules:
- Each hypothesis must have a specific mechanism, not a vague speculation.
- Each hypothesis must be in-principle falsifiable.
- Cite (in narrative form) which source corpus items inspired the idea by referring to "[S1]" etc.
- Do NOT propose operational lab protocols. Stay at the research-strategy / high-level-experiment level.
- Avoid duplicating existing hypotheses.

Return strict JSON.`;
