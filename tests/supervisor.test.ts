import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => {
  return {
    prisma: {
      agentTask: { count: vi.fn() },
      hypothesis: { count: vi.fn(), findMany: vi.fn() },
      finalReport: { findFirst: vi.fn() },
      completionAssessment: { findFirst: vi.fn() },
      agentEvent: { findMany: vi.fn() },
    },
  };
});

import { pickNextAction } from "@/lib/agents/core/supervisor";
import { prisma } from "@/lib/db/prisma";

const baseRun = {
  id: "r1",
  researchGoal: "test",
  maxIterations: 25,
  maxRuntimeMinutes: 60,
  maxSources: 50,
  maxHypotheses: 20,
  status: "running",
  sourceConfig: {},
  constraints: {},
  disabledAgents: [] as string[],
  skipCurrent: false,
} as unknown as import("@prisma/client").ResearchRun;

const baseSession = {
  id: "s1",
  runId: "r1",
  iterationCount: 0,
  status: "active",
} as unknown as import("@prisma/client").AgentSession;

function stubCounts(opts: {
  init?: number;
  lit?: number;
  domain?: number;
  reflection?: number;
  verification?: number;
  ranking?: number;
  evolution?: number;
  hypotheses?: number;
}) {
  const taskCount = vi.mocked(prisma.agentTask.count);
  // Order in supervisor's Promise.all:
  //   init, lit, domain, hypothesisCount (separate), reflection,
  //   verification, ranking, evolution, finalReport, latestAssessment,
  //   recommendations.
  taskCount.mockResolvedValueOnce(opts.init ?? 0);
  taskCount.mockResolvedValueOnce(opts.lit ?? 0);
  taskCount.mockResolvedValueOnce(opts.domain ?? 0);
  vi.mocked(prisma.hypothesis.count).mockResolvedValueOnce(opts.hypotheses ?? 0);
  taskCount.mockResolvedValueOnce(opts.reflection ?? 0);
  taskCount.mockResolvedValueOnce(opts.verification ?? 0);
  taskCount.mockResolvedValueOnce(opts.ranking ?? 0);
  taskCount.mockResolvedValueOnce(opts.evolution ?? 0);
  // topHypothesisCount and clusterCount queries both call hypothesis.count
  vi.mocked(prisma.hypothesis.count).mockResolvedValueOnce(0);
  vi.mocked(prisma.hypothesis.count).mockResolvedValueOnce(0);
  vi.mocked(prisma.finalReport.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.completionAssessment.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.agentEvent.findMany).mockResolvedValue([] as never);
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

  it("schedules LiteratureRetrieval after initialization", async () => {
    stubCounts({ init: 1 });
    const action = await pickNextAction(baseRun, baseSession);
    expect(action.kind).toBe("schedule");
    if (action.kind === "schedule") expect(action.agentName).toBe("LiteratureRetrievalAgent");
  });

  it("schedules Generation after retrieval", async () => {
    stubCounts({ init: 1, lit: 1 });
    const action = await pickNextAction(baseRun, baseSession);
    if (action.kind === "schedule") expect(action.agentName).toBe("GenerationAgent");
  });

  it("honors disabledAgents and skips to the next gate", async () => {
    stubCounts({ init: 1 });
    const run = {
      ...baseRun,
      disabledAgents: ["LiteratureRetrievalAgent"],
    } as unknown as import("@prisma/client").ResearchRun;
    const action = await pickNextAction(run, baseSession);
    expect(action.kind).toBe("schedule");
    if (action.kind === "schedule") {
      expect(action.agentName).toBe("GenerationAgent");
    }
  });
});
