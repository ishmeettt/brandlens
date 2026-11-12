/**
 * Local OCR.
 *
 * Tesseract runs in the browser and the models ship with the package, so a
 * document is never uploaded to read it. Both the image path and the
 * scanned-PDF path use this one setup, so they recognise text identically.
 */

export async function recogniseImage(input: Blob | HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(input);
    return (data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}
