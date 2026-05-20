import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SOURCE_CONFIG } from "@/lib/sources";
import { enqueueRun, removeRunFromQueue } from "@/lib/jobs/queue";
import { emitEvent } from "@/lib/agents/core/events";
import { writeMemory } from "@/lib/agents/core/memory";
import { cancelPendingTasksForSession } from "@/lib/agents/core/task-ledger";
import { HttpError, notFound, forbidden, badRequest } from "@/lib/auth/errors";
import { logger } from "@/lib/utils/logger";
import { publishControl } from "@/lib/realtime/control";

export interface CreateRunInput {
  userId: string;
  projectId: string;
  researchGoal: string;
  domain?: string | null;
  constraints?: Record<string, unknown>;
  sourceConfig?: Record<string, unknown>;
  modelConfig?: Record<string, unknown>;
  maxIterations?: number;
  maxRuntimeMinutes?: number;
  maxSources?: number;
  maxHypotheses?: number;
  maxModelCostUsd?: number | null;
  skillIds?: string[];
}

export const DEFAULTS = {
  maxIterations: 25,
  maxRuntimeMinutes: 180,
  maxSources: 100,
  maxHypotheses: 40,
  minFinalHypotheses: 3,
  minEvidencePerTopHypothesis: 3,
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
      constraints: (input.constraints ?? {}) as object,
      sourceConfig: sourceConfig as object,
      modelConfig: (input.modelConfig ?? {}) as object,
      maxIterations: input.maxIterations ?? DEFAULTS.maxIterations,
      maxRuntimeMinutes: input.maxRuntimeMinutes ?? DEFAULTS.maxRuntimeMinutes,
      maxSources: input.maxSources ?? DEFAULTS.maxSources,
      maxHypotheses: input.maxHypotheses ?? DEFAULTS.maxHypotheses,
      maxModelCostUsd: input.maxModelCostUsd ?? null,
    },
  });

  // Optional: attach skills to the run on creation.
  if (input.skillIds && input.skillIds.length > 0) {
    const owned = await prisma.skill.findMany({
      where: { id: { in: input.skillIds }, userId: input.userId },
      select: { id: true },
    });
    if (owned.length > 0) {
      await prisma.runSkill.createMany({
        data: owned.map((s) => ({ runId: run.id, skillId: s.id, enabled: true })),
        skipDuplicates: true,
      });
    }
  }

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
  if (["completed", "completed_with_limit", "failed", "cancelled"].includes(run.status)) {
    return;
  }
  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
  const sessions = await prisma.agentSession.findMany({ where: { runId } });
  for (const s of sessions) await cancelPendingTasksForSession(s.id);
  await removeRunFromQueue(runId);
  await publishControl(runId, { type: "interrupt", reason: "cancelled" });
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
    constraints: run.constraints as Record<string, unknown>,
    sourceConfig: run.sourceConfig as Record<string, unknown>,
    modelConfig: run.modelConfig as Record<string, unknown>,
    maxIterations: run.maxIterations,
    maxRuntimeMinutes: run.maxRuntimeMinutes,
    maxSources: run.maxSources,
    maxHypotheses: run.maxHypotheses,
    maxModelCostUsd: run.maxModelCostUsd ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Live controls: config, interrupt, skip, messages.
// ---------------------------------------------------------------------------

export interface UpdateRunConfigPatch {
  maxIterations?: number;
  maxRuntimeMinutes?: number;
  maxSources?: number;
  maxHypotheses?: number;
  /** Convenience deltas: add to current run config. */
  addRuntimeMinutes?: number;
  addIterations?: number;
  /** Sentinel to "finish now": flip maxIterations down to the current iteration. */
  finishNow?: boolean;
}

export async function updateRunConfig(runId: string, userId: string, patch: UpdateRunConfigPatch) {
  const run = await getRunForUser(runId, userId);
  const data: Record<string, number> = {};
  if (patch.maxIterations !== undefined) {
    if (patch.maxIterations < 1 || patch.maxIterations > 500) throw badRequest("max_iterations_out_of_range");
    data.maxIterations = patch.maxIterations;
  }
  if (patch.addIterations !== undefined) {
    if (patch.addIterations < 1 || patch.addIterations > 200) throw badRequest("add_iterations_out_of_range");
    data.maxIterations = Math.min(500, run.maxIterations + patch.addIterations);
  }
  if (patch.maxRuntimeMinutes !== undefined) {
    if (patch.maxRuntimeMinutes < 1 || patch.maxRuntimeMinutes > 60 * 24) throw badRequest("max_runtime_out_of_range");
    data.maxRuntimeMinutes = patch.maxRuntimeMinutes;
  }
  if (patch.addRuntimeMinutes !== undefined) {
    if (patch.addRuntimeMinutes < 1 || patch.addRuntimeMinutes > 60 * 12) throw badRequest("add_runtime_out_of_range");
    data.maxRuntimeMinutes = Math.min(60 * 24, run.maxRuntimeMinutes + patch.addRuntimeMinutes);
  }
  if (patch.maxSources !== undefined) {
    if (patch.maxSources < 5 || patch.maxSources > 1000) throw badRequest("max_sources_out_of_range");
    data.maxSources = patch.maxSources;
  }
  if (patch.maxHypotheses !== undefined) {
    if (patch.maxHypotheses < 3 || patch.maxHypotheses > 500) throw badRequest("max_hypotheses_out_of_range");
    data.maxHypotheses = patch.maxHypotheses;
  }
  if (patch.finishNow) {
    const session = await prisma.agentSession.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } });
    const iter = session?.iterationCount ?? 0;
    data.maxIterations = Math.max(1, iter);
    data.maxRuntimeMinutes = Math.max(1, Math.ceil(((Date.now() - (run.startedAt?.getTime() ?? Date.now())) / 60_000) + 1));
  }
  if (Object.keys(data).length === 0) throw badRequest("no_changes");
  await prisma.researchRun.update({ where: { id: runId }, data });
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "config_updated",
    title: "Run config updated",
    message: summarizeConfig(data, patch),
    payload: data,
  });
  await publishControl(runId, { type: "config_updated" });
  return prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
}

function summarizeConfig(data: Record<string, number>, patch: UpdateRunConfigPatch): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) parts.push(`${k}=${v}`);
  if (patch.finishNow) parts.unshift("finishNow");
  return parts.join(", ");
}

export interface SkipStepInput {
  agentName?: string;
  /** Skip just the currently-running step (without disabling the agent). */
  currentOnly?: boolean;
  /** Re-enable an agent the user previously disabled. */
  enable?: boolean;
}

export async function skipStep(runId: string, userId: string, opts: SkipStepInput) {
  const run = await getRunForUser(runId, userId);
  let disabled = [...(run.disabledAgents ?? [])];
  let message = "";
  if (opts.agentName) {
    const target = opts.agentName.trim();
    if (!target) throw badRequest("invalid_agent_name");
    if (opts.enable) {
      disabled = disabled.filter((a) => a !== target);
      message = `Re-enabled ${target}.`;
    } else if (!disabled.includes(target)) {
      disabled.push(target);
      message = `Disabled ${target} for the rest of this run.`;
    } else {
      message = `${target} is already disabled.`;
    }
  } else if (opts.currentOnly !== false) {
    message = "Skipped current step.";
  }
  await prisma.researchRun.update({
    where: { id: runId },
    data: {
      disabledAgents: disabled,
      skipCurrent: opts.agentName ? false : true,
    },
  });
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "step_skipped",
    title: message || "Skip requested",
    message,
    payload: { agentName: opts.agentName, currentOnly: opts.currentOnly, enable: opts.enable, disabledAgents: disabled },
  });
  await publishControl(runId, { type: "skip", agentName: opts.agentName, reason: message });
  return prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
}

export async function interruptRun(runId: string, userId: string, reason?: string) {
  await getRunForUser(runId, userId);
  await emitEvent({
    runId,
    agentName: "SupervisorAgent",
    eventType: "task_aborted",
    title: "User pressed Stop",
    message: reason ?? "User requested interrupt.",
  });
  await publishControl(runId, { type: "interrupt", reason });
}

export async function appendRunMessage(runId: string, userId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw badRequest("empty_message");
  if (trimmed.length > 8000) throw badRequest("message_too_long");
  const run = await getRunForUser(runId, userId);
  const msg = await prisma.runMessage.create({
    data: {
      runId,
      userId,
      content: trimmed.slice(0, 8000),
    },
  });
  await emitEvent({
    runId,
    agentName: "User",
    eventType: "user_message",
    title: trimmed.slice(0, 80),
    message: trimmed,
    payload: { messageId: msg.id },
  });
  // Write as a high-importance memory so every downstream agent surfaces it.
  const session = await prisma.agentSession.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });
  if (session) {
    await writeMemory({
      runId,
      sessionId: session.id,
      memoryType: "user_instruction",
      title: `User follow-up (${msg.createdAt.toISOString()})`,
      content: trimmed,
      importanceScore: 0.95,
    });
  }
  // If the run has terminated, re-enqueue so the agent can act on the message.
  if (["completed", "completed_with_limit", "failed", "cancelled"].includes(run.status)) {
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "queued", completedAt: null } });
    await enqueueRun({ runId, reason: "follow_up_message" });
  }
  await publishControl(runId, { type: "user_message", preview: trimmed.slice(0, 80) });
  return msg;
}
