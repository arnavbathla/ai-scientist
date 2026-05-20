"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Pause,
  Play,
  X,
  Copy,
  FileDown,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { AgentRail } from "./agent-rail";
import { EventStream, type UiEvent } from "./event-stream";
import { HypothesisList } from "./hypothesis-list";
import { RunDrawer } from "./drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Elapsed, formatElapsed } from "@/components/elapsed";
import { ReportPreview } from "./report-preview";

export interface RunViewProps {
  initialRun: any;
  initialSession: any;
  initialCounts: {
    hypotheses: number;
    evidence: number;
    sources: number;
    safetyFlags: number;
    tasks: number;
    events: number;
  };
  initialLatestAssessment: any;
  initialEvents: UiEvent[];
  initialHypotheses: any[];
  initialEvidence: any[];
  initialSafetyFlags: any[];
  initialSources: any[];
  initialTasks: any[];
  initialReport: any | null;
  modelLabel: string;
}

export function RunView(props: RunViewProps) {
  const router = useRouter();
  const [run, setRun] = useState<any>(props.initialRun);
  const [session, setSession] = useState<any>(props.initialSession);
  const [events, setEvents] = useState<UiEvent[]>(props.initialEvents);
  const [hypotheses, setHypotheses] = useState<any[]>(props.initialHypotheses);
  const [evidence, setEvidence] = useState<any[]>(props.initialEvidence);
  const [safetyFlags, setSafetyFlags] = useState<any[]>(props.initialSafetyFlags);
  const [sources, setSources] = useState<any[]>(props.initialSources);
  const [tasks, setTasks] = useState<any[]>(props.initialTasks);
  const [report, setReport] = useState<any | null>(props.initialReport);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, startTransition] = useTransition();

  // SSE connection
  useEffect(() => {
    let es: EventSource | null = null;
    let lastId = events[events.length - 1]?.id;

    function connect() {
      const url = lastId
        ? `/api/runs/${run.id}/stream?sinceId=${encodeURIComponent(lastId)}`
        : `/api/runs/${run.id}/stream`;
      es = new EventSource(url);
      es.addEventListener("event", (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data);
          setEvents((prev) => {
            if (prev.find((p) => p.id === ev.id)) return prev;
            return [...prev, ev];
          });
          lastId = ev.id;
        } catch {
          // ignore
        }
      });
      es.addEventListener("snapshot", (e) => {
        try {
          const snap = JSON.parse((e as MessageEvent).data);
          if (snap.run) {
            setRun((prev: any) => ({ ...prev, ...snap.run }));
          }
          if (snap.session) {
            setSession((prev: any) => ({ ...prev, ...snap.session }));
          }
        } catch {
          // ignore
        }
      });
      es.onerror = () => {
        // Browser will auto-retry SSE; close to clean up and let it reconnect.
        es?.close();
        setTimeout(connect, 2500);
      };
    }
    connect();
    return () => {
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // Periodically refresh non-event data sets while the run is active.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [hRes, eRes, tRes] = await Promise.all([
          fetch(`/api/runs/${run.id}/hypotheses`),
          fetch(`/api/runs/${run.id}/evidence`),
          fetch(`/api/runs/${run.id}/tasks`),
        ]);
        if (hRes.ok) {
          const j = await hRes.json();
          setHypotheses(j.hypotheses);
        }
        if (eRes.ok) {
          const j = await eRes.json();
          setEvidence(j.evidence);
          setSafetyFlags(j.safetyFlags);
          setSources(j.sources);
        }
        if (tRes.ok) {
          const j = await tRes.json();
          setTasks(j.tasks);
        }
      } catch {
        // network blip
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [run.id]);

  // Fetch report on demand once final_report_ready event is seen.
  useEffect(() => {
    if (report) return;
    if (events.some((e) => e.eventType === "final_report_ready")) {
      fetch(`/api/runs/${run.id}/report`).then(async (r) => {
        if (r.ok) {
          const j = await r.json();
          setReport(j.report);
        }
      });
    }
  }, [events, report, run.id]);

  const completedAgents = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (t.status === "completed") {
        const a = (t.agentName as string).replace(/Agent$/, "");
        s.add(a);
      }
    }
    return s;
  }, [tasks]);

  const doAction = (action: "pause" | "resume" | "cancel" | "duplicate") => {
    startTransition(async () => {
      const res = await fetch(`/api/runs/${run.id}/${action}`, { method: "POST" });
      if (action === "duplicate" && res.ok) {
        const j = await res.json();
        router.push(`/runs/${j.run.id}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/projects/${run.projectId}`}
            className="text-[11px] mono text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> {run.project?.title ?? "Project"}
          </Link>
          <h1 className="text-base font-medium tracking-tight mt-1 line-clamp-2">{run.researchGoal}</h1>
          <div className="mt-2 flex items-center flex-wrap gap-2">
            <StatusBadge status={run.status} />
            {session?.currentPhase && (
              <Badge variant="outline" className="mono">phase: {session.currentPhase}</Badge>
            )}
            <Badge variant="muted" className="mono">iter {session?.iterationCount ?? 0}/{run.maxIterations}</Badge>
            {run.completionConfidence != null && (
              <Badge variant="outline" className="mono">
                conf {(run.completionConfidence * 100).toFixed(0)}%
              </Badge>
            )}
            <Badge variant="outline" className="mono">{props.modelLabel}</Badge>
            <Elapsed startedAt={run.startedAt} completedAt={run.completedAt} />
            <span className="mono text-[10px] text-muted-foreground">
              budget: {formatElapsed(run.maxRuntimeMinutes * 60_000)} max
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {["running", "queued"].includes(run.status) && (
            <Button variant="outline" size="sm" onClick={() => doAction("pause")} disabled={pending}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {run.status === "paused" && (
            <Button variant="outline" size="sm" onClick={() => doAction("resume")} disabled={pending}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {!["completed", "completed_with_limit", "failed", "cancelled", "blocked"].includes(run.status) && (
            <Button variant="outline" size="sm" onClick={() => doAction("cancel")} disabled={pending}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => doAction("duplicate")} disabled={pending}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          {report && (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/runs/${run.id}/export/markdown`}>
                  <FileText className="h-3.5 w-3.5" /> .md
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/runs/${run.id}/export/pdf`}>
                  <FileDown className="h-3.5 w-3.5" /> .pdf
                </a>
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left: agent rail */}
        <aside className="col-span-2 border-r border-border overflow-y-auto p-3">
          <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground mb-2">
            Agent pipeline
          </div>
          <AgentRail
            currentPhase={session?.currentPhase}
            status={run.status}
            completed={completedAgents}
          />
        </aside>

        {/* Center: events + hypotheses */}
        <main className="col-span-7 overflow-y-auto p-4 space-y-4">
          <section>
            <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground mb-2">
              Live event stream
            </div>
            <div className="h-[40vh] border border-border rounded-md p-2 bg-card/50">
              <EventStream events={events} />
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground">
                Hypotheses ({hypotheses.length})
              </div>
            </div>
            <HypothesisList hypotheses={hypotheses} />
          </section>
          {report && (
            <section>
              <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground mb-2">
                Final report
              </div>
              <ReportPreview markdown={report.markdown} />
            </section>
          )}
          <section>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[10px] mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? "▾" : "▸"} Advanced inspection
            </button>
            {showAdvanced && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <StatBlock label="Tasks" count={props.initialCounts.tasks} hint={`${tasks.filter((t) => t.status === "completed").length} completed`} />
                <StatBlock label="Events" count={events.length} />
                <StatBlock label="Memories" count={props.initialCounts.events /* hint */} />
                <StatBlock label="Sources" count={sources.length} />
                <StatBlock label="Evidence" count={evidence.length} />
                <StatBlock label="Safety flags" count={safetyFlags.length} />
              </div>
            )}
          </section>
        </main>

        {/* Right: drawer */}
        <aside className="col-span-3 border-l border-border overflow-hidden">
          <RunDrawer
            evidence={evidence}
            safetyFlags={safetyFlags}
            sources={sources}
            tasks={tasks}
          />
        </aside>
      </div>
    </div>
  );
}

function StatBlock({ label, count, hint }: { label: string; count: number; hint?: string }) {
  return (
    <div className="border border-border rounded-md p-2 bg-card/40">
      <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-medium mono mt-0.5">{count}</div>
      {hint && <div className="text-[10px] text-muted-foreground mono">{hint}</div>}
    </div>
  );
}
