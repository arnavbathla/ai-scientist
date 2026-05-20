"use client";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

interface DrawerProps {
  evidence: any[];
  safetyFlags: any[];
  sources: any[];
  tasks: any[];
}

type Tab = "evidence" | "safety" | "sources" | "tasks";

export function RunDrawer({ evidence, safetyFlags, sources, tasks }: DrawerProps) {
  const [tab, setTab] = useState<Tab>("evidence");
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0 border-b border-border">
        {(
          [
            ["evidence", `Evidence (${evidence.length})`],
            ["safety", `Safety (${safetyFlags.length})`],
            ["sources", `Sources (${sources.length})`],
            ["tasks", `Tasks (${tasks.length})`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "px-3 py-2 text-xs mono uppercase tracking-wider border-b-2",
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === "evidence" && evidence.map((e: any) => (
          <div key={e.id} className="border border-border rounded-md p-2 bg-card/50 text-xs">
            <div className="flex items-center justify-between mb-1">
              <Badge variant={supportVariant(e.supportType)}>{e.supportType}</Badge>
              <span className="mono text-[10px] text-muted-foreground">
                confidence {e.confidence.toFixed(2)}
              </span>
            </div>
            <div className="text-foreground/90">{e.claim}</div>
            {e.quote && <div className="text-muted-foreground italic mt-1">“{e.quote}”</div>}
            {e.source && (
              <div className="mt-1 text-muted-foreground mono text-[10px] flex items-center gap-1">
                <span>{e.source.title?.slice(0, 80) ?? "source"}</span>
                {e.source.url && (
                  <a href={e.source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    <ExternalLink className="inline h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
        {tab === "evidence" && evidence.length === 0 && <Empty msg="No evidence yet." />}

        {tab === "safety" && safetyFlags.map((f: any) => (
          <div key={f.id} className="border border-border rounded-md p-2 bg-card/50 text-xs">
            <div className="flex items-center justify-between mb-1">
              <Badge variant={severityVariant(f.severity)}>{f.severity}</Badge>
              <span className="mono text-[10px] text-muted-foreground">{f.category}</span>
            </div>
            <div className="text-foreground/90">{f.message}</div>
          </div>
        ))}
        {tab === "safety" && safetyFlags.length === 0 && <Empty msg="No safety flags." />}

        {tab === "sources" && sources.map((s: any) => (
          <div key={s.id} className="border border-border rounded-md p-2 bg-card/50 text-xs">
            <div className="flex items-center justify-between mb-0.5">
              <Badge variant="outline" className="mono">{s.sourceType}</Badge>
              {s.year && <span className="mono text-[10px] text-muted-foreground">{s.year}</span>}
            </div>
            <div className="text-foreground/90">{s.title}</div>
            <div className="mt-1 mono text-[10px] text-muted-foreground flex items-center gap-2">
              {s.doi && <span>doi:{s.doi}</span>}
              {s.pmid && <span>pmid:{s.pmid}</span>}
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  <ExternalLink className="inline h-2.5 w-2.5" />
                </a>
              )}
            </div>
          </div>
        ))}
        {tab === "sources" && sources.length === 0 && <Empty msg="No sources retrieved yet." />}

        {tab === "tasks" && tasks.map((t: any) => (
          <div key={t.id} className="border border-border rounded-md p-2 bg-card/50 text-xs">
            <div className="flex items-center justify-between mb-1">
              <Badge variant={taskVariant(t.status)}>{t.status}</Badge>
              <span className="mono text-[10px] text-muted-foreground">{t.agentName}</span>
            </div>
            <div className="text-foreground/90">{t.title}</div>
            {t.failureReason && (
              <div className="text-red-400 text-[10px] mt-1 mono">⚠ {t.failureReason.slice(0, 200)}</div>
            )}
          </div>
        ))}
        {tab === "tasks" && tasks.length === 0 && <Empty msg="No tasks yet." />}
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-muted-foreground p-4">{msg}</div>;
}

function supportVariant(t: string): any {
  switch (t) {
    case "supports":
      return "success";
    case "contradicts":
      return "danger";
    case "mixed":
      return "warning";
    case "unsupported":
      return "danger";
    case "background":
      return "muted";
    default:
      return "outline";
  }
}

function severityVariant(s: string): any {
  switch (s) {
    case "blocked":
      return "danger";
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "muted";
    default:
      return "outline";
  }
}

function taskVariant(s: string): any {
  switch (s) {
    case "completed":
      return "success";
    case "running":
      return "primary";
    case "failed":
      return "danger";
    case "blocked":
      return "danger";
    case "cancelled":
      return "muted";
    default:
      return "muted";
  }
}
