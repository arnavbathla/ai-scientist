import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { StatusBadge } from "@/components/status-badge";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { NewRunComposer } from "@/components/new-run-composer";
import { listSkillsForUser } from "@/lib/skills/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [projects, runs, skills] = await Promise.all([
    prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { _count: { select: { runs: true } } },
    }),
    prisma.researchRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        researchGoal: true,
        createdAt: true,
        completedAt: true,
        completionConfidence: true,
        project: { select: { id: true, title: true } },
      },
    }),
    listSkillsForUser(userId),
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10 space-y-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Research</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Start a long-horizon multi-agent run. ResearchOS plans the work, retrieves literature, generates and ranks hypotheses, and writes a final report.
          </p>
        </header>

        <NewRunComposer
          projects={JSON.parse(JSON.stringify(projects.map((p) => ({ id: p.id, title: p.title, domain: p.domain }))))}
          skills={JSON.parse(JSON.stringify(skills.map((s) => ({ id: s.id, name: s.name, description: s.description, scope: s.scope }))))}
        />

        {projects.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Projects</div>
              <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground">
                All projects →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="border border-border rounded-md p-4 hover:border-primary/60 transition-colors bg-card group"
                >
                  <div className="flex items-start justify-between">
                    <div className="text-sm font-medium tracking-tight">{p.title}</div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                  </div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {p.description}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 mono text-[10px] text-muted-foreground">
                    <span>{p.domain ?? "—"}</span>
                    <span>•</span>
                    <span>{p._count.runs} run{p._count.runs === 1 ? "" : "s"}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Recent runs</div>
            <Link href="/skills" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Manage skills →
            </Link>
          </div>
          {runs.length === 0 ? (
            <div className="border border-dashed border-border rounded-md py-12 px-6 flex flex-col items-center gap-2 text-center bg-card/40">
              <div className="text-sm font-medium tracking-tight">No runs yet</div>
              <div className="text-xs text-muted-foreground max-w-md">
                Describe a research goal above and press launch.
              </div>
            </div>
          ) : (
            <div className="border border-border rounded-md divide-y divide-border bg-card">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="block px-4 py-3 hover:bg-secondary/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{r.researchGoal}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground mono">
                        <span>{r.project.title}</span>
                        <span>•</span>
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                        {r.completionConfidence != null && (
                          <>
                            <span>•</span>
                            <span>{(r.completionConfidence * 100).toFixed(0)}% confidence</span>
                          </>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
