/**
 * A small PDF writer.
 *
 * The audit record is a legal artefact, so it has to leave the app as a file —
 * not a screenshot of a page and not something that needs a print dialog. This
 * writes a real PDF using the base-14 Helvetica fonts, so it needs no
 * dependency, renders the same in every reader, and the text stays selectable
 * and searchable.
 *
 * It is deliberately small: a title, headings, paragraphs, label/value pairs,
 * bullets and rules, laid out on A4 with page numbers.
 */

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "kv"; label: string; value: string }
  | { kind: "bullet"; text: string }
  | { kind: "small"; text: string }
  | { kind: "rule" }
  | { kind: "spacer"; height?: number };

export interface PdfDocument {
  /** Repeated in the running header of pages after the first. */
  title: string;
  footer?: string;
  blocks: PdfBlock[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TOP = PAGE_HEIGHT - MARGIN;
/** Leaves room for the footer rule and page number. */
const BOTTOM = MARGIN + 34;

/* ------------------------------------------------------------------ */
/* Text metrics                                                        */
/* ------------------------------------------------------------------ */

/** Helvetica advance widths, in 1/1000 em. */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  "{": 334, "|": 260, "}": 334, "~": 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

function charWidth(ch: string, bold: boolean): number {
  const width = /[0-9]/.test(ch) ? 556 : WIDTHS[ch] ?? 556;
  return (bold ? width * 1.04 : width) / 1000;
}

export function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, bold) * size;
  return total;
}

/** Greedy wrap; a word longer than the line is split rather than overflowing. */
function wrap(text: string, size: number, bold: boolean, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, bold) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    if (textWidth(word, size, bold) <= width) {
      line = word;
      continue;
    }
    let part = "";
    for (const ch of word) {
      if (part && textWidth(part + ch, size, bold) > width) {
        lines.push(part);
        part = ch;
      } else {
        part += ch;
      }
    }
    line = part;
  }

  if (line) lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

/** Characters outside Latin-1, written as their closest plain equivalent. */
const FALLBACK: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
  "\u2013": "-", "\u2014": "--", "\u2026": "...", "\u2022": "-",
  "\u2192": "->", "\u2190": "<-", "\u2265": ">=", "\u2264": "<=",
  "\u00d7": "x", "\u2248": "~", "\u2713": "v", "\u2717": "x",
  "\u00a0": " ",
};

function encodeWinAnsi(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32;
    if (code < 256) {
      bytes.push(code);
      continue;
    }
    const fallback = FALLBACK[ch];
    if (fallback) {
      for (const part of fallback) bytes.push(part.charCodeAt(0) & 0xff);
    } else {
      bytes.push(63);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * PDF string literal: backslash, open and close parenthesis are special, and a
 * literal line break inside a text object would break the stream.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]+/g, " ");
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

type Op =
  | { type: "text"; x: number; y: number; size: number; bold: boolean; gray: number; text: string }
  | { type: "line"; x1: number; x2: number; y: number };

const KV_LABEL_WIDTH = 132;
const KV_GAP = 12;

export function renderPdf(doc: PdfDocument): Uint8Array {
  const pages: Op[][] = [[]];
  let ops = pages[0];
  let y = TOP;

  const ensure = (height: number) => {
    if (y - height >= BOTTOM) return;
    ops = [];
    pages.push(ops);
    y = TOP;
  };

  const text = (value: string, size: number, bold: boolean, gray: number, x = MARGIN) => {
    ops.push({ type: "text", x, y: y - size, size, bold, gray, text: value });
  };

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "title": {
        const size = 19;
        const lines = wrap(block.text, size, true, CONTENT_WIDTH);
        lines.forEach((line) => {
          text(line, size, true, 0.08);
          y -= size * 1.3;
        });
        y -= 2;
        break;
      }
      case "subtitle": {
        const size = 9.5;
        const lines = wrap(block.text, size, false, CONTENT_WIDTH);
        lines.forEach((line) => {
          text(line, size, false, 0.42);
          y -= size * 1.55;
        });
        y -= 8;
        break;
      }
      case "heading": {
        const size = 12;
        y -= 8;
        ensure(size * 1.4 + 8);
        text(block.text, size, true, 0.1);
        y -= size * 1.4 + 5;
        break;
      }
      case "text": {
        const size = 9.8;
        const lineHeight = size * 1.55;
        const lines = wrap(block.text, size, false, CONTENT_WIDTH);
        ensure(lines.length * lineHeight);
        for (const line of lines) {
          text(line, size, false, 0.18);
          y -= lineHeight;
        }
        y -= 5;
        break;
      }
      case "small": {
        const size = 8.6;
        const lineHeight = size * 1.5;
        const lines = wrap(block.text, size, false, CONTENT_WIDTH);
        ensure(lines.length * lineHeight);
        for (const line of lines) {
          text(line, size, false, 0.45);
          y -= lineHeight;
        }
        y -= 5;
        break;
      }
      case "bullet": {
        const size = 9.8;
        const lineHeight = size * 1.5;
        const lines = wrap(block.text, size, false, CONTENT_WIDTH - 14);
        ensure(lines.length * lineHeight);
        text("-", size, false, 0.35, MARGIN + 2);
        for (const line of lines) {
          text(line, size, false, 0.18, MARGIN + 14);
          y -= lineHeight;
        }
        y -= 5;
        break;
      }
      case "kv": {
        const size = 9.6;
        const lineHeight = size * 1.5;
        const labelLines = wrap(block.label, size, true, KV_LABEL_WIDTH);
        const valueLines = wrap(block.value, size, false, CONTENT_WIDTH - KV_LABEL_WIDTH - KV_GAP);
        const rows = Math.max(labelLines.length, valueLines.length);
        ensure(rows * lineHeight);
        const top = y;
        labelLines.forEach((line, index) => {
          ops.push({
            type: "text",
            x: MARGIN,
            y: top - size - index * lineHeight,
            size,
            bold: true,
            gray: 0.38,
            text: line,
          });
        });
        valueLines.forEach((line, index) => {
          ops.push({
            type: "text",
            x: MARGIN + KV_LABEL_WIDTH + KV_GAP,
            y: top - size - index * lineHeight,
            size,
            bold: false,
            gray: 0.18,
            text: line,
          });
        });
        y -= rows * lineHeight + 2;
        break;
      }
      case "rule": {
        ensure(10);
        y -= 5;
        ops.push({ type: "line", x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y });
        y -= 8;
        break;
      }
      case "spacer": {
        y -= block.height ?? 8;
        break;
      }
    }
  }

  // Page furniture: running header after the first page, rule and page number.
  const total = pages.length;
  pages.forEach((pageOps, index) => {
    if (index > 0) {
      pageOps.push({ type: "line", x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN + 16 });
      pageOps.push({
        type: "text",
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN + 22,
        size: 8,
        bold: false,
        gray: 0.55,
        text: doc.title,
      });
    }
    pageOps.push({ type: "line", x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y: MARGIN + 18 });
    if (doc.footer) {
      pageOps.push({ type: "text", x: MARGIN, y: MARGIN + 5, size: 8, bold: false, gray: 0.55, text: doc.footer });
    }
    const label = `Page ${index + 1} of ${total}`;
    pageOps.push({
      type: "text",
      x: PAGE_WIDTH - MARGIN - textWidth(label, 8),
      y: MARGIN + 5,
      size: 8,
      bold: false,
      gray: 0.55,
      text: label,
    });
  });

  return assemble(doc, pages);
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

function contentStream(ops: Op[]): Uint8Array {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.type === "line") {
      parts.push(
        `0.82 0.84 0.88 RG 0.6 w ${op.x1.toFixed(2)} ${op.y.toFixed(2)} m ${op.x2.toFixed(2)} ${op.y.toFixed(2)} l S`
      );
    } else {
      const shade = op.gray.toFixed(2);
      parts.push(
        `BT /${op.bold ? "F2" : "F1"} ${op.size.toFixed(2)} Tf ${shade} ${shade} ${shade} rg ` +
          `1 0 0 1 ${op.x.toFixed(2)} ${op.y.toFixed(2)} Tm (${escapeText(op.text)}) Tj ET`
      );
    }
  }
  return encodeWinAnsi(parts.join("\n"));
}

function assemble(doc: PdfDocument, pages: Op[][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets = new Map<number, number>();

  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encodeWinAnsi(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };

  const open = (num: number, body: string) => {
    offsets.set(num, length);
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };

  const openStream = (num: number, extra: string, stream: Uint8Array) => {
    offsets.set(num, length);
    push(`${num} 0 obj\n<< ${extra} /Length ${stream.length} >>\nstream\n`);
    push(stream);
    push("\nendstream\nendobj\n");
  };

  push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");

  const contentNumbers: number[] = [];
  const pageNumbers: number[] = [];
  pages.forEach((_, index) => {
    contentNumbers.push(7 + index * 2);
    pageNumbers.push(8 + index * 2);
  });

  open(1, "<< /Type /Catalog /Pages 2 0 R >>");
  open(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`
  );
  open(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  open(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  open(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
  open(
    6,
    `<< /Title (${escapeText(doc.title)}) /Producer (BrandLens) /Creator (BrandLens) >>`
  );

  pages.forEach((ops, index) => {
    const stream = contentStream(ops);
    openStream(contentNumbers[index], "", stream);
    open(
      pageNumbers[index],
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
        `/Contents ${contentNumbers[index]} 0 R >>`
    );
  });

  // Objects 1-6 are the fixed set below; each page adds a content stream and a page.
  const size = 7 + pages.length * 2;
  const xrefAt = length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let num = 1; num < size; num += 1) {
    const offset = offsets.get(num) ?? 0;
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
