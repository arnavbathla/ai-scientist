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

/**
 * Tests below operate on a directly-inserted run row instead of using
 * `createRun()`. This is intentional: `createRun` enqueues a BullMQ job, and
 * if a real worker is connected to the same Redis (e.g. you ran `pnpm worker`
 * before `pnpm test`) it will race the assertions. By bypassing the queue we
 * test the service layer in isolation, which is what these tests are for.
 */

async function insertRunForTest(): Promise<string> {
  const row = await prisma.researchRun.create({
    data: {
      userId,
      projectId,
      researchGoal: "Identify mechanism-grounded hypotheses about cellular aging.",
      maxIterations: 5,
      maxRuntimeMinutes: 5,
      maxSources: 10,
      maxHypotheses: 5,
      status: "queued",
      sourceConfig: {},
    },
  });
  createdRunIds.push(row.id);
  return row.id;
}

describe("runs service", () => {
  it("createRun stamps a queued run for the owning user", async () => {
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
    const runId = await insertRunForTest();
    await expect(getRunForUser(runId, otherUserId)).rejects.toBeInstanceOf(HttpError);
  });

  it("pauseRun transitions running → paused", async () => {
    const runId = await insertRunForTest();
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "running" } });
    await pauseRun(runId, userId);
    const fresh = await prisma.researchRun.findUnique({ where: { id: runId } });
    expect(fresh!.status).toBe("paused");
  });

  it("resumeRun transitions paused → queued", async () => {
    const runId = await insertRunForTest();
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "paused" } });
    await resumeRun(runId, userId);
    const fresh = await prisma.researchRun.findUnique({ where: { id: runId } });
    // After resume the row is queued; if a worker on the same Redis picks
    // it up immediately the next legal state is running.
    expect(["queued", "running"]).toContain(fresh!.status);
  });

  it("cancelRun marks the run terminal", async () => {
    const runId = await insertRunForTest();
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "running" } });
    await cancelRun(runId, userId);
    const fresh = await prisma.researchRun.findUnique({ where: { id: runId } });
    expect(fresh!.status).toBe("cancelled");
  });

  it("duplicateRun creates a fresh run", async () => {
    const runId = await insertRunForTest();
    const dup = await duplicateRun(runId, userId);
    createdRunIds.push(dup.id);
    expect(dup.id).not.toBe(runId);
    expect(dup.status).toBe("queued");
  });
});
