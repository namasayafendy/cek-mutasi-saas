// pdfjs-dist loader untuk client-side.
//
// Worker-nya DI-HOST SENDIRI di /public, bukan diambil dari CDN.
// Dulu ia menunjuk cdn.jsdelivr.net, dan itu satu titik patah di luar kendali
// kita — bukan kekhawatiran teoretis: di lingkungan pemilik pernah terjadi
// domain CDN dibajak ISP lokal (proyek bingkai). Kalau kambuh saat mutasi
// dibaca dari HP, seluruh alur mati padahal kodenya baik-baik saja, dan
// gejalanya menyesatkan.
//
// Berkasnya disalin ulang dari node_modules tiap build
// (scripts/salin-worker-pdf.mjs, dipasang sebagai "prebuild"), jadi versinya
// tidak bisa basi terhadap pdfjs-dist yang benar-benar dipakai.

import * as pdfjsLib from "pdfjs-dist";

let initialized = false;

function init() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  // Sama-origin: ikut CSP 'self', tidak butuh izin connect-src ke luar.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
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
