/**
 * Document ingestion: PDF and DOCX to page-anchored segments.
 *
 * Extraction runs on the server (`/api/extract`), with the in-browser parser as
 * a fallback, so the same file produces the same segments either way. They are
 * stored inside `text_content` with a marker line per anchor:
 *
 *     [[p.4]]
 *     The approved clauses, in one place ...
 *
 * That keeps anchors with the text they belong to, survives export and audit
 * history, and needs no schema change: anything that reads `text_content`
 * still gets readable text, and `stripAnchors` removes the markers before the
 * rule engine or the AI pass sees it.
 */

export interface DocSegment {
  /** Anchor shown to the reviewer, e.g. `p.4` or `¶ 12 · Pricing`. */
  label: string;
  text: string;
}

export interface ExtractedDocument {
  kind: "pdf" | "docx";
  segments: DocSegment[];
  pageCount: number;
  charCount: number;
  /** True when the file was longer than the caps below. */
  truncated: boolean;
}

/** The document a set of anchors belongs to. */
export function documentNameFromLabel(label: string): string | null {
  const separator = label.indexOf(" · ");
  return separator > 0 ? label.slice(0, separator) : null;
}

/** Hard stops so one 300-page deck cannot freeze the tab. */
const MAX_PAGES = 80;
const MAX_PARAGRAPHS = 400;
const MAX_CHARS = 300_000;

/**
 * A marker line is the whole line. The cap is generous because a DOCX set
 * anchor carries a document name, a paragraph number and a heading
 * (`[[Autumn deck · ¶ 12 · Pricing and packaging]]`); anything shorter would
 * stop being recognised as a marker, leak into the text the rules read and
 * report the submission as unanchored.
 */
const MARKER_LINE = /^\[\[(.{1,200})\]\]$/;

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

interface PdfTextItem {
  str?: string;
  width?: number;
  hasEOL?: boolean;
  transform?: number[];
}

/**
 * Rebuilds lines from pdf.js text items. Items carry their own x position and
 * width, so a positive gap between one item's right edge and the next item's
 * left edge becomes a space — otherwise words at a line break run together.
 */
function joinPdfItems(items: PdfTextItem[]): string {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;
  let prevRight: number | null = null;

  for (const item of items) {
    if (typeof item.str !== "string") continue;

    const transform = Array.isArray(item.transform) ? item.transform : null;
    const x = transform ? transform[4] : null;
    const y = transform ? Math.round(transform[5]) : null;

    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      if (current.trim()) lines.push(current);
      current = "";
      prevRight = null;
    }

    if (current && x !== null && prevRight !== null && x - prevRight > 1) {
      current += " ";
    }

    current += item.str;
    if (typeof item.width === "number" && x !== null) prevRight = x + item.width;
    else prevRight = null;

    if (item.hasEOL) {
      if (current.trim()) lines.push(current);
      current = "";
      prevRight = null;
    }

    if (y !== null) lastY = y;
  }

  if (current.trim()) lines.push(current);
  return mergeHyphenatedLines(lines);
}

/** "govern-" / "ance" is one word; "- 2026" at a line break is not. */
function mergeHyphenatedLines(lines: string[]): string {
  const merged: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const previous = merged[merged.length - 1];
    if (previous && /[A-Za-z]-$/.test(previous) && /^[a-z]/.test(line)) {
      merged[merged.length - 1] = previous.slice(0, -1) + line;
    } else {
      merged.push(line);
    }
  }
  return merged.join("\n");
}

/**
 * Where pdf.js loads its worker from. The browser default is the copy shipped
 * in `public/`; the Node verification script points it at the legacy build.
 */
let pdfWorkerSrc = "/pdf.worker.min.mjs";

/**
 * The parser module. Browsers get the standard build; the server route and the
 * Node harness inject pdf.js's legacy build, which does not need a DOM.
 */
type PdfModule = typeof import("pdfjs-dist");
let pdfModuleOverride: PdfModule | null = null;

export function configurePdfWorker(src: string): void {
  pdfWorkerSrc = src;
}

export function configurePdfModule(module: PdfModule): void {
  pdfModuleOverride = module;
}

export async function extractPdf(file: File): Promise<ExtractedDocument> {
  const pdfjs: PdfModule = pdfModuleOverride ?? (await import("pdfjs-dist"));
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  const segments: DocSegment[] = [];
  let charCount = 0;
  let truncated = false;
  const pageLimit = Math.min(pdf.numPages, MAX_PAGES);

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = joinPdfItems(content.items as PdfTextItem[]);
        if (text) {
          segments.push({ label: `p.${pageNumber}`, text });
          charCount += text.length;
        }
      } finally {
        page.cleanup();
      }
      if (charCount > MAX_CHARS) {
        truncated = true;
        break;
      }
    }
  } finally {
    await pdf.destroy();
  }

  if (pdf.numPages > pageLimit) truncated = true;

  return {
    kind: "pdf",
    segments,
    pageCount: pdf.numPages,
    charCount,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

/**
 * Word files have no fixed page boundaries, so anchors are paragraph numbers.
 * A short paragraph with no terminal punctuation is treated as a heading and
 * carried forward, which gives the reviewer "¶ 12 · Pricing" instead of "¶ 12".
 */
function looksLikeHeading(text: string): boolean {
  if (text.length === 0 || text.length > 64) return false;
  if (/[.!?:;]$/.test(text)) return false;
  return text.split(/\s+/).length <= 8;
}

/** Anchors stay readable and bounded, however long the heading was. */
const MAX_SECTION_LABEL = 40;

function sectionLabel(text: string): string {
  return text.length > MAX_SECTION_LABEL ? `${text.slice(0, MAX_SECTION_LABEL - 1).trim()}…` : text;
}

export async function extractDocx(file: File): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });

  const paragraphs = result.value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS);

  const segments: DocSegment[] = [];
  let section: string | null = null;
  let charCount = 0;
  let truncated = result.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length > MAX_PARAGRAPHS;

  paragraphs.forEach((text, index) => {
    if (looksLikeHeading(text)) {
      section = sectionLabel(text);
      return;
    }
    if (charCount > MAX_CHARS) {
      truncated = true;
      return;
    }
    const label = section ? `¶ ${index + 1} · ${section}` : `¶ ${index + 1}`;
    segments.push({ label, text });
    charCount += text.length;
  });

  return {
    kind: "docx",
    segments,
    pageCount: segments.length,
    charCount,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Anchors                                                             */
/* ------------------------------------------------------------------ */

export function serialiseDocument(document: ExtractedDocument): string {
  return document.segments
    .map((segment) => `[[${segment.label}]]\n${segment.text}`)
    .join("\n\n");
}

export interface NamedDocument {
  name: string;
  document: ExtractedDocument;
}

/** Short, marker-safe name for a document inside an anchor. */
export function documentShortName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\[\]]/g, "")
    .trim()
    .slice(0, 28);
}

/**
 * Serialise one or many documents for `text_content`.
 *
 * One document keeps its plain anchor (`[[p.4]]`). A set is prefixed with the
 * document it came from (`[[Q3 deck · p.4]]`), so a combined review can still
 * tell a reviewer which file to open — without a schema change.
 */
export function serialiseDocuments(documents: NamedDocument[]): string {
  if (documents.length === 0) return "";
  if (documents.length === 1) return serialiseDocument(documents[0].document);

  // Two files can share a short name ("Brief.pdf", "brief-final.pdf" both
  // becoming "Brief"); numbering keeps every anchor unambiguous.
  const seen = new Map<string, number>();
  const named = documents.map(({ name, document }) => {
    const base = documentShortName(name) || "Document";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { label: count === 1 ? base : `${base} (${count})`, document };
  });

  return named
    .flatMap(({ label, document }) =>
      document.segments.map(
        (segment) => `[[${label} · ${segment.label}]]\n${segment.text}`
      )
    )
    .join("\n\n");
}

/** Splits stored text back into anchored segments. Unmarked text is one block. */
export function parseSegments(text: string | null | undefined): DocSegment[] {
  const source = (text ?? "").replace(/\r\n/g, "\n");
  if (!source.trim()) return [];

  const segments: DocSegment[] = [];
  let current: DocSegment | null = null;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    const marker = trimmed.match(MARKER_LINE);
    if (marker) {
      if (current && current.text.trim()) segments.push(current);
      current = { label: marker[1].trim(), text: "" };
      continue;
    }
    if (!current) {
      if (!trimmed) continue;
      current = { label: "Document", text: "" };
    }

    current.text += (current.text ? "\n" : "") + line;
  }

  if (current && current.text.trim()) segments.push(current);
  return segments.map((segment) => ({ label: segment.label, text: segment.text.trim() }));
}

/** The plain text the rules and the AI pass should read. */
export function stripAnchors(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !MARKER_LINE.test(line.trim()))
    .join("\n")
    .trim();
}

export function hasAnchors(text: string | null | undefined): boolean {
  return (text ?? "").split("\n").some((line) => MARKER_LINE.test(line.trim()));
}

/**
 * Finds the anchor a finding belongs to. Rules put the offending token in the
 * message ("“synergy” is discouraged", "#FF5733 is not part of the approved
 * palette", "Image hero.png has no alt text"), so the quoted term, the hex, the
 * percentage or the asset name is the search key.
 */
export function locatorForFinding(
  finding: { message: string },
  segments: DocSegment[]
): string | null {
  if (segments.length <= 1) return null;

  const keys = new Set<string>();
  for (const match of finding.message.matchAll(/[“"']([^”"']{2,80})[”"']/g)) {
    keys.add(match[1]);
  }
  for (const match of finding.message.matchAll(/#[0-9a-f]{3,8}\b/gi)) keys.add(match[0]);
  for (const match of finding.message.matchAll(/\b\d+(?:\.\d+)?%/g)) keys.add(match[0]);
  for (const match of finding.message.matchAll(/\b[\w-]+\.(?:png|jpe?g|svg|webp|gif)\b/gi)) {
    keys.add(match[0]);
  }

  const normalise = (value: string) =>
    value.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();

  const searchable = segments.map((segment) => ({
    label: segment.label,
    text: normalise(segment.text),
  }));

  for (const key of keys) {
    const needle = normalise(key);
    if (needle.length < 2) continue;
    const hit = searchable.find((segment) => segment.text.includes(needle));
    if (hit) return hit.label;
  }

  return null;
}
