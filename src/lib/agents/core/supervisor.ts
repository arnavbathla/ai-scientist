import { prisma } from "@/lib/db/prisma";
import type { AgentSession, ResearchRun } from "@prisma/client";

/**
 * SupervisorAgent
 *
 * Decides the next task for an active session by reading durable state.
 *
 * The policy is phase-aware and gates progression on minimum coverage:
 *  - At least one literature retrieval pass must precede generation.
 *  - At least one generation pass must precede clustering/reflection.
 *  - Reflection, verification, ranking, and at least one evolution pass must
 *    precede the final report.
 *  - CompletionAssessor decides whether more passes are needed.
 *  - Any agent listed in `run.disabledAgents` is skipped entirely; if its
 *    gate is "required" the supervisor falls through to the next stage.
 *  - Recent user instructions (mid-run follow-up messages) are surfaced to
 *    every agent via memory, never modifying the supervisor decision tree.
 *
 * Recommendations from prior agents (stored as events with type "recommendation")
 * boost the priority of matching candidate actions but never bypass the gates.
 */

export type SupervisorAction =
  | { kind: "schedule"; agentName: SupervisorScientistName; phase: string; reason: string }
  | { kind: "assess_completion"; reason: string }
  | { kind: "produce_final_report"; reason: string }
  | { kind: "stop"; status: "completed"; reason: string };

export type SupervisorScientistName =
  | "InitializerAgent"
  | "LiteratureRetrievalAgent"
  | "DomainRetrievalAgent"
  | "GenerationAgent"
  | "ProximityAgent"
  | "ReflectionAgent"
  | "VerificationAgent"
  | "RankingAgent"
  | "EvolutionAgent"
  | "MetaReviewAgent";

export interface SupervisorState {
  iteration: number;
  initialized: boolean;
  retrievalPasses: number;
  domainRetrievalPasses: number;
  hypothesisCount: number;
  topHypothesisCount: number;
  reflectionPasses: number;
  verificationPasses: number;
  rankingPasses: number;
  evolutionPasses: number;
  finalReportExists: boolean;
  completionPassed: boolean;
  disabledAgents: Set<string>;
  recommendations: { kind: string; target: string; rationale: string; fromAgent: string }[];
}

export async function readSupervisorState(run: ResearchRun, session: AgentSession): Promise<SupervisorState> {
  const [
    initCount,
    litTaskCount,
    domainTaskCount,
    hypothesisCount,
    reflectionTaskCount,
    verificationTaskCount,
    rankingTaskCount,
    evolutionTaskCount,
    finalReport,
    latestAssessment,
    recommendationEvents,
  ] = await Promise.all([
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "InitializerAgent", status: "completed" },
    }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "LiteratureRetrievalAgent", status: "completed" },
    }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "DomainRetrievalAgent", status: "completed" },
    }),
    prisma.hypothesis.count({ where: { runId: run.id } }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "ReflectionAgent", status: "completed" },
    }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "VerificationAgent", status: "completed" },
    }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "RankingAgent", status: "completed" },
    }),
    prisma.agentTask.count({
      where: { runId: run.id, agentName: "EvolutionAgent", status: "completed" },
    }),
    prisma.finalReport.findFirst({ where: { runId: run.id }, orderBy: { createdAt: "desc" } }),
    prisma.completionAssessment.findFirst({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentEvent.findMany({
      where: { runId: run.id, eventType: "recommendation" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const topHypothesisCount = await prisma.hypothesis.count({
    where: { runId: run.id, status: { in: ["debated", "evolved", "selected"] } },
  });

  const disabledAgents = new Set<string>(((run as unknown as { disabledAgents?: string[] }).disabledAgents) ?? []);

  return {
    iteration: session.iterationCount,
    initialized: initCount > 0,
    retrievalPasses: litTaskCount,
    domainRetrievalPasses: domainTaskCount,
    hypothesisCount,
    topHypothesisCount,
    reflectionPasses: reflectionTaskCount,
    verificationPasses: verificationTaskCount,
    rankingPasses: rankingTaskCount,
    evolutionPasses: evolutionTaskCount,
    finalReportExists: Boolean(finalReport),
    completionPassed: Boolean(latestAssessment?.isComplete),
    disabledAgents,
    recommendations: recommendationEvents.map((e) => ({
      kind: (e.payload as { kind?: string } | null)?.kind ?? "phase",
      target: (e.payload as { target?: string } | null)?.target ?? "",
      rationale: e.message,
      fromAgent: e.agentName,
    })),
  };
}

export async function pickNextAction(run: ResearchRun, session: AgentSession): Promise<SupervisorAction> {
  const s = await readSupervisorState(run, session);
  const isDisabled = (name: SupervisorScientistName) => s.disabledAgents.has(name);

  if (!s.initialized && !isDisabled("InitializerAgent")) {
    return {
      kind: "schedule",
      agentName: "InitializerAgent",
      phase: "initializing",
      reason: "Initialize run plan, budgets, and completion criteria.",
    };
  }

  if (s.retrievalPasses === 0 && !isDisabled("LiteratureRetrievalAgent")) {
    return {
      kind: "schedule",
      agentName: "LiteratureRetrievalAgent",
      phase: "literature_retrieval",
      reason: "Build the source corpus from PubMed/OpenAlex/Crossref.",
    };
  }

  if (s.domainRetrievalPasses === 0 && shouldAttemptDomain(run) && !isDisabled("DomainRetrievalAgent")) {
    return {
      kind: "schedule",
      agentName: "DomainRetrievalAgent",
      phase: "domain_retrieval",
      reason: "Pull domain data (ChEMBL/UniProt/AlphaFold) where relevant.",
    };
  }

  if (s.hypothesisCount === 0 && !isDisabled("GenerationAgent")) {
    return {
      kind: "schedule",
      agentName: "GenerationAgent",
      phase: "generation",
      reason: "Generate the first batch of hypotheses.",
    };
  }

  if (s.reflectionPasses === 0 && !isDisabled("ReflectionAgent")) {
    return {
      kind: "schedule",
      agentName: "ReflectionAgent",
      phase: "reflection",
      reason: "Critique generated hypotheses.",
    };
  }

  // Cluster after at least one reflection pass to identify duplicates/diversity gaps.
  const clusterCount = await prisma.hypothesis.count({
    where: { runId: run.id, clusterId: { not: null } },
  });
  if (clusterCount === 0 && s.hypothesisCount >= 3 && !isDisabled("ProximityAgent")) {
    return {
      kind: "schedule",
      agentName: "ProximityAgent",
      phase: "clustering",
      reason: "Cluster hypotheses and detect coverage gaps.",
    };
  }

  if (s.verificationPasses === 0 && !isDisabled("VerificationAgent")) {
    return {
      kind: "schedule",
      agentName: "VerificationAgent",
      phase: "verification",
      reason: "Verify claims against the source corpus.",
    };
  }

  if (s.rankingPasses === 0 && !isDisabled("RankingAgent")) {
    return {
      kind: "schedule",
      agentName: "RankingAgent",
      phase: "ranking",
      reason: "Run pairwise debate and update rankings.",
    };
  }

  if (s.evolutionPasses === 0 && !isDisabled("EvolutionAgent")) {
    return {
      kind: "schedule",
      agentName: "EvolutionAgent",
      phase: "evolution",
      reason: "Evolve the top-ranked hypotheses.",
    };
  }

  // Honor recommendations from prior agents (e.g. "need more retrieval"):
  const reco = s.recommendations.find((r) =>
    [
      "literature_retrieval",
      "domain_retrieval",
      "generation",
      "verification",
      "ranking",
      "evolution",
    ].includes(r.target),
  );
  if (reco) {
    const candidate = phaseToAgent(reco.target);
    if (!isDisabled(candidate)) {
      return {
        kind: "schedule",
        agentName: candidate,
        phase: reco.target,
        reason: `Recommendation from ${reco.fromAgent}: ${reco.rationale}`,
      };
    }
  }

  // Periodic completion assessment.
  const latestAssessment = await prisma.completionAssessment.findFirst({
    where: { runId: run.id },
    orderBy: { createdAt: "desc" },
  });
  const needsAssess = !latestAssessment || latestAssessment.isComplete === false;
  if (needsAssess) {
    return {
      kind: "assess_completion",
      reason: "Determine whether the run satisfies completion criteria.",
    };
  }

  if (s.completionPassed && !s.finalReportExists) {
    return { kind: "produce_final_report", reason: "Completion criteria met; produce final report." };
  }

  if (s.finalReportExists) {
    return { kind: "stop", status: "completed", reason: "Final report exists and completion passed." };
  }

  // If we got here, the latest assessment said incomplete — re-loop with another retrieval or generation pass.
  if (latestAssessment) {
    const missing = (latestAssessment.missingWork as unknown as string[] | undefined) ?? [];
    const next =
      (latestAssessment.recommendedNextTasks as unknown as { agent?: string; reason?: string }[] | undefined) ?? [];
    const candidate = next.find((n) => n.agent && isScientist(n.agent) && !s.disabledAgents.has(n.agent));
    if (candidate?.agent) {
      return {
        kind: "schedule",
        agentName: candidate.agent as SupervisorScientistName,
        phase: agentToPhase(candidate.agent as SupervisorScientistName),
        reason: candidate.reason ?? "Completion assessor recommended this agent.",
      };
    }
    if (missing.some((m) => /retriev/i.test(m)) && !isDisabled("LiteratureRetrievalAgent")) {
      return {
        kind: "schedule",
        agentName: "LiteratureRetrievalAgent",
        phase: "literature_retrieval",
        reason: "Completion assessor flagged insufficient sources.",
      };
    }
    if (missing.some((m) => /evolve|evolution|specific/i.test(m)) && !isDisabled("EvolutionAgent")) {
      return {
        kind: "schedule",
        agentName: "EvolutionAgent",
        phase: "evolution",
        reason: "Completion assessor flagged need for more evolution.",
      };
    }
    if (missing.some((m) => /diversit|cluster|underexplored/i.test(m)) && !isDisabled("GenerationAgent")) {
      return {
        kind: "schedule",
        agentName: "GenerationAgent",
        phase: "generation",
        reason: "Completion assessor flagged diversity gap; generate more.",
      };
    }
  }

  // Fall through: produce report rather than loop forever if everything else is disabled.
  if (!s.finalReportExists) {
    return { kind: "produce_final_report", reason: "All gates passed or disabled; producing final report." };
  }
  return { kind: "stop", status: "completed", reason: "Nothing left to do." };
}

function shouldAttemptDomain(run: ResearchRun): boolean {
  const cfg = (run.sourceConfig as Record<string, { enabled?: boolean }> | null) ?? {};
  const enabled = (id: string) => cfg?.[id]?.enabled === true;
  return enabled("chembl") || enabled("uniprot") || enabled("alphafold");
}

function isScientist(name: string): name is SupervisorScientistName {
  return [
    "InitializerAgent",
    "LiteratureRetrievalAgent",
    "DomainRetrievalAgent",
    "GenerationAgent",
    "ProximityAgent",
    "ReflectionAgent",
    "VerificationAgent",
    "RankingAgent",
    "EvolutionAgent",
    "MetaReviewAgent",
  ].includes(name);
}

function phaseToAgent(phase: string): SupervisorScientistName {
  switch (phase) {
    case "literature_retrieval":
      return "LiteratureRetrievalAgent";
    case "domain_retrieval":
      return "DomainRetrievalAgent";
    case "generation":
      return "GenerationAgent";
    case "verification":
      return "VerificationAgent";
    case "ranking":
      return "RankingAgent";
    case "evolution":
      return "EvolutionAgent";
    default:
      return "ReflectionAgent";
  }
}

function agentToPhase(agent: SupervisorScientistName): string {
  switch (agent) {
    case "InitializerAgent":
      return "initializing";
    case "LiteratureRetrievalAgent":
      return "literature_retrieval";
    case "DomainRetrievalAgent":
      return "domain_retrieval";
    case "GenerationAgent":
      return "generation";
    case "ProximityAgent":
      return "clustering";
    case "ReflectionAgent":
      return "reflection";
    case "VerificationAgent":
      return "verification";
    case "RankingAgent":
      return "ranking";
    case "EvolutionAgent":
      return "evolution";
    case "MetaReviewAgent":
      return "meta_review";
  }
}
