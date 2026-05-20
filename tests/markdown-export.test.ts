import { describe, it, expect } from "vitest";
import { renderReportPdf } from "@/lib/export/pdf";

describe("PDF rendering", () => {
  it("produces a non-empty PDF buffer from markdown", async () => {
    const md = `# Test Report

## Executive summary
This is a test.

## Top hypotheses

- Hypothesis A
- Hypothesis B

## References

S1. Author. (2024) Title. doi:10.1234/abc <https://doi.org/10.1234/abc>
`;
    const buf = await renderReportPdf("Test Report", md);
    expect(buf.length).toBeGreaterThan(500);
    // PDF files start with "%PDF-"
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });
});
