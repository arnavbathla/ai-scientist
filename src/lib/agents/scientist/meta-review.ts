import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ModelRouter } from "@/lib/models/router";
import { safeGenerateJSON } from "@/lib/models/safe-json";
import { writeMemory } from "@/lib/agents/core/memory";
import { emitEvent } from "@/lib/agents/core/events";
import type { AgentInvocation, AgentExecResult } from "./context";

const ReportSchema = z.object({
  title: z.string().min(8),
  executiveSummary: z.string().min(50),
  topHypothesesNarrative: z.string().min(50),
  bestHypothesis: z.object({
    id: z.string(),
    title: z.string(),
    rationale: z.string(),
  }),
  evidenceTable: z
    .array(
      z.object({
        hypothesisId: z.string(),
        claim: z.string(),
        supportType: z.string(),
        sourceTitle: z.string().optional(),
        sourceLink: z.string().optional(),
      }),
    )
    .default([]),
  contradictoryEvidence: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  nextExperimentsHighLevel: z.array(z.string()).min(1),
  falsificationCriteria: z.array(z.string()).min(1),
  safetyNotes: z.array(z.string()).min(1),
  limitations: z.array(z.string()).min(1),
  openQuestions: z.array(z.string()).min(1),
  unresolvedGaps: z.array(z.string()).default([]),
});

export async function runMetaReview(
  ctx: AgentInvocation,
): Promise<AgentExecResult<{ reportId: string; partial: boolean }>> {
  const partial = Boolean(ctx.partial);
  const provider = ModelRouter.for("finalReport");

  const [
    run,
    topHyps,
    debates,
    rankings,
    evidence,
    sources,
    safetyFlags,
    latestAssessment,
    safetyNotesMemory,
    unresolvedNotes,
  ] = await Promise.all([
    prisma.researchRun.findUniqueOrThrow({ where: { id: ctx.run.id } }),
    prisma.hypothesis.findMany({
      where: { runId: ctx.run.id, status: { not: "rejected" } },
      orderBy: { overallScore: "desc" },
      take: 8,
    }),
    prisma.debateRound.findMany({
      where: { runId: ctx.run.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.ranking.findMany({
      where: { runId: ctx.run.id },
      orderBy: { rank: "asc" },
      take: 10,
    }),
    prisma.evidence.findMany({
      where: { runId: ctx.run.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { source: true },
    }),
    prisma.sourceDocument.findMany({
      where: { runId: ctx.run.id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.safetyFlag.findMany({
      where: { runId: ctx.run.id },
      orderBy: { severity: "desc" },
      take: 20,
    }),
    prisma.completionAssessment.findFirst({
      where: { runId: ctx.run.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentMemory.findMany({
      where: { runId: ctx.run.id, memoryType: "safety_note" },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.agentMemory.findMany({
      where: { runId: ctx.run.id, memoryType: { in: ["blocker", "finding"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const userPrompt = [
    `Research goal: ${run.researchGoal}`,
    `Normalized goal: ${run.normalizedGoal ?? "(not normalized)"}`,
    `Domain: ${run.domain ?? "unspecified"}`,
    partial ? `Note: PARTIAL report due to budget limit (${ctx.limitReason ?? "unknown"}). Be explicit.` : "",
    "",
    "Top hypotheses (with current scores):",
    topHyps
      .map(
        (h, i) =>
          `${i + 1}. id=${h.id} score=${h.overallScore.toFixed(2)} status=${h.status} risk=${h.riskLevel}\n   title: ${h.title}\n   summary: ${h.summary.slice(0, 320)}\n   mechanism: ${h.mechanism.slice(0, 320)}\n   testability: ${h.testability.slice(0, 240)}`,
      )
      .join("\n"),
    "",
    "Rankings (Elo):",
    rankings.map((r) => `  rank=${r.rank} hypId=${r.hypothesisId} elo=${r.eloScore.toFixed(0)}`).join("\n"),
    "",
    "Recent debate rounds (high-level):",
    debates.slice(0, 6).map((d) => `  ${d.hypothesisAId.slice(0, 6)} vs ${d.hypothesisBId.slice(0, 6)} → winner=${d.winnerHypothesisId?.slice(0, 6) ?? "tie"}: ${d.verdict.slice(0, 180)}`).join("\n"),
    "",
    "Evidence rows:",
    evidence
      .slice(0, 20)
      .map(
        (e) =>
          `  - hypId=${e.hypothesisId.slice(0, 6)} support=${e.supportType} src=${e.source?.title?.slice(0, 80) ?? "(none)"}${e.source?.doi ? ` doi:${e.source.doi}` : ""}${e.source?.pmid ? ` pmid:${e.source.pmid}` : ""}\n    claim: ${e.claim.slice(0, 220)}`,
      )
      .join("\n"),
    "",
    "Safety flags:",
    safetyFlags.map((f) => `  - ${f.severity}/${f.category}: ${f.message.slice(0, 240)}`).join("\n") || "  (none)",
    "",
    "Recent safety notes:",
    safetyNotesMemory.map((m) => `  - ${m.title}: ${m.content.slice(0, 200)}`).join("\n") || "  (none)",
    "",
    "Sources used (with identifiers; cite by number S1..Sn in the report):",
    sources
      .slice(0, 25)
      .map(
        (s, i) =>
          `  [S${i + 1}] (${s.sourceType}) ${s.title}${s.year ? ` (${s.year})` : ""}${
            s.doi ? ` doi:${s.doi}` : ""
          }${s.pmid ? ` pmid:${s.pmid}` : ""}${s.url ? ` ${s.url}` : ""}`,
      )
      .join("\n"),
    "",
    latestAssessment
      ? `Latest completion assessment: complete=${latestAssessment.isComplete} confidence=${latestAssessment.confidenceScore.toFixed(2)} rationale=${latestAssessment.rationale.slice(0, 240)}`
      : "(no completion assessment)",
    "",
    unresolvedNotes.length
      ? "Outstanding blockers / findings:\n" + unresolvedNotes.map((m) => `  - ${m.title}: ${m.content.slice(0, 200)}`).join("\n")
      : "",
    "",
    "Schema for JSON output:",
    `{
  "title": "report title",
  "executiveSummary": "2-3 paragraph summary",
  "topHypothesesNarrative": "prose discussion of top hypotheses",
  "bestHypothesis": { "id": "...", "title": "...", "rationale": "..." },
  "evidenceTable": [
    { "hypothesisId": "...", "claim": "...", "supportType": "...", "sourceTitle": "...", "sourceLink": "..." }
  ],
  "contradictoryEvidence": ["..."],
  "unsupportedClaims": ["..."],
  "nextExperimentsHighLevel": ["high-level direction 1", "..."],
  "falsificationCriteria": ["how each top hypothesis could be falsified, conceptually"],
  "safetyNotes": ["safety considerations and constraints"],
  "limitations": ["..."],
  "openQuestions": ["..."],
  "unresolvedGaps": ["..."]
}`,
    "",
    "Return ONLY the JSON object.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await safeGenerateJSON({
    provider,
    schema: ReportSchema,
    systemPrompt: META_SYSTEM,
    userPrompt,
    maxTokens: 5500,
    temperature: 0.25,
    ctx: { runId: ctx.run.id, sessionId: ctx.session.id, taskId: ctx.task.id, agentName: "MetaReviewAgent" },
  });

  const md = renderMarkdown({ run, data, sources, partial, limitReason: ctx.limitReason });

  const report = await prisma.finalReport.create({
    data: {
      runId: run.id,
      title: data.title.slice(0, 280),
      executiveSummary: data.executiveSummary.slice(0, 4000),
      markdown: md,
      json: data as any,
      completionCriteriaPassed: !partial && (latestAssessment?.isComplete ?? false),
      completionConfidence: latestAssessment?.confidenceScore ?? (partial ? 0.4 : 0.6),
      unresolvedGaps: data.unresolvedGaps as any,
    },
  });

  // Promote the chosen best hypothesis to status=selected.
  const selectedId = topHyps.find((h) => h.id === data.bestHypothesis.id)?.id ?? topHyps[0]?.id;
  if (selectedId) {
    await prisma.hypothesis.update({
      where: { id: selectedId },
      data: { status: "selected" },
    });
  }

  await writeMemory({
    runId: run.id,
    sessionId: ctx.session.id,
    memoryType: "final_summary",
    title: partial ? "Partial final report" : "Final report",
    content: data.executiveSummary,
    payload: { reportId: report.id },
    importanceScore: 1.0,
  });
  await emitEvent({
    runId: run.id,
    sessionId: ctx.session.id,
    taskId: ctx.task.id,
    agentName: "MetaReviewAgent",
    eventType: "final_report_ready",
    title: partial ? "Partial final report ready" : "Final report ready",
    message: data.title,
    payload: { reportId: report.id, partial },
  });

  return {
    output: { reportId: report.id, partial },
    summary: `Generated ${partial ? "partial" : "final"} report: ${data.title}`,
  };
}

const META_SYSTEM = `You are the ResearchOS MetaReviewAgent. You synthesize the entire research run into a
publication-quality final report focused on safe, high-level research planning.

Strict rules:
- Never propose operational wetlab protocols.
- Each top hypothesis must include a mechanism, falsification criteria, and a high-level next step.
- Always include references with DOI/PMID/URL.
- Always include limitations, open questions, and unresolved gaps.
- Always include safety notes.
- Always cite supporting sources by their S-number; refer to identifiers (DOI, PMID) where available.
- If the run was a partial report, say so plainly in the executive summary.

Return strict JSON.`;

function renderMarkdown({
  run,
  data,
  sources,
  partial,
  limitReason,
}: {
  run: any;
  data: z.infer<typeof ReportSchema>;
  sources: any[];
  partial: boolean;
  limitReason?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`> _ResearchOS final report — generated ${new Date().toISOString()}_`);
  if (partial) {
    lines.push(
      `>\n> **This is a partial report.** The run stopped before full completion${
        limitReason ? ` (\`${limitReason}\`)` : ""
      }. Unresolved work is listed in the **Limitations** and **Open Questions** sections.`,
    );
  }
  lines.push("");
  lines.push("## Executive summary");
  lines.push(data.executiveSummary);
  lines.push("");
  lines.push("## Research goal");
  lines.push(run.researchGoal);
  if (run.normalizedGoal) {
    lines.push("");
    lines.push("**Normalized goal:** " + run.normalizedGoal);
  }
  lines.push("");
  lines.push("## Completion status");
  lines.push(
    `- Run status: \`${run.status}\``,
  );
  if (run.completionConfidence != null) {
    lines.push(`- Completion confidence: ${(run.completionConfidence * 100).toFixed(0)}%`);
  }
  lines.push("");
  lines.push("## Top hypotheses");
  lines.push(data.topHypothesesNarrative);
  lines.push("");
  lines.push("### Best hypothesis");
  lines.push(`- **${data.bestHypothesis.title}** (id: \`${data.bestHypothesis.id}\`)`);
  lines.push(`- Rationale: ${data.bestHypothesis.rationale}`);
  lines.push("");

  if (data.evidenceTable.length) {
    lines.push("## Evidence table");
    lines.push("| Hypothesis | Support | Claim | Source |");
    lines.push("|---|---|---|---|");
    for (const row of data.evidenceTable.slice(0, 40)) {
      lines.push(
        `| \`${row.hypothesisId.slice(0, 8)}\` | ${row.supportType} | ${escapeMd(row.claim)} | ${
          row.sourceLink ? `[${escapeMd(row.sourceTitle ?? "source")}](${row.sourceLink})` : escapeMd(row.sourceTitle ?? "—")
        } |`,
      );
    }
    lines.push("");
  }

  if (data.contradictoryEvidence.length) {
    lines.push("## Contradictory evidence");
    for (const c of data.contradictoryEvidence) lines.push(`- ${c}`);
    lines.push("");
  }
  if (data.unsupportedClaims.length) {
    lines.push("## Unsupported claims");
    for (const c of data.unsupportedClaims) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("## High-level next experiments");
  for (const n of data.nextExperimentsHighLevel) lines.push(`- ${n}`);
  lines.push("");

  lines.push("## Falsification criteria");
  for (const f of data.falsificationCriteria) lines.push(`- ${f}`);
  lines.push("");

  lines.push("## Safety and ethics notes");
  for (const s of data.safetyNotes) lines.push(`- ${s}`);
  lines.push("");

  lines.push("## Limitations");
  for (const l of data.limitations) lines.push(`- ${l}`);
  lines.push("");

  lines.push("## Open questions");
  for (const q of data.openQuestions) lines.push(`- ${q}`);
  lines.push("");

  if (data.unresolvedGaps.length) {
    lines.push("## Unresolved gaps");
    for (const g of data.unresolvedGaps) lines.push(`- ${g}`);
    lines.push("");
  }

  lines.push("## References");
  if (sources.length === 0) {
    lines.push("_No external sources were retrieved during this run._");
  } else {
    sources.forEach((s, i) => {
      const idx = i + 1;
      const author = Array.isArray(s.authors) && s.authors.length > 0 ? `${s.authors.slice(0, 3).join(", ")}${s.authors.length > 3 ? " et al." : ""}` : "";
      const yearStr = s.year ? `(${s.year}) ` : "";
      const id = s.doi ? `doi:${s.doi}` : s.pmid ? `PMID:${s.pmid}` : "";
      const linkPart = s.url ? `<${s.url}>` : id ? `<https://doi.org/${s.doi ?? ""}>` : "";
      lines.push(`S${idx}. ${author ? `${author}. ` : ""}${yearStr}${escapeMd(s.title)}. ${id} ${linkPart}`.trim());
    });
  }
  lines.push("");
  return lines.join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
