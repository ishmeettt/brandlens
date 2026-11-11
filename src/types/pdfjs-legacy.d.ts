// pdf.js ships one type surface at the package root; the legacy build is the
// same API without a DOM dependency, so alias its types for the Node route.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
