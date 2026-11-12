// pdf.js ships one type surface at the package root; the legacy build is the
// same API without a DOM dependency, so alias its types for the Node route.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

// Imported for its side effect: it registers pdf.js's in-process worker handler
// on `globalThis.pdfjsWorker`, which is how the parser runs without spawning or
// fetching a worker module.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
