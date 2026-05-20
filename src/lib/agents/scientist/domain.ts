import { prisma } from "@/lib/db/prisma";
import { writeMemory } from "@/lib/agents/core/memory";
import { logToolCall } from "@/lib/tools/registry";
import { SOURCE_REGISTRY, DEFAULT_SOURCE_CONFIG, dedupeDocuments, type SourceId } from "@/lib/sources";
import type { NormalizedDocument } from "@/lib/sources/types";
import type { AgentInvocation, AgentExecResult } from "./context";

interface DomainOutput {
  attempted: string[];
  stored: number;
  failures: { source: string; message: string }[];
}

const DOMAIN_SOURCES: SourceId[] = ["chembl", "uniprot", "alphafold"];

/**
 * DomainRetrievalAgent
 *
 * Pulls ChEMBL / UniProt / AlphaFold data when those sources are enabled and
 * the constraints contain entities the tools can act on (proteins/compounds).
 * If no relevant data is present, gracefully no-ops (returning an "attempted: []"
 * output) so the supervisor doesn't keep rescheduling it.
 */
export async function runDomainRetrieval(ctx: AgentInvocation): Promise<AgentExecResult<DomainOutput>> {
  const cfg = (ctx.run.sourceConfig as any) ?? {};
  const constraints = (ctx.run.constraints as any) ?? {};
  const entities = constraints?.domainEntities ?? {};
  const goal = ctx.run.normalizedGoal ?? ctx.run.researchGoal;

  const queries: Partial<Record<SourceId, string[]>> = {
    chembl: dedupe(
      [
        ...((entities.compounds as string[] | undefined) ?? []),
        ...((entities.proteins as string[] | undefined) ?? []),
      ].slice(0, 4),
    ),
    uniprot: dedupe(
      [
        ...((entities.proteins as string[] | undefined) ?? []),
        ...((entities.genes as string[] | undefined) ?? []),
      ].slice(0, 4),
    ),
    alphafold: dedupe(((entities.proteins as string[] | undefined) ?? []).slice(0, 3)),
  };

  // Fallback: use goal as a query for ChEMBL / UniProt if no entities were named.
  if ((queries.chembl?.length ?? 0) === 0) queries.chembl = [goal.slice(0, 80)];
  if ((queries.uniprot?.length ?? 0) === 0) queries.uniprot = [goal.slice(0, 80)];

  const attempted: string[] = [];
  const failures: { source: string; message: string }[] = [];
  const collected: NormalizedDocument[] = [];

  for (const sid of DOMAIN_SOURCES) {
    const sCfg = { ...DEFAULT_SOURCE_CONFIG[sid], ...(cfg?.[sid] ?? {}) };
    if (!sCfg.enabled) continue;
    const qList = queries[sid] ?? [];
    if (qList.length === 0) continue;
    attempted.push(sid);
    for (const q of qList) {
      try {
        const result = await logToolCall(
          {
            runId: ctx.run.id,
            sessionId: ctx.session.id,
            taskId: ctx.task.id,
            agentName: "DomainRetrievalAgent",
          },
          `${sid}.search`,
          { query: q, limit: sCfg.maxResults },
          () => SOURCE_REGISTRY[sid].search({ query: q, limit: sCfg.maxResults }),
        );
        for (const f of result.failures) failures.push(f);
        for (const d of result.documents) collected.push(d);
      } catch (err) {
        failures.push({ source: sid, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const fresh = dedupeDocuments(collected);
  if (fresh.length > 0) {
    await prisma.sourceDocument.createMany({
      data: fresh.map((d) => ({
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

  if (fresh.length > 0) {
    await writeMemory({
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      memoryType: "source_summary",
      title: `Domain retrieval added ${fresh.length} documents`,
      content: fresh
        .slice(0, 20)
        .map((d) => `- ${d.sourceType.toUpperCase()} — ${d.title.slice(0, 240)}`)
        .join("\n"),
      payload: { attempted, failures },
      importanceScore: 0.5,
    });
  }

  return {
    output: { attempted, stored: fresh.length, failures },
    summary:
      attempted.length === 0
        ? "Domain retrieval skipped: no domain sources enabled."
        : `Domain retrieval added ${fresh.length} documents from ${attempted.join(", ")}.`,
  };
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
