import { prisma } from "@/lib/db/prisma";

/**
 * Build a deterministic skills block to be appended to every agent's
 * system prompt. Skills are user-authored markdown instructions that
 * apply across the multi-agent loop (e.g. "Prefer mechanism-first
 * hypotheses", "Cite UK English spellings", "Avoid drug discovery
 * directions for this project").
 *
 * Returns an empty string when no skills are active so the prompt stays
 * lean for runs without skills configured.
 */
export async function buildSkillsBlock(runId: string, maxChars = 6000): Promise<string> {
  const rows = await prisma.runSkill.findMany({
    where: { runId, enabled: true },
    include: { skill: true },
    orderBy: [{ skill: { scope: "asc" } }, { skill: { createdAt: "asc" } }],
  });
  if (rows.length === 0) return "";

  const items: string[] = [];
  let used = 0;
  for (const r of rows) {
    const s = r.skill;
    const block = `### ${s.name}\n_${s.description}_\n${s.body}`;
    if (used + block.length > maxChars) break;
    items.push(block);
    used += block.length + 2;
  }
  return ["<skills>", "The user has enabled the following research skills for this run. Honor them.", ...items, "</skills>"].join("\n\n");
}

/**
 * Build a "recent user follow-up instructions" block from durable memory.
 * Every agent should surface this so mid-run messages affect downstream work.
 */
export async function buildUserInstructionsBlock(runId: string, maxChars = 2000): Promise<string> {
  const memories = await prisma.agentMemory.findMany({
    where: { runId, memoryType: "user_instruction" },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  if (memories.length === 0) return "";
  const items: string[] = [];
  let used = 0;
  for (const m of memories) {
    const line = `- ${m.content}`;
    if (used + line.length > maxChars) break;
    items.push(line);
    used += line.length + 1;
  }
  return ["<user_followups>", "Recent follow-up instructions from the user:", ...items, "</user_followups>"].join("\n");
}

/**
 * Compose a base agent system prompt with the run-level skills block and
 * recent user-followups block.
 */
export async function composeSystem(base: string, runId: string): Promise<string> {
  const [skills, followups] = await Promise.all([
    buildSkillsBlock(runId),
    buildUserInstructionsBlock(runId),
  ]);
  return [base, skills, followups].filter(Boolean).join("\n\n");
}
