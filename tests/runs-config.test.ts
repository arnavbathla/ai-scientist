import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { updateRunConfig } from "@/lib/runs/service";

let userId: string;
let projectId: string;
let runId: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u = await prisma.user.create({
    data: { email: `cfg-${Date.now()}@researchos.local`, passwordHash, name: "C" },
  });
  userId = u.id;
  const p = await prisma.project.create({
    data: { userId, title: "Config test", domain: "General biology" },
  });
  projectId = p.id;
  const r = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "Test live config patching",
      maxIterations: 10,
      maxRuntimeMinutes: 30,
      maxSources: 10,
      maxHypotheses: 5,
      status: "running",
      startedAt: new Date(),
    },
  });
  runId = r.id;
  await prisma.agentSession.create({
    data: {
      runId,
      status: "active",
      maxIterations: 10,
      iterationCount: 4,
      currentPhase: "generation",
    },
  });
});

afterAll(async () => {
  await prisma.agentEvent.deleteMany({ where: { runId } });
  await prisma.agentSession.deleteMany({ where: { runId } });
  await prisma.researchRun.deleteMany({ where: { id: runId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("updateRunConfig", () => {
  it("sets absolute maxIterations + emits config_updated event", async () => {
    const fresh = await updateRunConfig(runId, userId, { maxIterations: 20 });
    expect(fresh.maxIterations).toBe(20);
    const event = await prisma.agentEvent.findFirst({
      where: { runId, eventType: "config_updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });

  it("addIterations adds to the current value", async () => {
    const before = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    const fresh = await updateRunConfig(runId, userId, { addIterations: 5 });
    expect(fresh.maxIterations).toBe(before.maxIterations + 5);
  });

  it("addRuntimeMinutes adds to the current runtime", async () => {
    const before = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    const fresh = await updateRunConfig(runId, userId, { addRuntimeMinutes: 15 });
    expect(fresh.maxRuntimeMinutes).toBe(before.maxRuntimeMinutes + 15);
  });

  it("finishNow lowers maxIterations to the current iteration count", async () => {
    const fresh = await updateRunConfig(runId, userId, { finishNow: true });
    // iterationCount = 4 from beforeAll
    expect(fresh.maxIterations).toBeLessThanOrEqual(4);
  });
});
