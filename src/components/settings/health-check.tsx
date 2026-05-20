"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ModelHealthCheck() {
  const [state, setState] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [message, setMessage] = useState<string>("");

  const check = async () => {
    setState("checking");
    setMessage("");
    try {
      const res = await fetch("/api/health/models");
      const j = await res.json();
      if (res.ok && j.ok) {
        setState("ok");
        setMessage(j.anthropic?.message ?? "ok");
      } else {
        setState("fail");
        setMessage(j.anthropic?.error ?? j.anthropic?.message ?? "health check failed");
      }
    } catch (err) {
      setState("fail");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={check} disabled={state === "checking"}>
        {state === "checking" ? "Checking..." : "Run health check"}
      </Button>
      {state === "ok" && <Badge variant="success">healthy</Badge>}
      {state === "fail" && <Badge variant="danger">failed</Badge>}
      {message && <span className="text-xs mono text-muted-foreground truncate max-w-md">{message}</span>}
    </div>
  );
}

export function SourceHealthCheck() {
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const check = async () => {
    setState("checking");
    try {
      const res = await fetch("/api/health/sources");
      const j = await res.json();
      setResults(j.sources ?? {});
      setState("done");
    } catch {
      setState("done");
    }
  };

  return (
    <div>
      <Button variant="outline" size="sm" onClick={check} disabled={state === "checking"}>
        {state === "checking" ? "Pinging sources..." : "Run health check"}
      </Button>
      {state === "done" && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(results).map(([id, r]) => (
            <div key={id} className="border border-border rounded-md p-2 flex items-center justify-between bg-card/40">
              <div className="text-sm font-medium mono">{id}</div>
              <Badge variant={r.ok ? "success" : "danger"}>{r.ok ? "ok" : r.message?.slice(0, 24) ?? "fail"}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
