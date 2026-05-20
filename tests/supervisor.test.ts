import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the pure decision logic by stubbing the prisma client used inside.
vi.mock("@/lib/db/prisma", () => {
  return {
    prisma: {
      agentTask: { count: vi.fn() },
      hypothesis: { count: vi.fn(), findMany: vi.fn() },
      safetyFlag: { findFirst: vi.fn() },
      finalReport: { findFirst: vi.fn() },
      completionAssessment: { findFirst: vi.fn() },
      agentEvent: { findMany: vi.fn() },
    },
  };
});

import { pickNextAction } from "@/lib/agents/core/supervisor";
import { prisma } from "@/lib/db/prisma";

const baseRun: any = {
  id: "r1",
  researchGoal: "test",
  maxIterations: 25,
  maxRuntimeMinutes: 60,
  maxSources: 50,
  maxHypotheses: 20,
  status: "running",
  sourceConfig: {},
  constraints: {},
};
const baseSession: any = {
  id: "s1",
  runId: "r1",
  iterationCount: 0,
  status: "active",
};

function stubCounts(opts: {
  init?: number;
  safety?: number;
  lit?: number;
  domain?: number;
  generation?: number;
  reflection?: number;
  verification?: number;
  ranking?: number;
  evolution?: number;
  safetyReview?: number;
  hypotheses?: number;
}) {
  const taskCount = vi.mocked(prisma.agentTask.count);
  // Order in supervisor's Promise.all:
  // init, safetyTaskCount, litTaskCount, domainTaskCount, hypothesisCount(below),
  // reflection, verification, ranking, evolution, safetyReview
  taskCount.mockResolvedValueOnce(opts.init ?? 0);
  taskCount.mockResolvedValueOnce(opts.safety ?? 0);
  taskCount.mockResolvedValueOnce(opts.lit ?? 0);
  taskCount.mockResolvedValueOnce(opts.domain ?? 0);
  // hypothesis.count
  vi.mocked(prisma.hypothesis.count).mockResolvedValueOnce(opts.hypotheses ?? 0);
  taskCount.mockResolvedValueOnce(opts.reflection ?? 0);
  taskCount.mockResolvedValueOnce(opts.verification ?? 0);
  taskCount.mockResolvedValueOnce(opts.ranking ?? 0);
  taskCount.mockResolvedValueOnce(opts.evolution ?? 0);
  taskCount.mockResolvedValueOnce(opts.safetyReview ?? 0);
  // The second hypothesis.count for topHypothesisCount
  vi.mocked(prisma.hypothesis.count).mockResolvedValueOnce(0);
  vi.mocked(prisma.finalReport.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.completionAssessment.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.agentEvent.findMany).mockResolvedValue([] as any);
  vi.mocked(prisma.safetyFlag.findFirst).mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("supervisor.pickNextAction", () => {
  it("schedules InitializerAgent when not initialized", async () => {
    stubCounts({});
    const action = await pickNextAction(baseRun, baseSession);
    expect(action.kind).toBe("schedule");
    if (action.kind === "schedule") expect(action.agentName).toBe("InitializerAgent");
  });

  it("schedules SafetyAgent after initialization", async () => {
    stubCounts({ init: 1 });
    const action = await pickNextAction(baseRun, baseSession);
    if (action.kind === "schedule") {
      expect(action.agentName).toBe("SafetyAgent");
      expect(action.phase).toBe("safety_intake");
    }
  });

  it("schedules LiteratureRetrieval after safety", async () => {
    stubCounts({ init: 1, safety: 1 });
    const action = await pickNextAction(baseRun, baseSession);
    if (action.kind === "schedule") expect(action.agentName).toBe("LiteratureRetrievalAgent");
  });

  it("schedules Generation after retrieval", async () => {
    stubCounts({ init: 1, safety: 1, lit: 1 });
    const action = await pickNextAction(baseRun, baseSession);
    if (action.kind === "schedule") expect(action.agentName).toBe("GenerationAgent");
  });

  it("stops with blocked when a blocked safety flag exists", async () => {
    stubCounts({ init: 1, safety: 1 });
    vi.mocked(prisma.safetyFlag.findFirst).mockResolvedValue({
      id: "f1",
      runId: "r1",
      severity: "blocked",
      category: "biosecurity",
      message: "Goal violates policy.",
      hypothesisId: null,
      createdAt: new Date(),
    } as any);
    const action = await pickNextAction(baseRun, baseSession);
    expect(action.kind).toBe("stop");
    if (action.kind === "stop") expect(action.status).toBe("blocked");
  });
});
