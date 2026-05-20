import type { AgentSession, ResearchRun } from "@prisma/client";

export interface AgentInvocation<Extra = Record<string, unknown>> {
  run: ResearchRun;
  session: AgentSession;
  task: { id: string; runId: string; sessionId: string };
  /** AbortSignal that every model/tool call should honor. */
  signal?: AbortSignal;
  /** Optional extras passed by the harness (e.g. partial-report flag). */
  partial?: boolean;
  limitReason?: string;
  extras?: Extra;
}

export interface AgentExecResult<T = unknown> {
  output: T;
  summary: string;
  recommendations?: {
    kind: "phase" | "action";
    target: string;
    rationale: string;
    fromAgent: string;
  }[];
}
