"use client";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";

export interface UiEvent {
  id: string;
  agentName: string;
  eventType: string;
  title: string;
  message: string;
  createdAt: string;
  payload?: any;
}

const EVENT_COLORS: Record<string, string> = {
  task_started: "border-l-primary",
  task_completed: "border-l-emerald-400",
  task_failed: "border-l-red-400",
  task_blocked: "border-l-orange-400",
  safety_flag: "border-l-orange-400",
  hypothesis_created: "border-l-purple-400",
  evidence_created: "border-l-sky-400",
  debate_round: "border-l-indigo-400",
  ranking_updated: "border-l-indigo-400",
  completion_assessed: "border-l-emerald-400",
  final_report_ready: "border-l-emerald-400",
  recommendation: "border-l-purple-400/50",
  checkpoint: "border-l-zinc-400/40",
  budget_limit: "border-l-amber-400",
  session_blocked: "border-l-red-400",
  session_completed: "border-l-emerald-400",
  session_failed: "border-l-red-400",
  session_paused: "border-l-amber-400",
  session_cancelled: "border-l-zinc-500",
};

export function EventStream({ events }: { events: UiEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events, stick]);

  return (
    <div
      ref={ref}
      onScroll={() => {
        if (!ref.current) return;
        const atBottom =
          ref.current.scrollHeight - ref.current.scrollTop - ref.current.clientHeight < 40;
        setStick(atBottom);
      }}
      className="h-full overflow-y-auto pr-2"
    >
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "border-l-2 pl-3 pr-2 py-2 mb-1 bg-card/30 hover:bg-card transition-colors rounded-r-sm",
              EVENT_COLORS[e.eventType] ?? "border-l-zinc-700",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] mono uppercase tracking-wider text-muted-foreground">
                {e.agentName} · {e.eventType.replace(/_/g, " ")}
              </div>
              <div className="text-[10px] mono text-muted-foreground/70">
                {new Date(e.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <div className="text-sm tracking-tight mt-0.5">{e.title}</div>
            {e.message && (
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-4">{e.message}</div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      {events.length === 0 && (
        <div className="text-xs text-muted-foreground p-4">Waiting for events…</div>
      )}
    </div>
  );
}
