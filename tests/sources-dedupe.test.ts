import { describe, it, expect } from "vitest";
import { dedupeDocuments } from "@/lib/sources";

const baseDoc = {
  sourceType: "pubmed" as const,
  title: "A study of cellular aging",
  raw: {},
};

describe("dedupeDocuments", () => {
  it("dedupes by DOI even across sources", () => {
    const docs = [
      { ...baseDoc, doi: "10.1234/abc", title: "Pubmed copy" },
      { ...baseDoc, sourceType: "openalex" as const, doi: "10.1234/ABC", title: "OpenAlex copy" },
    ];
    expect(dedupeDocuments(docs)).toHaveLength(1);
  });

  it("dedupes by PMID", () => {
    const docs = [
      { ...baseDoc, pmid: "12345" },
      { ...baseDoc, pmid: "12345", title: "Different title" },
    ];
    expect(dedupeDocuments(docs)).toHaveLength(1);
  });

  it("dedupes by normalized title when no doi/pmid", () => {
    const docs = [
      { ...baseDoc, title: "Some study here" },
      { ...baseDoc, title: "  SOME  study   HERE " },
    ];
    expect(dedupeDocuments(docs)).toHaveLength(1);
  });
});
