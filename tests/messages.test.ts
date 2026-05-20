import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { appendRunMessage } from "@/lib/runs/service";
import { buildUserInstructionsBlock, composeSystem } from "@/lib/agents/core/skills";

let userId: string;
let projectId: string;
let runId: string;
let sessionId: string;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u = await prisma.user.create({
    data: { email: `messages-${Date.now()}@researchos.local`, passwordHash, name: "M" },
  });
  userId = u.id;
  const p = await prisma.project.create({
    data: { userId, title: "Messages test", domain: "General biology" },
  });
  projectId = p.id;
  const r = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "Test mid-run messages",
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
  await prisma.agentEvent.deleteMany({ where: { runId } });
  await prisma.agentMemory.deleteMany({ where: { runId } });
  await prisma.runMessage.deleteMany({ where: { runId } });
  await prisma.agentSession.deleteMany({ where: { id: sessionId } });
  await prisma.researchRun.deleteMany({ where: { id: runId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("mid-run user messages", () => {
  it("appendRunMessage writes a message, event, and memory", async () => {
    const msg = await appendRunMessage(runId, userId, "Please focus on mitochondrial mechanisms.");
    expect(msg.runId).toBe(runId);

    const event = await prisma.agentEvent.findFirst({
      where: { runId, eventType: "user_message" },
    });
    expect(event).not.toBeNull();
    expect(event!.message).toContain("mitochondrial");

    const memory = await prisma.agentMemory.findFirst({
      where: { runId, memoryType: "user_instruction" },
    });
    expect(memory).not.toBeNull();
    expect(memory!.content).toContain("mitochondrial");
    expect(memory!.importanceScore).toBeGreaterThanOrEqual(0.9);
  });

  it("user instructions block surfaces the message to every agent", async () => {
    await appendRunMessage(runId, userId, "Prefer mouse studies over rat studies for this run.");
    const block = await buildUserInstructionsBlock(runId);
    expect(block).toContain("Prefer mouse studies");

    const system = await composeSystem("Base agent instructions.", runId);
    expect(system).toContain("Base agent instructions.");
    expect(system).toContain("Prefer mouse studies");
  });
});
