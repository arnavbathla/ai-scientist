"use client";
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Send, ChevronDown, Check, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

interface ProjectOption {
  id: string;
  title: string;
  domain?: string | null;
}

interface SkillOption {
  id: string;
  name: string;
  description: string;
  scope: string;
}

interface NewRunComposerProps {
  projects: ProjectOption[];
  skills: SkillOption[];
}

export function NewRunComposer({ projects, skills }: NewRunComposerProps) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [showSkillsPicker, setShowSkillsPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>(skills);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const onLaunch = () => {
    setError(null);
    startTransition(async () => {
      let useProjectId = projectId;
      if (!useProjectId) {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Default project" }),
        });
        if (!created.ok) {
          setError("Could not create default project.");
          return;
        }
        const j = await created.json();
        useProjectId = j.project.id;
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: useProjectId,
          researchGoal: goal,
          skillIds: Array.from(selectedSkills),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Could not start run.");
        return;
      }
      const j = await res.json();
      router.push(`/runs/${j.run.id}`);
    });
  };

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refreshSkills = async () => {
    const r = await fetch("/api/skills");
    if (r.ok) setAvailableSkills((await r.json()).skills);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (goal.trim().length >= 12) onLaunch();
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card/60 focus-within:border-primary/60 transition-colors">
      <Textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="Describe a long-horizon research goal. e.g. Identify plausible mechanism-grounded hypotheses to delay senescence in human fibroblasts, with concrete in vitro experiments."
        className="border-0 bg-transparent resize-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[88px]"
      />
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/60 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Project picker */}
          <div className="relative">
            <button
              onClick={() => setShowProjectPicker((v) => !v)}
              className="text-[11px] mono inline-flex items-center gap-1 border border-border rounded-md px-2 py-1 hover:bg-secondary"
            >
              <span className="text-muted-foreground">project:</span>
              <span>{projects.find((p) => p.id === projectId)?.title ?? "Default project"}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showProjectPicker && (
              <div className="absolute left-0 top-full mt-1 z-30 w-56 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
                {projects.length === 0 && (
                  <div className="text-xs text-muted-foreground px-3 py-2">
                    No projects yet. One will be created for you.
                  </div>
                )}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProjectId(p.id);
                      setShowProjectPicker(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center justify-between",
                      projectId === p.id && "bg-secondary",
                    )}
                  >
                    <span>{p.title}</span>
                    {projectId === p.id && <Check className="h-3 w-3" />}
                  </button>
                ))}
                <Link
                  href="/projects"
                  className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
                >
                  <Plus className="h-3 w-3 inline-block mr-1" /> Manage projects
                </Link>
              </div>
            )}
          </div>

          {/* Skills picker */}
          <div className="relative">
            <button
              onClick={() => {
                if (!showSkillsPicker) void refreshSkills();
                setShowSkillsPicker((v) => !v);
              }}
              className="text-[11px] mono inline-flex items-center gap-1 border border-border rounded-md px-2 py-1 hover:bg-secondary"
            >
              <Sparkles className="h-3 w-3" />
              skills · {selectedSkills.size}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showSkillsPicker && (
              <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-popover border border-border rounded-md shadow-md max-h-64 overflow-y-auto">
                {availableSkills.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-3 py-3">
                    No skills yet.
                    <Link href="/skills" className="text-primary hover:underline ml-1">
                      Create one →
                    </Link>
                  </div>
                ) : (
                  availableSkills.map((s) => {
                    const on = selectedSkills.has(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSkill(s.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 hover:bg-secondary text-xs flex items-start gap-2",
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
                          <span className="block text-muted-foreground line-clamp-2">{s.description}</span>
                        </span>
                        <Badge variant="outline" className="mono shrink-0">{s.scope}</Badge>
                      </button>
                    );
                  })
                )}
                <Link
                  href="/skills"
                  className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
                >
                  <Plus className="h-3 w-3 inline-block mr-1" /> Manage skills
                </Link>
              </div>
            )}
          </div>

          {Array.from(selectedSkills).map((id) => {
            const s = availableSkills.find((x) => x.id === id);
            if (!s) return null;
            return (
              <button
                key={id}
                onClick={() => toggleSkill(id)}
                className="text-[11px] mono px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                title={s.description}
              >
                {s.name} <span className="opacity-70">×</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {error && <span className="text-[11px] text-red-400 mono">{error}</span>}
          <span className="text-[10px] mono text-muted-foreground">⌘↵ to launch</span>
          <Button onClick={onLaunch} disabled={pending || goal.trim().length < 12}>
            <Send className="h-3.5 w-3.5" /> {pending ? "Starting…" : "Launch run"}
          </Button>
        </div>
      </div>
    </div>
  );
}
