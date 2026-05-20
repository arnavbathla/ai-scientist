import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { runAgentJson } from "@/lib/agents/core/prompt";
import { writeMemory } from "@/lib/agents/core/memory";
import { writeCheckpoint } from "@/lib/agents/core/checkpoint";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const InitSchema = z.object({
  normalizedGoal: z.string().min(8),
  domain: z.string().min(2),
  plan: z.array(z.string().min(4)).min(3),
  retrievalPlan: z.object({
    sources: z.array(z.enum(["pubmed", "openalex", "crossref", "chembl", "uniprot", "alphafold"])).min(1),
    queries: z.array(z.string().min(2)).min(1),
  }),
  domainEntities: z.object({
    genes: z.array(z.string()).optional().default([]),
    proteins: z.array(z.string()).optional().default([]),
    diseases: z.array(z.string()).optional().default([]),
    pathways: z.array(z.string()).optional().default([]),
    compounds: z.array(z.string()).optional().default([]),
    organisms: z.array(z.string()).optional().default([]),
  }),
  completionCriteria: z.array(z.string().min(4)).min(5),
});

export type InitializerOutput = z.infer<typeof InitSchema>;

export async function runInitializer(ctx: AgentInvocation): Promise<AgentExecResult<InitializerOutput>> {
  const provider = ModelRouter.for("supervisorPlanning");
  const userPrompt = buildPrompt(ctx);
  const { data } = await runAgentJson({
    provider,
    schema: InitSchema,
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 1800,
    temperature: 0.2,
    signal: ctx.signal,
    runId: ctx.run.id,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "InitializerAgent" },
  });

  // Persist normalization on the run record.
  await prisma.researchRun.update({
    where: { id: ctx.run.id },
    data: {
      normalizedGoal: data.normalizedGoal.slice(0, 4000),
      domain: ctx.run.domain ?? data.domain,
      constraints: {
        ...((ctx.run.constraints as object | null) ?? {}),
        domainEntities: data.domainEntities,
        retrievalPlan: data.retrievalPlan,
      } as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "objective",
    title: "Normalized research objective",
    content: data.normalizedGoal,
    importanceScore: 0.95,
  });
  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "plan",
    title: "Initial research plan",
    content: data.plan.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    payload: { plan: data.plan },
    importanceScore: 0.9,
  });
  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "decision",
    title: "Retrieval plan",
    content: `Sources: ${data.retrievalPlan.sources.join(", ")}\nQueries: ${data.retrievalPlan.queries.join(" | ")}`,
    payload: data.retrievalPlan,
    importanceScore: 0.85,
  });
  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "decision",
    title: "Completion criteria",
    content: data.completionCriteria.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    payload: { completionCriteria: data.completionCriteria },
    importanceScore: 0.95,
  });

  await writeCheckpoint({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    checkpointType: "initialization",
    summary: "Initializer wrote plan, retrieval plan, and completion criteria.",
    state: data as unknown as Record<string, unknown>,
  });
  await emitEvent({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    taskId: ctx.task.id,
    agentName: "InitializerAgent",
    eventType: "info",
    title: "Run plan ready",
    message: `Domain=${data.domain}. ${data.plan.length}-step plan. ${data.retrievalPlan.sources.length} sources planned.`,
    payload: data,
  });

  return {
    output: data,
    summary: `Initialized run: domain=${data.domain}; ${data.plan.length} plan steps; ${data.completionCriteria.length} completion criteria.`,
  };
}

const SYSTEM = `You are the ResearchOS InitializerAgent. You convert a user's free-text research goal
into structured, durable scaffolding for a long-horizon multi-agent run.

You must be specific and scientifically grounded. Plans should be high-level research strategy,
not protocols.

Return strict JSON.`;

function buildPrompt(ctx: AgentInvocation): string {
  return [
    `Research goal: ${ctx.run.researchGoal}`,
    `User-provided domain: ${ctx.run.domain ?? "(unspecified)"}`,
    `User constraints: ${JSON.stringify(ctx.run.constraints ?? {})}`,
    `Source config: ${JSON.stringify(ctx.run.sourceConfig ?? {})}`,
    "",
    "Schema:",
    `{
  "normalizedGoal": "Specific, falsifiable rewording of the user's goal.",
  "domain": "General biology" | "Drug discovery" | "Genetics" | "Protein science" | "Chemistry" | "Materials science" | "Aging research" | "Disease mechanism" | "Other" ,
  "plan": ["step 1 ...", "step 2 ...", "step 3 ...", ...],
  "retrievalPlan": {
    "sources": ["pubmed", "openalex", "crossref", "chembl", "uniprot", "alphafold"],
    "queries": ["concrete search query string", "another search query", ...]
  },
  "domainEntities": {
    "genes": [...], "proteins": [...], "diseases": [...], "pathways": [...], "compounds": [...], "organisms": [...]
  },
  "completionCriteria": [
    "at least 3 distinct mechanism-grounded hypotheses ...",
    "evidence support drawn from retrieved sources ...",
    "..."
  ]
}`,
    "",
    "Return ONLY the JSON object.",
  ].join("\n");
}
