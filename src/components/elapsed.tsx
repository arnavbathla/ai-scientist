"use client";
import { useEffect, useState } from "react";

export function Elapsed({ startedAt, completedAt }: { startedAt?: string | null; completedAt?: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (completedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [completedAt]);
  if (!startedAt) return <span className="mono text-[10px] text-muted-foreground">—</span>;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  return <span className="mono text-[10px] text-muted-foreground">{formatElapsed(ms)}</span>;
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}
