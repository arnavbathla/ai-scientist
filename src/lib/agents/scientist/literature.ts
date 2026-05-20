import { prisma } from "@/lib/db/prisma";
import { writeMemory } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import { logToolCall } from "@/lib/tools/registry";
import {
  SOURCE_REGISTRY,
  DEFAULT_SOURCE_CONFIG,
  dedupeDocuments,
  type SourceId,
} from "@/lib/sources";
import type { NormalizedDocument } from "@/lib/sources/types";
import type { AgentInvocation, AgentExecResult } from "./context";

interface LitRetrievalOutput {
  retrieved: number;
  storedNew: number;
  sourcesAttempted: string[];
  sourceFailures: { source: string; message: string }[];
  totalSourcesInRun: number;
}

const LIT_SOURCES: SourceId[] = ["pubmed", "openalex", "crossref"];

/**
 * LiteratureRetrievalAgent
 *
 * Reads the initializer's retrieval plan (queries + sources), executes them
 * across enabled literature databases, deduplicates by DOI/PMID/title, and
 * persists new SourceDocument rows.
 *
 * Honors `run.maxSources` as a global cap so a runaway plan can't blow past
 * the budget.
 */
export async function runLiteratureRetrieval(ctx: AgentInvocation): Promise<AgentExecResult<LitRetrievalOutput>> {
  const cfg = (ctx.run.sourceConfig as any) ?? {};
  const constraints = (ctx.run.constraints as any) ?? {};
  const retrievalPlan = constraints?.retrievalPlan ?? null;

  const queries: string[] =
    retrievalPlan?.queries && Array.isArray(retrievalPlan.queries) && retrievalPlan.queries.length > 0
      ? retrievalPlan.queries.slice(0, 6)
      : [ctx.run.normalizedGoal ?? ctx.run.researchGoal];

  const attempted: string[] = [];
  const failures: { source: string; message: string }[] = [];
  const collected: NormalizedDocument[] = [];

  const currentTotal = await prisma.sourceDocument.count({ where: { runId: ctx.run.id } });
  const remainingBudget = Math.max(0, ctx.run.maxSources - currentTotal);
  if (remainingBudget === 0) {
    await emitEvent({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      taskId: ctx.task.id,
      agentName: "LiteratureRetrievalAgent",
      eventType: "info",
      title: "Source budget reached",
      message: `maxSources=${ctx.run.maxSources} already met by ${currentTotal} stored documents.`,
    });
    return {
      output: {
        retrieved: 0,
        storedNew: 0,
        sourcesAttempted: [],
        sourceFailures: [],
        totalSourcesInRun: currentTotal,
      },
      summary: `Source budget reached (${currentTotal}/${ctx.run.maxSources}). No new fetches.`,
    };
  }

  for (const sid of LIT_SOURCES) {
    const sCfg = { ...DEFAULT_SOURCE_CONFIG[sid], ...(cfg?.[sid] ?? {}) };
    if (!sCfg.enabled) continue;
    attempted.push(sid);
    for (const q of queries) {
      if (collected.length >= remainingBudget) break;
      const max = Math.min(sCfg.maxResults ?? 20, remainingBudget - collected.length);
      try {
        const result = await logToolCall(
          {
            runId: ctx.run.id,
            sessionId: ctx.session.id,
            taskId: ctx.task.id,
            agentName: "LiteratureRetrievalAgent",
          },
          `${sid}.search`,
          { query: q, limit: max },
          () => SOURCE_REGISTRY[sid].search({ query: q, limit: max }),
        );
        for (const f of result.failures) failures.push(f);
        for (const d of result.documents) collected.push(d);
      } catch (err) {
        failures.push({ source: sid, message: err instanceof Error ? err.message : String(err) });
      }
    }
    if (collected.length >= remainingBudget) break;
  }

  const fresh = dedupeDocuments(collected);

  // Filter against already-stored docs for this run (by DOI / PMID / title).
  const existing = await prisma.sourceDocument.findMany({
    where: { runId: ctx.run.id },
    select: { doi: true, pmid: true, title: true },
  });
  const seenDoi = new Set(existing.map((e) => e.doi?.toLowerCase()).filter(Boolean) as string[]);
  const seenPmid = new Set(existing.map((e) => e.pmid).filter(Boolean) as string[]);
  const seenTitle = new Set(existing.map((e) => e.title.toLowerCase().trim()));

  const toInsert = fresh.filter((d) => {
    if (d.doi && seenDoi.has(d.doi.toLowerCase())) return false;
    if (d.pmid && seenPmid.has(d.pmid)) return false;
    if (!d.doi && !d.pmid && seenTitle.has(d.title.toLowerCase().trim())) return false;
    return true;
  });

  if (toInsert.length > 0) {
    await prisma.sourceDocument.createMany({
      data: toInsert.map((d) => ({
        runId: ctx.run.id,
        sourceType: d.sourceType,
        title: d.title.slice(0, 1000),
        authors: (d.authors ?? []) as any,
        abstract: d.abstract?.slice(0, 12_000),
        url: d.url?.slice(0, 1000),
        doi: d.doi?.slice(0, 200),
        pmid: d.pmid?.slice(0, 50),
        year: d.year,
        raw: d.raw as any,
      })),
    });
  }

  const total = await prisma.sourceDocument.count({ where: { runId: ctx.run.id } });
  await writeMemory({
    runId: ctx.run.id,
    sessionId: ctx.session.id,
    memoryType: "source_summary",
    title: `Retrieved ${toInsert.length} new sources (${total} total)`,
    content: toInsert
      .slice(0, 30)
      .map((d) => `- ${d.sourceType.toUpperCase()} ${d.year ?? "n.d."} — ${d.title.slice(0, 240)}`)
      .join("\n"),
    payload: { queries, sources: attempted, failures },
    importanceScore: 0.55,
  });

  const recommendations =
    toInsert.length < 5 && total < ctx.run.maxSources
      ? [
          {
            kind: "phase" as const,
            target: "literature_retrieval",
            rationale: "Few new sources retrieved; consider another retrieval pass with different queries.",
            fromAgent: "LiteratureRetrievalAgent",
          },
        ]
      : [];

  return {
    output: {
      retrieved: fresh.length,
      storedNew: toInsert.length,
      sourcesAttempted: attempted,
      sourceFailures: failures,
      totalSourcesInRun: total,
    },
    summary: `${toInsert.length} new sources stored (${total}/${ctx.run.maxSources}) across ${attempted.join(", ")}.`,
    recommendations,
  };
}
