import type {
  AgentSession,
  AgentTask,
  ResearchRun,
} from "@prisma/client";

/**
 * Phase = which stage of the research loop we're currently in. Used for UI
 * display, completion gating, and supervisor decisioning.
 */
export const PHASES = [
  "initializing",
  "safety_intake",
  "literature_retrieval",
  "domain_retrieval",
  "generation",
  "clustering",
  "reflection",
  "verification",
  "ranking",
  "evolution",
  "safety_review",
  "completion_assessment",
  "meta_review",
  "final_report",
  "completed",
  "blocked",
] as const;

export type Phase = (typeof PHASES)[number];

export interface AgentRecommendation {
  /** A phase or specific action the recommending agent thinks should happen next. */
  kind: "phase" | "action";
  target: string;
  rationale: string;
  fromAgent: string;
}

export interface AgentRunResult<T = unknown> {
  /** Agent's primary output, persisted as part of AgentTask.output. */
  output: T;
  /** Soft signals to the SupervisorAgent. */
  recommendations?: AgentRecommendation[];
  /** Human-readable summary, persisted as an AgentEvent and surfaced in the UI. */
  summary: string;
}

export interface AgentContext {
  run: ResearchRun;
  session: AgentSession;
  task: AgentTask;
}
