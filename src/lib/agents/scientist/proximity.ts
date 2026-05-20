import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory } from "@/lib/agents/core/memory";
import { nanoId } from "@/lib/utils/ids";
import type { AgentInvocation, AgentExecResult } from "./context";

const Schema = z.object({
  clusters: z.array(
    z.object({
      label: z.string().min(2),
      hypothesisIds: z.array(z.string()).min(1),
    }),
  ),
  underexplored: z.array(z.string()).optional().default([]),
  recommendMoreGeneration: z.boolean().default(false),
});

export async function runProximity(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ clusters: { label: string; size: number }[]; underexplored: string[] }>> {
  const hyps = await prisma.hypothesis.findMany({
    where: { runId: ctx.run.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, summary: true, mechanism: true },
  });
  if (hyps.length === 0) {
    return {
      output: { clusters: [], underexplored: [] },
      summary: "No hypotheses to cluster.",
    };
  }
  const provider = ModelRouter.for("hypothesisCritique");
  const userPrompt = [
    `Goal: ${ctx.run.normalizedGoal ?? ctx.run.researchGoal}`,
    "",
    "Hypotheses:",
    hyps
      .map(
        (h) =>
          `id=${h.id}\n  title: ${h.title}\n  summary: ${h.summary.slice(0, 240)}\n  mechanism: ${h.mechanism.slice(0, 240)}`,
      )
      .join("\n"),
    "",
    "Group hypotheses by mechanism / target / approach. Identify underexplored angles relative to the goal.",
    "",
    "Schema:",
    `{
  "clusters": [
    { "label": "short cluster label", "hypothesisIds": ["...", "..."] }
  ],
  "underexplored": ["angle 1", "angle 2"],
  "recommendMoreGeneration": true | false
}`,
    "Return ONLY the JSON object.",
  ].join("\n");

  const { data } = await safeGenerateJSON({
    provider,
    schema: Schema,
    systemPrompt: "You are the ResearchOS ProximityAgent. Cluster hypotheses by mechanism similarity.",
    userPrompt,
    maxTokens: 1800,
    temperature: 0.2,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "ProximityAgent" },
  });

  const validIds = new Set(hyps.map((h) => h.id));
  const clusterSizes: { label: string; size: number }[] = [];
  for (const c of data.clusters) {
    const id = nanoId(10);
    const targets = c.hypothesisIds.filter((hid) => validIds.has(hid));
    if (targets.length === 0) continue;
    clusterSizes.push({ label: c.label, size: targets.length });
    await prisma.hypothesis.updateMany({
      where: { id: { in: targets } },
      data: { clusterId: id, status: "clustered" },
    });
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "decision",
    title: `Clustered ${hyps.length} hypotheses into ${clusterSizes.length} clusters`,
    content:
      clusterSizes.map((c) => `- ${c.label} (${c.size})`).join("\n") +
      (data.underexplored.length ? `\nUnderexplored:\n- ${data.underexplored.join("\n- ")}` : ""),
    payload: { clusters: clusterSizes, underexplored: data.underexplored },
    importanceScore: 0.6,
  });

  const recommendations =
    data.recommendMoreGeneration && data.underexplored.length > 0
      ? [
          {
            kind: "phase" as const,
            target: "generation",
            rationale: `Proximity flagged underexplored areas: ${data.underexplored.slice(0, 3).join("; ")}`,
            fromAgent: "ProximityAgent",
          },
        ]
      : [];

  return {
    output: { clusters: clusterSizes, underexplored: data.underexplored },
    summary: `Clustered into ${clusterSizes.length} groups${
      data.underexplored.length ? `, ${data.underexplored.length} underexplored area(s).` : "."
    }`,
    recommendations,
  };
}
