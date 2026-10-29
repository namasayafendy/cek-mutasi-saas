// Uji parser BSINet terhadap PDF ARSIP sungguhan — dijalankan manual, bukan
// bagian build, dan TIDAK menulis apa pun ke database.
//   npx tsx scripts/uji-kepala-pdf.mts <folder-berisi-pdf>
//
// Membuktikan untuk SETIAP berkas:
//   - nomor rekening & periode di kepala PDF terbaca (syarat gerbang tolak);
//   - total tercetak terbaca dan cocok dengan baris (complete === true);
//   - rantai saldo tidak putus.
import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseBsiBsinetDari } from "../lib/parsers/bsi-bsinet.ts";
import { analyzeIntegrity } from "../lib/parsers/integrity.ts";

const folder = process.argv[2];
if (!folder) {
  console.error("pakai: npx tsx scripts/uji-kepala-pdf.mts <folder>");
  process.exit(2);
}
const berkas = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
const ringkas: Record<string, number> = {};
let masalah = 0;
for (const f of berkas) {
  const data = new Uint8Array(fs.readFileSync(path.join(folder, f)));
  const pdf = await getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 }).promise;
  const doc = await parseBsiBsinetDari(pdf, data);
  const m = doc.statementMeta!;
  const ig = analyzeIntegrity(doc, null);
  const kunci = `${m.nomorRekening ?? "NULL"}|${m.mataUang ?? "-"}|${m.produk ?? "-"}`;
  ringkas[kunci] = (ringkas[kunci] ?? 0) + 1;
  const salah: string[] = [];
  if (!m.nomorRekening) salah.push("nomor tak terbaca");
  if (!m.periodeAwal || !m.periodeAkhir) salah.push("periode tak terbaca");
  if (m.printedKredit == null || m.printedDebet == null) salah.push("total tak terbaca");
  if (ig.complete !== true) salah.push(`complete=${ig.complete}`);
  if (ig.chainBreaks > 0) salah.push(`rantai putus ${ig.chainBreaks}`);
  // Informasi saja (bukan masalah): BSI kerap mencetak baris bertanggal H-1
  // di awal berkas — transaksi larut malam yang dibukukan hari berikutnya.
  const info = m.periodeAwal && m.firstDate && m.firstDate < m.periodeAwal ? ` (baris awal ${m.firstDate})` : "";
  if (salah.length) masalah++;
  console.log(`${salah.length ? "!!" : "ok"} ${f} | ${m.nomorRekening} | ${m.periodeAwal}..${m.periodeAkhir}${info} | baris ${doc.rows.length} | ${salah.join("; ")}`);
}
console.log("\nIdentitas yang terbaca:", ringkas);
console.log(`berkas=${berkas.length} bermasalah=${masalah}`);
