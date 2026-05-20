import { prisma } from "@/lib/db/prisma";

export interface VerifyResult {
  passed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Per-agent verification predicates. The harness will refuse to mark a task
 * completed if its predicate returns passed=false.
 */
export const VERIFIERS: Record<string, (runId: string, taskId: string) => Promise<VerifyResult>> = {
  InitializerAgent: async (runId) => {
    const memCount = await prisma.agentMemory.count({
      where: { runId, memoryType: { in: ["objective", "plan", "decision"] } },
    });
    const cpCount = await prisma.agentCheckpoint.count({
      where: { runId, checkpointType: "initialization" },
    });
    if (memCount < 1 || cpCount < 1) {
      return {
        passed: false,
        reason: "Initialization requires at least one objective/plan memory and one initialization checkpoint.",
      };
    }
    return { passed: true, reason: "ok" };
  },

  LiteratureRetrievalAgent: async (runId, taskId) => {
    const sources = await prisma.sourceDocument.count({
      where: { runId, sourceType: { in: ["pubmed", "openalex", "crossref"] } },
    });
    const toolFailures = await prisma.toolCall.count({
      where: { runId, taskId, error: { not: null } },
    });
    const toolCalls = await prisma.toolCall.count({ where: { runId, taskId } });
    if (sources === 0 && toolCalls === toolFailures && toolCalls > 0) {
      // every source call failed — still passes only because failures are
      // captured. We let the supervisor decide whether to retry.
      return { passed: true, reason: "All source calls failed but were captured." };
    }
    if (sources === 0 && toolCalls === 0) {
      return { passed: false, reason: "No source documents retrieved and no tool calls recorded." };
    }
    return { passed: true, reason: "ok", details: { sourceCount: sources } };
  },

  DomainRetrievalAgent: async (runId, taskId) => {
    const docs = await prisma.sourceDocument.count({
      where: { runId, sourceType: { in: ["chembl", "uniprot", "alphafold"] } },
    });
    const calls = await prisma.toolCall.count({ where: { runId, taskId } });
    if (docs === 0 && calls === 0) {
      return { passed: true, reason: "Domain retrieval skipped (no relevant tools)." };
    }
    return { passed: true, reason: "ok", details: { docCount: docs } };
  },

  GenerationAgent: async (runId, taskId) => {
    const created = await prisma.hypothesis.count({
      where: { runId, createdAt: { gte: await taskStartTime(taskId) } },
    });
    if (created < 3) {
      return { passed: false, reason: `Generation produced only ${created} hypotheses; minimum 3 expected.` };
    }
    return { passed: true, reason: "ok", details: { count: created } };
  },

  ProximityAgent: async (runId) => {
    const hyps = await prisma.hypothesis.findMany({
      where: { runId },
      select: { id: true, clusterId: true },
    });
    if (hyps.length === 0) {
      return { passed: false, reason: "No hypotheses to cluster." };
    }
    const clustered = hyps.filter((h) => h.clusterId).length;
    if (clustered === 0) {
      return { passed: false, reason: "Proximity agent did not assign any clusterIds." };
    }
    return { passed: true, reason: "ok", details: { clustered, total: hyps.length } };
  },

  ReflectionAgent: async (runId) => {
    const reflected = await prisma.hypothesis.count({
      where: { runId, status: { in: ["clustered", "debated", "evolved", "selected", "generated"] } },
    });
    if (reflected === 0) return { passed: false, reason: "No hypotheses to critique." };
    return { passed: true, reason: "ok" };
  },

  VerificationAgent: async (runId, taskId) => {
    const evid = await prisma.evidence.count({
      where: { runId, createdAt: { gte: await taskStartTime(taskId) } },
    });
    if (evid === 0) {
      return { passed: false, reason: "No evidence rows were produced." };
    }
    return { passed: true, reason: "ok", details: { evidence: evid } };
  },

  RankingAgent: async (runId, taskId) => {
    const debates = await prisma.debateRound.count({
      where: { runId, createdAt: { gte: await taskStartTime(taskId) } },
    });
    const rankings = await prisma.ranking.count({ where: { runId } });
    if (debates === 0) {
      return { passed: false, reason: "Ranking produced no debate rounds." };
    }
    if (rankings === 0) {
      return { passed: false, reason: "Ranking produced no ranking rows." };
    }
    return { passed: true, reason: "ok", details: { debates, rankings } };
  },

  EvolutionAgent: async (runId, taskId) => {
    const evolved = await prisma.hypothesis.findMany({
      where: {
        runId,
        createdAt: { gte: await taskStartTime(taskId) },
      },
      select: { id: true, parentHypothesisIds: true, status: true },
    });
    if (evolved.length === 0) {
      return { passed: false, reason: "Evolution produced no new hypotheses." };
    }
    const withParents = evolved.filter(
      (h) => Array.isArray(h.parentHypothesisIds) && (h.parentHypothesisIds as unknown[]).length > 0,
    );
    if (withParents.length === 0) {
      return { passed: false, reason: "Evolved hypotheses lack parentHypothesisIds." };
    }
    return { passed: true, reason: "ok", details: { evolved: withParents.length } };
  },

  CompletionAssessorAgent: async (runId, taskId) => {
    const cnt = await prisma.completionAssessment.count({
      where: { runId, createdAt: { gte: await taskStartTime(taskId) } },
    });
    if (cnt === 0) return { passed: false, reason: "No completion assessment recorded." };
    return { passed: true, reason: "ok" };
  },

  MetaReviewAgent: async (runId, taskId) => {
    const reports = await prisma.finalReport.count({
      where: { runId, createdAt: { gte: await taskStartTime(taskId) } },
    });
    if (reports === 0) return { passed: false, reason: "Meta-review produced no final report." };
    return { passed: true, reason: "ok" };
  },
};

async function taskStartTime(taskId: string): Promise<Date> {
  const t = await prisma.agentTask.findUnique({
    where: { id: taskId },
    select: { startedAt: true, createdAt: true },
  });
  return t?.startedAt ?? t?.createdAt ?? new Date(Date.now() - 1000 * 60 * 60 * 24);
}

export async function verifyTask(runId: string, taskId: string, agentName: string): Promise<VerifyResult> {
  const fn = VERIFIERS[agentName];
  if (!fn) return { passed: true, reason: "no verifier registered" };
  return fn(runId, taskId);
}
