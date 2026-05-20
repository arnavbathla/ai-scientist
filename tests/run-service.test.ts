import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { createRun, getRunForUser, pauseRun, resumeRun, cancelRun, duplicateRun } from "@/lib/runs/service";
import { HttpError } from "@/lib/auth/errors";

// Integration test that requires the local Postgres from docker-compose to be up.
// We isolate to a unique user per test run.

let userId: string;
let otherUserId: string;
let projectId: string;
let createdRunIds: string[] = [];

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("password123", 4);
  const u1 = await prisma.user.create({
    data: { email: `test-${Date.now()}-a@researchos.local`, passwordHash, name: "T1" },
  });
  const u2 = await prisma.user.create({
    data: { email: `test-${Date.now()}-b@researchos.local`, passwordHash, name: "T2" },
  });
  userId = u1.id;
  otherUserId = u2.id;
  const p = await prisma.project.create({
    data: { userId, title: "Test project", domain: "General biology" },
  });
  projectId = p.id;
});

afterAll(async () => {
  await prisma.researchRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("runs service", () => {
  it("creates a queued run for the owning user", async () => {
    const run = await createRun({
      userId,
      projectId,
      researchGoal: "Identify mechanism-grounded hypotheses about cellular aging.",
      maxIterations: 5,
      maxRuntimeMinutes: 5,
      maxSources: 10,
      maxHypotheses: 5,
    });
    createdRunIds.push(run.id);
    expect(run.status).toBe("queued");
    expect(run.userId).toBe(userId);
  });

  it("forbids another user from reading the run", async () => {
    const run = await prisma.researchRun.findFirst({ where: { userId, projectId } });
    await expect(getRunForUser(run!.id, otherUserId)).rejects.toBeInstanceOf(HttpError);
  });

  it("pause then resume cycles through states", async () => {
    const run = await prisma.researchRun.findFirst({ where: { userId, projectId } });
    // Force into running to satisfy the precondition
    await prisma.researchRun.update({ where: { id: run!.id }, data: { status: "running" } });
    await pauseRun(run!.id, userId);
    let fresh = await prisma.researchRun.findUnique({ where: { id: run!.id } });
    expect(fresh!.status).toBe("paused");
    await resumeRun(run!.id, userId);
    fresh = await prisma.researchRun.findUnique({ where: { id: run!.id } });
    expect(fresh!.status).toBe("queued");
  });

  it("cancel marks the run terminal", async () => {
    const run = await prisma.researchRun.findFirst({ where: { userId, projectId } });
    await cancelRun(run!.id, userId);
    const fresh = await prisma.researchRun.findUnique({ where: { id: run!.id } });
    expect(fresh!.status).toBe("cancelled");
  });

  it("duplicate creates a fresh run", async () => {
    const run = await prisma.researchRun.findFirst({ where: { userId, projectId } });
    const dup = await duplicateRun(run!.id, userId);
    createdRunIds.push(dup.id);
    expect(dup.id).not.toBe(run!.id);
    expect(dup.status).toBe("queued");
  });
});
