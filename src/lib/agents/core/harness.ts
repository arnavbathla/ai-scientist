import type { AgentSession, ResearchRun, SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { emitEvent } from "./events";
import { writeCheckpoint } from "./checkpoint";
import { writeMemory } from "./memory";
import { maybeCompact } from "./compaction";
import { pickNextAction, type SupervisorAction, type SupervisorScientistName } from "./supervisor";
import { acquireRunLock, type RunLock } from "./locks";
import {
  createTask,
  startTask,
  completeTask,
  failTask,
  cancelPendingTasksForSession,
} from "./task-ledger";
import { verifyTask } from "./verification";

// Lazy agent imports to avoid pulling Anthropic SDK into edge bundles.
async function runAgentByName(name: SupervisorScientistName, ctx: any) {
  switch (name) {
    case "InitializerAgent": {
      const { runInitializer } = await import("@/lib/agents/scientist/initializer");
      return runInitializer(ctx);
    }
    case "SafetyAgent": {
      const { runSafety } = await import("@/lib/agents/scientist/safety");
      return runSafety(ctx);
    }
    case "LiteratureRetrievalAgent": {
      const { runLiteratureRetrieval } = await import("@/lib/agents/scientist/literature");
      return runLiteratureRetrieval(ctx);
    }
    case "DomainRetrievalAgent": {
      const { runDomainRetrieval } = await import("@/lib/agents/scientist/domain");
      return runDomainRetrieval(ctx);
    }
    case "GenerationAgent": {
      const { runGeneration } = await import("@/lib/agents/scientist/generation");
      return runGeneration(ctx);
    }
    case "ProximityAgent": {
      const { runProximity } = await import("@/lib/agents/scientist/proximity");
      return runProximity(ctx);
    }
    case "ReflectionAgent": {
      const { runReflection } = await import("@/lib/agents/scientist/reflection");
      return runReflection(ctx);
    }
    case "VerificationAgent": {
      const { runVerification } = await import("@/lib/agents/scientist/verification");
      return runVerification(ctx);
    }
    case "RankingAgent": {
      const { runRanking } = await import("@/lib/agents/scientist/ranking");
      return runRanking(ctx);
    }
    case "EvolutionAgent": {
      const { runEvolution } = await import("@/lib/agents/scientist/evolution");
      return runEvolution(ctx);
    }
    case "MetaReviewAgent": {
      const { runMetaReview } = await import("@/lib/agents/scientist/meta-review");
      return runMetaReview(ctx);
    }
  }
}

async function runAssessment(ctx: any) {
  const { runCompletionAssessment } = await import("@/lib/agents/scientist/completion");
  return runCompletionAssessment(ctx);
}

export interface RunSessionOpts {
  runId: string;
  /** Resume an existing session if one is already active for this run. */
  resume?: boolean;
}

/**
 * runSession — the durable supervisor loop.
 *
 * Invoked by the BullMQ worker for `research-runs` jobs. Keeps working until
 * the research goal is satisfied, the run is cancelled/paused, a safety block
 * fires, or a budget/runtime/iteration limit is hit (in which case it produces
 * a partial report with status `completed_with_limit`).
 *
 * Safe to call concurrently for the same runId thanks to the Redis lock.
 */
export async function runSession({ runId }: RunSessionOpts): Promise<void> {
  const cfg = env();
  const lockTtlMs = Math.max(60_000, cfg.RESEARCH_HEARTBEAT_INTERVAL_MS * 4);
  const lock: RunLock | null = await acquireRunLock(runId, lockTtlMs);
  if (!lock) {
    logger.warn({ runId }, "another worker holds the run lock; skipping");
    return;
  }

  let session: AgentSession | null = null;
  try {
    const run = await prisma.researchRun.findUnique({ where: { id: runId } });
    if (!run) {
      logger.warn({ runId }, "runSession: run not found");
      return;
    }

    if (run.status === "cancelled" || run.status === "completed" || run.status === "blocked") {
      logger.info({ runId, status: run.status }, "runSession: run already terminal");
      return;
    }

    session = await ensureSession(run);
    await prisma.researchRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: run.startedAt ?? new Date() },
    });
    await emitEvent({
      runId,
      sessionId: session.id,
      agentName: "SupervisorAgent",
      eventType: "session_started",
      title: session.iterationCount > 0 ? "Session resumed" : "Session started",
      message: `Run ${run.id} entered active loop.`,
    });

    const start = Date.now();
    const maxRuntimeMs = Math.max(60_000, run.maxRuntimeMinutes * 60_000);
    const heartbeat = setInterval(async () => {
      try {
        if (!session) return;
        await prisma.agentSession.update({
          where: { id: session.id },
          data: { lastHeartbeatAt: new Date() },
        });
        await lock.renew(lockTtlMs);
      } catch (err) {
        logger.warn({ err: String(err) }, "heartbeat failed");
      }
    }, cfg.RESEARCH_HEARTBEAT_INTERVAL_MS);

    try {
      while (true) {
        const fresh = await prisma.researchRun.findUnique({ where: { id: runId } });
        if (!fresh) break;
        if (fresh.status === "paused") {
          await emitEvent({
            runId,
            sessionId: session.id,
            agentName: "SupervisorAgent",
            eventType: "session_paused",
            title: "Session paused",
            message: "Worker yielding due to paused run status.",
          });
          await prisma.agentSession.update({ where: { id: session.id }, data: { status: "paused" } });
          return;
        }
        if (fresh.status === "cancelled") {
          await cancelPendingTasksForSession(session.id);
          await prisma.agentSession.update({
            where: { id: session.id },
            data: { status: "cancelled", completedAt: new Date() },
          });
          await emitEvent({
            runId,
            sessionId: session.id,
            agentName: "SupervisorAgent",
            eventType: "session_cancelled",
            title: "Session cancelled",
            message: "Run was cancelled by user.",
          });
          return;
        }

        // Budget gates
        if (session.iterationCount >= run.maxIterations) {
          await finalizeWithLimit(run.id, session.id, "max_iterations");
          return;
        }
        if (Date.now() - start > maxRuntimeMs) {
          await finalizeWithLimit(run.id, session.id, "max_runtime");
          return;
        }

        const action = await pickNextAction(fresh, session);
        await emitEvent({
          runId,
          sessionId: session.id,
          agentName: "SupervisorAgent",
          eventType: "phase_transition",
          title: `Supervisor: ${describeAction(action)}`,
          message: action.kind === "stop" ? action.reason : action.kind === "schedule" ? action.reason : "supervisor decision",
          payload: action,
        });

        if (action.kind === "stop") {
          if (action.status === "blocked") {
            await prisma.researchRun.update({
              where: { id: runId },
              data: { status: "blocked", completedAt: new Date(), error: action.reason },
            });
            await prisma.agentSession.update({
              where: { id: session.id },
              data: { status: "blocked", completedAt: new Date() },
            });
            await emitEvent({
              runId,
              sessionId: session.id,
              agentName: "SupervisorAgent",
              eventType: "session_blocked",
              title: "Run blocked by safety",
              message: action.reason,
            });
            return;
          }
          await prisma.researchRun.update({
            where: { id: runId },
            data: { status: "completed", completedAt: new Date() },
          });
          await prisma.agentSession.update({
            where: { id: session.id },
            data: { status: "completed", completedAt: new Date() },
          });
          await emitEvent({
            runId,
            sessionId: session.id,
            agentName: "SupervisorAgent",
            eventType: "session_completed",
            title: "Run completed",
            message: action.reason,
          });
          return;
        }

        await maybeCompact(runId, session.id);

        if (action.kind === "assess_completion") {
          await advanceIteration(session.id, "completion_assessment");
          await runAndCommit(run, session, "CompletionAssessorAgent", "completion_assessment", action.reason, async (ctx) => {
            return runAssessment(ctx);
          });
          session = await refresh(session.id);
          continue;
        }

        if (action.kind === "produce_final_report") {
          await advanceIteration(session.id, "final_report");
          await runAndCommit(run, session, "MetaReviewAgent", "final_report", action.reason, async (ctx) => {
            return runAgentByName("MetaReviewAgent", ctx);
          });
          session = await refresh(session.id);
          // After report, run post-report safety review then mark completed in next loop iteration.
          continue;
        }

        // action.kind === "schedule"
        await advanceIteration(session.id, action.phase);
        await runAndCommit(run, session, action.agentName, action.phase, action.reason, async (ctx) => {
          return runAgentByName(action.agentName, ctx);
        });
        session = await refresh(session.id);
      }
    } finally {
      clearInterval(heartbeat);
    }
  } catch (err) {
    logger.error({ err, runId }, "runSession error");
    if (session) {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: "failed", completedAt: new Date() },
      });
      await emitEvent({
        runId,
        sessionId: session.id,
        agentName: "SupervisorAgent",
        eventType: "session_failed",
        title: "Session failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await prisma.researchRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
  } finally {
    await lock.release();
  }
}

async function ensureSession(run: ResearchRun): Promise<AgentSession> {
  const existing = await prisma.agentSession.findFirst({
    where: { runId: run.id, status: { in: ["active", "paused"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return prisma.agentSession.update({
      where: { id: existing.id },
      data: { status: "active", lastHeartbeatAt: new Date() },
    });
  }
  const created = await prisma.agentSession.create({
    data: {
      runId: run.id,
      status: "active",
      maxIterations: run.maxIterations,
      currentPhase: "initializing",
    },
  });
  await writeCheckpoint({
    runId: run.id,
    sessionId: created.id,
    checkpointType: "initialization",
    summary: "Session created.",
    state: { iterationCount: 0 },
  });
  return created;
}

async function advanceIteration(sessionId: string, phase: string) {
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      iterationCount: { increment: 1 },
      currentPhase: phase,
      lastHeartbeatAt: new Date(),
    },
  });
}

async function refresh(sessionId: string): Promise<AgentSession> {
  const s = await prisma.agentSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error("session vanished");
  return s;
}

interface AgentInvocationCtx {
  run: ResearchRun;
  session: AgentSession;
  task: { id: string; runId: string; sessionId: string };
}

async function runAndCommit(
  run: ResearchRun,
  session: AgentSession,
  agentName: string,
  phase: string,
  reason: string,
  fn: (ctx: AgentInvocationCtx) => Promise<{ output?: unknown; summary?: string; recommendations?: { kind: string; target: string; rationale: string; fromAgent: string }[] }>,
) {
  const task = await createTask({
    runId: run.id,
    sessionId: session.id,
    agentName,
    title: `${agentName} • ${phase}`,
    description: reason,
    input: { phase, reason },
  });
  await startTask(task.id);
  await emitEvent({
    runId: run.id,
    sessionId: session.id,
    taskId: task.id,
    agentName: "SupervisorAgent",
    eventType: "task_started",
    title: `Started ${agentName}`,
    message: reason,
  });

  try {
    const result = await fn({
      run,
      session,
      task: { id: task.id, runId: run.id, sessionId: session.id },
    });
    const verifier = await verifyTask(run.id, task.id, agentName);
    if (!verifier.passed) {
      await failTask(task.id, verifier.reason, verifier as any);
      await emitEvent({
        runId: run.id,
        sessionId: session.id,
        taskId: task.id,
        agentName,
        eventType: "task_failed",
        title: `${agentName} failed verification`,
        message: verifier.reason,
      });
      await writeMemory({
        runId: run.id,
        sessionId: session.id,
        memoryType: "blocker",
        title: `${agentName} verification failure`,
        content: verifier.reason,
        importanceScore: 0.7,
      });
      return;
    }
    await completeTask({ taskId: task.id, output: result?.output, verificationResult: verifier as any });
    await emitEvent({
      runId: run.id,
      sessionId: session.id,
      taskId: task.id,
      agentName,
      eventType: "task_completed",
      title: `${agentName} completed`,
      message: result?.summary ?? `Phase ${phase} completed.`,
    });
    if (Array.isArray(result?.recommendations) && result!.recommendations!.length > 0) {
      for (const rec of result!.recommendations!) {
        await emitEvent({
          runId: run.id,
          sessionId: session.id,
          taskId: task.id,
          agentName,
          eventType: "recommendation",
          title: `Recommendation: ${rec.target}`,
          message: rec.rationale,
          payload: rec,
        });
      }
    }
    await writeCheckpoint({
      runId: run.id,
      sessionId: session.id,
      checkpointType: "phase_transition",
      summary: `${agentName} completed (${phase})`,
      state: {
        phase,
        taskId: task.id,
        iteration: (session.iterationCount ?? 0) + 1,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(task.id, message);
    await emitEvent({
      runId: run.id,
      sessionId: session.id,
      taskId: task.id,
      agentName,
      eventType: "task_failed",
      title: `${agentName} threw`,
      message,
    });
    await writeMemory({
      runId: run.id,
      sessionId: session.id,
      memoryType: "blocker",
      title: `${agentName} error`,
      content: message,
      importanceScore: 0.7,
    });
    await writeCheckpoint({
      runId: run.id,
      sessionId: session.id,
      checkpointType: "failure_recovery",
      summary: `${agentName} failure recovery`,
      state: { phase, error: message },
    });
  }
}

function describeAction(action: SupervisorAction): string {
  if (action.kind === "schedule") return `schedule ${action.agentName} (${action.phase})`;
  if (action.kind === "assess_completion") return "assess_completion";
  if (action.kind === "produce_final_report") return "produce_final_report";
  return `stop ${action.status}`;
}

async function finalizeWithLimit(runId: string, sessionId: string, reason: "max_iterations" | "max_runtime") {
  await emitEvent({
    runId,
    sessionId,
    agentName: "SupervisorAgent",
    eventType: "budget_limit",
    title: `Budget limit hit: ${reason}`,
    message: `Stopping with ${reason}; producing partial report.`,
  });
  await writeCheckpoint({
    runId,
    sessionId,
    checkpointType: "budget_limit",
    summary: `Budget limit hit (${reason})`,
    state: { reason },
  });

  // Try to produce a partial final report regardless.
  try {
    const { runMetaReview } = await import("@/lib/agents/scientist/meta-review");
    const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    const task = await createTask({
      runId,
      sessionId,
      agentName: "MetaReviewAgent",
      title: "Partial meta-review (budget limit)",
      description: `Producing partial final report because ${reason}.`,
      input: { reason, partial: true },
    });
    await startTask(task.id);
    await runMetaReview({
      run,
      session,
      task: { id: task.id, runId, sessionId },
      partial: true,
      limitReason: reason,
    });
    await completeTask({
      taskId: task.id,
      output: { partial: true, reason },
      verificationResult: { passed: true, reason: "partial report under budget limit" } as any,
    });
  } catch (err) {
    logger.error({ err, runId }, "partial report failed");
  }

  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: "completed_with_limit", completedAt: new Date(), error: `budget_limit:${reason}` },
  });
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: { status: "completed", completedAt: new Date() } as { status: SessionStatus; completedAt: Date },
  });
  await emitEvent({
    runId,
    sessionId,
    agentName: "SupervisorAgent",
    eventType: "session_completed",
    title: "Run completed with limit",
    message: `Status: completed_with_limit (${reason}).`,
  });
}
