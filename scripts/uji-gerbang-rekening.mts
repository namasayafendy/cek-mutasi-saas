// Uji lib/pipeline/gerbangRekening.ts — dijalankan manual, bukan bagian build.
//   npx tsx scripts/uji-gerbang-rekening.mts
// Fungsi murni: tidak menyentuh database.
import { periksaRekeningPdf, samarkanNomor, hanyaDigit } from "../lib/pipeline/gerbangRekening.ts";

let lulus = 0;
let gagal = 0;

function cek(nama: string, benar: boolean, keterangan = "") {
  if (benar) {
    lulus++;
    console.log(`  ok   ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama} ${keterangan}`);
  }
}

const MASUK = { label: "BSI Pusat", kode: "BSI", parser_id: "BSI_BSINET_PDF", nomor_rekening: "1999881994", peran: "MASUK" as const };
const KELUAR = { id: "b2", label: "BSI Kirim", kode: "BSI", nomor_rekening: "1999881919", peran: "KELUAR" as const };
const KEPALA_UTUH = { printedKredit: 1000, printedDebet: 500, saldoAwal: 0, saldoAkhir: 500 };
const metaBsi = (nomor: string | null, lain: Record<string, unknown> = KEPALA_UTUH) =>
  ({ nomorRekening: nomor, mataUang: "IDR", ...lain }) as any;

console.log("\n1. Bank tanpa nomor → perilaku lama (lewat)");
{
  const h = periksaRekeningPdf({ ...MASUK, nomor_rekening: null }, metaBsi("1999881919"));
  cek("lewat", h.ok === true);
  cek("tidak diperiksa", h.ok === true && h.diperiksa === false);
  const h2 = periksaRekeningPdf({ ...MASUK, nomor_rekening: "" }, metaBsi(null));
  cek("nomor kosong string → lewat walau PDF tak terbaca", h2.ok === true);
}

console.log("\n1b. Bank tanpa nomor, tapi PDF-nya milik rekening LAIN yang terdaftar → TOLAK");
{
  const kirimTanpaNomor = { label: "BSI Kirim", kode: "BSI", parser_id: "BSI_BSINET_PDF", nomor_rekening: null, peran: "KELUAR" as const };
  const pusat = { id: "b1", label: "BSI Pusat", kode: "BSI", nomor_rekening: "1999881994", peran: "MASUK" as const };
  const h = periksaRekeningPdf(kirimTanpaNomor, metaBsi("1999881994"), [pusat]);
  cek("ditolak REKENING_BEDA", h.ok === false && h.kode === "REKENING_BEDA");
  cek("pesan menyebut pemilik", h.ok === false && h.pesan.includes("BSI Pusat (MASUK)"), h.ok ? "" : h.pesan);
  cek("pemilikId = rekening pemilik", h.ok === false && h.pemilikId === "b1");
  const h2 = periksaRekeningPdf(kirimTanpaNomor, metaBsi("7777777777"), [pusat]);
  cek("nomor asing (tak terdaftar) → tetap lewat, tidak diperiksa", h2.ok === true && h2.diperiksa === false);
  const h3 = periksaRekeningPdf(kirimTanpaNomor, metaBsi(null), [pusat]);
  cek("nomor tak terbaca, bank tanpa nomor → lewat (perilaku lama)", h3.ok === true && h3.diperiksa === false);
  const h4 = periksaRekeningPdf(kirimTanpaNomor, metaBsi("1999881994"), []);
  cek("akun tanpa nomor sama sekali → lewat (perilaku lama)", h4.ok === true);
}

console.log("\n2. Parser tanpa dukungan nomor → lewat, diperiksa=false");
{
  const bca = { label: "BCA", kode: "BCA", parser_id: "BCA_PDF", nomor_rekening: "1234567890" };
  const h = periksaRekeningPdf(bca, { printedKredit: 1, printedDebet: 1, saldoAwal: 1, saldoAkhir: 1 } as any);
  cek("lewat", h.ok === true && h.diperiksa === false);
  const h2 = periksaRekeningPdf(bca, undefined);
  cek("meta undefined → lewat", h2.ok === true && h2.diperiksa === false);
}

console.log("\n3. BSINet, nomor sama → lewat & diperiksa");
{
  const h = periksaRekeningPdf(MASUK, metaBsi("1999881994"), [KELUAR]);
  cek("lewat", h.ok === true && h.diperiksa === true);
  cek("nomorPdf terisi", h.nomorPdf === "1999881994");
  const h2 = periksaRekeningPdf({ ...MASUK, nomor_rekening: "1999 8819 94" }, metaBsi("1999-881-994"));
  cek("spasi/strip diabaikan di kedua sisi", h2.ok === true && h2.diperiksa === true);
}

console.log("\n4. BSINet, nomor tak terbaca → TOLAK");
{
  const h = periksaRekeningPdf(MASUK, metaBsi(null));
  cek("ditolak", h.ok === false);
  cek("kode NOMOR_TAK_TERBACA", h.ok === false && h.kode === "NOMOR_TAK_TERBACA");
  const h2 = periksaRekeningPdf(MASUK, metaBsi(""));
  cek("string kosong juga ditolak", h2.ok === false && h2.kode === "NOMOR_TAK_TERBACA");
  // Kunci ADA tapi bernilai undefined (parser mendukung, gagal baca) → tetap tolak.
  const h3 = periksaRekeningPdf(MASUK, { nomorRekening: undefined, ...KEPALA_UTUH } as any);
  cek("kunci undefined → ditolak", h3.ok === false && h3.kode === "NOMOR_TAK_TERBACA");
}

console.log("\n5. BSINet, nomor beda → TOLAK, sebut pemilik");
{
  const h = periksaRekeningPdf(MASUK, metaBsi("1999881919"), [KELUAR]);
  cek("ditolak", h.ok === false);
  cek("kode REKENING_BEDA", h.ok === false && h.kode === "REKENING_BEDA");
  cek("pesan sebut rekening pemilik", h.ok === false && h.pesan.includes("BSI Kirim (KELUAR)"), h.ok ? "" : h.pesan);
  cek("pesan TIDAK memuat nomor penuh", h.ok === false && !h.pesan.includes("1999881919") && !h.pesan.includes("1999881994"));
  cek("pesan memuat ekor …1919", h.ok === false && h.pesan.includes("…1919"));
  const h2 = periksaRekeningPdf(MASUK, metaBsi("7777777777"), [KELUAR]);
  cek("nomor asing → tolak, 'tidak terdaftar'", h2.ok === false && h2.pesan.includes("tidak terdaftar"));
  // Arah sebaliknya: PDF rekening MASUK dikirim ke rekening KELUAR.
  const h3 = periksaRekeningPdf(
    { label: "BSI Kirim", kode: "BSI", parser_id: "BSI_BSINET_PDF", nomor_rekening: "1999881919", peran: "KELUAR" },
    metaBsi("1999881994"),
    [{ id: "b1", label: "BSI Pusat", kode: "BSI", nomor_rekening: "1999881994", peran: "MASUK" }],
  );
  cek("PDF MASUK ke rekening KELUAR → tolak", h3.ok === false && h3.kode === "REKENING_BEDA");
  // Awalan sama tapi panjang beda tidak boleh lolos.
  const h4 = periksaRekeningPdf(MASUK, metaBsi("19998819940"));
  cek("nomor lebih panjang → tolak", h4.ok === false && h4.kode === "REKENING_BEDA");
}

console.log("\n6. BSINet, kepala total/saldo tak terbaca → TOLAK");
{
  for (const kunci of ["printedKredit", "printedDebet", "saldoAwal", "saldoAkhir"]) {
    const h = periksaRekeningPdf(MASUK, metaBsi("1999881994", { ...KEPALA_UTUH, [kunci]: null }));
    cek(`${kunci} null → KEPALA_TAK_TERBACA`, h.ok === false && h.kode === "KEPALA_TAK_TERBACA");
  }
  const h = periksaRekeningPdf(MASUK, metaBsi("1999881994", { ...KEPALA_UTUH, saldoAwal: 0, printedDebet: 0 }));
  cek("nilai NOL bukan 'tak terbaca'", h.ok === true);
  // Parser lain yang kebetulan mendukung nomor tidak dikenai syarat kepala BSINet.
  const lain = { label: "X", kode: "X", parser_id: "LAIN_PDF", nomor_rekening: "1999881994" };
  const h2 = periksaRekeningPdf(lain, { nomorRekening: "1999881994" } as any);
  cek("parser non-BSINet tanpa total → lewat", h2.ok === true && h2.diperiksa === true);
}

console.log("\n7. Pembantu");
{
  cek("samarkanNomor", samarkanNomor("1999881994") === "…1994");
  cek("samarkanNomor pendek", samarkanNomor("123") === "123");
  cek("hanyaDigit null", hanyaDigit(null) === "");
  cek("hanyaDigit campur", hanyaDigit("IDR 1999-881 994") === "1999881994");
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);
