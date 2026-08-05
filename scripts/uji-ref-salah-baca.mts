// Uji perbaikan 5 Agustus 2026 pada kasus NYATA SBR-1-0127.
// Bank menulis FT26212Z0R4C (angka nol), AI membaca FT26212ZOR4C (huruf O).
// Sebelum perbaikan: pencocokan lewat REF gagal total.
//   npx tsx scripts/uji-ref-salah-baca.mts
import { runMatching } from "../lib/matching.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const tx = (noRef: string, kredit: number, iso: string, no: number): PdfTransaction => ({
  no, tanggal: iso.split("-").reverse().join("/"),
  tanggalDate: new Date(`${iso}T12:00:00Z`), waktu: "14.55",
  namaPengirim: "SALSABILA ADNANI", deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef, bankId: "bank-1", parsedTxId: `tx-${no}`,
} as any);

const input = (refFt: string, nominal: number, iso: string): UserInput => ({
  id: "in-1", tanggal: new Date(`${iso}T12:00:00Z`), nominal, jenis: "kredit",
  outletId: null, outletNama: "LHOKSEUMAWE", bankId: "bank-1", refFt,
  noFaktur: "SBR-1-0127",
} as any);

const kasus: [string, string, string][] = [
  ["nol dibaca huruf O", "FT26212Z0R4C\\Q53/213", "FT26212ZOR4C"],
  ["sama persis",        "FT26212Z0R4C\\Q53/213", "FT26212Z0R4C"],
  ["1 dibaca I",         "FT2621210R4C",          "FT26212I0R4C"],
  ["ref memang BEDA",    "FT99999XXXXX",          "FT26212ZOR4C"],
];

console.log("keadaan                 ref bank                 ref bacaan AI   hasil");
console.log("──────────────────────────────────────────────────────────────────────────");
for (const [nama, refBank, refAi] of kasus) {
  const { inputs } = runMatching(
    [input(refAi, 1_032_000, "2026-07-31")],
    [tx(refBank, 1_032_000, "2026-07-31", 1)],
    new Map(),
  );
  const m = inputs[0].match as any;
  const hasil = m?.status === "matched" ? `✅ COCOK (lewat ${m.matchedBy})` : `⛔ ${m?.status ?? "-"}`;
  console.log(`${nama.padEnd(23)} ${refBank.padEnd(24)} ${refAi.padEnd(15)} ${hasil}`);
}
