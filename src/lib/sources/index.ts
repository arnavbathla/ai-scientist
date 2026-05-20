import { pubmedSearch, pubmedHealth } from "./pubmed";
import { openalexSearch, openalexHealth } from "./openalex";
import { crossrefSearch, crossrefHealth } from "./crossref";
import { chemblSearch, chemblHealth } from "./chembl";
import { uniprotSearch, uniprotHealth } from "./uniprot";
import { alphafoldSearch, alphafoldHealth } from "./alphafold";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

export type SourceId = "pubmed" | "openalex" | "crossref" | "chembl" | "uniprot" | "alphafold";

export const SOURCE_REGISTRY: Record<
  SourceId,
  {
    label: string;
    description: string;
    search: (input: SourceSearchInput) => Promise<SourceSearchResult>;
    health: () => Promise<SourceHealth>;
  }
> = {
  pubmed: {
    label: "PubMed",
    description: "NCBI biomedical literature index.",
    search: pubmedSearch,
    health: pubmedHealth,
  },
  openalex: {
    label: "OpenAlex",
    description: "Open scholarly works index.",
    search: openalexSearch,
    health: openalexHealth,
  },
  crossref: {
    label: "Crossref",
    description: "DOI metadata registry.",
    search: crossrefSearch,
    health: crossrefHealth,
  },
  chembl: {
    label: "ChEMBL",
    description: "Bioactive molecules with drug-like properties.",
    search: chemblSearch,
    health: chemblHealth,
  },
  uniprot: {
    label: "UniProt",
    description: "Comprehensive protein sequence and annotation knowledgebase.",
    search: uniprotSearch,
    health: uniprotHealth,
  },
  alphafold: {
    label: "AlphaFold DB",
    description: "Predicted protein structures from DeepMind/EBI.",
    search: alphafoldSearch,
    health: alphafoldHealth,
  },
};

export const ALL_SOURCE_IDS = Object.keys(SOURCE_REGISTRY) as SourceId[];

export const DEFAULT_SOURCE_CONFIG: Record<SourceId, { enabled: boolean; maxResults: number }> = {
  pubmed: { enabled: true, maxResults: 25 },
  openalex: { enabled: true, maxResults: 25 },
  crossref: { enabled: true, maxResults: 15 },
  chembl: { enabled: false, maxResults: 10 },
  uniprot: { enabled: false, maxResults: 10 },
  alphafold: { enabled: false, maxResults: 5 },
};

/**
 * Dedupe documents by DOI, PMID, or normalized title.
 * Stable order: prefer the first document seen for each identity.
 */
export function dedupeDocuments(docs: NormalizedDocument[]): NormalizedDocument[] {
  const seenDoi = new Set<string>();
  const seenPmid = new Set<string>();
  const seenTitle = new Set<string>();
  const out: NormalizedDocument[] = [];
  for (const d of docs) {
    const doi = d.doi?.toLowerCase().trim();
    const pmid = d.pmid?.trim();
    const titleKey = d.title ? d.title.toLowerCase().replace(/\s+/g, " ").trim() : undefined;
    if (doi && seenDoi.has(doi)) continue;
    if (pmid && seenPmid.has(pmid)) continue;
    if (!doi && !pmid && titleKey && seenTitle.has(titleKey)) continue;
    if (doi) seenDoi.add(doi);
    if (pmid) seenPmid.add(pmid);
    if (titleKey) seenTitle.add(titleKey);
    out.push(d);
  }
  return out;
}
