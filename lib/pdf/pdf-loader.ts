// pdfjs-dist loader untuk client-side.
// Set worker source ke CDN (jsdelivr) supaya match dengan versi npm package.

import * as pdfjsLib from "pdfjs-dist";

let initialized = false;

function init() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  initialized = true;
}

/**
 * Buka PDF document. SELALU bikin copy fresh karena pdfjs transfer buffer ke
 * worker (detached). Kalau caller pass Uint8Array yang sama, buffernya jadi
 * tidak bisa dipakai lagi setelah call ini.
 *
 * Optional `password` untuk PDF protected (Mandiri).
 */
export async function getDocument(
  data: Uint8Array | ArrayBuffer,
  options?: { password?: string },
) {
  init();
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(src);
  return await pdfjsLib.getDocument({
    data: copy,
    password: options?.password,
  }).promise;
}

export { pdfjsLib };
