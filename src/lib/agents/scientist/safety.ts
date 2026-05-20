import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { emitEvent } from "@/lib/agents/core/events";
import { writeMemory } from "@/lib/agents/core/memory";
import { deterministicSafetyScreen } from "@/lib/safety/policy";
import type { AgentInvocation, AgentExecResult } from "./context";

const SafetySchema = z.object({
  decision: z.enum(["allow", "allow_with_caution", "block"]),
  severity: z.enum(["low", "medium", "high", "blocked"]),
  category: z.enum([
    "biosecurity",
    "chemical_safety",
    "clinical_safety",
    "dual_use",
    "unsupported_claim",
    "ethics",
    "other",
  ]),
  rationale: z.string().min(10),
  suggestedReframing: z.string().optional().nullable(),
  flagsForHypothesisIds: z.array(z.string()).optional().default([]),
});

type SafetyDecision = z.infer<typeof SafetySchema>;

/**
 * SafetyAgent
 *
 * Two modes:
 *   - "intake": evaluate the run's research goal before any work happens.
 *   - "review": evaluate the in-flight state (hypotheses, evolved hypotheses)
 *               before the final report is produced.
 *
 * In both modes we run a deterministic screen first; if it returns `block`,
 * we record the block and skip the LLM call (deterministic floor).
 * Otherwise, the LLM classifier returns a structured decision that becomes a
 * SafetyFlag row (and, if `blocked`, halts the run).
 */
export async function runSafety(ctx: AgentInvocation): Promise<AgentExecResult<SafetyDecision>> {
  // Determine mode from task title we set in supervisor.
  const taskRecord = await prisma.agentTask.findUniqueOrThrow({ where: { id: ctx.task.id } });
  const isReview = /safety_review|review/i.test(taskRecord.title);

  const det = deterministicSafetyScreen(ctx.run.researchGoal);
  if (det.kind === "block") {
    const flag = await prisma.safetyFlag.create({
      data: {
        runId: ctx.run.id,
        severity: "blocked",
        category: det.category as any,
        message: `Deterministic screen blocked goal. Signals: ${det.signals.join("; ")}`,
      },
    });
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "SafetyAgent",
      eventType: "safety_flag",
      title: "Safety: blocked by deterministic screen",
      message: flag.message,
    });
    await writeMemory({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      memoryType: "safety_note",
      title: "Goal blocked by safety policy",
      content: flag.message,
      importanceScore: 0.95,
    });
    return {
      output: {
        decision: "block",
        severity: "blocked",
        category: det.category as any,
        rationale: `Deterministic screen blocked goal. Signals: ${det.signals.join("; ")}`,
        suggestedReframing: "Reframe to a safe high-level analytical or literature-review goal.",
        flagsForHypothesisIds: [],
      },
      summary: "Blocked by deterministic safety screen.",
    };
  }

  const hypotheses = isReview
    ? await prisma.hypothesis.findMany({
        where: { runId: ctx.run.id, status: { in: ["generated", "clustered", "debated", "evolved", "selected"] } },
        orderBy: { overallScore: "desc" },
        take: 10,
        select: { id: true, title: true, summary: true, mechanism: true, riskLevel: true, status: true },
      })
    : [];

  const provider = ModelRouter.for("safetyClassification");
  const systemPrompt = SAFETY_SYSTEM;
  const userPrompt = buildSafetyPrompt({
    mode: isReview ? "review" : "intake",
    goal: ctx.run.researchGoal,
    domain: ctx.run.domain ?? null,
    constraints: ctx.run.constraints as any,
    sensitivity: ctx.run.safetySensitivity,
    hypotheses,
  });

  const { data } = await safeGenerateJSON({
    provider,
    schema: SafetySchema,
    systemPrompt,
    userPrompt,
    maxTokens: 1200,
    temperature: 0.0,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "SafetyAgent" },
  });

  // Persist a SafetyFlag for every non-clear decision.
  if (data.severity !== "low" || data.decision !== "allow") {
    const flag = await prisma.safetyFlag.create({
      data: {
        runId: ctx.run.id,
        severity: data.severity as any,
        category: data.category as any,
        message: data.rationale.slice(0, 4000),
      },
    });
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "SafetyAgent",
      eventType: "safety_flag",
      title: `Safety: ${data.severity} (${data.category})`,
      message: flag.message,
      payload: { flagId: flag.id, decision: data.decision },
    });
  } else {
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "SafetyAgent",
      eventType: "info",
      title: `Safety: ${isReview ? "review" : "intake"} clear`,
      message: data.rationale.slice(0, 4000),
    });
  }

  // If any specific hypothesis was flagged, attach a SafetyFlag with hypothesisId.
  if (Array.isArray(data.flagsForHypothesisIds) && data.flagsForHypothesisIds.length > 0) {
    for (const hid of data.flagsForHypothesisIds) {
      const exists = hypotheses.find((h) => h.id === hid);
      if (!exists) continue;
      await prisma.safetyFlag.create({
        data: {
          runId: ctx.run.id,
          hypothesisId: hid,
          severity: data.severity as any,
          category: data.category as any,
          message: `Hypothesis-specific safety concern: ${data.rationale.slice(0, 1000)}`,
        },
      });
    }
  }

  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "safety_note",
    title: `Safety ${isReview ? "review" : "intake"}: ${data.severity}`,
    content: `${data.decision.toUpperCase()} (${data.category}). ${data.rationale}${
      data.suggestedReframing ? `\nSafe reframing: ${data.suggestedReframing}` : ""
    }`,
    importanceScore: data.severity === "blocked" ? 0.95 : data.severity === "high" ? 0.8 : 0.5,
  });

  return {
    output: data,
    summary: `${data.decision.toUpperCase()} (${data.category}, ${data.severity})`,
  };
}

const SAFETY_SYSTEM = `You are the ResearchOS SafetyAgent. You are a strict but constructive
research safety classifier. You must:
- Block goals or hypotheses that enable bioweapon creation, pathogen engineering, toxin synthesis,
  weaponization of chemicals or biology, CBRN enablement, evasion of safety controls, or operational
  wetlab protocols intended for harmful outcomes.
- Allow safe, non-operational, high-level scientific research, including therapeutic, defensive,
  diagnostic, mechanism-of-disease, and literature-review work.
- When in doubt, prefer allow_with_caution and propose a safe high-level reframing instead of blocking.
- Severity "blocked" means the run must stop. Use it sparingly and only when reframing cannot help.

Respond with strict JSON.`;

function buildSafetyPrompt(input: {
  mode: "intake" | "review";
  goal: string;
  domain: string | null;
  constraints: unknown;
  sensitivity: string;
  hypotheses: { id: string; title: string; summary: string; mechanism: string; riskLevel: string; status: string }[];
}): string {
  const hypBlock = input.hypotheses.length
    ? "\nCurrent hypotheses (top 10 by score):\n" +
      input.hypotheses
        .map(
          (h) =>
            `  - id=${h.id} status=${h.status} risk=${h.riskLevel}\n    title: ${h.title}\n    summary: ${h.summary.slice(0, 280)}\n    mechanism: ${h.mechanism.slice(0, 280)}`,
        )
        .join("\n")
    : "";
  return [
    `MODE: ${input.mode}`,
    `RESEARCH GOAL: ${input.goal}`,
    `DOMAIN: ${input.domain ?? "unspecified"}`,
    `CONSTRAINTS: ${JSON.stringify(input.constraints ?? {})}`,
    `SAFETY SENSITIVITY: ${input.sensitivity}`,
    hypBlock,
    "",
    "Schema:",
    `{
  "decision": "allow" | "allow_with_caution" | "block",
  "severity": "low" | "medium" | "high" | "blocked",
  "category": "biosecurity" | "chemical_safety" | "clinical_safety" | "dual_use" | "unsupported_claim" | "ethics" | "other",
  "rationale": "...",
  "suggestedReframing": "..." | null,
  "flagsForHypothesisIds": ["hypothesisIdsThatWarrantAFlag"]
}`,
    "Return ONLY the JSON object.",
  ].join("\n");
}
