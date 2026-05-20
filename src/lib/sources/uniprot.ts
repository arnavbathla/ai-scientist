import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * UniProt protein search.
 * Docs: https://www.uniprot.org/help/api
 */
const BASE = "https://rest.uniprot.org/uniprotkb/search";

export async function uniprotSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const limit = Math.min(input.limit ?? 10, 25);
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];
  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("size", String(limit));
  params.set("format", "json");
  params.set(
    "fields",
    "accession,id,protein_name,gene_names,organism_name,cc_function,cc_disease,xref_alphafolddb",
  );
  try {
    const res = await fetchWithRetry(`${BASE}?${params}`, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    const results = Array.isArray(json?.results) ? json.results : [];
    for (const r of results) {
      const accession = r?.primaryAccession as string | undefined;
      const proteinName =
        r?.proteinDescription?.recommendedName?.fullName?.value ??
        r?.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
        accession ??
        "Unnamed protein";
      const genes = Array.isArray(r?.genes)
        ? r.genes
            .map((g: any) => g?.geneName?.value ?? g?.synonyms?.[0]?.value)
            .filter((s: any) => typeof s === "string")
        : [];
      const organism = r?.organism?.scientificName as string | undefined;
      const functions: string[] = Array.isArray(r?.comments)
        ? r.comments
            .filter((c: any) => c?.commentType === "FUNCTION")
            .flatMap((c: any) => (Array.isArray(c?.texts) ? c.texts : []))
            .map((t: any) => t?.value)
            .filter((s: any) => typeof s === "string")
        : [];
      const diseases: string[] = Array.isArray(r?.comments)
        ? r.comments
            .filter((c: any) => c?.commentType === "DISEASE")
            .map((c: any) => c?.disease?.diseaseId || c?.disease?.acronym)
            .filter((s: any) => typeof s === "string")
        : [];
      documents.push({
        sourceType: "uniprot",
        title: `Protein: ${proteinName}${genes.length ? ` (${genes.slice(0, 3).join(", ")})` : ""}`,
        abstract:
          [
            organism ? `Organism: ${organism}.` : "",
            functions.length ? `Function: ${functions.join(" ")}` : "",
            diseases.length ? `Diseases: ${diseases.join(", ")}.` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        url: accession ? `https://www.uniprot.org/uniprotkb/${accession}/entry` : undefined,
        raw: { accession, gene_names: genes, organism, ...r },
      });
    }
    return { documents, failures, totalFound: Number(json?.results?.length ?? 0) };
  } catch (err) {
    failures.push({
      source: "uniprot.search",
      message: err instanceof Error ? err.message : String(err),
    });
    return { documents, failures };
  }
}

export async function uniprotHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      `${BASE}?query=insulin&size=1&format=json`,
      { method: "GET" },
      { acceptHeader: "application/json" },
    );
    return { ok: res.ok, message: res.ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}
