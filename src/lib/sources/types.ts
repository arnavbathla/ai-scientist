import type { SourceType } from "@prisma/client";

export interface NormalizedDocument {
  sourceType: SourceType;
  title: string;
  authors?: string[];
  abstract?: string;
  url?: string;
  doi?: string;
  pmid?: string;
  year?: number;
  raw: Record<string, unknown>;
}

export interface SourceSearchInput {
  query: string;
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
}

export interface SourceSearchResult {
  documents: NormalizedDocument[];
  failures: { source: string; message: string }[];
  totalFound?: number;
}

export interface SourceHealth {
  ok: boolean;
  message: string;
  latencyMs?: number;
}
