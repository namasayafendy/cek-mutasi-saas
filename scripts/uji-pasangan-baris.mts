// Uji lib/parsers/pasanganBaris.ts — dijalankan manual, bukan bagian build.
//   npx tsx scripts/uji-pasangan-baris.mts
// Fungsi murni: tidak menyentuh database. Setiap kasus diambil dari data
// sungguhan yang ditemukan backtest 89 PDF arsip (Okt 2026).
import { pasangkanBaris, sidikJariSemua, type BarisDb } from "../lib/parsers/pasanganBaris.ts";
import type { ParsedTxRow } from "../lib/parsers/types.ts";

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

// Baris PDF. tanggal "dd-mm-yyyy" seperti parser; tanggalDate UTC tengah malam.
function P(tgl: string, jam: string, ref: string | null, debet: number, kredit: number, saldo: number | null): ParsedTxRow {
  const [y, m, d] = tgl.split("-");
  return {
    no: 0, page: 1, tanggal: `${d}-${m}-${y}`, tanggalDate: new Date(`${tgl}T00:00:00.000Z`),
    waktu: jam, namaPengirim: "", namaPenerima: "", deskripsi: "", noRef: ref, saldo, kredit, debet,
    bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  };
}
let seq = 0;
// Baris DB: id berurutan supaya urutan pemilihan deterministik.
function D(p: ParsedTxRow, ubah: Partial<BarisDb> = {}, fp?: string): BarisDb {
  seq++;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    no_ref: p.noRef,
    fingerprint: p.noRef ? null : (fp ?? sidikJariSemua([p])[0]),
    tanggal: p.tanggalDate.toISOString().slice(0, 10),
    jam: p.waktu || null,
    nominal_kredit: p.kredit,
    nominal_debet: p.debet,
    saldo: p.saldo,
    deleted_at: null,
    ...ubah,
  };
}

console.log("\n1. Database kosong → semua baru");
{
  const rows = [P("2026-10-28", "09.00", "FT1/213", 100, 0, 900), P("2026-10-28", "09.01", null, 0, 50, 950)];
  const h = pasangkanBaris(rows, []);
  cek("2 baru", h.baru.length === 2);
  cek("tak ada ganda", h.gandaDb.length === 0);
}

console.log("\n2. Unggah ulang (tumpang H-1) → semua berpasangan identitas, 0 baru");
{
  const rows = [P("2026-10-28", "09.00", "FT1/213", 100, 0, 900), P("2026-10-28", "09.01", null, 0, 50, 950)];
  const db = rows.map((r) => D(r));
  const h = pasangkanBaris(rows, db);
  cek("0 baru", h.baru.length === 0);
  cek("semua lewat identitas", h.cara.every((c) => c === "identitas"));
  cek("id dipetakan benar", h.pasangan[0]?.id === db[0].id && h.pasangan[1]?.id === db[1].id);
}

console.log("\n3. 21 Okt: transfer + biaya ber-ref SAMA, DB hanya punya transfernya");
{
  const t = P("2026-10-21", "09.33", "FT2629X/977", 1312426, 0, 95332325);
  const b = P("2026-10-21", "09.33", "FT2629X/977", 2500, 0, 95329825);
  const h = pasangkanBaris([t, b], [D(t)]);
  cek("biaya = baru (akan disisipkan)", h.baru.length === 1 && h.baru[0] === 1);
  cek("transfer berpasangan", h.cara[0] === "identitas");
}

console.log("\n4. Retur BI-FAST: debet + kredit ber-ref sama, DB hanya punya kreditnya");
{
  const d = P("2026-10-08", "12.49", "FT2628Y/213", 590000, 0, 122764561);
  const k = P("2026-10-08", "12.49", "FT2628Y/213", 0, 590000, 123354561);
  const h = pasangkanBaris([d, k], [D(k)]);
  cek("debet = baru", h.baru.length === 1 && h.baru[0] === 0);
}

console.log("\n5. Retur diulang dalam menit yang sama: saldo kembali sama, debet kedua TETAP baru");
{
  const d1 = P("2026-10-08", "12.49", "FT_R1", 590000, 0, 1000);
  const k1 = P("2026-10-08", "12.49", "FT_R1", 0, 590000, 591000);
  const d2 = P("2026-10-08", "12.49", "FT_R3", 590000, 0, 1000); // isi SAMA dengan d1
  const h = pasangkanBaris([d1, k1, d2], [D(d1), D(k1)]);
  cek("d2 = baru (tidak dicuri d1 lewat isi)", h.baru.length === 1 && h.baru[0] === 2);
  cek("tak ada ganda", h.gandaDb.length === 0);
}

console.log("\n6. 5 Agu: transaksi tersimpan TANPA ref (parser lama); PDF kini ber-ref → TIDAK disisipkan lagi");
{
  const pdf = P("2026-08-05", "09.10", "FT262170BF1B/213", 0, 65000, 45315408);
  const lama = D({ ...pdf, noRef: null });
  const h = pasangkanBaris([pdf], [lama]);
  cek("0 baru (tidak jadi ganda)", h.baru.length === 0);
  cek("berpasangan lewat isi ke baris lama", h.cara[0] === "isi" && h.pasangan[0]?.id === lama.id);
}

console.log("\n7. 5 Agu keadaan sekarang: dua salinan aktif (tanpa ref + ber-ref) → GANDA terdeteksi");
{
  const pdf = P("2026-08-05", "09.10", "FT262170BF1B/213", 0, 65000, 45315408);
  const tanpaRef = D({ ...pdf, noRef: null });
  const berRef = D(pdf);
  const h = pasangkanBaris([pdf], [tanpaRef, berRef]);
  cek("berpasangan identitas ke salinan ber-ref", h.cara[0] === "identitas" && h.pasangan[0]?.id === berRef.id);
  cek("salinan tanpa ref = ganda", h.gandaDb.length === 1 && h.gandaDb[0].id === tanpaRef.id);
}

console.log("\n8. 5 Agu sesudah perbaikan: salinan ber-ref dihapus, yang tersisa tanpa ref (diklaim) → bersih");
{
  const pdf = P("2026-08-05", "01.41", "FT26217X7CN6", 0, 155000, 45250408);
  const tanpaRef = D({ ...pdf, noRef: null });
  const berRefTerhapus = D(pdf, { deleted_at: "2026-10-29T00:00:00Z" });
  const h = pasangkanBaris([pdf], [tanpaRef, berRefTerhapus]);
  cek("berpasangan ke baris AKTIF lewat isi", h.cara[0] === "isi" && h.pasangan[0]?.id === tanpaRef.id);
  cek("tidak hilang, tidak ganda", h.terhapus.length === 0 && h.baru.length === 0 && h.gandaDb.length === 0);
}

console.log("\n9. 27 Sep: saldo baris lama BERGESER (kredit dibukukan belakangan) → tetap berpasangan, tidak baru");
{
  const pdf = P("2026-09-27", "09.39", "FT26270PNG/213", 2000000, 0, 82747184);
  const lama = D({ ...pdf, saldo: 82667184 });
  const kreditTelat = P("2026-09-27", "09.39", "FT26270DT1/213", 0, 80000, 84747184);
  const h = pasangkanBaris([kreditTelat, pdf], [lama]);
  cek("debet berpasangan identitas", h.cara[1] === "identitas");
  cek("hanya kredit telat yang baru", h.baru.length === 1 && h.baru[0] === 0);
  cek("tak ada ganda", h.gandaDb.length === 0);
}

console.log("\n10. Hanya ada versi TERHAPUS (Hapus Data) dan tak ada pengganti aktif → terhapus (hilang), bukan baru");
{
  const pdf = P("2026-10-01", "10.00", "FT_DEL", 5000, 0, 1000);
  const h = pasangkanBaris([pdf], [D(pdf, { deleted_at: "2026-10-02T00:00:00Z" })]);
  cek("terhapus = 1", h.terhapus.length === 1);
  cek("baru = 0 (tidak akan disisipkan → tak bentrok indeks)", h.baru.length === 0);
}

console.log("\n11. Dua baris PDF identitas SAMA (ref+nominal) — DB satu → yang kedua baru (lalu tertolak indeks = terlihat hilang)");
{
  const a = P("2026-10-05", "08.00", "FT_X", 2500, 0, 1000);
  const b = P("2026-10-05", "08.00", "FT_X", 2500, 0, 997500);
  const h = pasangkanBaris([a, b], [D(a)]);
  cek("baru = 1", h.baru.length === 1 && h.baru[0] === 1);
}

console.log("\n12. Baris tanpa saldo ber-ref beda: a baru; baris DB yang TIDAK ada di PDF (tgl/jam/nominal sama) ditahan ganda");
{
  const a = P("2026-10-05", "08.00", "FT_A", 2500, 0, null);
  const dbLain = D({ ...a, noRef: "FT_B" });
  const h = pasangkanBaris([a], [dbLain]);
  cek("a = baru (tak bisa dibandingkan isinya)", h.baru.length === 1);
  cek("dbLain = ganda (tidak ada di PDF)", h.gandaDb.length === 1 && h.gandaDb[0].id === dbLain.id);
}

console.log("\n13. Baris DB yang sama datang dari 2 kueri → dihitung sekali");
{
  const a = P("2026-10-05", "08.00", "FT_A", 2500, 0, 100);
  const x = D(a);
  const h = pasangkanBaris([a], [x, { ...x }]);
  cek("0 baru, 0 ganda", h.baru.length === 0 && h.gandaDb.length === 0);
}

console.log("\n14. Database punya isi LEBIH sering dari PDF (salinan kembar ber-ref beda) → ganda");
{
  const a = P("2026-10-05", "08.00", "FT_A", 2500, 0, 100);
  const h = pasangkanBaris([a], [D(a), D({ ...a, noRef: "FT_A_SALAH_BACA" })]);
  cek("ganda = 1", h.gandaDb.length === 1);
}

console.log("\n15. BCA/BNI tanpa ref, jam & saldo: dua transfer 50.000 di hari yang sama → KEDUANYA baru");
{
  const a = P("2026-10-05", "", null, 0, 50000, null);
  const b = P("2026-10-05", "", null, 0, 50000, null);
  const fp = sidikJariSemua([a, b]);
  cek("sidik jari berbeda", fp[0] !== fp[1], JSON.stringify(fp));
  cek("kemunculan pertama = format lama (tanpa akhiran)", !fp[0]!.includes("#"));
  cek("kemunculan kedua berakhiran |#2", fp[1]!.endsWith("|#2"));
  const h = pasangkanBaris([a, b], []);
  cek("2 baru", h.baru.length === 2);
}

console.log("\n16. Baris tanpa ref SUDAH tersimpan (format lama) + kembarannya muncul → hanya kembaran yang baru");
{
  const a = P("2026-10-06", "", null, 0, 50000, null);
  const b = P("2026-10-06", "", null, 0, 50000, null);
  const lama = D(a);
  const h = pasangkanBaris([a, b], [lama]);
  cek("a berpasangan dgn baris lama", h.cara[0] === "identitas" && h.pasangan[0]?.id === lama.id);
  cek("b = baru", h.baru.length === 1 && h.baru[0] === 1);
  const fp = sidikJariSemua([a, b]);
  const h2 = pasangkanBaris([a, b], [lama, D(b, {}, fp[1]!)]);
  cek("unggah ulang sesudahnya → 0 baru, 0 ganda", h2.baru.length === 0 && h2.gandaDb.length === 0);
}

console.log("\n17. Pemetaan id: baris yang berpasangan lewat ISI mendapat id baris lama (untuk pencocokan)");
{
  const pdf = P("2026-08-05", "09.12", "FT26217TSJVT/213", 0, 38000, 45549408);
  const lama = D({ ...pdf, noRef: null });
  const h = pasangkanBaris([pdf], [lama]);
  cek("pasangan = baris lama", h.pasangan[0]?.id === lama.id && h.cara[0] === "isi");
}

console.log("\n18. Baris TANPA ref tersimpan, saldonya bergeser di PDF berikutnya → berpasangan lewat langkah 2b, TIDAK disisipkan ulang");
{
  const pdf = P("2026-10-07", "10.15", null, 0, 75000, 1080000);
  const lama = D({ ...pdf, saldo: 1000000 }); // fingerprint & saldo lama
  const h = pasangkanBaris([pdf], [lama]);
  cek("0 baru", h.baru.length === 0, JSON.stringify(h.cara));
  cek("berpasangan ke baris lama", h.pasangan[0]?.id === lama.id);
  cek("tak ada ganda", h.gandaDb.length === 0);
}

console.log("\n19. 2b ambigu (jumlah beda): 1 baris PDF vs 2 baris DB tanpa ref → tidak ditebak; keduanya tertahan ganda");
{
  const pdf = P("2026-10-07", "10.15", null, 0, 75000, 1080000);
  const x = D({ ...pdf, saldo: 1000000 });
  const y = D({ ...pdf, saldo: 2000000 });
  const h = pasangkanBaris([pdf], [x, y]);
  cek("pdf = baru (tidak ditebak)", h.baru.length === 1);
  cek("2 baris DB = ganda → Lapis 2 tertahan", h.gandaDb.length === 2);
}

console.log("\n20. Perbaikan 5 Agu + saldo bergeser: salinan ber-ref dihapus, salinan tanpa ref aktif bersaldo lama → 2b memasangkan, TIDAK menghidupkan salinan terhapus");
{
  const pdf = P("2026-08-05", "01.41", "FT26217X7CN6", 0, 155000, 45330408);
  const tanpaRef = D({ ...pdf, noRef: null, saldo: 45250408 });
  const berRefTerhapus = D(pdf, { deleted_at: "2026-10-29T00:00:00Z" });
  const h = pasangkanBaris([pdf], [tanpaRef, berRefTerhapus]);
  cek("berpasangan ke salinan AKTIF", h.pasangan[0]?.id === tanpaRef.id);
  cek("tidak ada yang dihidupkan", h.terhapus.length === 0);
  cek("tidak hilang, tidak ganda", h.baru.length === 0 && h.gandaDb.length === 0);
}

console.log("\n21. Salinan terhapus + baris AKTIF ber-ref LAIN dengan tgl/jam/nominal sama → TIDAK dihidupkan (ragu), keduanya menahan");
{
  const pdf = P("2026-10-07", "11.00", "FT_ASLI", 0, 90000, 500000);
  const terhapus = D(pdf, { deleted_at: "2026-10-08T00:00:00Z" });
  const lainAktif = D({ ...pdf, noRef: "FT_SALAH_BACA", saldo: 400000 });
  const h = pasangkanBaris([pdf], [terhapus, lainAktif]);
  cek("terhapus tercatat", h.terhapus.length === 1);
  cek("tapi RAGU → tidak dihidupkan", h.terhapusRagu.length === 1 && h.terhapusRagu[0] === 0);
  cek("baris aktif lain = ganda", h.gandaDb.length === 1 && h.gandaDb[0].id === lainAktif.id);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);
