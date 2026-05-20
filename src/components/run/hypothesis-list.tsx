"use client";
import { Badge } from "@/components/ui/badge";

interface UiHypothesis {
  id: string;
  title: string;
  summary: string;
  mechanism: string;
  testability: string;
  status: string;
  overallScore: number;
  noveltyScore: number;
  feasibilityScore: number;
  impactScore: number;
  evidenceScore: number;
  confidenceScore: number;
  parentHypothesisIds?: unknown;
  riskLevel: string;
  latestRanking?: { eloScore: number; rank: number } | null;
}

export function HypothesisList({ hypotheses }: { hypotheses: UiHypothesis[] }) {
  if (hypotheses.length === 0) {
    return <div className="text-xs text-muted-foreground p-4">No hypotheses yet.</div>;
  }
  const sorted = [...hypotheses].sort((a, b) => {
    const ra = a.latestRanking?.rank ?? 99999;
    const rb = b.latestRanking?.rank ?? 99999;
    if (ra !== rb) return ra - rb;
    return b.overallScore - a.overallScore;
  });
  return (
    <div className="space-y-2">
      {sorted.map((h) => (
        <div key={h.id} className="border border-border rounded-md p-3 bg-card">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="text-sm font-medium tracking-tight">{h.title}</div>
            <div className="flex items-center gap-2">
              {h.latestRanking && (
                <Badge variant="outline" className="mono">
                  rank {h.latestRanking.rank} · elo {h.latestRanking.eloScore.toFixed(0)}
                </Badge>
              )}
              <Badge variant={h.status === "selected" ? "primary" : h.status === "evolved" ? "success" : "muted"}>
                {h.status}
              </Badge>
              <Badge variant={h.riskLevel === "high" ? "danger" : h.riskLevel === "medium" ? "warning" : "outline"}>
                risk: {h.riskLevel}
              </Badge>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{h.summary}</div>
          <div className="text-xs text-muted-foreground mt-1.5">
            <span className="text-foreground/70 mono uppercase tracking-wider">mechanism: </span>
            {h.mechanism}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">
            <span className="text-foreground/70 mono uppercase tracking-wider">testability: </span>
            {h.testability}
          </div>
          <div className="mt-2 flex items-center gap-3 mono text-[10px] text-muted-foreground">
            <span>overall {h.overallScore.toFixed(2)}</span>
            <span>·</span>
            <span>novelty {h.noveltyScore.toFixed(2)}</span>
            <span>·</span>
            <span>feasibility {h.feasibilityScore.toFixed(2)}</span>
            <span>·</span>
            <span>impact {h.impactScore.toFixed(2)}</span>
            <span>·</span>
            <span>evidence {h.evidenceScore.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
