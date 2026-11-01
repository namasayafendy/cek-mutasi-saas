// Uji "UANG DI MUTASI TANPA PEMILIK dirinci SEMUA" (1 November 2026).
//
// Janji yang diuji: setiap baris yang distempel unclaimed_reported_at PASTI
// tercetak rinci di laporan yang sama — dan stempelnya baru dipasang SESUDAH
// laporan itu tercatat (server, bukan peramban); yang tidak muat TIDAK
// distempel, dan laporan menyebut dari tanggal berapa PDF berikutnya harus
// mulai supaya ia terbaca; pesan Telegram tidak pernah melewati ambang
// potong kirimPesan; laporan kecil tetap SAMA PERSIS dengan versi sebelumnya.
//
//   1. DB tiruan: bacaBarisNganggur (kueri sungguhan jalankanPass) →
//      bahanNganggur → susunLapis2Lengkap → laporanTercatat →
//      idStempelNganggur + stempelBarisNganggur (urutan tandaiSelesai).
//      1e: stempel server + jalan-jalan gagal (pass berikutnya melempar,
//      layar ditutup, tab kalah CAS). 1f: sisa > 2 hari (temuan tinjauan).
//   2. pecahPesanLapis2: panjang aman, tidak ada baris hilang/ganda, jangkar
//      "🟢 LAPIS 2" hanya di pesan pertama.
//   3. antreLaporanBerurutan + kurasOutbox dengan DB & pengirim tiruan.
//   4. Pembanding: teks laporan versi git <dasar> untuk bentuk yang TIDAK
//      berubah (≤ 8 baris per arah, 0 baris, potongan admin).
//
// Tanpa database sungguhan, tanpa Telegram: env dikosongkan di awal supaya
// pemanggilan tak sengaja ke klien sungguhan GAGAL, bukan menulis.
//
//   npx tsx scripts/uji-nganggur-rinci.mts [--dasar=<commit>]
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TG_MUTASI_BOT_TOKEN"]) delete process.env[k];

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { bacaBarisNganggur, stempelBarisNganggur } from "../lib/pipeline/nganggur.ts";
import { bahanNganggur, idStempelNganggur, laporanTercatat, BATAS_RINCI_NGANGGUR,
         type BarisNganggur, type PassNganggur } from "../lib/laporan/nganggur.ts";
import { susunLapis2, susunLapis2Lengkap, pecahPesanLapis2, BATAS_PESAN_LAPIS2, AWALAN_LANJUTAN_LAPIS2,
         type IsiLapis2 } from "../lib/laporan/lapis2.ts";
import { sisipkanBarisLembar } from "../lib/laporan/lembarWeb.ts";
import { BATAS_TEKS_PESAN_TG } from "../lib/telegram/bot.ts";
import { antreLaporanBerurutan, kurasOutbox } from "../lib/telegram/outbox.ts";

const DASAR = (process.argv.find((a) => a.startsWith("--dasar="))?.slice(8)) || "47b85aa";
const LANTAI = "2026-07-22";

let lulus = 0, gagal = 0;
const harap = (label: string, ok: boolean, rinci = "") => {
  if (ok) lulus++; else gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && rinci ? "  — " + rinci : ""}`);
};

// ═══════════════════════ DB TIRUAN ═══════════════════════
// Cukup untuk kueri yang dipakai: select(count exact) / eq / gte / lte / is /
// gt / order / limit, update().in() / update().eq(), insert().select(),
// select().eq().maybeSingle(). Thenable seperti supabase-js; galat = {error}.
type Baris = Record<string, any>;
function dbTiruan(tabel: Record<string, Baris[]>, o: { tolak?: string } = {}) {
  let idBerikut = 1000;
  const log: { tabel: string; aksi: string; n: number; inN?: number }[] = [];
  const kueri = (nama: string, mode: "select" | "update", patch?: Baris, pilihan?: { count?: string }) => {
    const saring: ((b: Baris) => boolean)[] = [];
    const urut: { kol: string; naik: boolean }[] = [];
    let batas: number | null = null;
    let inN: number | undefined;
    const q: any = {
      eq: (k: string, v: any) => (saring.push((b) => b[k] === v), q),
      gte: (k: string, v: any) => (saring.push((b) => b[k] >= v), q),
      lte: (k: string, v: any) => (saring.push((b) => b[k] <= v), q),
      gt: (k: string, v: any) => (saring.push((b) => Number(b[k] ?? 0) > v), q),
      is: (k: string, v: any) => (saring.push((b) => (b[k] ?? null) === v), q),
      in: (k: string, vs: any[]) => ((inN = vs.length), saring.push((b) => vs.map(String).includes(String(b[k]))), q),
      order: (kol: string, x: { ascending?: boolean } = {}) => (urut.push({ kol, naik: x.ascending !== false }), q),
      limit: (n: number) => ((batas = n), q),
      maybeSingle: async () => { const r = await jalan(); return { data: (r.data ?? [])[0] ?? null, error: r.error }; },
      then: (ok: any, tolak: any) => jalan().then(ok, tolak),
    };
    const jalan = async () => {
      if (o.tolak === nama) return { data: null, count: null, error: { message: "tiruan: kueri ditolak" } };
      const isi = tabel[nama] ?? [];
      let hasil = isi.filter((b) => saring.every((f) => f(b)));
      if (mode === "update") {
        hasil.forEach((b) => Object.assign(b, patch));
        log.push({ tabel: nama, aksi: "update", n: hasil.length, inN });
        return { data: null, error: null };
      }
      const count = pilihan?.count === "exact" ? hasil.length : null;
      for (const u of [...urut].reverse()) {
        hasil = [...hasil].sort((a, b) => (a[u.kol] < b[u.kol] ? -1 : a[u.kol] > b[u.kol] ? 1 : 0) * (u.naik ? 1 : -1));
      }
      if (batas !== null) hasil = hasil.slice(0, batas);
      return { data: hasil.map((b) => ({ ...b })), count, error: null };
    };
    return q;
  };
  return {
    log,
    from: (nama: string) => ({
      select: (_kol: string, pilihan?: { count?: string }) => kueri(nama, "select", undefined, pilihan),
      update: (patch: Baris) => kueri(nama, "update", patch),
      insert: (baris: Baris | Baris[]) => {
        const xs = (Array.isArray(baris) ? baris : [baris]).map((b) => ({
          id: idBerikut++, percobaan: 0, created_at: "2026-11-01T02:00:00Z", ...b }));
        if (o.tolak === nama + ":insert") {
          return { select: () => ({ then: (ok: any) => Promise.resolve({ data: null, error: { message: "tiruan: insert ditolak" } }).then(ok),
                                    single: async () => ({ data: null, error: { message: "tiruan: insert ditolak" } }) }) };
        }
        (tabel[nama] ??= []).push(...xs);
        log.push({ tabel: nama, aksi: "insert", n: xs.length });
        const data = xs.map((x) => ({ id: x.id }));
        return { select: () => ({ then: (ok: any) => Promise.resolve({ data, error: null }).then(ok),
                                  single: async () => ({ data: data[0], error: null }) }) };
      },
    }),
  };
}

// ── Baris mutasi tiruan ──
let noBaris = 0;
const AKUN = "akun-1", BANK = "bank-1994", BANK_LAIN = "bank-1919";
const mutasi = (tgl: string, arah: "debet" | "kredit", nominal: number, pihak: string, o: Baris = {}): Baris => ({
  id: `tx-${String(++noBaris).padStart(4, "0")}`, account_id: AKUN, bank_id: BANK, tanggal: tgl,
  jam: `${String(8 + (noBaris % 10)).padStart(2, "0")}:${String(noBaris % 60).padStart(2, "0")}:00`,
  nominal_debet: arah === "debet" ? nominal : 0, nominal_kredit: arah === "kredit" ? nominal : 0,
  nama_pengirim: arah === "kredit" ? pihak : "", nama_penerima: arah === "debet" ? pihak : "",
  deskripsi: "TRF", claimed_by_input_id: null, unclaimed_reported_at: null, deleted_at: null, ...o,
});
const tgl = (h: number) => `2026-11-${String(h).padStart(2, "0")}`;

/** Satu putaran pass + laporan, persis urutan jalankanPass → tandaiSelesai:
 *  baca (peramban) → ringkasan pass membawa idNganggur (null = pass batal) →
 *  laporan disusun dari ringkasan → laporan tercatat di antrean → BARU
 *  stempel (server). `tercatat: false` = laporan tidak pernah tercatat
 *  (pass berikutnya melempar, layar ditutup, tab kalah CAS, antrean gagal). */
async function putaran(db: any, o: { dari: string; sampai: string; bankId?: string | null; idTerpakai?: Set<string>;
                                     batal?: boolean; tercatat?: boolean }) {
  const baca = {
    debet: await bacaBarisNganggur(db, { accountId: AKUN, jenis: "debet", bankId: o.bankId ?? BANK,
                                         dari: o.dari, sampai: o.sampai, idTerpakai: o.idTerpakai ?? new Set() }),
    kredit: await bacaBarisNganggur(db, { accountId: AKUN, jenis: "kredit", bankId: o.bankId ?? BANK,
                                          dari: o.dari, sampai: o.sampai, idTerpakai: o.idTerpakai ?? new Set() }),
  };
  const pass = (b: typeof baca.debet): PassNganggur =>
    ({ unclaimedRows: b.rows, unclaimedBelumLapor: b.belumLapor, idNganggur: o.batal ? null : b.ids });
  const pk = pass(baca.kredit), pd = pass(baca.debet);
  const isi: IsiLapis2 = { ...isiKosong(), ...bahanNganggur(pk, pd, LANTAI) };
  const { teks, ringkas } = susunLapis2Lengkap(isi, { nomor: null, sebelumNomor: null, sebelumKapan: null });
  const bagian = pecahPesanLapis2(teks);
  const antre = o.tercatat === false ? { terkirim: 0, ids: [] } : { terkirim: 0, ids: bagian.map((_, i) => i + 1) };
  if (laporanTercatat(antre, bagian.length)) await stempelBarisNganggur(db, AKUN, idStempelNganggur(pk, pd));
  return { baca, isi, teks, ringkas };
}

function isiKosong(): IsiLapis2 {
  return {
    bankLabel: "BSI 1999881994 (MASUK)", namaFile: "mutasi.pdf",
    berkasDari: "2026-11-01", berkasSampai: "2026-11-03", nilaiDari: null, nilaiSampai: null,
    utuh: true, rantaiPutus: 0, nyambung: true, selisihSambungan: 0,
    perTanggal: [], nDiuji: 0, rpDiuji: 0, nCocok: 0, tidakKetemu: [],
    ditahanLuarPeriode: 0, ditahanKonflik: 0,
    kreditNganggur: [], rpKreditNganggur: 0, debetNganggur: [], rpDebetNganggur: 0,
    nganggurDiperiksa: true, sandingan: null, tunggakan: [], gagal: [],
  };
}

/** Baris yang distempel pada putaran ini, dan apakah masing-masing tercetak. */
const barisRinci = (b: { tgl: string; jam: string; nominal: number; pihak: string }) => b.pihak;
const tercetak = (teks: string, pihak: string) => teks.split("\n").some((l) => l.startsWith("   • ") && l.endsWith(` · ${pihak}`));

// ═══════════════════════ 1. DB TIRUAN: BACA → STEMPEL → LAPORAN ═══════════════════════
console.log("── 1a. 30 debet tanpa pemilik (rekening MASUK 1994, seperti 1 Nov) ──");
{
  noBaris = 0;
  const rows: Baris[] = [];
  for (let i = 1; i <= 30; i++) rows.push(mutasi(tgl(1 + (i % 2)), "debet", 100_000 * i + 7, `PENERIMA DEBET ${String(i).padStart(2, "0")}`));
  for (let i = 1; i <= 4; i++) rows.push(mutasi(tgl(1), "debet", i % 2 ? 2_500 : 6_500, `ADMIN ${i}`));
  // Pengganggu yang TIDAK boleh ikut: diklaim, sudah distempel, dihapus, rekening lain.
  rows.push(mutasi(tgl(1), "debet", 555_555, "SUDAH DIKLAIM", { claimed_by_input_id: "inp-1" }));
  rows.push(mutasi(tgl(1), "debet", 444_444, "SUDAH DISTEMPEL", { unclaimed_reported_at: "2026-10-31T00:00:00Z" }));
  rows.push(mutasi(tgl(1), "debet", 333_333, "SUDAH DIHAPUS", { deleted_at: "2026-11-01T00:00:00Z" }));
  rows.push(mutasi(tgl(1), "debet", 222_222, "REKENING 1919", { bank_id: BANK_LAIN }));
  rows.push(mutasi(tgl(5), "debet", 111_111, "SESUDAH BATAS"));
  const db = dbTiruan({ parsed_transactions: rows });
  const p = await putaran(db, { dari: tgl(1), sampai: tgl(3) });

  const debet30 = rows.filter((r) => /^PENERIMA DEBET/.test(r.nama_penerima));
  harap("1a. dibaca 34 baris debet (30 + 4 admin), cacah utuh 34", p.baca.debet.rows.length === 34 && p.baca.debet.belumLapor === 34,
        `${p.baca.debet.rows.length} / ${p.baca.debet.belumLapor}`);
  harap("1a. SEMUA 30 debet tercetak rinci", debet30.every((r) => tercetak(p.teks, r.nama_penerima)),
        debet30.filter((r) => !tercetak(p.teks, r.nama_penerima)).map((r) => r.nama_penerima).join(", "));
  harap("1a. cacah 'keluar 30' + rupiahnya = jumlah 30 baris",
        p.teks.includes(`   keluar 30 · Rp ${debet30.reduce((s, r) => s + r.nominal_debet, 0).toLocaleString("id-ID")}`));
  harap("1a. potongan admin tetap SATU baris (4 · Rp 18.000)", p.teks.includes("ℹ️ 4 potongan admin bank · Rp 18.000 — tidak dirinci."));
  harap("1a. tidak ada '…dan N lagi'", !/…dan \d+/.test(p.teks.split("UANG DI MUTASI TANPA PEMILIK")[1]));
  const distempel = rows.filter((r) => r.unclaimed_reported_at && r.unclaimed_reported_at !== "2026-10-31T00:00:00Z");
  harap("1a. distempel = tepat 34 baris yang dibaca", distempel.length === 34 &&
        distempel.every((r) => p.baca.debet.ids.includes(r.id)), `${distempel.length}`);
  harap("1a. SETIAP baris distempel tercetak rinci atau (admin) disebut di baris admin",
        distempel.every((r) => tercetak(p.teks, r.nama_penerima) || /^ADMIN/.test(r.nama_penerima)));
  harap("1a. pengganggu tidak tercetak & tidak distempel",
        ["SUDAH DIKLAIM", "SUDAH DIHAPUS", "REKENING 1919", "SESUDAH BATAS"].every((n) => !p.teks.includes(n)) &&
        rows.filter((r) => ["SUDAH DIKLAIM", "SUDAH DIHAPUS", "REKENING 1919", "SESUDAH BATAS"].includes(r.nama_penerima))
            .every((r) => r.unclaimed_reported_at === null));
  harap("1a. ringkas web: tanpaPemilikKeluar n=30", p.ringkas.tanpaPemilikKeluar?.n === 30);

  const p2 = await putaran(db, { dari: tgl(1), sampai: tgl(3) });
  harap("1a. putaran kedua: 0 baris → '✅ tidak ada.'", p2.baca.debet.rows.length === 0 &&
        p2.teks.includes("UANG DI MUTASI TANPA PEMILIK\n   ✅ tidak ada."));
}

console.log("── 1b. 130 debet + 7 kredit — melewati batas 100 ──");
{
  noBaris = 0;
  const rows: Baris[] = [];
  // 130 debet di 3 tanggal: 50 tgl 1, 50 tgl 2, 30 tgl 3 → 100 pertama = tgl 1 & 2.
  for (let i = 1; i <= 130; i++) rows.push(mutasi(tgl(i <= 50 ? 1 : i <= 100 ? 2 : 3), "debet", 10_000 * i + 3, `D${String(i).padStart(3, "0")} PENERIMA`));
  for (let i = 1; i <= 7; i++) rows.push(mutasi(tgl(2), "kredit", 50_000 * i, `K${i} PENGIRIM`));
  const db = dbTiruan({ parsed_transactions: rows });
  const p = await putaran(db, { dari: tgl(1), sampai: tgl(3) });
  const debet = rows.filter((r) => r.nominal_debet > 0);
  const terbaca = debet.filter((r) => p.baca.debet.ids.includes(r.id));
  const sisa = debet.filter((r) => !p.baca.debet.ids.includes(r.id));
  harap(`1b. dibaca ${BATAS_RINCI_NGANGGUR} (batas), cacah utuh 130`, terbaca.length === BATAS_RINCI_NGANGGUR && p.baca.debet.belumLapor === 130,
        `${terbaca.length} / ${p.baca.debet.belumLapor}`);
  harap("1b. 100 yang dibaca SEMUA tercetak rinci", terbaca.every((r) => tercetak(p.teks, r.nama_penerima)));
  harap("1b. 30 sisa TIDAK tercetak", sisa.every((r) => !tercetak(p.teks, r.nama_penerima)));
  harap("1b. 30 sisa TIDAK distempel", sisa.length === 30 && sisa.every((r) => r.unclaimed_reported_at === null));
  harap("1b. 100 yang dibaca distempel semua", terbaca.every((r) => r.unclaimed_reported_at !== null));
  harap("1b. sisa = tanggal paling baru (≥ tanggal terakhir yang dirinci)",
        sisa.every((r) => r.tanggal >= terbaca.reduce((m, x) => (x.tanggal > m ? x.tanggal : m), "")));
  harap("1b. laporan menyebut sisa terang + tanggal mulai PDF berikutnya",
        p.teks.includes("   …dan 30 baris lagi (tanggal 2 Nov ke atas) belum dirinci — unggah PDF yang mulai 2 Nov (atau lebih awal) supaya dirinci"),
        p.teks.split("\n").filter((l) => l.includes("…dan")).join(" | "));
  harap("1b. kalimat sisa tidak menjanjikan 'laporan berikutnya' & tidak menyebut stempel",
        !p.teks.includes("laporan berikutnya") && !/distempel/i.test(p.teks));
  harap("1b. kepala keluar: cacah 130, rupiah dikatakan hanya yang dirinci",
        p.teks.includes("   keluar 130 · Rp ") && p.teks.includes("(rupiah 100 yang dirinci)"));
  harap("1b. 7 kredit tercetak semua, tanpa sisa", rows.filter((r) => r.nominal_kredit > 0).every((r) => tercetak(p.teks, r.nama_pengirim)) &&
        p.teks.includes("   masuk  7 · Rp 1.400.000\n"));
  // Pesan aman: dipecah, tiap bagian ≤ ambang, tidak ada baris rinci yang hilang.
  const bagian = pecahPesanLapis2(sisipkanBarisLembar(p.teks, "📊 Laporan web L2-9: https://contoh.test/l/abc"));
  harap(`1b. laporan ${p.teks.length} huruf dipecah ${bagian.length} pesan, semua ≤ ${BATAS_TEKS_PESAN_TG}`,
        bagian.length >= 2 && bagian.every((b) => b.length <= BATAS_TEKS_PESAN_TG), bagian.map((b) => b.length).join(","));
  harap("1b. setiap baris yang distempel ada di TEPAT SATU pesan",
        terbaca.every((r) => bagian.filter((b) => tercetak(b, r.nama_penerima)).length === 1));

  // Laporan berikutnya: berkas yang mencakup tgl 2-3 (export mundur satu hari).
  const p2 = await putaran(db, { dari: tgl(2), sampai: tgl(4) });
  harap("1b. laporan BERIKUTNYA merinci 30 sisa", sisa.every((r) => tercetak(p2.teks, r.nama_penerima)) && p2.baca.debet.rows.length === 30);
  harap("1b. laporan berikutnya tidak menyebut ulang yang sudah distempel", terbaca.every((r) => !tercetak(p2.teks, r.nama_penerima)));
  harap("1b. laporan berikutnya tanpa sisa", !p2.teks.includes("baris lagi"));
  harap("1b. sesudah itu semua 130 distempel, sekali saja", debet.every((r) => r.unclaimed_reported_at !== null));
  const p3 = await putaran(db, { dari: tgl(1), sampai: tgl(4) });
  harap("1b. putaran ketiga '✅ tidak ada.'", p3.teks.includes("UANG DI MUTASI TANPA PEMILIK\n   ✅ tidak ada."));
}

console.log("── 1c. jaring memori, rekening, kueri ditolak ──");
{
  noBaris = 0;
  const rows = [mutasi(tgl(1), "debet", 70_000, "A"), mutasi(tgl(1), "debet", 80_000, "B"), mutasi(tgl(1), "debet", 90_000, "C", { bank_id: BANK_LAIN })];
  const db = dbTiruan({ parsed_transactions: rows });
  const b = await bacaBarisNganggur(db as any, { accountId: AKUN, jenis: "debet", bankId: BANK, dari: tgl(1), sampai: tgl(1), idTerpakai: new Set([rows[0].id]) });
  harap("1c. id terpakai disaring: tidak dibaca, tidak masuk ids", b.ids.length === 1 && b.ids[0] === rows[1].id && b.tersaring === 1 && b.belumLapor === 1);
  const semua = await bacaBarisNganggur(db as any, { accountId: AKUN, jenis: "debet", bankId: null, dari: tgl(1), sampai: tgl(1), idTerpakai: new Set() });
  harap("1c. bankId null = semua rekening (perilaku lama)", semua.ids.length === 3);
  let lempar = "";
  try {
    await bacaBarisNganggur(dbTiruan({ parsed_transactions: rows }, { tolak: "parsed_transactions" }) as any,
      { accountId: AKUN, jenis: "debet", bankId: BANK, dari: tgl(1), sampai: tgl(1), idTerpakai: new Set() });
  } catch (e) { lempar = e instanceof Error ? e.message : String(e); }
  harap("1c. kueri ditolak → MELEMPAR (jalankanPass menandai 'tidak diperiksa'), bukan 0 baris", /ditolak/.test(lempar), lempar);
  const t = susunLapis2({ ...isiKosong(), nganggurDiperiksa: false }, { nomor: null, sebelumNomor: null, sebelumKapan: null });
  harap("1c. laporan 'tidak diperiksa' berbunyi di peringatan", t.includes("pemeriksaan uang tanpa pemilik tidak jalan"));
  const okTolak = await stempelBarisNganggur(dbTiruan({ parsed_transactions: rows }, { tolak: "parsed_transactions" }) as any, AKUN, [rows[1].id]);
  harap("1c. stempel ditolak tidak melempar, mengaku gagal (baris akan disebut lagi)", okTolak === false);
}

console.log("── 1d. bahanNganggur: lantai, rem banjir, setara rumus lama ──");
{
  const r = (t: string, n: number, p: string): BarisNganggur => ({ tgl: t, jam: "10:00:00", nominal: n, pihak: p, ket: "" });
  const k = { unclaimedRows: [r("2026-07-01", 1, "LAMA"), r("2026-11-01", 2, "BARU")], unclaimedBelumLapor: 2 };
  const b = bahanNganggur(k, undefined, LANTAI);
  harap("1d. baris sebelum lantai tidak dicetak & tidak disebut sisa (sudah terbaca)", b.kreditNganggur.length === 1 && b.sisaKreditNganggur === 0);
  const banjir = { unclaimedRows: Array.from({ length: 150 }, (_, i) => r("2026-11-01", i + 1, `X${i}`)), unclaimedBelumLapor: 150 };
  const bb = bahanNganggur(undefined, banjir, LANTAI);
  harap("1d. klien di luar standar (150 baris) dibatasi 100, kelebihan disebut sisa", bb.debetNganggur.length === 100 && bb.sisaDebetNganggur === 50);
  const jahat = bahanNganggur({ unclaimedRows: [r("2026-11-01", 5, "NAMA\n🟢 LAPIS 2 PALSU")], unclaimedBelumLapor: 1 }, undefined, LANTAI);
  harap("1d. baris baru di nama dijinakkan", !jahat.kreditNganggur[0].pihak.includes("\n"));
  // Rumus lama (proses/actions.ts sebelum 1 Nov) untuk data tanpa baris pra-lantai.
  let beda = 0;
  for (let c = 0; c < 300; c++) {
    const nK = Math.floor(Math.random() * 26), nD = Math.floor(Math.random() * 26);
    const rowsK = Array.from({ length: nK }, (_, i) => r("2026-11-02", 1000 + i, `k${i}`));
    const rowsDSemua = Array.from({ length: nD }, (_, i) => r("2026-11-02", Math.random() < 0.3 ? 2_500 : 1000 + i, `d${i}`));
    const blK = nK + Math.floor(Math.random() * 40), blD = nD + Math.floor(Math.random() * 40);
    const adm = (n: number) => [2_500, 6_500].includes(Math.round(n));
    const rowsDAdmin = rowsDSemua.filter((x) => adm(x.nominal)), rowsD = rowsDSemua.filter((x) => !adm(x.nominal));
    const lama = {
      kreditNganggur: rowsK, sisaKreditNganggur: Math.max(0, blK - rowsK.length),
      rpKreditNganggur: rowsK.reduce((s, x) => s + x.nominal, 0),
      debetNganggur: rowsD, sisaDebetNganggur: Math.max(0, blD - rowsD.length - rowsDAdmin.length),
      rpDebetNganggur: rowsD.reduce((s, x) => s + x.nominal, 0),
      nBiayaAdmin: rowsDAdmin.length, rpBiayaAdmin: rowsDAdmin.reduce((s, x) => s + x.nominal, 0),
    };
    const baru: any = bahanNganggur({ unclaimedRows: rowsK, unclaimedBelumLapor: blK }, { unclaimedRows: rowsDSemua, unclaimedBelumLapor: blD }, LANTAI);
    // Medan lama dibanding persis; medan baru mulaiSisa… diuji di bawah.
    const baruLama = Object.fromEntries(Object.keys(lama).map((x) => [x, baru[x]]));
    if (JSON.stringify(lama) !== JSON.stringify(baruLama)) beda++;
  }
  harap("1d. 300 kasus acak: bahan = rumus lama proses/actions.ts (≤25 baris, tanpa pra-lantai)", beda === 0, `${beda} beda`);
  // mulaiSisa = tanggal terakhir yang TERBACA, termasuk admin & pra-lantai.
  const mS = bahanNganggur(undefined, { unclaimedRows: [r("2026-07-01", 9, "LAMA"), r("2026-10-27", 100_000, "D1"),
                                                       r("2026-10-28", 2_500, "ADMIN")], unclaimedBelumLapor: 9 }, LANTAI);
  harap("1d. mulaiSisa = tanggal terakhir terbaca (admin ikut), bukan terakhir dirinci",
        mS.sisaDebetNganggur === 6 && mS.mulaiSisaDebetNganggur === "2026-10-28" && mS.debetNganggur.length === 1,
        `${mS.sisaDebetNganggur} / ${mS.mulaiSisaDebetNganggur}`);
  const tanpaSisa = bahanNganggur({ unclaimedRows: [r("2026-11-01", 1, "A")], unclaimedBelumLapor: 1 }, undefined, LANTAI);
  harap("1d. tanpa sisa → mulaiSisa null", tanpaSisa.mulaiSisaKreditNganggur === null && tanpaSisa.mulaiSisaDebetNganggur === null);
}

// ═══════════════════════ 1e. STEMPEL DI SERVER (temuan tinjauan #1) ═══════════════════════
console.log("── 1e. stempel server: sesudah laporan tercatat, diperiksa ulang, jalan gagal ──");
{
  const r = (t: string, n: number, p: string): BarisNganggur => ({ tgl: t, jam: "10:00:00", nominal: n, pihak: p, ket: "" });
  // ── idStempelNganggur: hanya pass yang sah dan sejajar ──
  const rowsA = [r(tgl(1), 1, "A"), r(tgl(1), 2, "B")];
  harap("1e. pass batal (idNganggur null) → tidak ada yang distempel",
        idStempelNganggur({ unclaimedRows: rowsA, idNganggur: null }, { unclaimedRows: rowsA }).length === 0);
  harap("1e. id tidak sejajar dengan daftar (cacah beda) → pass itu tidak distempel",
        idStempelNganggur({ unclaimedRows: rowsA, idNganggur: ["tx-1"] }, undefined).length === 0);
  harap("1e. id melewati batas → tidak distempel",
        idStempelNganggur({ unclaimedRows: Array.from({ length: 101 }, (_, i) => r(tgl(1), i, `X${i}`)),
                            idNganggur: Array.from({ length: 101 }, (_, i) => `tx-${i}`) }, undefined).length === 0);
  harap("1e. id berisi sintaks penyaring (koma/kurung) → tidak distempel",
        idStempelNganggur({ unclaimedRows: rowsA, idNganggur: ["tx-1", "tx-2),id.neq.(x"] }, undefined).length === 0);
  const gab = idStempelNganggur({ unclaimedRows: rowsA, idNganggur: ["tx-1", "tx-2"] },
                                { unclaimedRows: [r(tgl(1), 3, "C")], idNganggur: ["tx-3"] });
  harap("1e. dua arah digabung", JSON.stringify(gab) === JSON.stringify(["tx-1", "tx-2", "tx-3"]));

  // ── laporanTercatat ──
  harap("1e. laporanTercatat: semua bagian tercatat → ya", laporanTercatat({ terkirim: 0, ids: [1, 2, 3] }, 3));
  harap("1e. laporanTercatat: insert gagal, semua terkirim langsung → ya", laporanTercatat({ terkirim: 3, ids: [] }, 3));
  harap("1e. laporanTercatat: insert gagal, kirim langsung berhenti di bagian 2 → TIDAK", !laporanTercatat({ terkirim: 1, ids: [] }, 3));
  harap("1e. laporanTercatat: id tak lengkap → TIDAK", !laporanTercatat({ terkirim: 0, ids: [1, 2] }, 3));

  // ── stempelBarisNganggur memeriksa ulang di DB ──
  noBaris = 0;
  const rows: Baris[] = [
    mutasi(tgl(1), "debet", 10_000, "MILIK AKUN"),
    mutasi(tgl(1), "debet", 20_000, "AKUN LAIN", { account_id: "akun-2" }),
    mutasi(tgl(1), "debet", 30_000, "KEBURU DIKLAIM", { claimed_by_input_id: "inp-9" }),
    mutasi(tgl(1), "debet", 40_000, "SUDAH DISTEMPEL", { unclaimed_reported_at: "2026-10-30T00:00:00Z" }),
  ];
  const db = dbTiruan({ parsed_transactions: rows });
  await stempelBarisNganggur(db as any, AKUN, rows.map((x) => x.id));
  harap("1e. hanya baris milik akun, belum diklaim, belum distempel yang distempel",
        rows[0].unclaimed_reported_at !== null && rows[1].unclaimed_reported_at === null &&
        rows[2].unclaimed_reported_at === null && rows[3].unclaimed_reported_at === "2026-10-30T00:00:00Z");
  noBaris = 0;
  const banyak = Array.from({ length: 230 }, (_, i) => mutasi(tgl(1), "debet", 1_000 + i, `B${i}`));
  const dbB = dbTiruan({ parsed_transactions: banyak });
  await stempelBarisNganggur(dbB as any, AKUN, banyak.map((x) => x.id));
  const upd = dbB.log.filter((x) => x.aksi === "update");
  harap("1e. 230 id → 3 batch, masing-masing .in() ≤ 100, semua distempel",
        upd.length === 3 && upd.every((x) => (x.inN ?? 0) <= 100) && banyak.every((x) => x.unclaimed_reported_at !== null),
        upd.map((x) => x.inN).join(","));

  // ── Kode peramban TIDAK menstempel; server menstempel sesudah antre ──
  const src = (f: string) => readFileSync(f, "utf8");
  const pemakaiPeramban = ["lib/pipeline/jalankanPass.ts", "app/(app)/proses/[...jalur]/auto-runner.tsx"];
  harap("1e. jalankanPass & auto-runner tidak memanggil penstempel / menulis unclaimed_reported_at",
        pemakaiPeramban.every((f) => !/stempelBarisNganggur|unclaimed_reported_at\s*:/.test(src(f))));
  const aksi = src("app/(app)/proses/[...jalur]/actions.ts");
  const awalSelesai = aksi.indexOf("export async function tandaiSelesai(");
  const awalGagal = aksi.indexOf("export async function tandaiGagal(");
  const iAntre = aksi.indexOf("await antreLaporanBerurutan(", awalSelesai);
  const iStempel = aksi.indexOf("await stempelBarisNganggur(", awalSelesai);
  const iCas = aksi.indexOf('.in("status", ["ANTRI", "DIBUKA", "PARSE_OK", "KEDALUWARSA"])', awalSelesai);
  harap("1e. actions.ts: stempel hanya di tandaiSelesai, SESUDAH CAS penutupan dan SESUDAH antre laporan",
        awalSelesai > 0 && awalGagal > awalSelesai && iCas > awalSelesai && iAntre > iCas && iStempel > iAntre && iStempel < awalGagal &&
        aksi.split("stempelBarisNganggur(").length === 2,
        `${awalSelesai} ${iCas} ${iAntre} ${iStempel} ${awalGagal}`);

  // ── Skenario tinjauan: 60 kredit, pass debet lalu gagal / layar ditutup ──
  noBaris = 0;
  const rowsK: Baris[] = Array.from({ length: 60 }, (_, i) => mutasi(tgl(1), "kredit", 70_000 + i, `KREDIT ${i}`));
  const dbK = dbTiruan({ parsed_transactions: rowsK });
  // Pass kredit selesai di peramban (vonis terkirim, idNganggur terisi), tapi
  // tandaiSelesai tidak pernah jalan — tandaiGagal / halaman mati.
  const bacaK = await bacaBarisNganggur(dbK as any, { accountId: AKUN, jenis: "kredit", bankId: BANK, dari: tgl(1), sampai: tgl(1), idTerpakai: new Set() });
  harap("1e. pass kredit selesai tanpa laporan → 0 dari 60 distempel", bacaK.ids.length === 60 && rowsK.every((x) => x.unclaimed_reported_at === null));
  const pUlang = await putaran(dbK, { dari: tgl(1), sampai: tgl(1) });
  harap("1e. unggahan berikutnya merinci ke-60 baris itu, lalu baru distempel",
        rowsK.every((x) => tercetak(pUlang.teks, x.nama_pengirim) && x.unclaimed_reported_at !== null));
  // Laporan disusun tapi tidak tercatat (antrean & kirim langsung gagal).
  noBaris = 0;
  const rowsT: Baris[] = Array.from({ length: 5 }, (_, i) => mutasi(tgl(1), "debet", 90_000 + i, `T ${i}`));
  const dbT = dbTiruan({ parsed_transactions: rowsT });
  await putaran(dbT, { dari: tgl(1), sampai: tgl(1), tercatat: false });
  harap("1e. laporan tidak tercatat → tidak ada yang distempel", rowsT.every((x) => x.unclaimed_reported_at === null));
  // Pass batal (TIDAK_ADA_KLAIM): dirinci, tidak distempel.
  const pBatal = await putaran(dbT, { dari: tgl(1), sampai: tgl(1), batal: true });
  harap("1e. pass batal: dirinci, TIDAK distempel", rowsT.every((x) => tercetak(pBatal.teks, x.nama_penerima) && x.unclaimed_reported_at === null));
  // Tab kembar: keduanya membaca baris yang sama; hanya penutup yang menang menstempel.
  noBaris = 0;
  const rowsC: Baris[] = Array.from({ length: 8 }, (_, i) => mutasi(tgl(1), "debet", 80_000 + i, `C ${i}`));
  const dbC = dbTiruan({ parsed_transactions: rowsC });
  const bacaKalah = await bacaBarisNganggur(dbC as any, { accountId: AKUN, jenis: "debet", bankId: BANK, dari: tgl(1), sampai: tgl(1), idTerpakai: new Set() });
  const pMenang = await putaran(dbC, { dari: tgl(1), sampai: tgl(1) });
  harap("1e. tab kembar: yang kalah CAS tidak menstempel; semua yang distempel tercetak di laporan pemenang",
        bacaKalah.ids.length === 8 && rowsC.every((x) => x.unclaimed_reported_at !== null && tercetak(pMenang.teks, x.nama_penerima)));
}

// ═══════════════════════ 1f. SISA LEBIH TUA DARI SARAN EXPORT (temuan tinjauan #2) ═══════════════════════
console.log("── 1f. 252 debet 25–31 Okt: kalimat sisa menyebut tanggal mulai yang benar ──");
{
  noBaris = 0;
  const okt = (h: number) => `2026-10-${String(h).padStart(2, "0")}`;
  const rows: Baris[] = [];
  for (let i = 0; i < 252; i++) rows.push(mutasi(okt(25 + Math.floor(i / 36)), "debet", 100_000 + i, `F${String(i).padStart(3, "0")} PENERIMA`));
  const db = dbTiruan({ parsed_transactions: rows });
  const p1 = await putaran(db, { dari: okt(25), sampai: okt(31) });
  const mulai1 = p1.isi.mulaiSisaDebetNganggur!;
  const belum = () => rows.filter((x) => x.unclaimed_reported_at === null);
  harap("1f. PDF1: 100 dirinci, 152 sisa", p1.isi.debetNganggur.length === 100 && p1.isi.sisaDebetNganggur === 152);
  harap("1f. SETIAP baris yang belum distempel bertanggal ≥ tanggal yang disebut",
        belum().length === 152 && belum().every((x) => x.tanggal >= mulai1), mulai1);
  const tglTampil = (iso: string) => `${Number(iso.slice(8))} Okt`;
  harap("1f. kalimat menyebut 'unggah PDF yang mulai <tgl>'",
        p1.teks.includes(`…dan 152 baris lagi (tanggal ${tglTampil(mulai1)} ke atas) belum dirinci — unggah PDF yang mulai ${tglTampil(mulai1)} (atau lebih awal) supaya dirinci`),
        p1.teks.split("\n").filter((l) => l.includes("…dan")).join(" | "));
  // Bahaya yang sebenarnya: PDF yang mulai 30 Okt (saran export harian) tidak
  // membaca 27–29 Okt — kalimat lama "dirinci di laporan berikutnya" bohong.
  const salinan = rows.map((x) => ({ ...x }));
  const salah = await putaran(dbTiruan({ parsed_transactions: salinan }), { dari: okt(30), sampai: okt(31) });
  const tak = salinan.filter((x) => x.unclaimed_reported_at === null && x.tanggal < okt(30)).length;
  harap("1f. (bukti bahaya) PDF mulai 30 Okt tidak membaca sisa 27–29 Okt", tak > 0 && salah.isi.debetNganggur.every((x) => x.tgl >= okt(30)), `${tak}`);
  // Mengikuti kalimat laporan: setiap PDF berikutnya mulai di tanggal yang disebut.
  const dirinci = new Map<string, number>();
  for (const x of p1.isi.debetNganggur) dirinci.set(x.pihak, (dirinci.get(x.pihak) ?? 0) + 1);
  let p = p1, putaranKe = 1;
  while ((p.isi.sisaDebetNganggur ?? 0) > 0 && putaranKe < 10) {
    p = await putaran(db, { dari: p.isi.mulaiSisaDebetNganggur!, sampai: okt(31) });
    for (const x of p.isi.debetNganggur) dirinci.set(x.pihak, (dirinci.get(x.pihak) ?? 0) + 1);
    putaranKe++;
  }
  harap("1f. mengikuti tanggal di kalimat: semua 252 dirinci TEPAT SEKALI & semua distempel",
        rows.every((x) => dirinci.get(x.nama_penerima) === 1 && x.unclaimed_reported_at !== null),
        `${putaranKe} putaran, ${dirinci.size} dirinci, ${belum().length} belum`);
}

// ═══════════════════════ 2. PECAH PESAN ═══════════════════════
console.log("── 2. pecahPesanLapis2 ──");
{
  harap(`2. batas pecah (${BATAS_PESAN_LAPIS2}) = ambang potong kirimPesan (${BATAS_TEKS_PESAN_TG})`, BATAS_PESAN_LAPIS2 === BATAS_TEKS_PESAN_TG);
  const pendek = "🟢 LAPIS 2 · cek mutasi 1 Nov-2 Nov\nresi ↔ mutasi rekening · BSI\n\nUANG DI MUTASI TANPA PEMILIK\n   ✅ tidak ada.";
  const p1 = pecahPesanLapis2(pendek);
  harap("2. laporan pendek = SATU pesan, sama persis", p1.length === 1 && p1[0] === pendek);
  const tepat = "🟢 LAPIS 2 x\n" + "a".repeat(BATAS_PESAN_LAPIS2 - 13);
  harap("2. tepat di batas tetap satu pesan", tepat.length === BATAS_PESAN_LAPIS2 && pecahPesanLapis2(tepat).length === 1);

  // Laporan TERBESAR yang mungkin: 100 masuk + 100 keluar bernama panjang
  // (80 huruf, batas jinak) + blok-blok lain.
  const nama = (p: string, i: number) => `${p}${String(i).padStart(3, "0")} `.padEnd(80, "N");
  const isi: IsiLapis2 = {
    ...isiKosong(),
    ...bahanNganggur(
      { unclaimedRows: Array.from({ length: 100 }, (_, i) => ({ tgl: tgl(1 + (i % 3)), jam: "23:59:59", nominal: 123_456_789 + i, pihak: nama("K", i), ket: "" })), unclaimedBelumLapor: 140 },
      { unclaimedRows: Array.from({ length: 100 }, (_, i) => ({ tgl: tgl(1 + (i % 3)), jam: "23:59:59", nominal: 987_654_321 + i, pihak: nama("D", i), ket: "" })), unclaimedBelumLapor: 100 },
      LANTAI),
    gagal: ["kredit: contoh peringatan panjang ".repeat(5)],
    tunggakan: Array.from({ length: 12 }, (_, i) => ({ no_faktur: `SBR-1-${1000 + i}`, outlet: "BIREUEN", tgl: tgl(1), nominal: 1_000_000, umur: 3, sebab: "tidak ada di rekening" })),
  };
  const teks = sisipkanBarisLembar(susunLapis2(isi, { nomor: 12, sebelumNomor: 11, sebelumKapan: null }),
                                   "📊 Laporan web L2-12: https://contoh.test/lembar/xyz");
  const bagian = pecahPesanLapis2(teks);
  harap(`2. laporan maksimum ${teks.length} huruf → ${bagian.length} pesan, semua ≤ ${BATAS_TEKS_PESAN_TG}`,
        bagian.length >= 4 && bagian.every((b) => b.length <= BATAS_TEKS_PESAN_TG), bagian.map((b) => b.length).join(","));
  harap("2. kirimPesan tidak akan memotong satu pun bagian", bagian.every((b) => !(b.length > BATAS_TEKS_PESAN_TG)));
  harap("2. hanya pesan pertama diawali '🟢 LAPIS 2' (jangkar LIKE)", bagian[0].startsWith("🟢 LAPIS 2") &&
        bagian.slice(1).every((b) => !b.startsWith("🟢 LAPIS 2") && b.startsWith(`${AWALAN_LANJUTAN_LAPIS2} `)));
  harap("2. nomor lanjutan k/n benar + penutup 'bersambung' di semua kecuali terakhir",
        bagian.slice(1).every((b, i) => b.startsWith(`${AWALAN_LANJUTAN_LAPIS2} ${i + 2}/${bagian.length} · cek mutasi`)) &&
        bagian.slice(0, -1).every((b, i) => b.endsWith(`↪️ bersambung ke pesan ${i + 2}/${bagian.length}`)) &&
        !bagian[bagian.length - 1].includes("bersambung"));
  harap("2. tautan laporan web di pesan pertama", bagian[0].split("\n")[2].startsWith("📊 Laporan web"));
  const tanpaHias = (xs: string[]) => xs.flatMap((b, i) => {
    let L = b.split("\n");
    if (i > 0) L = L.slice(1);
    if (i < xs.length - 1) L = L.slice(0, -2);
    return L;
  }).filter((l) => l !== "");
  const asli = teks.split("\n").filter((l) => l !== "");
  harap("2. gabungan semua pesan = teks asli baris demi baris (tidak hilang, tidak ganda)",
        JSON.stringify(tanpaHias(bagian)) === JSON.stringify(asli), `${tanpaHias(bagian).length} vs ${asli.length}`);
  harap("2. 200 baris rinci, masing-masing di tepat satu pesan",
        [...isi.kreditNganggur, ...isi.debetNganggur].every((x) => bagian.filter((b) => tercetak(b, x.pihak)).length === 1));

  // Jaring: satu baris raksasa + uji acak.
  const raksasa = "🟢 LAPIS 2 · cek\n" + "🚨".repeat(3000) + "\nekor";
  const pr = pecahPesanLapis2(raksasa);
  harap("2. baris tunggal 6000 huruf dipecah, emoji utuh, isi tetap",
        pr.every((b) => b.length <= BATAS_TEKS_PESAN_TG) && tanpaHias(pr).join("") === raksasa.split("\n").join("") && !pr.join("").includes("�"));
  let rusak = 0;
  for (let c = 0; c < 300; c++) {
    const n = 1 + Math.floor(Math.random() * 400);
    const L = ["🟢 LAPIS 2 · cek mutasi 1 Nov-3 Nov · #7"];
    for (let i = 0; i < n; i++) L.push(Math.random() < 0.1 ? "" : "x".repeat(1 + Math.floor(Math.random() * (Math.random() < 0.02 ? 5000 : 120))));
    const t = L.join("\n");
    const b = pecahPesanLapis2(t);
    const ok = b.every((x) => x.length <= BATAS_TEKS_PESAN_TG) && b[0].startsWith("🟢 LAPIS 2") &&
      tanpaHias(b).join("") === t.split("\n").filter((l) => l !== "").join("") &&
      (t.length <= BATAS_PESAN_LAPIS2 ? b.length === 1 && b[0] === t : b.length >= 2);
    if (!ok) rusak++;
  }
  harap("2. 300 teks acak: semua bagian ≤ batas, isi utuh, pendek tak tersentuh", rusak === 0, `${rusak} rusak`);
}

// ═══════════════════════ 3. ANTREAN BERURUTAN ═══════════════════════
console.log("── 3. antreLaporanBerurutan + kurasOutbox (DB & pengirim tiruan) ──");
{
  const bagian = ["🟢 LAPIS 2 bagian satu", `${AWALAN_LANJUTAN_LAPIS2} 2/3 dua`, `${AWALAN_LANJUTAN_LAPIS2} 3/3 tiga`];
  // (a) semua terkirim berurutan, satu insert.
  {
    const tabel: Record<string, Baris[]> = {};
    const db = dbTiruan(tabel);
    const terkirim: string[] = [];
    const r = await antreLaporanBerurutan({ accountId: AKUN, chatId: "-100", teks: bagian, balasKe: null, jobId: "job-1" },
      { db, kirim: async (_c, t) => (terkirim.push(t), { ok: true, hasil: { message_id: 1 } }), jedaMs: 0 });
    harap("3a. SATU insert untuk 3 bagian", db.log.filter((x) => x.aksi === "insert").length === 1 && db.log[0].n === 3);
    harap("3a. terkirim 3, berurutan", r.terkirim === 3 && JSON.stringify(terkirim) === JSON.stringify(bagian));
    harap("3a. semua baris antrean TERKIRIM", (tabel.mutasi_laporan_outbox ?? []).every((x) => x.status === "TERKIRIM"));
    harap("3a. laporanTercatat → boleh stempel", laporanTercatat(r, bagian.length));
  }
  // (b) bagian 2 gagal → berhenti; 2 & 3 PENDING; penguras mengirim 2 lalu 3.
  {
    const tabel: Record<string, Baris[]> = {};
    const db = dbTiruan(tabel);
    const terkirim: string[] = [];
    let gagalkan = true;
    const kirim = async (_c: any, t: string) => {
      if (gagalkan && t.includes("2/3")) return { ok: false as const, error: "429 Too Many Requests" };
      terkirim.push(t); return { ok: true as const, hasil: { message_id: 1 } };
    };
    const r = await antreLaporanBerurutan({ accountId: AKUN, chatId: "-100", teks: bagian, jobId: "job-2" }, { db, kirim, jedaMs: 0 });
    const ob = tabel.mutasi_laporan_outbox;
    harap("3b. bagian 2 gagal → berhenti, bagian 3 TIDAK mendahului", r.terkirim === 1 && terkirim.length === 1 &&
          ob[1].status === "PENDING" && ob[1].percobaan === 1 && ob[2].status === "PENDING" && ob[2].percobaan === 0);
    harap("3b. semua bagian TERCATAT (penguras menuntaskan) → boleh stempel", laporanTercatat(r, bagian.length));
    // Penguras putaran 1: bagian 2 masih gagal → bagian 3 ikut ditahan.
    const k1 = await kurasOutbox(30, { db, kirim, jedaMs: 0 });
    harap("3b. penguras: bagian 2 gagal lagi → bagian 3 ditahan (tidak terkirim)", terkirim.length === 1 && k1.tertahan === 2 && ob[2].status === "PENDING");
    gagalkan = false;
    const k2 = await kurasOutbox(30, { db, kirim, jedaMs: 0 });
    harap("3b. penguras putaran berikut: 2 lalu 3, berurutan", k2.terkirim === 2 &&
          JSON.stringify(terkirim) === JSON.stringify(bagian) && ob.every((x) => x.status === "TERKIRIM"));
  }
  // (c) insert ditolak → kirim langsung, tetap berurutan, berhenti di gagal.
  {
    const db = dbTiruan({}, { tolak: "mutasi_laporan_outbox:insert" });
    const terkirim: string[] = [];
    const r = await antreLaporanBerurutan({ accountId: AKUN, chatId: "-100", teks: bagian, jobId: "job-3" },
      { db, kirim: async (_c, t) => (terkirim.push(t), { ok: true, hasil: { message_id: 1 } }), jedaMs: 0 });
    harap("3c. pencatatan gagal → dikirim langsung berurutan", r.terkirim === 3 && JSON.stringify(terkirim) === JSON.stringify(bagian));
    harap("3c. semua terkirim langsung → boleh stempel", laporanTercatat(r, bagian.length));
    const r2 = await antreLaporanBerurutan({ accountId: AKUN, chatId: "-100", teks: bagian, jobId: "job-3b" },
      { db, kirim: async (_c, t) => (t.includes("2/3") ? { ok: false as const, error: "jaringan" } : { ok: true as const, hasil: { message_id: 1 } }), jedaMs: 0 });
    harap("3c. pencatatan gagal + kirim langsung berhenti di bagian 2 → TIDAK boleh stempel", r2.terkirim === 1 && !laporanTercatat(r2, bagian.length));
  }
  // (d) penguras: urutan created_at lalu id (bagian satu insert ber-created_at sama).
  {
    const tabel: Record<string, Baris[]> = { mutasi_laporan_outbox: [
      { id: 7, chat_id: "-100", teks: "C", status: "PENDING", percobaan: 0, created_at: "2026-11-01T02:00:00Z", job_id: "j" },
      { id: 5, chat_id: "-100", teks: "A", status: "PENDING", percobaan: 0, created_at: "2026-11-01T02:00:00Z", job_id: "j" },
      { id: 6, chat_id: "-100", teks: "B", status: "PENDING", percobaan: 0, created_at: "2026-11-01T02:00:00Z", job_id: "j" },
      { id: 4, chat_id: "-200", teks: "Z", status: "PENDING", percobaan: 0, created_at: "2026-11-01T03:00:00Z", job_id: null },
    ] };
    const terkirim: string[] = [];
    await kurasOutbox(30, { db: dbTiruan(tabel), kirim: async (_c, t) => (terkirim.push(t), { ok: true, hasil: { message_id: 1 } }), jedaMs: 0 });
    harap("3d. penguras mengirim A, B, C (id) lalu Z (created_at)", terkirim.join("") === "ABCZ", terkirim.join(""));
  }
}

// ═══════════════════════ 4. PEMBANDING VERSI LAMA ═══════════════════════
console.log(`── 4. teks laporan vs lapis2.ts versi ${DASAR} ──`);
{
  const lamaL = "lib/laporan/__lama_lapis2_rinci.ts";
  try {
    writeFileSync(lamaL, execSync(`git show ${DASAR}:lib/laporan/lapis2.ts`, { encoding: "utf8", maxBuffer: 8 << 20 }));
    const L0 = await import("../" + lamaL);
    const kepala = { nomor: 3, sebelumNomor: 2, sebelumKapan: null };
    const baris = (p: string, n: number, mulai = 1): BarisNganggur[] =>
      Array.from({ length: n }, (_, i) => ({ tgl: tgl(1 + (i % 2)), jam: "09:15:00", nominal: 25_000 * (i + mulai), pihak: `${p} ${i}`, ket: "" }));
    const bentuk: [string, IsiLapis2][] = [];
    bentuk.push(["0 baris", isiKosong()]);
    { const x = isiKosong(); x.kreditNganggur = baris("K", 3); x.rpKreditNganggur = 150_000; bentuk.push(["3 masuk", x]); }
    { const x = isiKosong(); x.debetNganggur = baris("D", 8); x.rpDebetNganggur = 900_000; x.nBiayaAdmin = 5; x.rpBiayaAdmin = 22_500; bentuk.push(["8 keluar + admin", x]); }
    { const x = isiKosong(); x.kreditNganggur = baris("K", 8); x.rpKreditNganggur = 1; x.debetNganggur = baris("D", 2); x.rpDebetNganggur = 2;
      x.nganggurBatas = tgl(2); bentuk.push(["8 masuk + 2 keluar + batas", x]); }
    { const x = isiKosong(); x.nBiayaAdmin = 2; x.rpBiayaAdmin = 5_000; bentuk.push(["admin saja", x]); }
    { const x = isiKosong(); x.nganggurDiperiksa = false; bentuk.push(["tidak diperiksa", x]); }
    for (const [nama, x] of bentuk) {
      harap(`4. bentuk tak berubah "${nama}": SAMA PERSIS dengan versi lama`, L0.susunLapis2(x, kepala) === susunLapis2(x, kepala));
    }
    // 30 debet: versi lama mencetak 8 + "…dan 22 lagi" — 22 baris itu distempel tanpa dirinci.
    const x = isiKosong(); x.debetNganggur = baris("D", 30); x.rpDebetNganggur = 7;
    const lama: string[] = L0.susunLapis2(x, kepala).split("\n"), baru = susunLapis2(x, kepala).split("\n");
    const tambah = baru.filter((l) => !lama.includes(l)), hilang = lama.filter((l) => !baru.includes(l));
    // (bullet peringatan "   • angka dari Aceh Gadai…" bukan baris rinci)
    const rinci = (L: string[]) => L.filter((l) => /^   • .* · D \d+$/.test(l)).length;
    harap("4. 30 keluar: versi lama hanya 8 rinci + '…dan 22 lagi'", rinci(lama) === 8 && lama.includes("   …dan 22 lagi"), `${rinci(lama)}`);
    harap("4. 30 keluar: versi baru 30 rinci", rinci(baru) === 30, `${rinci(baru)}`);
    harap("4. 30 keluar: beda dengan versi lama HANYA 22 baris rinci tambahan, '…dan 22 lagi' hilang",
          tambah.length === 22 && tambah.every((l) => l.startsWith("   • ")) && hilang.length === 1 && hilang[0] === "   …dan 22 lagi",
          `+${tambah.length} -${hilang.length}`);
  } catch (e) {
    harap("4. lapis2 lama dapat dimuat dari git " + DASAR, false, String(e));
  } finally {
    if (existsSync(lamaL)) unlinkSync(lamaL);
  }
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
