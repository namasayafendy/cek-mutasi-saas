// ============================================================
// Salin worker pdfjs ke /public — dijalankan otomatis sebelum build.
//
// KENAPA ADA: parser PDF dulu mengambil worker dari cdn.jsdelivr.net. Itu
// satu titik patah di luar kendali kita, dan bukan kekhawatiran teoretis —
// di lingkungan pemilik pernah terjadi domain CDN dibajak ISP lokal (proyek
// bingkai). Kalau itu kambuh, seluruh alur baca mutasi mati di HP padahal
// tidak ada yang salah dengan kodenya, dan gejalanya menyesatkan.
//
// Berkasnya JUGA di-commit, supaya aplikasi tetap hidup walau skrip ini
// entah bagaimana tidak jalan. Skrip ini yang menjaga agar salinan itu tidak
// pernah basi: tiap build ia disalin ulang dari node_modules, sehingga
// versinya selalu sama dengan pdfjs-dist yang benar-benar dipakai. Versi yang
// tidak cocok membuat pdfjs melempar galat yang sama sekali tidak menunjuk
// ke sini.
//
// Gagal menyalin = build GAGAL, bukan diam-diam lolos. Aplikasi yang ter-deploy
// tanpa worker akan tampak sehat sampai berkas pertama dibuka.
// ============================================================

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const akar = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const NAMA = "pdf.worker.min.mjs";
const asal = join(akar, "node_modules", "pdfjs-dist", "build", NAMA);
const tujuan = join(akar, "public", NAMA);

if (!existsSync(asal)) {
  console.error(`[worker-pdf] TIDAK KETEMU: ${asal}`);
  console.error("[worker-pdf] pdfjs-dist belum terpasang atau strukturnya berubah.");
  process.exit(1);
}

mkdirSync(dirname(tujuan), { recursive: true });
copyFileSync(asal, tujuan);

let versi = "?";
try {
  versi = require("pdfjs-dist/package.json").version;
} catch {
  /* tidak fatal — berkasnya sudah tersalin */
}

const { size } = statSync(tujuan);
console.log(`[worker-pdf] pdfjs-dist ${versi} -> public/${NAMA} (${size} byte)`);
