"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: "global" | "project";
  projectId: string | null;
  createdAt: string;
}

interface SkillsViewProps {
  initialSkills: Skill[];
  projects: { id: string; title: string }[];
}

export function SkillsView({ initialSkills, projects }: SkillsViewProps) {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();

  const refresh = async () => {
    const res = await fetch("/api/skills");
    if (res.ok) {
      const j = await res.json();
      setSkills(j.skills);
    }
  };

  const onDelete = (id: string) => {
    if (!confirm("Delete this skill?")) return;
    startTransition(async () => {
      await fetch(`/api/skills/${id}`, { method: "DELETE" });
      await refresh();
      router.refresh();
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-base font-medium tracking-tight">Skills</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Reusable instructions injected into every agent&apos;s system prompt for the runs you enable them on.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New skill
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {skills.length === 0 ? (
          <div className="border border-dashed border-border rounded-md p-12 text-center">
            <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm text-muted-foreground">No skills yet.</div>
            <div className="text-xs text-muted-foreground/70 mt-1">
              Create a skill to make every agent honor it during a run.
            </div>
            <Button className="mt-4" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Create your first skill
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {skills.map((s) => (
              <div key={s.id} className="border border-border rounded-md p-3 bg-card/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium tracking-tight truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {s.description}
                    </div>
                  </div>
                  <Badge variant="outline" className="mono shrink-0">
                    {s.scope}
                  </Badge>
                </div>
                <pre className="mt-3 text-[11px] mono text-muted-foreground/90 line-clamp-3 whitespace-pre-wrap break-words">
                  {s.body}
                </pre>
                <div className="flex items-center justify-end gap-1 mt-3 border-t border-border pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <SkillEditor
          initial={editing}
          projects={projects}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await refresh();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

interface SkillEditorProps {
  initial: Skill | null;
  projects: { id: string; title: string }[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function SkillEditor({ initial, projects, onClose, onSaved }: SkillEditorProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [scope, setScope] = useState<"global" | "project">(initial?.scope ?? "global");
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = () => {
    setError(null);
    startTransition(async () => {
      const body_ = body.trim();
      if (name.trim().length < 2) {
        setError("Name must be at least 2 characters.");
        return;
      }
      if (!description.trim()) {
        setError("Description is required.");
        return;
      }
      if (!body_) {
        setError("Body is required.");
        return;
      }
      const payload = {
        name: name.trim(),
        description: description.trim(),
        body: body_,
        scope,
        projectId: scope === "project" ? projectId : null,
      };
      const res = initial
        ? await fetch(`/api/skills/${initial.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Could not save skill.");
        return;
      }
      await onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-xl bg-card border border-border rounded-md shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="text-sm font-medium tracking-tight">
            {initial ? "Edit skill" : "New skill"}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prefer mechanism-first hypotheses"
            />
          </div>
          <div>
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short one-line description of what this skill does"
            />
          </div>
          <div>
            <Label htmlFor="skill-body">Body (markdown injected into every agent prompt)</Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={"When generating or critiquing hypotheses, always start with a specific molecular or cellular mechanism. Mark vague systems-level guesses as low-confidence.\n\nWhen the user mentions a gene or protein, cite the most-recent peer-reviewed source you have for it."}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="skill-scope">Scope</Label>
              <select
                id="skill-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "global" | "project")}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="global">Global (any project)</option>
                <option value="project">Project-scoped</option>
              </select>
            </div>
            {scope === "project" && (
              <div>
                <Label htmlFor="skill-project">Project</Label>
                <select
                  id="skill-project"
                  value={projectId ?? ""}
                  onChange={(e) => setProjectId(e.target.value || null)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-400 mono">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={pending}>
            <Save className="h-3.5 w-3.5" /> {pending ? "Saving…" : "Save skill"}
          </Button>
        </div>
      </div>
    </div>
  );
}
