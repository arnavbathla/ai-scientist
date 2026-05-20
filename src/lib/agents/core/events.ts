import { prisma } from "@/lib/db/prisma";

export interface EmitEventInput {
  runId: string;
  sessionId?: string | null;
  taskId?: string | null;
  agentName: string;
  eventType:
    | "session_started"
    | "session_completed"
    | "session_failed"
    | "session_paused"
    | "session_cancelled"
    | "session_blocked"
    | "session_resumed"
    | "phase_transition"
    | "task_created"
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "task_blocked"
    | "model_call"
    | "tool_call"
    | "recommendation"
    | "checkpoint"
    | "memory_write"
    | "safety_flag"
    | "hypothesis_created"
    | "evidence_created"
    | "debate_round"
    | "ranking_updated"
    | "completion_assessed"
    | "final_report_ready"
    | "budget_limit"
    | "info"
    | "error";
  title: string;
  message: string;
  payload?: unknown;
}

export async function emitEvent(input: EmitEventInput) {
  return prisma.agentEvent.create({
    data: {
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      taskId: input.taskId ?? null,
      agentName: input.agentName,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      payload: (input.payload ?? undefined) as any,
    },
  });
}
