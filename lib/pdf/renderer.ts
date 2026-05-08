// PDF page renderer ke canvas pakai pdfjs-dist (client-side).

import { getDocument } from "./pdf-loader";

export type RenderedPage = {
  pageNum: number;
  canvas: HTMLCanvasElement;
  viewportWidth: number;
  viewportHeight: number;
  pdfWidth: number;
  pdfHeight: number;
  scale: number;
};

export async function renderAllPages(
  fileBuffer: Uint8Array,
  scale = 1.4,
): Promise<RenderedPage[]> {
  // getDocument internal-copy supaya fileBuffer asli tidak detached
  const pdf = await getDocument(fileBuffer);
  const out: RenderedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const pdfViewport = page.getViewport({ scale: 1 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas 2d context unavailable");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    out.push({
      pageNum: i,
      canvas,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      pdfWidth: pdfViewport.width,
      pdfHeight: pdfViewport.height,
      scale,
    });
  }
  return out;
}
