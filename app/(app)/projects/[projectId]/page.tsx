import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { StatusBadge } from "@/components/status-badge";
import { NewRunButton } from "@/components/new-run-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const session = await auth();
  const userId = session!.user.id;
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          researchGoal: true,
          createdAt: true,
          completedAt: true,
          completionConfidence: true,
        },
      },
    },
  });
  if (!project) notFound();
  if (project.userId !== userId) redirect("/projects");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
        <header className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mono">
              Project · {project.domain ?? "—"}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">{project.title}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{project.description}</p>
            )}
          </div>
          <NewRunButton projectId={project.id} defaultDomain={project.domain ?? "General biology"} />
        </header>

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Runs</div>
            <div className="mono text-[10px] text-muted-foreground">{project.runs.length} total</div>
          </div>
          {project.runs.length === 0 ? (
            <div className="border border-dashed border-border rounded-md py-16 px-6 flex flex-col items-center gap-3 text-center bg-card/40">
              <div className="text-sm font-medium">No runs yet</div>
              <div className="text-xs text-muted-foreground max-w-md">
                Start a long-horizon research run. Each run is durable: closing the browser does not
                stop the worker.
              </div>
              <NewRunButton projectId={project.id} defaultDomain={project.domain ?? "General biology"} />
            </div>
          ) : (
            <div className="border border-border rounded-md divide-y divide-border bg-card">
              {project.runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="block px-4 py-3 hover:bg-secondary/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{r.researchGoal}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground mono">
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                        {r.completionConfidence != null && (
                          <>
                            <span>•</span>
                            <span>{(r.completionConfidence * 100).toFixed(0)}%</span>
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
