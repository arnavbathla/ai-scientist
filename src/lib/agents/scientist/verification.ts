import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const EvidenceSchema = z.object({
  perHypothesis: z.array(
    z.object({
      hypothesisId: z.string(),
      claims: z.array(
        z.object({
          claim: z.string().min(8),
          supportType: z.enum(["supports", "contradicts", "mixed", "background", "unsupported"]),
          sourceIndex: z.number().int().nullable(),
          quote: z.string().nullable(),
          explanation: z.string().min(8),
          confidence: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
});

export async function runVerification(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ evidenceCreated: number; contradictions: number; unsupported: number }>> {
  const hyps = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id, status: { in: ["clustered", "generated", "evolved", "selected", "debated"] } },
    orderBy: { overallScore: "desc" },
    take: 15,
  });
  if (hyps.length === 0) {
    return { output: { evidenceCreated: 0, contradictions: 0, unsupported: 0 }, summary: "No hypotheses to verify." };
  }
  const sources = await prisma.sourceDocument.findMany({
    where: { runId: ctx.run.id },
    take: 30,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      abstract: true,
      year: true,
      doi: true,
      pmid: true,
      sourceType: true,
    },
  });

  if (sources.length === 0) {
    return {
      output: { evidenceCreated: 0, contradictions: 0, unsupported: 0 },
      summary: "No sources available to verify against.",
      recommendations: [
        {
          kind: "phase",
          target: "literature_retrieval",
          rationale: "Verification needs source documents to compare against; corpus is empty.",
          fromAgent: "VerificationAgent",
        },
      ],
    };
  }

  const provider = ModelRouter.for("claimVerification");
  const userPrompt = [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    "",
    "Hypotheses:",
    hyps
      .map(
        (h) =>
          `id=${h.id}\n  title: ${h.title}\n  summary: ${h.summary.slice(0, 360)}\n  mechanism: ${h.mechanism.slice(0, 360)}`,
      )
      .join("\n"),
    "",
    `Source corpus (use sourceIndex starting at 0):`,
    sources
      .map(
        (s, i) =>
          `[${i}] (${s.sourceType}) ${s.title}\n  ${(s.abstract ?? "").slice(0, 700)}`,
      )
      .join("\n"),
    "",
    "For each hypothesis, identify 2-4 major claims it depends on. For each claim, find supporting,",
    "contradicting, mixed, or unsupported evidence from the source corpus, citing sourceIndex (or null if",
    "no source). Use short, exact-ish quotes when supportType is supports/contradicts/mixed.",
    "",
    "Schema:",
    `{
  "perHypothesis": [
    {
      "hypothesisId": "...",
      "claims": [
        {
          "claim": "claim text",
          "supportType": "supports" | "contradicts" | "mixed" | "background" | "unsupported",
          "sourceIndex": number | null,
          "quote": "short quote" | null,
          "explanation": "why this support type",
          "confidence": 0-1
        }
      ]
    }
  ]
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await safeGenerateJSON({
    provider,
    schema: EvidenceSchema,
    systemPrompt:
      "You are the ResearchOS VerificationAgent. Cross-check each claim against the corpus and produce labeled evidence rows.",
    userPrompt,
    maxTokens: 3500,
    temperature: 0.2,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "VerificationAgent" },
  });

  const validHyp = new Set(hyps.map((h) => h.id));
  let evidenceCount = 0;
  let contradictions = 0;
  let unsupported = 0;
  const hypEvidenceScores = new Map<string, { num: number; pos: number; neg: number }>();
  for (const block of data.perHypothesis) {
    if (!validHyp.has(block.hypothesisId)) continue;
    for (const claim of block.claims) {
      const sourceId =
        claim.sourceIndex != null && claim.sourceIndex >= 0 && claim.sourceIndex < sources.length
          ? sources[claim.sourceIndex].id
          : null;
      await prisma.evidence.create({
        data: {
          runId: ctx.run.id,
          hypothesisId: block.hypothesisId,
          sourceDocumentId: sourceId,
          claim: claim.claim.slice(0, 2000),
          supportType: claim.supportType,
          quote: claim.quote?.slice(0, 2000) ?? null,
          explanation: claim.explanation.slice(0, 2000),
          confidence: claim.confidence,
        },
      });
      evidenceCount++;
      if (claim.supportType === "contradicts") contradictions++;
      if (claim.supportType === "unsupported") unsupported++;
      const agg = hypEvidenceScores.get(block.hypothesisId) ?? { num: 0, pos: 0, neg: 0 };
      agg.num++;
      if (claim.supportType === "supports") agg.pos++;
      if (claim.supportType === "contradicts" || claim.supportType === "unsupported") agg.neg++;
      hypEvidenceScores.set(block.hypothesisId, agg);
    }
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "VerificationAgent",
      eventType: "evidence_created",
      title: `Evidence for ${block.hypothesisId.slice(0, 8)}`,
      message: `${block.claims.length} claim(s) labeled.`,
    });
  }

  // Update hypothesis evidence scores based on aggregate.
  for (const [hid, agg] of hypEvidenceScores) {
    if (agg.num === 0) continue;
    const evScore = Math.max(0, Math.min(1, (agg.pos - 0.5 * agg.neg) / agg.num + 0.5 - 0.5));
    const hyp = await prisma.hypothesis.findUnique({ where: { id: hid } });
    if (!hyp) continue;
    const overall =
      0.25 * hyp.noveltyScore +
      0.2 * hyp.feasibilityScore +
      0.25 * hyp.impactScore +
      0.15 * evScore +
      0.15 * hyp.confidenceScore;
    await prisma.hypothesis.update({
      where: { id: hid },
      data: { evidenceScore: evScore, overallScore: overall },
    });
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "finding",
    title: `Verification: ${evidenceCount} claim rows`,
    content: `Contradictions: ${contradictions}. Unsupported: ${unsupported}.`,
    importanceScore: 0.65,
  });

  return {
    output: { evidenceCreated: evidenceCount, contradictions, unsupported },
    summary: `Created ${evidenceCount} evidence rows (${contradictions} contradictions, ${unsupported} unsupported).`,
  };
}
