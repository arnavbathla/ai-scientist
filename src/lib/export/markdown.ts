import { prisma } from "@/lib/db/prisma";

export interface MarkdownBundle {
  filename: string;
  markdown: string;
}

/**
 * Build the markdown export for a run. Uses the most recent FinalReport row's
 * markdown directly (already authored by MetaReviewAgent with full structure).
 */
export async function buildRunMarkdown(runId: string): Promise<MarkdownBundle> {
  const report = await prisma.finalReport.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });
  if (!report) throw new Error("No final report exists for this run yet.");
  const filename = `researchos-run-${runId.slice(0, 10)}.md`;
  return { filename, markdown: report.markdown };
}
