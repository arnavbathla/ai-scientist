import { env } from "@/lib/utils/env";
import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * Crossref works search.
 * Docs: https://api.crossref.org/works
 */
const BASE = "https://api.crossref.org/works";

export async function crossrefSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];

  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("rows", String(limit));
  if (input.yearFrom) params.append("filter", `from-pub-date:${input.yearFrom}`);
  if (input.yearTo) params.append("filter", `until-pub-date:${input.yearTo}`);
  const e = env();
  const ua = e.OPENALEX_EMAIL ? `ResearchOS/0.1 (mailto:${e.OPENALEX_EMAIL})` : undefined;

  try {
    const res = await fetchWithRetry(
      `${BASE}?${params}`,
      { method: "GET" },
      { acceptHeader: "application/json", userAgent: ua },
    );
    const json = (await res.json()) as any;
    const items = Array.isArray(json?.message?.items) ? json.message.items : [];
    for (const w of items) {
      const title = Array.isArray(w.title) && w.title[0] ? String(w.title[0]) : "Untitled";
      const doi = typeof w.DOI === "string" ? w.DOI : undefined;
      const authors = Array.isArray(w.author)
        ? w.author
            .map((a: any) => [a?.given, a?.family].filter(Boolean).join(" "))
            .filter((s: string) => Boolean(s))
        : [];
      const yearParts =
        w.issued?.["date-parts"]?.[0] ??
        w["published-print"]?.["date-parts"]?.[0] ??
        w["published-online"]?.["date-parts"]?.[0];
      const year = Array.isArray(yearParts) && typeof yearParts[0] === "number" ? yearParts[0] : undefined;
      const abstract =
        typeof w.abstract === "string"
          ? w.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : undefined;
      const url = doi ? `https://doi.org/${doi}` : typeof w.URL === "string" ? w.URL : undefined;
      documents.push({
        sourceType: "crossref",
        title,
        authors,
        abstract,
        url,
        doi,
        year,
        raw: { DOI: w.DOI, type: w.type, container: w["container-title"] },
      });
    }
    return { documents, failures, totalFound: Number(json?.message?.["total-results"] ?? items.length) };
  } catch (err) {
    failures.push({
      source: "crossref.works",
      message: err instanceof Error ? err.message : String(err),
    });
    return { documents, failures };
  }
}

export async function crossrefHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      `${BASE}?query=cell&rows=1`,
      { method: "GET" },
      { acceptHeader: "application/json" },
    );
    return { ok: res.ok, message: res.ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}
