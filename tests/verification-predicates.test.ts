import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { verifyTask } from "@/lib/agents/core/verification";

let userId: string;
let projectId: string;
let runId: string;
let sessionId: string;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u = await prisma.user.create({
    data: { email: `verify-${Date.now()}@researchos.local`, passwordHash, name: "VerifyTester" },
  });
  userId = u.id;
  const p = await prisma.project.create({
    data: { userId, title: "verification test", domain: "General biology" },
  });
  projectId = p.id;
  const r = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "test verification predicates",
      status: "running",
      maxIterations: 5,
      maxRuntimeMinutes: 5,
      maxSources: 10,
      maxHypotheses: 5,
    },
  });
  runId = r.id;
  const s = await prisma.agentSession.create({
    data: { runId, status: "active", maxIterations: 5 },
  });
  sessionId = s.id;
});

afterAll(async () => {
  await prisma.researchRun.deleteMany({ where: { id: runId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("verifyTask predicates", () => {
  it("GenerationAgent fails when fewer than 3 hypotheses created since start", async () => {
    const task = await prisma.agentTask.create({
      data: {
        runId,
        sessionId,
        agentName: "GenerationAgent",
        title: "gen",
        description: "gen",
        status: "running",
        startedAt: new Date(),
      },
    });
    createdTaskIds.push(task.id);
    const res = await verifyTask(runId, task.id, "GenerationAgent");
    expect(res.passed).toBe(false);
  });

  it("GenerationAgent passes when at least 3 hypotheses exist since task start", async () => {
    const task = await prisma.agentTask.create({
      data: {
        runId,
        sessionId,
        agentName: "GenerationAgent",
        title: "gen-2",
        description: "gen-2",
        status: "running",
        startedAt: new Date(Date.now() - 1000),
      },
    });
    createdTaskIds.push(task.id);
    for (let i = 0; i < 3; i++) {
      await prisma.hypothesis.create({
        data: {
          runId,
          title: `H${i + 1}`,
          summary: "...",
          mechanism: "...",
          noveltyRationale: "...",
          testability: "...",
          proposedExperimentHighLevel: "...",
          createdByAgent: "GenerationAgent",
        },
      });
    }
    const res = await verifyTask(runId, task.id, "GenerationAgent");
    expect(res.passed).toBe(true);
  });
});
