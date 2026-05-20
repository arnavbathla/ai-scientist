import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ProjectCreateButton } from "@/components/project-create-button";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { runs: true } } },
  });
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              A project groups related research runs. Each run is an independent long-horizon
              session.
            </p>
          </div>
          <ProjectCreateButton />
        </div>
        {projects.length === 0 ? (
          <div className="border border-dashed border-border rounded-md py-16 px-6 flex flex-col items-center gap-3 text-center bg-card/40">
            <div className="text-sm font-medium">No projects yet</div>
            <div className="text-xs text-muted-foreground max-w-md">
              Create your first project to start a research run. Projects let you group
              related runs together.
            </div>
            <ProjectCreateButton />
          </div>
        ) : (
          <div className="border border-border rounded-md divide-y divide-border bg-card">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="block px-4 py-3 hover:bg-secondary/60 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium tracking-tight truncate">{p.title}</div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</div>
                    )}
                  </div>
                  <div className="mono text-[10px] text-muted-foreground">
                    {p._count.runs} run{p._count.runs === 1 ? "" : "s"} · {p.domain ?? "—"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
