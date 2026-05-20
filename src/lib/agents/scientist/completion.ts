import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const CompletionSchema = z.object({
  isComplete: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  missingWork: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  recommendedNextTasks: z
    .array(
      z.object({
        agent: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  rationale: z.string().min(10),
});

export type CompletionOutput = z.infer<typeof CompletionSchema>;

/**
 * CompletionAssessorAgent
 *
 * Returns strict JSON with isComplete + confidence + missing-work + next-tasks.
 * The supervisor gates final-report production on isComplete=true plus the
 * deterministic checklist enforced here (min 3 hypotheses, evidence coverage,
 * safety clear, contradictions addressed).
 */
export async function runCompletionAssessment(
  ctx: AgentInvocation,
): Promise<AgentExecResult<CompletionOutput>> {
  const [
    hyps,
    topHyps,
    evidenceCount,
    contradictionsCount,
    rankingCount,
    sourceCount,
    safetyBlocked,
    safetyClearOrLow,
    completionCriteriaMemory,
    evolutionCount,
    debateCount,
  ] = await Promise.all([
    prisma.hypothesis.findMany({
      where: { runId: ctx.run.id, status: { not: "rejected" } },
      orderBy: { overallScore: "desc" },
      take: 8,
    }),
    prisma.hypothesis.findMany({
      where: { runId: ctx.run.id, status: { in: ["debated", "evolved", "selected"] } },
      orderBy: { overallScore: "desc" },
      take: 5,
    }),
    prisma.evidence.count({ where: { runId: ctx.run.id } }),
    prisma.evidence.count({ where: { runId: ctx.run.id, supportType: "contradicts" } }),
    prisma.ranking.count({ where: { runId: ctx.run.id } }),
    prisma.sourceDocument.count({ where: { runId: ctx.run.id } }),
    prisma.safetyFlag.findFirst({ where: { runId: ctx.run.id, severity: "blocked" } }),
    prisma.safetyFlag.count({ where: { runId: ctx.run.id, severity: { in: ["low", "medium"] } } }),
    prisma.agentMemory.findFirst({
      where: { runId: ctx.run.id, memoryType: "decision", title: "Completion criteria" },
    }),
    prisma.agentTask.count({
      where: { runId: ctx.run.id, agentName: "EvolutionAgent", status: "completed" },
    }),
    prisma.debateRound.count({ where: { runId: ctx.run.id } }),
  ]);

  // Hard deterministic floor: even if the model says complete, we override on these.
  const deterministicBlockers: string[] = [];
  if (safetyBlocked) {
    deterministicBlockers.push(`Safety flag (blocked) present: ${safetyBlocked.message.slice(0, 200)}`);
  }
  if (hyps.length < 3) deterministicBlockers.push(`Only ${hyps.length} candidate hypotheses; need >= 3.`);
  if (topHyps.length === 0)
    deterministicBlockers.push("No hypotheses have reached debated/evolved/selected status.");
  if (evidenceCount === 0 && sourceCount > 0)
    deterministicBlockers.push("No evidence rows linking hypotheses to sources.");
  if (rankingCount === 0) deterministicBlockers.push("No ranking rows.");
  if (evolutionCount === 0) deterministicBlockers.push("No evolution pass completed.");

  const provider = ModelRouter.for("completionAssessment");
  const userPrompt = [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    `Domain: ${ctx.run.domain ?? "unspecified"}`,
    "",
    "Completion criteria (from initializer, if present):",
    completionCriteriaMemory?.content ?? "(none recorded — use default scientific checklist)",
    "",
    "Default checklist:",
    `- Research goal directly addressed`,
    `- Source corpus sufficient or limitations explicit`,
    `- Top hypotheses non-duplicative`,
    `- Top hypotheses have explicit mechanisms`,
    `- Top hypotheses have evidence support`,
    `- Contradictory evidence addressed`,
    `- Unsupported claims marked`,
    `- Safety review passed`,
    `- At least 3 final hypotheses`,
    `- Final recommendation will be clear`,
    `- Final report will include references, falsification criteria, safe next steps, limitations, open questions`,
    "",
    "Current state:",
    `- Sources stored: ${sourceCount}`,
    `- Hypotheses (non-rejected): ${hyps.length}`,
    `- Top (debated/evolved/selected): ${topHyps.length}`,
    `- Evidence rows: ${evidenceCount} (${contradictionsCount} contradictions)`,
    `- Debate rounds: ${debateCount}`,
    `- Ranking rows: ${rankingCount}`,
    `- Evolution passes completed: ${evolutionCount}`,
    `- Safety: blocked=${Boolean(safetyBlocked)}, low/medium flags=${safetyClearOrLow}`,
    "",
    "Top hypotheses (preview):",
    hyps
      .slice(0, 6)
      .map((h) => `  - ${h.title} (score=${h.overallScore.toFixed(2)}, status=${h.status})`)
      .join("\n"),
    "",
    "Schema:",
    `{
  "isComplete": true | false,
  "confidenceScore": 0-1,
  "missingWork": ["..."],
  "blockers": ["..."],
  "recommendedNextTasks": [{ "agent": "LiteratureRetrievalAgent" | "GenerationAgent" | "VerificationAgent" | "RankingAgent" | "EvolutionAgent" | "ReflectionAgent" | "DomainRetrievalAgent" | "ProximityAgent", "reason": "..." }],
  "rationale": "..."
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await safeGenerateJSON({
    provider,
    schema: CompletionSchema,
    systemPrompt:
      "You are the ResearchOS CompletionAssessorAgent. You decide whether the research run satisfies its goal AND its checklist.",
    userPrompt,
    maxTokens: 1500,
    temperature: 0.1,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "CompletionAssessorAgent" },
  });

  // Deterministic override
  let isComplete = data.isComplete;
  const blockers = [...new Set([...(data.blockers ?? []), ...deterministicBlockers])];
  if (deterministicBlockers.length > 0) isComplete = false;

  const finalData: CompletionOutput = {
    ...data,
    isComplete,
    blockers,
  };

  await prisma.completionAssessment.create({
    data: {
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      isComplete: finalData.isComplete,
      confidenceScore: finalData.confidenceScore,
      missingWork: finalData.missingWork as any,
      blockers: finalData.blockers as any,
      recommendedNextTasks: finalData.recommendedNextTasks as any,
      rationale: finalData.rationale.slice(0, 4000),
    },
  });
  await prisma.researchRun.update({
    where: { id: ctx.run.id },
    data: { completionConfidence: finalData.confidenceScore },
  });

  await emitEvent({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    taskId: ctx.task.id,
    agentName: "CompletionAssessorAgent",
    eventType: "completion_assessed",
    title: finalData.isComplete ? "Completion: PASSED" : "Completion: incomplete",
    message: finalData.rationale.slice(0, 400),
    payload: finalData,
  });

  if (!finalData.isComplete) {
    await writeMemory({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      memoryType: "blocker",
      title: "Completion blockers",
      content: blockers.join("\n"),
      payload: { blockers, recommendedNextTasks: finalData.recommendedNextTasks },
      importanceScore: 0.8,
    });
  }

  return {
    output: finalData,
    summary: finalData.isComplete
      ? `Completion PASSED (conf=${finalData.confidenceScore.toFixed(2)}).`
      : `Completion INCOMPLETE: ${blockers.slice(0, 2).join(" | ")}`,
  };
}
