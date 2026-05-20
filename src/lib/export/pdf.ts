/**
 * PDF export using `pdfkit` + `markdown-it`.
 *
 * We render the report markdown to a token stream, then walk those tokens to
 * draw a clean black & white PDF: serif body, hairline header, page numbers,
 * generated timestamp, references with hanging indent.
 */
import PDFDocument from "pdfkit";
import MarkdownIt from "markdown-it";
import { prisma } from "@/lib/db/prisma";

const md = new MarkdownIt({ html: false, breaks: false, linkify: true, typographer: true });

interface RenderTextOptions {
  font?: "regular" | "bold" | "italic" | "boldItalic" | "mono";
  size?: number;
  indent?: number;
  paragraphAfter?: number;
}

export interface PdfBundle {
  filename: string;
  buffer: Buffer;
}

export async function buildRunPdf(runId: string): Promise<PdfBundle> {
  const report = await prisma.finalReport.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });
  if (!report) throw new Error("No final report exists for this run yet.");

  const buf = await renderReportPdf(report.title, report.markdown);
  return { filename: `researchos-run-${runId.slice(0, 10)}.pdf`, buffer: buf };
}

export function renderReportPdf(title: string, markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: title,
        Author: "ResearchOS",
        Subject: "ResearchOS final report",
        Producer: "ResearchOS PDF exporter",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();

    // Header
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
    doc.text("ResearchOS", { continued: true });
    doc.font("Helvetica").fillColor("#555");
    doc.text(`   ·   final report   ·   generated ${new Date().toISOString()}`, { align: "left" });
    doc.moveDown(0.2);
    doc.strokeColor("#000").lineWidth(0.6).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.6);

    // Tokens
    const tokens = md.parse(markdown, {});
    walkTokens(doc, tokens);

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor("#777");
      doc.text(`${i + 1} / ${range.count}`, doc.page.margins.left, doc.page.height - 40, {
        align: "right",
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
    }

    doc.end();
  });
}

function walkTokens(doc: PDFKit.PDFDocument, tokens: ReturnType<MarkdownIt["parse"]>) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    switch (t.type) {
      case "heading_open": {
        const level = Number(t.tag.slice(1)) || 2;
        const inner = collectInline(tokens, i + 1);
        renderParagraph(doc, inner.text, {
          font: "bold",
          size: level === 1 ? 18 : level === 2 ? 14 : 12,
          paragraphAfter: 4,
        });
        i = inner.skipTo + 1; // skip closing tag
        break;
      }
      case "paragraph_open": {
        const inner = collectInline(tokens, i + 1);
        renderParagraph(doc, inner.text, { font: "regular", size: 10.5, paragraphAfter: 6 });
        i = inner.skipTo + 1;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const isOrdered = t.type === "ordered_list_open";
        const items: string[] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j].type !== `${isOrdered ? "ordered" : "bullet"}_list_close`) {
          if (tokens[j].type === "list_item_open") {
            let k = j + 1;
            const pieces: string[] = [];
            while (k < tokens.length && tokens[k].type !== "list_item_close") {
              if (tokens[k].type === "paragraph_open") {
                const inner = collectInline(tokens, k + 1);
                pieces.push(inner.text);
                k = inner.skipTo + 1;
              } else {
                k++;
              }
            }
            items.push(pieces.join(" "));
            j = k + 1;
          } else {
            j++;
          }
        }
        for (const [idx, item] of items.entries()) {
          const prefix = isOrdered ? `${idx + 1}.  ` : "•  ";
          renderParagraph(doc, prefix + item, { font: "regular", size: 10.5, indent: 12, paragraphAfter: 3 });
        }
        i = j + 1;
        break;
      }
      case "table_open": {
        // Render tables as flowing paragraphs to keep pdfkit dep small.
        // Find table_close; collect rows.
        const rows: string[][] = [];
        let j = i + 1;
        let currentRow: string[] = [];
        while (j < tokens.length && tokens[j].type !== "table_close") {
          if (tokens[j].type === "tr_open") currentRow = [];
          if (tokens[j].type === "tr_close") {
            rows.push(currentRow);
            currentRow = [];
          }
          if (tokens[j].type === "th_open" || tokens[j].type === "td_open") {
            const inner = collectInline(tokens, j + 1);
            currentRow.push(inner.text);
            j = inner.skipTo + 1;
            continue;
          }
          j++;
        }
        for (const [ri, row] of rows.entries()) {
          renderParagraph(doc, row.join("  |  "), {
            font: ri === 0 ? "bold" : "regular",
            size: 9.5,
            paragraphAfter: 2,
          });
        }
        doc.moveDown(0.3);
        i = j + 1;
        break;
      }
      case "blockquote_open": {
        let j = i + 1;
        const buf: string[] = [];
        while (j < tokens.length && tokens[j].type !== "blockquote_close") {
          if (tokens[j].type === "paragraph_open") {
            const inner = collectInline(tokens, j + 1);
            buf.push(inner.text);
            j = inner.skipTo + 1;
          } else {
            j++;
          }
        }
        renderParagraph(doc, buf.join(" "), {
          font: "italic",
          size: 10,
          indent: 12,
          paragraphAfter: 4,
        });
        i = j + 1;
        break;
      }
      case "hr": {
        doc
          .strokeColor("#999")
          .lineWidth(0.4)
          .moveTo(doc.page.margins.left, doc.y + 2)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
          .stroke();
        doc.moveDown(0.4);
        i++;
        break;
      }
      case "fence":
      case "code_block": {
        const text = t.content || "";
        renderParagraph(doc, text, { font: "mono", size: 9.5, indent: 8, paragraphAfter: 4 });
        i++;
        break;
      }
      default:
        i++;
        break;
    }
  }
}

function collectInline(
  tokens: ReturnType<MarkdownIt["parse"]>,
  startIdx: number,
): { text: string; skipTo: number } {
  // The first inline token after start contains the children.
  let i = startIdx;
  while (i < tokens.length && tokens[i].type !== "inline") i++;
  if (i >= tokens.length) return { text: "", skipTo: startIdx };
  const inline = tokens[i];
  const children = inline.children ?? [];
  const parts: string[] = [];
  for (const c of children) {
    if (c.type === "text") parts.push(c.content);
    else if (c.type === "softbreak" || c.type === "hardbreak") parts.push(" ");
    else if (c.type === "code_inline") parts.push(c.content);
    else if (c.type === "link_open") {
      // emit href in parens after link text
      const href = c.attrGet("href") ?? "";
      parts.push("[");
      // wait, simpler: just include link text and trailing url
      parts.push(`__LINK_TEXT__|${href}|`);
    }
    // skip emphasis tokens (text inside is also a text child)
    // softbreaks already handled
  }
  // Re-flow link markers: convert [__LINK_TEXT__|href| <text> ... maybe + close]
  // Simpler: just replace markers
  let text = parts.join("");
  text = text
    .replace(/__LINK_TEXT__\|([^|]+)\|/g, " ($1) ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, skipTo: i };
}

function renderParagraph(doc: PDFKit.PDFDocument, text: string, opts: RenderTextOptions) {
  if (!text) return;
  switch (opts.font) {
    case "bold":
      doc.font("Helvetica-Bold");
      break;
    case "italic":
      doc.font("Helvetica-Oblique");
      break;
    case "boldItalic":
      doc.font("Helvetica-BoldOblique");
      break;
    case "mono":
      doc.font("Courier");
      break;
    default:
      doc.font("Helvetica");
  }
  doc.fontSize(opts.size ?? 10.5);
  doc.fillColor("#000");
  const left = doc.page.margins.left + (opts.indent ?? 0);
  const width = doc.page.width - left - doc.page.margins.right;
  doc.text(text, left, doc.y, { width, lineGap: 2 });
  if (opts.paragraphAfter) doc.moveDown((opts.paragraphAfter ?? 6) / 14);
}
