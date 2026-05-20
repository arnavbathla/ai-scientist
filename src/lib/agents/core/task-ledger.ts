import type { AgentTask, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { emitEvent } from "./events";

export interface CreateTaskInput {
  runId: string;
  sessionId: string;
  agentName: string;
  title: string;
  description: string;
  input?: Record<string, unknown>;
  completionCriteria?: Record<string, unknown>;
  verificationCriteria?: Record<string, unknown>;
  priority?: number;
  parentTaskId?: string;
}

export async function createTask(t: CreateTaskInput): Promise<AgentTask> {
  const task = await prisma.agentTask.create({
    data: {
      runId: t.runId,
      sessionId: t.sessionId,
      agentName: t.agentName,
      title: t.title,
      description: t.description,
      priority: t.priority ?? 0,
      parentTaskId: t.parentTaskId ?? null,
      input: (t.input ?? {}) as any,
      completionCriteria: (t.completionCriteria ?? {}) as any,
      verificationCriteria: (t.verificationCriteria ?? {}) as any,
    },
  });
  await emitEvent({
    runId: t.runId,
    sessionId: t.sessionId,
    taskId: task.id,
    agentName: t.agentName,
    eventType: "task_created",
    title: `Task created: ${t.title}`,
    message: t.description,
  });
  return task;
}

export async function startTask(taskId: string): Promise<AgentTask> {
  return prisma.agentTask.update({
    where: { id: taskId },
    data: { status: "running" satisfies TaskStatus, startedAt: new Date() },
  });
}

export interface CompleteTaskInput {
  taskId: string;
  output?: unknown;
  verificationResult?: Record<string, unknown>;
}

export async function completeTask({ taskId, output, verificationResult }: CompleteTaskInput) {
  return prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: "completed",
      completedAt: new Date(),
      output: (output ?? undefined) as any,
      verificationResult: (verificationResult ?? undefined) as any,
    },
  });
}

export async function failTask(taskId: string, reason: string, verificationResult?: Record<string, unknown>) {
  return prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      completedAt: new Date(),
      failureReason: reason,
      verificationResult: (verificationResult ?? undefined) as any,
    },
  });
}

export async function blockTask(taskId: string, reason: string) {
  return prisma.agentTask.update({
    where: { id: taskId },
    data: { status: "blocked", completedAt: new Date(), failureReason: reason },
  });
}

export async function cancelPendingTasksForSession(sessionId: string) {
  return prisma.agentTask.updateMany({
    where: { sessionId, status: { in: ["pending", "running"] } },
    data: { status: "cancelled", completedAt: new Date() },
  });
}
