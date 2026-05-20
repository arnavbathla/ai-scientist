import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SOURCE_CONFIG } from "@/lib/sources";
import { enqueueRun, removeRunFromQueue } from "@/lib/jobs/queue";
import { emitEvent } from "@/lib/agents/core/events";
import { cancelPendingTasksForSession } from "@/lib/agents/core/task-ledger";
import { HttpError, notFound, forbidden } from "@/lib/auth/errors";
import { logger } from "@/lib/utils/logger";

export interface CreateRunInput {
  userId: string;
  projectId: string;
  researchGoal: string;
  domain?: string | null;
  constraints?: Record<string, unknown>;
  sourceConfig?: Record<string, unknown>;
  modelConfig?: Record<string, unknown>;
  safetySensitivity?: "low" | "standard" | "high";
  maxIterations?: number;
  maxRuntimeMinutes?: number;
  maxSources?: number;
  maxHypotheses?: number;
  maxModelCostUsd?: number | null;
}

export const DEFAULTS = {
  maxIterations: 25,
  maxRuntimeMinutes: 180,
  maxSources: 100,
  maxHypotheses: 40,
  minFinalHypotheses: 3,
  minEvidencePerTopHypothesis: 3,
  safetySensitivity: "standard" as const,
};

export async function createRun(input: CreateRunInput) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw notFound();
  if (project.userId !== input.userId) throw forbidden();

  const sourceConfig = mergeSourceConfig(input.sourceConfig);

  const run = await prisma.researchRun.create({
    data: {
      projectId: input.projectId,
      userId: input.userId,
      status: "queued",
      researchGoal: input.researchGoal.trim().slice(0, 4000),
      domain: input.domain ?? project.domain ?? null,
      constraints: (input.constraints ?? {}) as any,
      sourceConfig: sourceConfig as any,
      modelConfig: (input.modelConfig ?? {}) as any,
      safetySensitivity: input.safetySensitivity ?? DEFAULTS.safetySensitivity,
      maxIterations: input.maxIterations ?? DEFAULTS.maxIterations,
      maxRuntimeMinutes: input.maxRuntimeMinutes ?? DEFAULTS.maxRuntimeMinutes,
      maxSources: input.maxSources ?? DEFAULTS.maxSources,
      maxHypotheses: input.maxHypotheses ?? DEFAULTS.maxHypotheses,
      maxModelCostUsd: input.maxModelCostUsd ?? null,
    },
  });

  await emitEvent({
    runId: run.id,
    agentName: "SupervisorAgent",
    eventType: "info",
    title: "Run created",
    message: `Queued run for project '${project.title}'.`,
  });

  try {
    await enqueueRun({ runId: run.id, reason: "user_created" });
  } catch (err) {
    logger.error({ err, runId: run.id }, "failed to enqueue run");
  }

  return run;
}

function mergeSourceConfig(input?: Record<string, unknown>) {
  const merged: Record<string, { enabled: boolean; maxResults: number }> = {};
  for (const [k, v] of Object.entries(DEFAULT_SOURCE_CONFIG)) {
    const override = (input?.[k] ?? {}) as Partial<{ enabled: boolean; maxResults: number }>;
    merged[k] = {
      enabled: override.enabled ?? v.enabled,
      maxResults: clamp(override.maxResults ?? v.maxResults, 1, 100),
    };
  }
  return merged;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export async function getRunForUser(runId: string, userId: string) {
  const run = await prisma.researchRun.findUnique({
    where: { id: runId },
    include: { project: true },
  });
  if (!run) throw notFound();
  if (run.userId !== userId) throw forbidden();
  return run;
}

export async function pauseRun(runId: string, userId: string) {
  const run = await getRunForUser(runId, userId);
  if (!["queued", "running"].includes(run.status)) {
    throw new HttpError(409, `cannot_pause_status:${run.status}`);
  }
  await prisma.researchRun.update({ where: { id: runId }, data: { status: "paused" } });
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "session_paused",
    title: "Run paused",
    message: "User paused the run.",
  });
}

export async function resumeRun(runId: string, userId: string) {
  const run = await getRunForUser(runId, userId);
  if (run.status !== "paused") {
    throw new HttpError(409, `cannot_resume_status:${run.status}`);
  }
  await prisma.researchRun.update({ where: { id: runId }, data: { status: "queued" } });
  await enqueueRun({ runId, reason: "user_resumed" });
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "session_resumed",
    title: "Run resumed",
    message: "User resumed the run.",
  });
}

export async function cancelRun(runId: string, userId: string) {
  const run = await getRunForUser(runId, userId);
  if (["completed", "completed_with_limit", "failed", "cancelled", "blocked"].includes(run.status)) {
    return;
  }
  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
  const sessions = await prisma.agentSession.findMany({ where: { runId } });
  for (const s of sessions) await cancelPendingTasksForSession(s.id);
  await removeRunFromQueue(runId);
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "session_cancelled",
    title: "Run cancelled",
    message: "User cancelled the run.",
  });
}

export async function duplicateRun(runId: string, userId: string) {
  const run = await getRunForUser(runId, userId);
  return createRun({
    userId,
    projectId: run.projectId,
    researchGoal: run.researchGoal,
    domain: run.domain,
    constraints: run.constraints as any,
    sourceConfig: run.sourceConfig as any,
    modelConfig: run.modelConfig as any,
    safetySensitivity: run.safetySensitivity as any,
    maxIterations: run.maxIterations,
    maxRuntimeMinutes: run.maxRuntimeMinutes,
    maxSources: run.maxSources,
    maxHypotheses: run.maxHypotheses,
    maxModelCostUsd: run.maxModelCostUsd ?? undefined,
  });
}
