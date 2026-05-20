import { env } from "@/lib/utils/env";
import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * PubMed (NCBI E-utilities) search tool.
 *
 * Pipeline:
 *   1) ESearch returns PMIDs for the query.
 *   2) ESummary returns metadata (title, authors, journal, year, doi).
 *   3) EFetch retrieves abstracts (XML mode) for those PMIDs.
 *
 * Endpoint: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 */
const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function commonParams(): Record<string, string> {
  const e = env();
  const p: Record<string, string> = { tool: "ResearchOS", db: "pubmed" };
  if (e.NCBI_EMAIL) p.email = e.NCBI_EMAIL;
  if (e.NCBI_API_KEY) p.api_key = e.NCBI_API_KEY;
  return p;
}

function qs(params: Record<string, string>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) u.set(k, v);
  return u.toString();
}

export async function pubmedSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];

  let pmids: string[] = [];
  try {
    const term = buildPubMedTerm(input);
    const url = `${BASE}/esearch.fcgi?${qs({ ...commonParams(), term, retmax: String(limit), retmode: "json", sort: "relevance" })}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    pmids = (json?.esearchresult?.idlist ?? []) as string[];
  } catch (err) {
    failures.push({ source: "pubmed.esearch", message: err instanceof Error ? err.message : String(err) });
    return { documents, failures };
  }
  if (pmids.length === 0) return { documents, failures };

  // ESummary for metadata
  let summary: any = {};
  try {
    const url = `${BASE}/esummary.fcgi?${qs({ ...commonParams(), id: pmids.join(","), retmode: "json" })}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    summary = json?.result ?? {};
  } catch (err) {
    failures.push({ source: "pubmed.esummary", message: err instanceof Error ? err.message : String(err) });
  }

  // EFetch for abstracts (XML)
  let abstractsByPmid: Record<string, string> = {};
  try {
    const url = `${BASE}/efetch.fcgi?${qs({ ...commonParams(), id: pmids.join(","), rettype: "abstract", retmode: "xml" })}`;
    const res = await fetchWithRetry(url, { method: "GET" });
    const xml = await res.text();
    abstractsByPmid = parsePubMedAbstractXml(xml);
  } catch (err) {
    failures.push({ source: "pubmed.efetch", message: err instanceof Error ? err.message : String(err) });
  }

  for (const pmid of pmids) {
    const entry = summary?.[pmid];
    if (!entry) continue;
    const authors: string[] = Array.isArray(entry.authors)
      ? entry.authors.map((a: any) => a?.name).filter((s: any) => typeof s === "string")
      : [];
    const doiId = (Array.isArray(entry.articleids) ? entry.articleids : [])
      .find((id: any) => id?.idtype === "doi")?.value as string | undefined;
    const year = parseYear(entry.pubdate);
    documents.push({
      sourceType: "pubmed",
      title: typeof entry.title === "string" ? entry.title.replace(/\.$/, "") : "Untitled",
      authors,
      abstract: abstractsByPmid[pmid],
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      doi: doiId,
      pmid,
      year,
      raw: entry,
    });
  }
  return { documents, failures, totalFound: pmids.length };
}

export async function pubmedHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const url = `${BASE}/einfo.fcgi?${qs({ ...commonParams(), retmode: "json" })}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { acceptHeader: "application/json" });
    const ok = res.ok;
    return { ok, message: ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}

function buildPubMedTerm(input: SourceSearchInput): string {
  let term = input.query.trim();
  if (input.yearFrom || input.yearTo) {
    const from = input.yearFrom ?? 1900;
    const to = input.yearTo ?? new Date().getFullYear();
    term = `(${term}) AND (${from}:${to}[dp])`;
  }
  return term;
}

function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const match = pubdate.match(/(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Pull <AbstractText> blocks per <PubmedArticle> using regex.
 *
 * We avoid pulling in a full XML parser dep for this single use; the structure
 * we care about is well-known and stable. We strip nested tags conservatively.
 */
function parsePubMedAbstractXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const articleRe = /<PubmedArticle[\s\S]*?<\/PubmedArticle>/g;
  const articles = xml.match(articleRe) ?? [];
  for (const block of articles) {
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    if (!pmidMatch) continue;
    const pmid = pmidMatch[1];
    const abstractMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
    if (abstractMatches.length === 0) continue;
    const text = abstractMatches
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .join("\n\n");
    result[pmid] = text;
  }
  return result;
}
