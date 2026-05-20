import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const ELO_INITIAL = 1000;
const K_FACTOR = 32;
const MAX_HYPOTHESES_FOR_TOURNEY = 12;
const MAX_ROUNDS = 18;

const JudgeSchema = z.object({
  argumentA: z.string().min(20),
  argumentB: z.string().min(20),
  verdict: z.string().min(10),
  winner: z.enum(["A", "B", "tie"]),
  rationale: z.string().min(10),
});

interface EloMap {
  [hypothesisId: string]: number;
}

/**
 * RankingAgent
 *
 * Runs a bounded pairwise debate tournament:
 *  - Pulls top-N hypotheses (by current overallScore) up to MAX_HYPOTHESES_FOR_TOURNEY.
 *  - Generates a Swiss-style pairing list of MAX_ROUNDS pairs.
 *  - For each pair, asks the judge model to produce argumentA, argumentB, verdict, winner.
 *  - Updates Elo scores and writes DebateRound rows.
 *  - At the end, writes Ranking rows in descending Elo order.
 */
export async function runRanking(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ debates: number; ranked: number }>> {
  const candidates = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id, status: { in: ["clustered", "generated", "evolved", "selected"] } },
    orderBy: { overallScore: "desc" },
    take: MAX_HYPOTHESES_FOR_TOURNEY,
  });
  if (candidates.length < 2) {
    return { output: { debates: 0, ranked: 0 }, summary: "Not enough hypotheses to rank." };
  }

  // Initial Elo: each hypothesis starts at ELO_INITIAL, OR reuse latest Ranking row Elo if exists.
  const elo: EloMap = {};
  for (const h of candidates) elo[h.id] = ELO_INITIAL;
  const latestRankings = await prisma.ranking.findMany({
    where: { runId: ctx.run.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const seen = new Set<string>();
  for (const r of latestRankings) {
    if (!seen.has(r.hypothesisId) && elo[r.hypothesisId] != null) {
      elo[r.hypothesisId] = r.eloScore;
      seen.add(r.hypothesisId);
    }
  }

  const pairs = generatePairings(
    candidates.map((c) => c.id),
    Math.min(MAX_ROUNDS, Math.max(3, candidates.length)),
  );

  const provider = ModelRouter.for("debateJudge");
  let debates = 0;
  for (const [aId, bId] of pairs) {
    const a = candidates.find((c) => c.id === aId)!;
    const b = candidates.find((c) => c.id === bId)!;
    try {
      const { data } = await safeGenerateJSON({
        provider,
        schema: JudgeSchema,
        systemPrompt: JUDGE_SYSTEM,
        userPrompt: buildDebatePrompt(ctx, a, b),
        maxTokens: 1500,
        temperature: 0.3,
        ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "RankingAgent" },
      });
      const winnerId = data.winner === "A" ? a.id : data.winner === "B" ? b.id : null;
      const scoreA = data.winner === "A" ? 1 : data.winner === "B" ? 0 : 0.5;
      const eA = elo[a.id];
      const eB = elo[b.id];
      const expectedA = 1 / (1 + Math.pow(10, (eB - eA) / 400));
      const expectedB = 1 - expectedA;
      const deltaA = K_FACTOR * (scoreA - expectedA);
      const deltaB = K_FACTOR * (1 - scoreA - expectedB);
      elo[a.id] = eA + deltaA;
      elo[b.id] = eB + deltaB;

      await prisma.debateRound.create({
        data: {
          runId: ctx.run.id,
          sessionId: ctx.session.id,
          hypothesisAId: a.id,
          hypothesisBId: b.id,
          judgeAgent: "RankingAgent",
          argumentA: data.argumentA.slice(0, 3000),
          argumentB: data.argumentB.slice(0, 3000),
          verdict: `${data.verdict}\n\nRationale: ${data.rationale}`.slice(0, 4000),
          winnerHypothesisId: winnerId,
          scoreDeltaA: deltaA,
          scoreDeltaB: deltaB,
        },
      });
      debates++;
      await emitEvent({
        runId: ctx.run.id,
        sessionId: ctx.session.id,
        taskId: ctx.task.id,
        agentName: "RankingAgent",
        eventType: "debate_round",
        title: `Debate: ${a.id.slice(0, 6)} vs ${b.id.slice(0, 6)} → ${data.winner}`,
        message: data.verdict.slice(0, 400),
      });
    } catch (err) {
      // Skip this pair, continue tournament.
      await emitEvent({
        runId: ctx.run.id,
        sessionId: ctx.session.id,
        taskId: ctx.task.id,
        agentName: "RankingAgent",
        eventType: "error",
        title: "Debate round failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Persist final rankings.
  const sorted = [...candidates].sort((x, y) => elo[y.id] - elo[x.id]);
  await prisma.ranking.createMany({
    data: sorted.map((h, i) => ({
      runId: ctx.run.id,
      hypothesisId: h.id,
      eloScore: elo[h.id],
      rank: i + 1,
      rationale: `Elo after ${debates} round(s); started 1000.`,
    })),
  });
  // Mark top-half as debated.
  const topCount = Math.max(3, Math.ceil(sorted.length / 2));
  await prisma.hypothesis.updateMany({
    where: { id: { in: sorted.slice(0, topCount).map((h) => h.id) } },
    data: { status: "debated" },
  });

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "decision",
    title: `Ranking after ${debates} debate rounds`,
    content: sorted
      .slice(0, 8)
      .map((h, i) => `${i + 1}. ${h.title.slice(0, 200)} (Elo ${elo[h.id].toFixed(0)})`)
      .join("\n"),
    importanceScore: 0.8,
  });

  await emitEvent({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    taskId: ctx.task.id,
    agentName: "RankingAgent",
    eventType: "ranking_updated",
    title: `Ranking updated (top: ${sorted[0]?.title.slice(0, 80)})`,
    message: `Debates: ${debates}. Top Elo: ${elo[sorted[0]?.id]?.toFixed(0)}.`,
  });

  return {
    output: { debates, ranked: sorted.length },
    summary: `Ranking complete: ${debates} debate rounds, ${sorted.length} hypotheses ranked.`,
  };
}

/**
 * Generate Swiss-ish pairings: cycle adjacent pairs by current order, with shuffling.
 * Produces up to `maxRounds` unique pairs (a,b) where a !== b.
 */
function generatePairings(ids: string[], maxRounds: number): [string, string][] {
  const out = new Set<string>();
  const pairs: [string, string][] = [];
  const n = ids.length;
  // Adjacent pairs first
  for (let i = 0; i + 1 < n && pairs.length < maxRounds; i += 1) {
    const k = key(ids[i], ids[i + 1]);
    if (!out.has(k)) {
      out.add(k);
      pairs.push([ids[i], ids[i + 1]]);
    }
  }
  // Cross pairs (top vs middle, top vs bottom, etc.)
  if (n >= 4) {
    const middle = Math.floor(n / 2);
    for (let i = 0; i < middle && pairs.length < maxRounds; i++) {
      const j = middle + i;
      if (j >= n) break;
      const k = key(ids[i], ids[j]);
      if (!out.has(k)) {
        out.add(k);
        pairs.push([ids[i], ids[j]]);
      }
    }
  }
  // Stride pairs
  for (let i = 0; i < n && pairs.length < maxRounds; i++) {
    for (let stride = 2; stride <= 4 && pairs.length < maxRounds; stride++) {
      const j = (i + stride) % n;
      if (j === i) continue;
      const k = key(ids[i], ids[j]);
      if (!out.has(k)) {
        out.add(k);
        pairs.push([ids[i], ids[j]]);
      }
    }
  }
  return pairs;
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const JUDGE_SYSTEM = `You are the ResearchOS RankingAgent acting as a careful, neutral debate judge.
For each pair of hypotheses, write a steel-man argument for A, a steel-man argument for B, then a verdict
focused on: scientific specificity, evidence support so far, mechanistic plausibility, novelty, and
falsifiability. Choose a winner (A, B, or tie). Return strict JSON.`;

function buildDebatePrompt(ctx: AgentInvocation, a: any, b: any): string {
  return [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    "",
    `Hypothesis A (id=${a.id}, score=${a.overallScore.toFixed(2)}):`,
    `  title: ${a.title}`,
    `  summary: ${a.summary.slice(0, 400)}`,
    `  mechanism: ${a.mechanism.slice(0, 400)}`,
    `  testability: ${a.testability.slice(0, 300)}`,
    "",
    `Hypothesis B (id=${b.id}, score=${b.overallScore.toFixed(2)}):`,
    `  title: ${b.title}`,
    `  summary: ${b.summary.slice(0, 400)}`,
    `  mechanism: ${b.mechanism.slice(0, 400)}`,
    `  testability: ${b.testability.slice(0, 300)}`,
    "",
    "Schema:",
    `{ "argumentA": "...", "argumentB": "...", "verdict": "...", "winner": "A"|"B"|"tie", "rationale": "..." }`,
    "Return ONLY the JSON object.",
  ].join("\n");
}
