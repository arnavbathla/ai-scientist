"use client";
import { cn } from "@/lib/utils/cn";

const AGENTS: { key: string; label: string; phases: string[] }[] = [
  { key: "Initializer", label: "Initializer", phases: ["initializing"] },
  { key: "Supervisor", label: "Supervisor", phases: ["supervising"] },
  { key: "Safety", label: "Safety", phases: ["safety_intake", "safety_review"] },
  { key: "LiteratureRetrieval", label: "Literature retrieval", phases: ["literature_retrieval"] },
  { key: "DomainRetrieval", label: "Domain retrieval", phases: ["domain_retrieval"] },
  { key: "Generation", label: "Generation", phases: ["generation"] },
  { key: "Proximity", label: "Proximity", phases: ["clustering"] },
  { key: "Reflection", label: "Reflection", phases: ["reflection"] },
  { key: "Verification", label: "Verification", phases: ["verification"] },
  { key: "Ranking", label: "Ranking", phases: ["ranking"] },
  { key: "Evolution", label: "Evolution", phases: ["evolution"] },
  { key: "CompletionAssessor", label: "Completion", phases: ["completion_assessment"] },
  { key: "MetaReview", label: "Meta review", phases: ["meta_review", "final_report"] },
];

export function AgentRail({
  currentPhase,
  status,
  completed,
}: {
  currentPhase?: string | null;
  status: string;
  completed: Set<string>;
}) {
  const isTerminal = ["completed", "completed_with_limit", "failed", "cancelled", "blocked"].includes(status);
  return (
    <div className="flex flex-col gap-0">
      {AGENTS.map((a, idx) => {
        const active = a.phases.includes(currentPhase ?? "") && !isTerminal;
        const done = completed.has(a.key) || isTerminal;
        return (
          <div key={a.key} className="flex items-stretch gap-3 group">
            <div className="relative flex flex-col items-center w-3">
              <span
                className={cn(
                  "h-2 w-2 rounded-full mt-3",
                  active ? "bg-primary pulse-dot" : done ? "bg-foreground" : "bg-zinc-700",
                )}
              />
              {idx < AGENTS.length - 1 && (
                <span className="flex-1 w-px bg-border my-1" aria-hidden="true" />
              )}
            </div>
            <div className="pt-2 pb-3 flex-1">
              <div
                className={cn(
                  "text-xs mono tracking-wider uppercase",
                  active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {a.label}
              </div>
              <div className="text-[10px] mono text-muted-foreground/80 mt-0.5">{a.phases.join(", ")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
