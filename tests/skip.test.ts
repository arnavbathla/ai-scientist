import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { skipStep } from "@/lib/runs/service";
import { pickNextAction } from "@/lib/agents/core/supervisor";

let userId: string;
let projectId: string;
let runId: string;
let sessionId: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u = await prisma.user.create({
    data: { email: `skip-${Date.now()}@researchos.local`, passwordHash, name: "Sk" },
  });
  userId = u.id;
  const p = await prisma.project.create({
    data: { userId, title: "Skip test", domain: "General biology" },
  });
  projectId = p.id;
  const r = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "Test skip-step behavior",
      maxIterations: 10,
      maxRuntimeMinutes: 30,
      maxSources: 10,
      maxHypotheses: 5,
      status: "running",
    },
  });
  runId = r.id;
  const s = await prisma.agentSession.create({
    data: {
      runId,
      status: "active",
      maxIterations: 10,
      iterationCount: 1,
      currentPhase: "initializing",
    },
  });
  sessionId = s.id;
});

afterAll(async () => {
  await prisma.agentSession.deleteMany({ where: { id: sessionId } });
  await prisma.researchRun.deleteMany({ where: { id: runId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("skip / disable agents", () => {
  it("disables an agent for the rest of the run", async () => {
    await skipStep(runId, userId, { agentName: "LiteratureRetrievalAgent" });
    const fresh = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(fresh.disabledAgents).toContain("LiteratureRetrievalAgent");
  });

  it("supervisor honors disabledAgents and falls through to the next gate", async () => {
    // Mark initializer complete so the supervisor would normally route to literature retrieval.
    await prisma.agentTask.create({
      data: {
        runId,
        sessionId,
        agentName: "InitializerAgent",
        title: "init",
        description: "stub initializer completion",
        status: "completed",
      },
    });
    const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    const action = await pickNextAction(run, session);
    expect(action.kind).toBe("schedule");
    if (action.kind === "schedule") {
      expect(action.agentName).not.toBe("LiteratureRetrievalAgent");
    }
  });

  it("re-enabling an agent removes it from disabledAgents", async () => {
    await skipStep(runId, userId, { agentName: "LiteratureRetrievalAgent", enable: true });
    const fresh = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(fresh.disabledAgents).not.toContain("LiteratureRetrievalAgent");
  });

  it("currentOnly flips skipCurrent without modifying disabledAgents", async () => {
    await skipStep(runId, userId, { currentOnly: true });
    const fresh = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
    expect(fresh.skipCurrent).toBe(true);
    expect(fresh.disabledAgents).not.toContain("__current__");
  });
});
