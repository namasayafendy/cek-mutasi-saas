// Backtest lib/coverage/celah.ts — dijalankan manual, bukan bagian build.
//   npx tsx scripts/uji-celah.mts
import { hitungCakupan, saranExport, selisihHari } from "../lib/coverage/celah.ts";

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

const B = (a: string, b: string, sa: number | null = null, sb: number | null = null) => ({
  tgl_awal: a, tgl_akhir: b, saldo_awal: sa, saldo_akhir: sb,
});

console.log("\n1. Kosong");
{
  const h = hitungCakupan([], "2026-07-27");
  cek("tanpa data -> tidak ada rentang", h.rentang.length === 0);
  cek("tanpa data -> umur null", h.umurHari === null);
  cek("tanpa data -> hariTercakup 0", h.hariTercakup === 0);
}

console.log("\n2. Satu rentang (keadaan hari pertama)");
{
  const h = hitungCakupan([B("2026-07-24", "2026-07-27", 100, 200)], "2026-07-27");
  cek("tidak ada celah", h.celah.length === 0);
  cek("hariTercakup = 4", h.hariTercakup === 4, `dapat ${h.hariTercakup}`);
  cek("jauh di bawah jendela 60 -> laporan wajib jujur", h.hariTercakup < h.jendelaHari);
  cek("umur 0 hari", h.umurHari === 0, `dapat ${h.umurHari}`);
}

console.log("\n3. Rentang bersambungan (akhir + 1 hari = awal berikutnya)");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-10", 0, 500), B("2026-07-11", "2026-07-20", 500, 900)],
    "2026-07-20",
  );
  cek("digabung jadi SATU rentang", h.rentang.length === 1, JSON.stringify(h.rentang));
  cek("tidak melahirkan celah nol hari", h.celah.length === 0);
  cek("hariTercakup = 20", h.hariTercakup === 20, `dapat ${h.hariTercakup}`);
}

console.log("\n4. Rentang bertindihan");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-15", 0, 700), B("2026-07-10", "2026-07-20", 400, 900)],
    "2026-07-20",
  );
  cek("digabung jadi satu", h.rentang.length === 1);
  cek("tidak dihitung dobel", h.hariTercakup === 20, `dapat ${h.hariTercakup}`);
}

console.log("\n5. CELAH TERBUKTI KOSONG (saldo bertemu) — inti Fase 2");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-10", 0, 1_000_000), B("2026-07-13", "2026-07-20", 1_000_000, 2_000_000)],
    "2026-07-20",
  );
  cek("TIDAK dilaporkan sebagai masalah", h.celah.length === 0, JSON.stringify(h.celah));
  cek("tercatat sebagai terbukti kosong", h.celahTerbuktiKosong.length === 1);
  cek("celahnya 2 hari (11-12 Jul)", h.celahTerbuktiKosong[0]?.hari === 2, `dapat ${h.celahTerbuktiKosong[0]?.hari}`);
}

console.log("\n6. CELAH NYATA (saldo TIDAK bertemu)");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-10", 0, 1_000_000), B("2026-07-13", "2026-07-20", 1_450_000, 2_000_000)],
    "2026-07-20",
  );
  cek("dilaporkan sebagai celah", h.celah.length === 1);
  cek("selisihnya 450.000", h.celah[0]?.selisih === 450_000, `dapat ${h.celah[0]?.selisih}`);
  cek("rentangnya 11 s/d 12 Jul", h.celah[0]?.dari === "2026-07-11" && h.celah[0]?.sampai === "2026-07-12");
}

console.log("\n7. Saldo TIDAK DIKETAHUI (bank non-BSI) — ketidaktahuan bukan bukti");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-10", null, null), B("2026-07-13", "2026-07-20", null, null)],
    "2026-07-20",
  );
  cek("celah TETAP dilaporkan", h.celah.length === 1, "tidak boleh dianggap kosong");
  cek("tanpa mengarang selisih", h.celah[0]?.selisih === 0);
}

console.log("\n8. Toleransi pembulatan Rp1");
{
  const h = hitungCakupan(
    [B("2026-07-01", "2026-07-10", 0, 1_000_000), B("2026-07-13", "2026-07-20", 1_000_001, 2_000_000)],
    "2026-07-20",
  );
  cek("selisih Rp1 dianggap bertemu", h.celah.length === 0);
}

console.log("\n9. Keterkinian");
{
  const h = hitungCakupan([B("2026-07-01", "2026-07-20", 0, 100)], "2026-07-27");
  cek("umur 7 hari", h.umurHari === 7, `dapat ${h.umurHari}`);
}

console.log("\n10. Urutan masukan acak");
{
  const h = hitungCakupan(
    [B("2026-07-13", "2026-07-20", 1_000_000, 2_000_000), B("2026-07-01", "2026-07-10", 0, 1_000_000)],
    "2026-07-20",
  );
  cek("tetap benar walau tidak urut", h.celahTerbuktiKosong.length === 1 && h.celah.length === 0);
}

console.log("\n11. saranExport SELALU mundur 1 hari");
{
  const s = saranExport("2026-07-25", "2026-07-27");
  cek("mulai dari 24 Jul (mundur 1)", s.dari === "2026-07-24", `dapat ${s.dari}`);
  cek("sampai hari ini", s.sampai === "2026-07-27");
  const s2 = saranExport(null, "2026-07-27");
  cek("tanpa riwayat -> mundur 7 hari", s2.dari === "2026-07-20", `dapat ${s2.dari}`);
}

console.log("\n12. selisihHari melintasi pergantian bulan & tahun");
{
  cek("31 Jul -> 1 Agu = 1", selisihHari("2026-07-31", "2026-08-01") === 1);
  cek("31 Des -> 1 Jan = 1", selisihHari("2026-12-31", "2027-01-01") === 1);
  cek("tahun kabisat 28 Feb -> 1 Mar 2028 = 2", selisihHari("2028-02-28", "2028-03-01") === 2);
}

console.log("\n13. JENDELA — rentang lama tidak boleh mengaku memenuhi 60 hari terakhir");
{
  // 85 hari dari masa lampau; ujung kanannya masih menyentuh jendela.
  const h = hitungCakupan([B("2026-03-10", "2026-06-02", 0, 999)], "2026-07-26", 60);
  cek("hariTercakup DIPOTONG ke jendela", h.hariTercakup <= 60, `dapat ${h.hariTercakup}`);
  cek("jauh di bawah 60 -> tidak boleh mengaku bersih", h.hariTercakup < 60, `dapat ${h.hariTercakup}`);
  cek("umur besar (data basi)", (h.umurHari ?? 0) > 50, `dapat ${h.umurHari}`);
}

console.log("14. JENDELA — rentang di luar jendela dibuang seluruhnya");
{
  const h = hitungCakupan([B("2025-01-01", "2025-02-01", 0, 100)], "2026-07-26", 60);
  cek("tidak menyumbang cakupan apa pun", h.hariTercakup === 0 && h.rentang.length === 0);
}

console.log("15. JENDELA — saldo di ujung yang TERPOTONG tidak boleh jadi bukti");
{
  // Rentang kiri dipotong batas jendela; saldo_akhir-nya milik tanggal asli.
  const h = hitungCakupan(
    [B("2026-04-01", "2026-06-10", 0, 5_000_000), B("2026-06-20", "2026-07-26", 5_000_000, 9_000_000)],
    "2026-07-26",
    60, // jendela mulai 2026-05-28
  );
  const semuaCelah = [...h.celah, ...h.celahTerbuktiKosong];
  cek("celah 11-19 Jun terdeteksi", semuaCelah.length === 1, JSON.stringify(semuaCelah));
  cek(
    "saldo ujung kiri TIDAK terpotong (10 Jun di dalam jendela) -> terbukti kosong",
    h.celahTerbuktiKosong.length === 1,
    JSON.stringify(h.celah),
  );
}

console.log("16. JENDELA — cakupan penuh boleh mengaku bersih");
{
  const h = hitungCakupan([B("2026-05-01", "2026-07-26", 0, 100)], "2026-07-26", 60);
  cek("hariTercakup = 60 tepat", h.hariTercakup === 60, `dapat ${h.hariTercakup}`);
  cek("tanpa celah", h.celah.length === 0);
}

console.log(`\n===== ${lulus} lulus, ${gagal} gagal =====`);
process.exit(gagal > 0 ? 1 : 0);
