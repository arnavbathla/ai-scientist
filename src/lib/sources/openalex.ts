import { env } from "@/lib/utils/env";
import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * OpenAlex `works` endpoint search.
 * Docs: https://api.openalex.org/works
 *
 * We use the polite pool by passing mailto when configured.
 * OpenAlex abstracts come back as an inverted index; we reconstruct the text.
 */
const BASE = "https://api.openalex.org/works";

export async function openalexSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const limit = Math.min(input.limit ?? 25, 50);
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];

  const params = new URLSearchParams();
  params.set("search", input.query);
  params.set("per_page", String(limit));
  if (input.yearFrom || input.yearTo) {
    const filters: string[] = [];
    if (input.yearFrom) filters.push(`from_publication_date:${input.yearFrom}-01-01`);
    if (input.yearTo) filters.push(`to_publication_date:${input.yearTo}-12-31`);
    params.set("filter", filters.join(","));
  }
  const e = env();
  if (e.OPENALEX_EMAIL) params.set("mailto", e.OPENALEX_EMAIL);

  try {
    const res = await fetchWithRetry(`${BASE}?${params}`, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    const results = Array.isArray(json?.results) ? json.results : [];
    for (const w of results) {
      const title = typeof w.title === "string" ? w.title : "Untitled";
      const doi = typeof w.doi === "string" ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : undefined;
      const authors = Array.isArray(w.authorships)
        ? w.authorships
            .map((a: any) => a?.author?.display_name)
            .filter((s: any) => typeof s === "string")
        : [];
      const abstract = reconstructAbstract(w?.abstract_inverted_index);
      const year =
        typeof w.publication_year === "number"
          ? w.publication_year
          : typeof w.publication_date === "string"
            ? Number(w.publication_date.slice(0, 4))
            : undefined;
      const url =
        (typeof w.primary_location?.landing_page_url === "string"
          ? w.primary_location.landing_page_url
          : undefined) ?? (doi ? `https://doi.org/${doi}` : (w.id as string | undefined));
      const ids = w.ids ?? {};
      const pmidRaw = typeof ids.pmid === "string" ? ids.pmid : undefined;
      const pmid = pmidRaw ? pmidRaw.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "") : undefined;
      documents.push({
        sourceType: "openalex",
        title,
        authors,
        abstract,
        url,
        doi,
        pmid,
        year,
        raw: { id: w.id, openalex_id: w.id, ids: w.ids, type: w.type },
      });
    }
    return { documents, failures, totalFound: Number(json?.meta?.count ?? results.length) };
  } catch (err) {
    failures.push({
      source: "openalex.works",
      message: err instanceof Error ? err.message : String(err),
    });
    return { documents, failures };
  }
}

export async function openalexHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      `${BASE}?search=cell&per_page=1`,
      { method: "GET" },
      { acceptHeader: "application/json" },
    );
    return { ok: res.ok, message: res.ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}

function reconstructAbstract(inverted: Record<string, number[]> | undefined): string | undefined {
  if (!inverted || typeof inverted !== "object") return undefined;
  const positions: { idx: number; word: string }[] = [];
  for (const [word, idxs] of Object.entries(inverted)) {
    if (Array.isArray(idxs)) for (const idx of idxs) positions.push({ idx, word });
  }
  positions.sort((a, b) => a.idx - b.idx);
  return positions.map((p) => p.word).join(" ");
}
