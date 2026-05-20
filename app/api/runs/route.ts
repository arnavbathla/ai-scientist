import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, withApiErrors, badRequest, HttpError } from "@/lib/auth/session";
import { createRun, DEFAULTS } from "@/lib/runs/service";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

const sourceCfg = z.object({
  enabled: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

const createSchema = z.object({
  projectId: z.string().min(1),
  researchGoal: z.string().min(8).max(4000),
  domain: z.string().max(100).optional(),
  constraints: z
    .object({
      organisms: z.array(z.string()).optional(),
      genes: z.array(z.string()).optional(),
      proteins: z.array(z.string()).optional(),
      diseases: z.array(z.string()).optional(),
      pathways: z.array(z.string()).optional(),
      compounds: z.array(z.string()).optional(),
      excludedDirections: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
  sourceConfig: z
    .object({
      pubmed: sourceCfg.optional(),
      openalex: sourceCfg.optional(),
      crossref: sourceCfg.optional(),
      chembl: sourceCfg.optional(),
      uniprot: sourceCfg.optional(),
      alphafold: sourceCfg.optional(),
    })
    .optional(),
  safetySensitivity: z.enum(["low", "standard", "high"]).optional(),
  maxIterations: z.number().int().min(1).max(200).optional(),
  maxRuntimeMinutes: z.number().int().min(1).max(24 * 60).optional(),
  maxSources: z.number().int().min(5).max(500).optional(),
  maxHypotheses: z.number().int().min(3).max(200).optional(),
  maxModelCostUsd: z.number().min(0).max(1000).optional(),
});

export const POST = withApiErrors(async (req: Request) => {
  const userId = await requireUserId();
  const rl = await checkRateLimit({ key: `runs:${userId}`, limit: 10, windowSeconds: 60 * 10 });
  if (!rl.ok) {
    throw new HttpError(429, `rate_limited:retry_after_${rl.retryAfter ?? 60}`);
  }
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) throw badRequest(`invalid_body:${parsed.error.issues[0]?.path?.join(".")}`);
  const run = await createRun({
    userId,
    projectId: parsed.data.projectId,
    researchGoal: parsed.data.researchGoal,
    domain: parsed.data.domain,
    constraints: parsed.data.constraints as any,
    sourceConfig: parsed.data.sourceConfig as any,
    safetySensitivity: parsed.data.safetySensitivity,
    maxIterations: parsed.data.maxIterations ?? DEFAULTS.maxIterations,
    maxRuntimeMinutes: parsed.data.maxRuntimeMinutes ?? DEFAULTS.maxRuntimeMinutes,
    maxSources: parsed.data.maxSources ?? DEFAULTS.maxSources,
    maxHypotheses: parsed.data.maxHypotheses ?? DEFAULTS.maxHypotheses,
    maxModelCostUsd: parsed.data.maxModelCostUsd,
  });
  return NextResponse.json({ run }, { status: 201 });
});

export const GET = withApiErrors(async (req: Request) => {
  const userId = await requireUserId();
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  const { prisma } = await import("@/lib/db/prisma");
  const runs = await prisma.researchRun.findMany({
    where: {
      userId,
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      projectId: true,
      status: true,
      researchGoal: true,
      domain: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      completionConfidence: true,
      project: { select: { title: true } },
    },
  });
  return NextResponse.json({ runs });
});
