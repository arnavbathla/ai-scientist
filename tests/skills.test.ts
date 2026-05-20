import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import {
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillsForUser,
  setRunSkills,
  getActiveRunSkills,
} from "@/lib/skills/service";
import { buildSkillsBlock, composeSystem } from "@/lib/agents/core/skills";
import { HttpError } from "@/lib/auth/errors";

let userId: string;
let otherUserId: string;
let projectId: string;
let otherProjectId: string;
let runId: string;
const createdSkillIds: string[] = [];

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u = await prisma.user.create({
    data: { email: `skills-${Date.now()}@researchos.local`, passwordHash, name: "S" },
  });
  const u2 = await prisma.user.create({
    data: { email: `skills2-${Date.now()}@researchos.local`, passwordHash, name: "S2" },
  });
  userId = u.id;
  otherUserId = u2.id;
  const p = await prisma.project.create({
    data: { userId, title: "Skills test", domain: "General biology" },
  });
  projectId = p.id;
  const p2 = await prisma.project.create({
    data: { userId, title: "Other project", domain: "General biology" },
  });
  otherProjectId = p2.id;
  const run = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "Test skills injection",
      maxIterations: 5,
      maxRuntimeMinutes: 5,
      maxSources: 10,
      maxHypotheses: 5,
      status: "queued",
    },
  });
  runId = run.id;
});

afterAll(async () => {
  await prisma.runSkill.deleteMany({ where: { runId } });
  await prisma.researchRun.deleteMany({ where: { id: runId } });
  await prisma.skill.deleteMany({ where: { id: { in: createdSkillIds } } });
  await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("skills service", () => {
  it("createSkill stores a global skill", async () => {
    const s = await createSkill(userId, {
      name: "Mechanism first",
      description: "Prefer mechanism-grounded hypotheses.",
      body: "When generating hypotheses, always anchor the claim to a specific molecular or cellular mechanism.",
    });
    createdSkillIds.push(s.id);
    expect(s.scope).toBe("global");
    expect(s.userId).toBe(userId);
  });

  it("createSkill rejects unowned project", async () => {
    await expect(
      createSkill(otherUserId, {
        name: "Cross-user",
        description: "should fail",
        body: "x",
        scope: "project",
        projectId,
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("updateSkill mutates the body", async () => {
    const s = await createSkill(userId, {
      name: "Cite",
      description: "Cite sources",
      body: "Cite every claim.",
    });
    createdSkillIds.push(s.id);
    const updated = await updateSkill(s.id, userId, { body: "Cite every claim with PMID." });
    expect(updated.body).toBe("Cite every claim with PMID.");
  });

  it("deleteSkill removes the row", async () => {
    const s = await createSkill(userId, {
      name: "Disposable",
      description: "to delete",
      body: "Will be deleted.",
    });
    await deleteSkill(s.id, userId);
    const after = await prisma.skill.findUnique({ where: { id: s.id } });
    expect(after).toBeNull();
  });

  it("listSkillsForUser includes globals and matching project-scoped only", async () => {
    const scoped = await createSkill(userId, {
      name: "Project only",
      description: "scoped",
      body: "scoped body",
      scope: "project",
      projectId,
    });
    createdSkillIds.push(scoped.id);
    const other = await createSkill(userId, {
      name: "Other project only",
      description: "scoped to other project",
      body: "scoped body",
      scope: "project",
      projectId: otherProjectId,
    });
    createdSkillIds.push(other.id);

    const skillsForProject = await listSkillsForUser(userId, { projectId });
    const ids = new Set(skillsForProject.map((s) => s.id));
    expect(ids.has(scoped.id)).toBe(true);
    expect(ids.has(other.id)).toBe(false);
  });
});

describe("skills composition into agent prompts", () => {
  it("setRunSkills + buildSkillsBlock injects only enabled skills", async () => {
    const a = await createSkill(userId, {
      name: "Style A",
      description: "always answer in plain English",
      body: "Use plain English. No jargon.",
    });
    createdSkillIds.push(a.id);
    const b = await createSkill(userId, {
      name: "Style B",
      description: "always cite at least three sources",
      body: "Every claim must have at least three citations.",
    });
    createdSkillIds.push(b.id);
    await setRunSkills(runId, userId, [a.id, b.id]);

    const active = await getActiveRunSkills(runId);
    expect(active).toHaveLength(2);

    const block = await buildSkillsBlock(runId);
    expect(block).toContain("Style A");
    expect(block).toContain("Style B");
    expect(block).toContain("Use plain English");
    expect(block).toContain("citations");
  });

  it("composeSystem appends the skills block to the base system prompt", async () => {
    const base = "You are the GenerationAgent. Output strict JSON.";
    const composed = await composeSystem(base, runId);
    expect(composed.startsWith(base)).toBe(true);
    expect(composed).toContain("<skills>");
    expect(composed).toContain("Style A");
  });

  it("returns empty skills block when run has no enabled skills", async () => {
    await setRunSkills(runId, userId, []);
    const block = await buildSkillsBlock(runId);
    expect(block).toBe("");
  });
});
