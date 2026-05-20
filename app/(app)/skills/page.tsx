import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { listSkillsForUser } from "@/lib/skills/service";
import { SkillsView } from "@/components/skills/skills-view";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const [skills, projects] = await Promise.all([
    listSkillsForUser(userId),
    prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);
  return (
    <SkillsView
      initialSkills={JSON.parse(JSON.stringify(skills))}
      projects={JSON.parse(JSON.stringify(projects))}
    />
  );
}
