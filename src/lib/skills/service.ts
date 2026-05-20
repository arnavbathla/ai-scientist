import { prisma } from "@/lib/db/prisma";
import { HttpError, notFound, forbidden, badRequest } from "@/lib/auth/errors";

export interface SkillInput {
  name: string;
  description: string;
  body: string;
  scope?: "global" | "project";
  projectId?: string | null;
}

const NAME_RE = /^[\w\- .]{2,80}$/;

export async function listSkillsForUser(userId: string, opts?: { projectId?: string | null }) {
  return prisma.skill.findMany({
    where: {
      userId,
      ...(opts?.projectId !== undefined
        ? { OR: [{ scope: "global" }, { projectId: opts.projectId }] }
        : {}),
    },
    orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
  });
}

export async function getSkillForUser(skillId: string, userId: string) {
  const s = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!s) throw notFound();
  if (s.userId !== userId) throw forbidden();
  return s;
}

export async function createSkill(userId: string, input: SkillInput) {
  if (!NAME_RE.test(input.name)) throw badRequest("invalid_name");
  if (!input.description?.trim()) throw badRequest("invalid_description");
  if (!input.body?.trim()) throw badRequest("invalid_body");
  if (input.body.length > 12_000) throw badRequest("body_too_large");
  if (input.scope === "project") {
    if (!input.projectId) throw badRequest("project_required_for_project_scope");
    const proj = await prisma.project.findUnique({ where: { id: input.projectId } });
    if (!proj) throw notFound();
    if (proj.userId !== userId) throw forbidden();
  }
  return prisma.skill.create({
    data: {
      userId,
      projectId: input.scope === "project" ? input.projectId : null,
      name: input.name.trim(),
      description: input.description.trim().slice(0, 1000),
      body: input.body.trim(),
      scope: input.scope ?? "global",
    },
  });
}

export async function updateSkill(
  skillId: string,
  userId: string,
  patch: Partial<SkillInput>,
) {
  const existing = await getSkillForUser(skillId, userId);
  if (patch.name !== undefined && !NAME_RE.test(patch.name)) throw badRequest("invalid_name");
  if (patch.body !== undefined && patch.body.length > 12_000) throw badRequest("body_too_large");
  return prisma.skill.update({
    where: { id: existing.id },
    data: {
      name: patch.name?.trim() ?? existing.name,
      description: patch.description?.trim().slice(0, 1000) ?? existing.description,
      body: patch.body?.trim() ?? existing.body,
      scope: patch.scope ?? existing.scope,
      projectId:
        patch.scope === "project"
          ? patch.projectId ?? existing.projectId
          : patch.scope === "global"
            ? null
            : existing.projectId,
    },
  });
}

export async function deleteSkill(skillId: string, userId: string) {
  await getSkillForUser(skillId, userId);
  await prisma.skill.delete({ where: { id: skillId } });
}

export async function getActiveRunSkills(runId: string) {
  const rows = await prisma.runSkill.findMany({
    where: { runId, enabled: true },
    include: { skill: true },
  });
  return rows.map((r) => r.skill);
}

export async function listRunSkills(runId: string) {
  return prisma.runSkill.findMany({
    where: { runId },
    include: { skill: true },
    orderBy: [{ skill: { scope: "asc" } }, { skill: { createdAt: "desc" } }],
  });
}

export async function setRunSkills(runId: string, userId: string, skillIds: string[]) {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound();
  if (run.userId !== userId) throw forbidden();
  if (skillIds.length > 0) {
    const owned = await prisma.skill.findMany({ where: { id: { in: skillIds }, userId } });
    if (owned.length !== skillIds.length) throw new HttpError(400, "unknown_skill_id");
  }
  await prisma.$transaction([
    prisma.runSkill.deleteMany({ where: { runId } }),
    ...(skillIds.length > 0
      ? [
          prisma.runSkill.createMany({
            data: skillIds.map((skillId) => ({ runId, skillId, enabled: true })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}
