"use client";
import { cn } from "@/lib/utils/cn";

const AGENTS: { key: string; label: string; agentName: string; phases: string[] }[] = [
  { key: "Initializer", label: "Initializer", agentName: "InitializerAgent", phases: ["initializing"] },
  { key: "Supervisor", label: "Supervisor", agentName: "SupervisorAgent", phases: ["supervising"] },
  { key: "LiteratureRetrieval", label: "Literature retrieval", agentName: "LiteratureRetrievalAgent", phases: ["literature_retrieval"] },
  { key: "DomainRetrieval", label: "Domain retrieval", agentName: "DomainRetrievalAgent", phases: ["domain_retrieval"] },
  { key: "Generation", label: "Generation", agentName: "GenerationAgent", phases: ["generation"] },
  { key: "Proximity", label: "Proximity", agentName: "ProximityAgent", phases: ["clustering"] },
  { key: "Reflection", label: "Reflection", agentName: "ReflectionAgent", phases: ["reflection"] },
  { key: "Verification", label: "Verification", agentName: "VerificationAgent", phases: ["verification"] },
  { key: "Ranking", label: "Ranking", agentName: "RankingAgent", phases: ["ranking"] },
  { key: "Evolution", label: "Evolution", agentName: "EvolutionAgent", phases: ["evolution"] },
  { key: "CompletionAssessor", label: "Completion", agentName: "CompletionAssessorAgent", phases: ["completion_assessment"] },
  { key: "MetaReview", label: "Meta review", agentName: "MetaReviewAgent", phases: ["meta_review", "final_report"] },
];

export const AGENT_RAIL = AGENTS;

export function AgentRail({
  currentPhase,
  status,
  completed,
  disabled,
  onToggleDisable,
}: {
  currentPhase?: string | null;
  status: string;
  completed: Set<string>;
  disabled?: Set<string>;
  onToggleDisable?: (agentName: string, nextDisabled: boolean) => void;
}) {
  const isTerminal = ["completed", "completed_with_limit", "failed", "cancelled"].includes(status);
  const active = (a: typeof AGENTS[number]) =>
    a.phases.includes(currentPhase ?? "") && !isTerminal;
  return (
    <div className="flex flex-col gap-0">
      {AGENTS.map((a, idx) => {
        const isActive = active(a);
        const done = completed.has(a.key) || isTerminal;
        const isDisabled = disabled?.has(a.agentName) ?? false;
        return (
          <div key={a.key} className="flex items-stretch gap-3 group">
            <div className="relative flex flex-col items-center w-3">
              <span
                className={cn(
                  "h-2 w-2 rounded-full mt-3",
                  isDisabled
                    ? "bg-zinc-800 opacity-50"
                    : isActive
                      ? "bg-primary pulse-dot"
                      : done
                        ? "bg-foreground"
                        : "bg-zinc-700",
                )}
              />
              {idx < AGENTS.length - 1 && (
                <span className="flex-1 w-px bg-border my-1" aria-hidden="true" />
              )}
            </div>
            <div className="pt-2 pb-3 flex-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-xs mono tracking-wider uppercase",
                    isDisabled
                      ? "text-muted-foreground/50 line-through"
                      : isActive
                        ? "text-primary"
                        : done
                          ? "text-foreground"
                          : "text-muted-foreground",
                  )}
                >
                  {a.label}
                </div>
                <div className="text-[10px] mono text-muted-foreground/80 mt-0.5">
                  {a.phases.join(", ")}
                </div>
              </div>
              {onToggleDisable && !isTerminal && (
                <button
                  onClick={() => onToggleDisable(a.agentName, !isDisabled)}
                  className="text-[10px] mono text-muted-foreground/70 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title={isDisabled ? "Re-enable agent" : "Skip / disable agent"}
                >
                  {isDisabled ? "enable" : "skip"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
