import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * AlphaFold DB entries by UniProt accession.
 * Docs: https://alphafold.ebi.ac.uk/api/docs
 *
 * For broader queries (e.g. "TP53"), we first need a UniProt accession. This
 * module exposes a lookup-by-accession path and a convenience search that
 * accepts a comma-separated list of accessions in the query string.
 */
const BASE = "https://alphafold.ebi.ac.uk/api/prediction";

export async function alphafoldSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];
  const accessions = input.query
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(s) || /^[A-Z0-9]{6,10}$/.test(s));
  if (accessions.length === 0) {
    return { documents, failures };
  }
  for (const acc of accessions.slice(0, Math.min(input.limit ?? 5, 10))) {
    try {
      const res = await fetchWithRetry(`${BASE}/${acc}`, { method: "GET" }, { acceptHeader: "application/json" });
      if (!res.ok) {
        failures.push({ source: `alphafold.${acc}`, message: `HTTP ${res.status}` });
        continue;
      }
      const json = (await res.json()) as any;
      const entry = Array.isArray(json) ? json[0] : json;
      if (!entry) continue;
      const organismScientificName = entry.organismScientificName as string | undefined;
      const proteinName = (entry.uniprotDescription || entry.uniprotId || acc) as string;
      documents.push({
        sourceType: "alphafold",
        title: `AlphaFold prediction: ${proteinName} (${acc})`,
        abstract:
          [
            organismScientificName ? `Organism: ${organismScientificName}.` : "",
            entry.modelCreatedDate ? `Created: ${entry.modelCreatedDate}.` : "",
            entry.uniprotSequence ? `Length: ${String(entry.uniprotSequence).length} aa.` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        url: `https://alphafold.ebi.ac.uk/entry/${acc}`,
        raw: entry,
      });
    } catch (err) {
      failures.push({
        source: `alphafold.${acc}`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { documents, failures };
}

export async function alphafoldHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      `${BASE}/P04637`,
      { method: "GET" },
      { acceptHeader: "application/json" },
    );
    return { ok: res.ok, message: res.ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}
