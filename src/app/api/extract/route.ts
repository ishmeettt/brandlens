import { NextResponse } from "next/server";
import {
  configurePdfModule,
  configurePdfWorker,
  extractDocx,
  extractPdf,
  serialiseDocument,
  type ExtractedDocument,
} from "../../../lib/document-extract";

/**
 * Server-side document parsing.
 *
 * The submit form posts each PDF/DOCX here first. The route returns the same
 * anchored document the browser parser produces, so a finding always cites the
 * page it came from regardless of where the bytes were read.
 *
 * `runtime = "nodejs"` because pdf.js needs a real filesystem and worker
 * module. Where the host cannot provide those (a Workers-only deployment), the
 * form falls back to the in-browser parser and the user sees no difference.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

async function workerSource(): Promise<string | null> {
  try {
    const [{ pathToFileURL }, path] = await Promise.all([
      import("node:url"),
      import("node:path"),
    ]);
    const candidate = path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
    return pathToFileURL(candidate).href;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // A Workers-only host has no Node runtime for pdf.js; the form falls back
    // to the in-browser parser when this answers 503.
    if (typeof process === "undefined" || !process.versions?.node) {
      return NextResponse.json(
        { error: "This host cannot parse documents on the server." },
        { status: 503 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach a file in the `file` field." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is larger than 25 MB." }, { status: 413 });
    }

    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isDocx = name.endsWith(".docx");
    if (!isPdf && !isDocx) {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are parsed here." },
        { status: 415 }
      );
    }

    let document: ExtractedDocument;
    if (isPdf) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      configurePdfModule(pdfjs as unknown as typeof import("pdfjs-dist"));
      const worker = await workerSource();
      if (worker) configurePdfWorker(worker);
      document = await extractPdf(file);
    } else {
      document = await extractDocx(file);
    }

    if (document.segments.length === 0) {
      return NextResponse.json(
        {
          error: isPdf
            ? "This PDF has no selectable text layer — it is probably a scan."
            : "No readable paragraphs were found in this document.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      document,
      text: serialiseDocument(document),
      parsed: "server",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `The server parser could not read that file: ${error.message}`
            : "The server parser could not read that file.",
      },
      { status: 500 }
    );
  }
}
