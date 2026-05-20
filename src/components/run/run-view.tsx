"use client";

import { useEffect, useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Pause,
  Play,
  Square,
  Copy,
  FileDown,
  FileText,
  ArrowLeft,
  ChevronDown,
  Send,
  Plus,
  Sparkles,
  PanelRight,
  Clock,
  Hash,
  Flag,
  Check,
} from "lucide-react";
import { AgentRail } from "./agent-rail";
import { HypothesisList } from "./hypothesis-list";
import { RunDrawer } from "./drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Elapsed, formatElapsed } from "@/components/elapsed";
import { ReportPreview } from "./report-preview";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";

interface UiEvent {
  id: string;
  agentName: string;
  eventType: string;
  title: string;
  message: string;
  createdAt: string;
  payload?: unknown;
}

interface UiSkill {
  id: string;
  name: string;
  description: string;
  scope: string;
  projectId: string | null;
}

interface UiRunSkill {
  runId: string;
  skillId: string;
  enabled: boolean;
  skill: UiSkill;
}

interface RunLike {
  id: string;
  projectId: string;
  researchGoal: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  completionConfidence: number | null;
  maxIterations: number;
  maxRuntimeMinutes: number;
  maxHypotheses: number;
  maxSources: number;
  disabledAgents: string[];
  project?: { id: string; title: string } | null;
}

interface SessionLike {
  id: string;
  iterationCount: number;
  currentPhase: string | null;
}

export interface RunViewProps {
  initialRun: RunLike;
  initialSession: SessionLike | null;
  initialCounts: {
    hypotheses: number;
    evidence: number;
    sources: number;
    tasks: number;
    events: number;
  };
  initialLatestAssessment: unknown;
  initialEvents: UiEvent[];
  initialHypotheses: any[];
  initialEvidence: any[];
  initialSources: any[];
  initialTasks: any[];
  initialReport: { markdown: string } | null;
  initialSkills: UiSkill[];
  initialRunSkills: UiRunSkill[];
  modelLabel: string;
}

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_limit",
  "failed",
  "cancelled",
]);

export function RunView(props: RunViewProps) {
  const router = useRouter();
  const [run, setRun] = useState<RunLike>(props.initialRun);
  const [session, setSession] = useState<SessionLike | null>(props.initialSession);
  const [events, setEvents] = useState<UiEvent[]>(props.initialEvents);
  const [hypotheses, setHypotheses] = useState<any[]>(props.initialHypotheses);
  const [evidence, setEvidence] = useState<any[]>(props.initialEvidence);
  const [sources, setSources] = useState<any[]>(props.initialSources);
  const [tasks, setTasks] = useState<any[]>(props.initialTasks);
  const [report, setReport] = useState<{ markdown: string } | null>(props.initialReport);
  const [allSkills, setAllSkills] = useState<UiSkill[]>(props.initialSkills);
  const [runSkills, setRunSkills] = useState<UiRunSkill[]>(props.initialRunSkills);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHypotheses, setShowHypotheses] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [pending, startTransition] = useTransition();

  const isActive = ACTIVE_STATUSES.has(run.status);
  const isTerminal = TERMINAL_STATUSES.has(run.status);

  const refreshAuxData = async () => {
    try {
      const [hRes, eRes, tRes, rRes] = await Promise.all([
        fetch(`/api/runs/${run.id}/hypotheses`),
        fetch(`/api/runs/${run.id}/evidence`),
        fetch(`/api/runs/${run.id}/tasks`),
        fetch(`/api/runs/${run.id}`),
      ]);
      if (hRes.ok) setHypotheses((await hRes.json()).hypotheses);
      if (eRes.ok) {
        const j = await eRes.json();
        setEvidence(j.evidence);
        setSources(j.sources);
      }
      if (tRes.ok) setTasks((await tRes.json()).tasks);
      if (rRes.ok) {
        const j = await rRes.json();
        if (j.run) setRun((prev) => ({ ...prev, ...j.run }));
      }
    } catch {
      // ignore network blip
    }
  };

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
          const ev = JSON.parse((e as MessageEvent).data) as UiEvent;
          setEvents((prev) => {
            if (prev.find((p) => p.id === ev.id)) return prev;
            return [...prev, ev];
          });
          lastId = ev.id;
          if (
            ev.eventType === "task_completed" ||
            ev.eventType === "hypothesis_created" ||
            ev.eventType === "evidence_created" ||
            ev.eventType === "ranking_updated"
          ) {
            void refreshAuxData();
          }
        } catch {
          // ignore
        }
      });
      es.addEventListener("snapshot", (e) => {
        try {
          const snap = JSON.parse((e as MessageEvent).data);
          if (snap.run) setRun((prev) => ({ ...prev, ...snap.run }));
          if (snap.session) setSession((prev) => ({ ...(prev ?? {} as SessionLike), ...snap.session }));
        } catch {
          // ignore
        }
      });
      es.onerror = () => {
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

  useEffect(() => {
    const interval = setInterval(refreshAuxData, 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

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
        s.add(String(t.agentName).replace(/Agent$/, ""));
      }
    }
    return s;
  }, [tasks]);

  const disabledAgents = useMemo(() => new Set(run.disabledAgents ?? []), [run.disabledAgents]);

  const enabledSkillIds = useMemo(
    () => new Set(runSkills.filter((rs) => rs.enabled).map((rs) => rs.skill.id)),
    [runSkills],
  );

  const onToggleSkill = (skillId: string) => {
    const next = new Set(enabledSkillIds);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);
    const ids = Array.from(next);
    startTransition(async () => {
      const res = await fetch(`/api/runs/${run.id}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: ids }),
      });
      if (res.ok) {
        const fresh = await fetch(`/api/runs/${run.id}/skills`);
        if (fresh.ok) setRunSkills((await fresh.json()).skills);
      }
    });
  };

  const onToggleDisableAgent = (agentName: string, nextDisabled: boolean) => {
    startTransition(async () => {
      const res = await fetch(`/api/runs/${run.id}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, enable: !nextDisabled }),
      });
      if (res.ok) {
        await refreshAuxData();
      }
    });
  };

  const doAction = (action: "pause" | "resume" | "cancel" | "duplicate") => {
    startTransition(async () => {
      const res = await fetch(`/api/runs/${run.id}/${action}`, { method: "POST" });
      if (action === "duplicate" && res.ok) {
        const j = await res.json();
        router.push(`/runs/${j.run.id}`);
        return;
      }
      router.refresh();
      await refreshAuxData();
    });
  };

  const doInterrupt = () => {
    startTransition(async () => {
      await fetch(`/api/runs/${run.id}/interrupt`, { method: "POST" });
      await refreshAuxData();
    });
  };

  const doSkipCurrent = () => {
    startTransition(async () => {
      await fetch(`/api/runs/${run.id}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentOnly: true }),
      });
      await refreshAuxData();
    });
  };

  const doExtend = (kind: "time" | "iters" | "finish") => {
    startTransition(async () => {
      const body: Record<string, unknown> = {};
      if (kind === "time") body.addRuntimeMinutes = 30;
      if (kind === "iters") body.addIterations = 10;
      if (kind === "finish") body.finishNow = true;
      const res = await fetch(`/api/runs/${run.id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.run) setRun((prev) => ({ ...prev, ...j.run }));
        await refreshAuxData();
      }
    });
  };

  const handleSend = async () => {
    const value = inputValue.trim();
    if (!value) return;
    setInputValue("");

    if (value.startsWith("/")) {
      const [cmd, ...rest] = value.slice(1).split(/\s+/);
      const arg = rest.join(" ").trim();
      switch (cmd) {
        case "skip": {
          startTransition(async () => {
            if (arg) {
              await fetch(`/api/runs/${run.id}/skip`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agentName: arg }),
              });
            } else {
              await fetch(`/api/runs/${run.id}/skip`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentOnly: true }),
              });
            }
            await refreshAuxData();
          });
          return;
        }
        case "extend": {
          const minutes = parseInt((arg.match(/(\d+)/) ?? ["30"])[0], 10);
          startTransition(async () => {
            await fetch(`/api/runs/${run.id}/config`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ addRuntimeMinutes: minutes }),
            });
            await refreshAuxData();
          });
          return;
        }
        case "finish": {
          doExtend("finish");
          return;
        }
        case "stop":
        case "interrupt": {
          doInterrupt();
          return;
        }
        case "pause": {
          doAction("pause");
          return;
        }
        case "resume": {
          doAction("resume");
          return;
        }
        default: {
          // unknown slash command: post it as a normal message
          break;
        }
      }
    }

    startTransition(async () => {
      const res = await fetch(`/api/runs/${run.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      if (!res.ok) {
        // Restore the input so user doesn't lose their typing.
        setInputValue(value);
      }
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Compact header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${run.projectId}`}
            className="text-[10px] mono text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> {run.project?.title ?? "Project"}
          </Link>
          <h1 className="text-sm font-medium tracking-tight mt-0.5 truncate">{run.researchGoal}</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={run.status} />
          <Badge variant="muted" className="mono">
            iter {session?.iterationCount ?? 0}/{run.maxIterations}
          </Badge>
          <Badge variant="outline" className="mono hidden md:inline-flex">{props.modelLabel}</Badge>
          <Elapsed startedAt={run.startedAt} completedAt={run.completedAt} />

          {/* Extend menu */}
          {!isTerminal && (
            <ExtendMenu onExtend={doExtend} />
          )}

          {/* Pause/Resume/Cancel */}
          {isActive && (
            <Button variant="ghost" size="sm" onClick={() => doAction("pause")} disabled={pending}>
              <Pause className="h-3.5 w-3.5" />
            </Button>
          )}
          {run.status === "paused" && (
            <Button variant="ghost" size="sm" onClick={() => doAction("resume")} disabled={pending}>
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isTerminal && (
            <Button variant="ghost" size="sm" onClick={() => doAction("cancel")} disabled={pending} title="Cancel run">
              ✕
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => doAction("duplicate")} disabled={pending} title="Duplicate run">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {report && (
            <>
              <Button asChild variant="ghost" size="sm" title="Download markdown">
                <a href={`/api/runs/${run.id}/export/markdown`}>
                  <FileText className="h-3.5 w-3.5" />
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" title="Download PDF">
                <a href={`/api/runs/${run.id}/export/pdf`}>
                  <FileDown className="h-3.5 w-3.5" />
                </a>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrawerOpen((v) => !v)}
            title="Toggle inspector"
            className={drawerOpen ? "text-primary" : ""}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: drawerOpen ? "minmax(0, 1fr) 360px" : "minmax(0, 1fr)" }}>
        <div className="flex flex-col overflow-hidden">
          <ChatThread
            events={events}
            hypotheses={hypotheses}
            showHypotheses={showHypotheses}
            setShowHypotheses={setShowHypotheses}
            report={report}
            agentRail={
              <AgentRail
                currentPhase={session?.currentPhase}
                status={run.status}
                completed={completedAgents}
                disabled={disabledAgents}
                onToggleDisable={onToggleDisableAgent}
              />
            }
            isTerminal={isTerminal}
          />

          <Composer
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onInterrupt={doInterrupt}
            onSkipCurrent={doSkipCurrent}
            onFinishNow={() => doExtend("finish")}
            isActive={isActive}
            isTerminal={isTerminal}
            pending={pending}
            allSkills={allSkills}
            enabledSkillIds={enabledSkillIds}
            onToggleSkill={onToggleSkill}
            onReloadSkills={async () => {
              const res = await fetch(`/api/skills`);
              if (res.ok) setAllSkills((await res.json()).skills);
            }}
          />
        </div>

        {drawerOpen && (
          <aside className="border-l border-border overflow-hidden h-full">
            <RunDrawer evidence={evidence} sources={sources} tasks={tasks} />
          </aside>
        )}
      </div>
    </div>
  );
}

function ExtendMenu({ onExtend }: { onExtend: (kind: "time" | "iters" | "finish") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} className="gap-1">
        <Clock className="h-3.5 w-3.5" /> Extend <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-popover border border-border rounded-md shadow-md py-1 text-sm">
          <MenuItem onClick={() => { setOpen(false); onExtend("time"); }} icon={<Clock className="h-3.5 w-3.5" />}>
            +30 min runtime
          </MenuItem>
          <MenuItem onClick={() => { setOpen(false); onExtend("iters"); }} icon={<Hash className="h-3.5 w-3.5" />}>
            +10 iterations
          </MenuItem>
          <MenuItem onClick={() => { setOpen(false); onExtend("finish"); }} icon={<Flag className="h-3.5 w-3.5" />}>
            Finish now
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, icon, children }: { onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-secondary text-left">
      {icon}
      {children}
    </button>
  );
}

function ChatThread({
  events,
  hypotheses,
  showHypotheses,
  setShowHypotheses,
  report,
  agentRail,
  isTerminal,
}: {
  events: UiEvent[];
  hypotheses: any[];
  showHypotheses: boolean;
  setShowHypotheses: React.Dispatch<React.SetStateAction<boolean>>;
  report: { markdown: string } | null;
  agentRail: React.ReactNode;
  isTerminal: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [showRail, setShowRail] = useState(false);

  useEffect(() => {
    if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length, stick, hypotheses.length, report]);

  return (
    <div
      ref={ref}
      onScroll={() => {
        if (!ref.current) return;
        const atBottom =
          ref.current.scrollHeight - ref.current.scrollTop - ref.current.clientHeight < 40;
        setStick(atBottom);
      }}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowRail((v) => !v)}
            className="text-[10px] mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {showRail ? "▾" : "▸"} Agent pipeline
          </button>
          {hypotheses.length > 0 && (
            <button
              onClick={() => setShowHypotheses((v) => !v)}
              className="text-[10px] mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {showHypotheses ? "▾" : "▸"} Hypotheses ({hypotheses.length})
            </button>
          )}
        </div>

        {showRail && (
          <div className="border border-border rounded-md p-3 bg-card/40">
            {agentRail}
          </div>
        )}

        {events.length === 0 && (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
            Waiting for the first event…
          </div>
        )}

        {events.map((e) => (
          <EventBubble key={e.id} event={e} />
        ))}

        {showHypotheses && hypotheses.length > 0 && (
          <ArtifactCard title={`Hypotheses (${hypotheses.length})`}>
            <HypothesisList hypotheses={hypotheses} />
          </ArtifactCard>
        )}

        {report && (
          <ArtifactCard title="Final report">
            <ReportPreview markdown={report.markdown} />
          </ArtifactCard>
        )}

        {isTerminal && !report && events.some((e) => e.eventType === "session_completed") && (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
            Run completed without a final report. Check the inspector for tasks/evidence.
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border text-[10px] mono uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EventBubble({ event }: { event: UiEvent }) {
  if (event.eventType === "user_message") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm whitespace-pre-wrap">
          {event.message}
        </div>
      </div>
    );
  }

  const palette = bubblePalette(event.eventType);
  const subtle = ["phase_transition", "task_started", "info"].includes(event.eventType);

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[92%] rounded-md text-sm border bg-card/60",
          palette.border,
          subtle ? "px-3 py-1.5" : "px-3 py-2",
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="text-[10px] mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", palette.dot)} />
            {event.agentName} · {event.eventType.replace(/_/g, " ")}
          </div>
          <div className="text-[10px] mono text-muted-foreground/70">
            {new Date(event.createdAt).toLocaleTimeString()}
          </div>
        </div>
        <div className={cn("tracking-tight", subtle ? "text-xs text-muted-foreground" : "text-sm")}>
          {event.title}
        </div>
        {event.message && !subtle && (
          <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap line-clamp-6">
            {event.message}
          </div>
        )}
      </div>
    </div>
  );
}

function bubblePalette(eventType: string): { border: string; dot: string } {
  switch (eventType) {
    case "task_completed":
    case "session_completed":
    case "final_report_ready":
    case "completion_assessed":
      return { border: "border-emerald-700/60", dot: "bg-emerald-400" };
    case "task_failed":
    case "session_failed":
      return { border: "border-red-700/60", dot: "bg-red-400" };
    case "task_aborted":
    case "step_skipped":
      return { border: "border-amber-700/60", dot: "bg-amber-400" };
    case "budget_limit":
    case "session_paused":
      return { border: "border-orange-700/60", dot: "bg-orange-400" };
    case "hypothesis_created":
    case "recommendation":
      return { border: "border-purple-700/60", dot: "bg-purple-400" };
    case "evidence_created":
    case "ranking_updated":
    case "debate_round":
      return { border: "border-sky-700/60", dot: "bg-sky-400" };
    case "config_updated":
      return { border: "border-indigo-700/60", dot: "bg-indigo-400" };
    default:
      return { border: "border-border", dot: "bg-zinc-500" };
  }
}

function Composer({
  value,
  onChange,
  onSend,
  onInterrupt,
  onSkipCurrent,
  onFinishNow,
  isActive,
  isTerminal,
  pending,
  allSkills,
  enabledSkillIds,
  onToggleSkill,
  onReloadSkills,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  onSkipCurrent: () => void;
  onFinishNow: () => void;
  isActive: boolean;
  isTerminal: boolean;
  pending: boolean;
  allSkills: UiSkill[];
  enabledSkillIds: Set<string>;
  onToggleSkill: (id: string) => void;
  onReloadSkills: () => Promise<void> | void;
}) {
  const [showSkills, setShowSkills] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showSkills) void onReloadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSkills]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSend();
    }
  };

  const placeholder = isTerminal
    ? "Run finished. Duplicate to start a new run."
    : isActive
      ? "Send a follow-up. Try /skip, /skip <agent>, /extend 30, /finish, /pause…"
      : "Send a message to the agents…";

  return (
    <div className="border-t border-border bg-background">
      <div className="max-w-4xl mx-auto px-6 py-3 space-y-2">
        {/* Skills row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowSkills((v) => !v)}
            className="text-[10px] mono uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1"
            title="Choose skills active for this run"
          >
            <Sparkles className="h-3 w-3" /> skills · {enabledSkillIds.size}
          </button>
          {Array.from(enabledSkillIds).map((id) => {
            const s = allSkills.find((x) => x.id === id);
            if (!s) return null;
            return (
              <button
                key={id}
                onClick={() => onToggleSkill(id)}
                disabled={isTerminal}
                className="text-[11px] mono px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                title={s.description}
              >
                {s.name}
                <span className="ml-1 opacity-70">×</span>
              </button>
            );
          })}
        </div>

        {showSkills && (
          <div className="border border-border rounded-md p-2 bg-card/40 max-h-48 overflow-y-auto space-y-1">
            {allSkills.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-3 flex items-center justify-between">
                <span>No skills yet.</span>
                <Link href="/skills" className="text-primary hover:underline">Create one →</Link>
              </div>
            )}
            {allSkills.map((s) => {
              const on = enabledSkillIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => onToggleSkill(s.id)}
                  disabled={isTerminal}
                  className={cn(
                    "w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-md hover:bg-secondary text-xs",
                    on && "bg-secondary/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0",
                      on ? "bg-primary border-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {on && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium tracking-tight">{s.name}</span>
                    <span className="block text-muted-foreground text-[11px] line-clamp-2">{s.description}</span>
                  </span>
                  <Badge variant="outline" className="mono shrink-0">{s.scope}</Badge>
                </button>
              );
            })}
            <div className="px-2 pt-2 border-t border-border/60 flex items-center justify-end">
              <Link href="/skills" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Plus className="h-3 w-3" /> Manage skills
              </Link>
            </div>
          </div>
        )}

        <div className="border border-border rounded-md bg-card/60 focus-within:border-primary/60 transition-colors">
          <Textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            rows={2}
            className="border-0 bg-transparent resize-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[44px] max-h-48"
            disabled={isTerminal && !isActive}
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-border/60">
            <div className="flex items-center gap-1">
              {isActive && (
                <Button variant="ghost" size="sm" onClick={onSkipCurrent} disabled={pending} title="Skip current step">
                  skip step
                </Button>
              )}
              {!isTerminal && (
                <Button variant="ghost" size="sm" onClick={onFinishNow} disabled={pending} title="Stop iterating and produce the final report">
                  finish now
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isActive ? (
                <Button variant="outline" size="sm" onClick={onInterrupt} disabled={pending} title="Hard-abort the in-flight LLM call">
                  <Square className="h-3 w-3 fill-current" /> Stop
                </Button>
              ) : (
                <Button size="sm" onClick={onSend} disabled={pending || !value.trim() || (isTerminal && !isActive)}>
                  <Send className="h-3 w-3" /> Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { formatElapsed };
