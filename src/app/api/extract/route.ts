import { NextResponse } from "next/server";
import {
  configurePdfModule,
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
 * pdf.js normally runs its parsing in a worker loaded from a URL. A Worker
 * runtime has neither a filesystem nor a spare thread for that, so the worker
 * module is bundled and imported in-process instead: it registers
 * `globalThis.pdfjsWorker`, which pdf.js prefers over any worker source. This
 * keeps the server parse working on both Node and Cloudflare Workers, so the
 * form gets anchored text from the server on either host.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

let pdfReady: Promise<typeof import("pdfjs-dist")> | null = null;

/** Load pdf.js and its worker handler once per isolate. */
function loadPdf(): Promise<typeof import("pdfjs-dist")> {
  pdfReady ??= (async () => {
    const pdfjs = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as unknown as typeof import("pdfjs-dist");
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    configurePdfModule(pdfjs);
    return pdfjs;
  })();
  return pdfReady;
}

export async function POST(request: Request) {
  try {
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
      await loadPdf();
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
    // A file the parser cannot read is a problem with the upload, not with the
    // server, so it answers 422. It used to answer 500, which read like an
    // outage for what is a corrupt or mislabelled document.
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `The server parser could not read that file: ${error.message}`
            : "The server parser could not read that file.",
      },
      { status: 422 }
    );
  }
}
