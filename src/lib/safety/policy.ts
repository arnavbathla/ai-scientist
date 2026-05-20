/**
 * Safety policy.
 *
 * Two layers:
 *   1) A deterministic keyword/regex screen flags clearly dangerous goals.
 *   2) An LLM-backed classifier (in SafetyAgent) produces the final verdict
 *      with category and severity.
 *
 * The deterministic screen is conservative — it short-circuits to a block when
 * a goal is unambiguously operational (e.g. "synthesize ricin"), but it does
 * NOT serve as the only line of defense. The LLM classifier sees the same goal
 * plus context and may upgrade or downgrade severity.
 */

export type DeterministicSafetyVerdict =
  | { kind: "clear" }
  | { kind: "warn"; category: string; signals: string[] }
  | { kind: "block"; category: string; signals: string[] };

// Patterns are illustrative and broad-strokes; the LLM classifier does the real work.
const BLOCK_PATTERNS: Array<{ category: string; rx: RegExp }> = [
  { category: "biosecurity", rx: /\b(synthes(?:is|ize)|create|enhance|weaponize)[^.]{0,80}\b(anthrax|smallpox|ebola|marburg|botulinum|nipah|sarin|vx|nerve agent|select agent|pathogen|bioweapon)\b/i },
  { category: "biosecurity", rx: /\b(gain[- ]of[- ]function)[^.]{0,80}(pathogen|virus|bacter|host range)\b/i },
  { category: "chemical_safety", rx: /\b(synthes(?:is|ize)|produce|cook)[^.]{0,40}\b(ricin|sarin|vx|tabun|soman|cyanide gas|mustard gas|chemical weapon|nerve agent|fentanyl|methamphetamine|tnt|hmx|pet[n])\b/i },
  { category: "chemical_safety", rx: /\b(explosive|detonat|improvised explosive|ied)\b[^.]{0,40}(recipe|synthesis|procedure|build)/i },
  { category: "dual_use", rx: /\b(evade|circumvent|bypass)[^.]{0,40}(safety|detection|controls|safeguards|regulation)/i },
];

const WARN_PATTERNS: Array<{ category: string; rx: RegExp }> = [
  { category: "biosecurity", rx: /\bgain[- ]of[- ]function\b/i },
  { category: "dual_use", rx: /\bdual[- ]use\b/i },
  { category: "clinical_safety", rx: /\b(self[- ]experiment|untested human protocol)/i },
];

export function deterministicSafetyScreen(text: string): DeterministicSafetyVerdict {
  const blockSignals: string[] = [];
  let blockCategory: string | null = null;
  for (const p of BLOCK_PATTERNS) {
    const m = text.match(p.rx);
    if (m) {
      blockSignals.push(m[0]);
      blockCategory = blockCategory ?? p.category;
    }
  }
  if (blockSignals.length) {
    return { kind: "block", category: blockCategory!, signals: blockSignals };
  }
  const warnSignals: string[] = [];
  let warnCategory: string | null = null;
  for (const p of WARN_PATTERNS) {
    const m = text.match(p.rx);
    if (m) {
      warnSignals.push(m[0]);
      warnCategory = warnCategory ?? p.category;
    }
  }
  if (warnSignals.length) {
    return { kind: "warn", category: warnCategory!, signals: warnSignals };
  }
  return { kind: "clear" };
}
