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
//      berubah (≤ 8 baris per arah, 0 baris, potongan admin). Bentuk yang
//      memuat uang KELUAR dibandingkan sesudah sorotannya dilepas (bagian 5).
//   5. SOROTAN UANG KELUAR TANPA ALASAN (keputusan Owner 1 Nov 2026): judul
//      + 🔴 di setiap baris keluar + satu peringatan di kepala; masuk & admin
//      tidak disorot; 0 keluar → tanpa sorotan; laporan dipecah → baris 🔴
//      di pesan lanjutan tetap tersorot dan judulnya diulang — HANYA bila
//      pesannya dimulai di baris 🔴 / kalimat sisa keluar, bukan di baris ℹ️
//      admin/batas (sapuan tetap 2×61×80 bentuk); rekening KIRIM 1919 ikut;
//      dilepas sorotannya = SAMA PERSIS dengan versi <sebelum>.
//
// Tanpa database sungguhan, tanpa Telegram: env dikosongkan di awal supaya
// pemanggilan tak sengaja ke klien sungguhan GAGAL, bukan menulis.
//
//   npx tsx scripts/uji-nganggur-rinci.mts [--dasar=<commit>] [--sebelum=<commit>]
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TG_MUTASI_BOT_TOKEN"]) delete process.env[k];

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { bacaBarisNganggur, stempelBarisNganggur } from "../lib/pipeline/nganggur.ts";
import { bahanNganggur, idStempelNganggur, laporanTercatat, BATAS_RINCI_NGANGGUR,
         type BarisNganggur, type PassNganggur } from "../lib/laporan/nganggur.ts";
import { susunLapis2, susunLapis2Lengkap, pecahPesanLapis2, BATAS_PESAN_LAPIS2, AWALAN_LANJUTAN_LAPIS2,
         JUDUL_KELUAR_TANPA_ALASAN, PENANDA_KELUAR_TANPA_ALASAN, SAMBUNGAN_KELUAR_LAPIS2,
         type IsiLapis2 } from "../lib/laporan/lapis2.ts";
import { sisipkanBarisLembar } from "../lib/laporan/lembarWeb.ts";
import { BATAS_TEKS_PESAN_TG } from "../lib/telegram/bot.ts";
import { antreLaporanBerurutan, kurasOutbox } from "../lib/telegram/outbox.ts";

const DASAR = (process.argv.find((a) => a.startsWith("--dasar="))?.slice(8)) || "47b85aa";
/** Versi SEBELUM sorotan uang keluar (rinci semua, a772ae4) — pembanding bagian 5. */
const SEBELUM = (process.argv.find((a) => a.startsWith("--sebelum="))?.slice(10)) || "a772ae4";
const LANTAI = "2026-07-22";

/** Kembalikan teks bersorot ke bentuk sebelum sorotan (a772ae4): buang
 *  peringatan di kepala, judul keluar → "   keluar N · …", 🔴 → "•", buang
 *  baris kosong pemisah yang ditambahkan di depan judul. Kalau hasilnya SAMA
 *  PERSIS dengan versi lama, sorotan tidak mengubah cacah/rupiah/kalimat apa pun. */
const KEPALA_KELUAR = `${JUDUL_KELUAR_TANPA_ALASAN} — `;
const BARIS_KELUAR = `   ${PENANDA_KELUAR_TANPA_ALASAN} `;
// Ada sisa → cacahnya menyebut berapa yang belum terbaca, rupiahnya menyebut
// berapa yang dirinci; tanpa sisa → keduanya tidak ada (temuan tinjauan 3).
const PERINGATAN_ATAS = /^🚨 ADA \d+ UANG KELUAR TANPA ALASAN( \(Rp [\d.]+\)|, termasuk \d+ yang belum terbaca \(Rp [\d.]+, rupiah \d+ yang dirinci\)) — lihat bagian bawah$/;
function lepasSorotan(t: string): string {
  const out: string[] = [];
  for (const l of t.split("\n")) {
    if (PERINGATAN_ATAS.test(l)) continue;
    if (l.startsWith(KEPALA_KELUAR)) {
      if (out.length && out[out.length - 1] === "") out.pop();
      out.push("   keluar " + l.slice(KEPALA_KELUAR.length));
      continue;
    }
    out.push(l.startsWith(BARIS_KELUAR) ? "   • " + l.slice(BARIS_KELUAR.length) : l);
  }
  return out.join("\n");
}

/** Gabungan isi pesan-pesan hasil pecahPesanLapis2 tanpa hiasannya: judul
 *  lanjutan (+ baris sambungan uang keluar bila ada) dan penutup "bersambung". */
const tanpaHias = (xs: string[]) => xs.flatMap((b, i) => {
  let L = b.split("\n");
  if (i > 0) { L = L.slice(1); if (L[0] === SAMBUNGAN_KELUAR_LAPIS2) L = L.slice(1); }
  if (i < xs.length - 1) L = L.slice(0, -2);
  return L;
}).filter((l) => l !== "");

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
// Baris rinci: masuk "   • …", keluar (disorot sejak 1 Nov 2026) "   🔴 …".
const tercetak = (teks: string, pihak: string) => teks.split("\n").some((l) =>
  (l.startsWith("   • ") || l.startsWith(BARIS_KELUAR)) && l.endsWith(` · ${pihak}`));
const tercetakSorot = (teks: string, pihak: string) => teks.split("\n").some((l) => l.startsWith(BARIS_KELUAR) && l.endsWith(` · ${pihak}`));
const tercetakBiasa = (teks: string, pihak: string) => teks.split("\n").some((l) => l.startsWith("   • ") && l.endsWith(` · ${pihak}`));

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
  const rp30 = debet30.reduce((s, r) => s + r.nominal_debet, 0).toLocaleString("id-ID");
  harap("1a. cacah 'keluar 30' + rupiahnya = jumlah 30 baris (judul bersorot)",
        p.teks.includes(`\n${JUDUL_KELUAR_TANPA_ALASAN} — 30 · Rp ${rp30}\n`));
  harap("1a. SEMUA 30 debet disorot 🔴", debet30.every((r) => tercetakSorot(p.teks, r.nama_penerima)));
  harap("1a. peringatan di kepala: cacah & rupiah = blok", p.teks.split("\n")[2] === `🚨 ADA 30 UANG KELUAR TANPA ALASAN (Rp ${rp30}) — lihat bagian bawah`,
        p.teks.split("\n")[2]);
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
  const rp100 = terbaca.reduce((s, r) => s + r.nominal_debet, 0).toLocaleString("id-ID");
  harap("1b. kepala keluar: cacah 130, rupiah dikatakan hanya yang dirinci",
        p.teks.includes(`\n${JUDUL_KELUAR_TANPA_ALASAN} — 130 · Rp ${rp100} (rupiah 100 yang dirinci)\n`));
  // Cacah 130 = 100 dirinci + 30 sisa yang BELUM terbaca (isinya belum
  // diketahui — bisa saja potongan admin), jadi kalimatnya menyebut itu.
  harap("1b. peringatan di kepala menyebut 130, termasuk 30 yang belum terbaca, + rupiah 100 yang dirinci",
        p.teks.split("\n")[2] === `🚨 ADA 130 UANG KELUAR TANPA ALASAN, termasuk 30 yang belum terbaca (Rp ${rp100}, rupiah 100 yang dirinci) — lihat bagian bawah`,
        p.teks.split("\n")[2]);
  harap("1b. 7 kredit tercetak semua, tanpa sisa", rows.filter((r) => r.nominal_kredit > 0).every((r) => tercetak(p.teks, r.nama_pengirim)) &&
        p.teks.includes("   masuk  7 · Rp 1.400.000\n"));
  harap("1b. 7 kredit TIDAK disorot (tetap '•'), 100 debet disorot 🔴",
        rows.filter((r) => r.nominal_kredit > 0).every((r) => tercetakBiasa(p.teks, r.nama_pengirim) && !tercetakSorot(p.teks, r.nama_pengirim)) &&
        terbaca.every((r) => tercetakSorot(p.teks, r.nama_penerima) && !tercetakBiasa(p.teks, r.nama_penerima)));
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
      // Bentuk yang memuat uang KELUAR kini disorot (bagian 5) — dibandingkan
      // sesudah sorotannya dilepas; selebihnya harus SAMA PERSIS apa adanya.
      const adaKeluar = x.debetNganggur.length + Number(x.sisaDebetNganggur ?? 0) > 0;
      const baru = susunLapis2(x, kepala);
      harap(adaKeluar ? `4. bentuk "${nama}": sorotan dilepas = SAMA PERSIS dengan versi lama`
                      : `4. bentuk tak berubah "${nama}": SAMA PERSIS dengan versi lama`,
            L0.susunLapis2(x, kepala) === (adaKeluar ? lepasSorotan(baru) : baru) && (!adaKeluar || baru !== lepasSorotan(baru)));
    }
    // 30 debet: versi lama mencetak 8 + "…dan 22 lagi" — 22 baris itu distempel tanpa dirinci.
    const x = isiKosong(); x.debetNganggur = baris("D", 30); x.rpDebetNganggur = 7;
    const lama: string[] = L0.susunLapis2(x, kepala).split("\n"), baru = lepasSorotan(susunLapis2(x, kepala)).split("\n");
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

// ═══════════════════════ 5. SOROTAN UANG KELUAR TANPA ALASAN ═══════════════════════
// Keputusan Owner 1 Nov 2026: "SEMUA UANG KELUAR TANPA ALASAN … baik rek 1994
// maupun 1919, telegramnya DI HIGHLIGHT. Uang masuk tidak perlu di highlight."
console.log(`── 5. sorotan uang keluar tanpa alasan (pembanding ${SEBELUM}) ──`);
{
  const kepala = { nomor: 41, sebelumNomor: 40, sebelumKapan: null };
  const r = (t: string, jam: string, n: number, p: string): BarisNganggur => ({ tgl: t, jam, nominal: n, pihak: p, ket: "" });
  const hitung = (t: string, s: string) => t.split(s).length - 1;

  // ── 5a. bentuk dasar: 2 masuk + 3 keluar + admin + batas ──
  {
    const x = isiKosong();
    x.kreditNganggur = [r(tgl(1), "10:02:11", 1_500_000, "SITI AMINAH"), r(tgl(2), "11:00:00", 250_000, "M_ALI*RAHMAN [PRIBADI]")];
    x.rpKreditNganggur = 1_750_000;
    x.debetNganggur = [r(tgl(1), "14:20:05", 2_000_000, "BUDI SANTOSO"), r(tgl(2), "09:11:40", 750_000, "TOKO_MAJU (QRIS) *"),
                       r(tgl(2), "16:45:00", 300_000, "")];
    x.rpDebetNganggur = 3_050_000;
    x.nBiayaAdmin = 2; x.rpBiayaAdmin = 9_000; x.nganggurBatas = tgl(2);
    const { teks, ringkas } = susunLapis2Lengkap(x, kepala);
    const L = teks.split("\n");
    harap("5a. baris pertama tetap '🟢 LAPIS 2 · cek mutasi' (jangkar LIKE)", L[0].startsWith("🟢 LAPIS 2 · cek mutasi"));
    harap("5a. peringatan SATU baris tepat di bawah kepala, cacah & rupiah = blok",
          L[2] === "🚨 ADA 3 UANG KELUAR TANPA ALASAN (Rp 3.050.000) — lihat bagian bawah" && hitung(teks, "🚨 ADA ") === 1, L[2]);
    harap("5a. judul blok keluar bersorot, dipisah baris kosong dari daftar masuk",
          teks.includes("   • 2 Nov 11:00:00 · Rp 250.000 · M_ALI*RAHMAN [PRIBADI]\n\n🚨 UANG KELUAR TANPA ALASAN — 3 · Rp 3.050.000\n"));
    harap("5a. setiap baris keluar diawali 🔴 (termasuk pihak kosong & karakter Markdown)",
          teks.includes("\n   🔴 1 Nov 14:20:05 · Rp 2.000.000 · BUDI SANTOSO\n") &&
          teks.includes("\n   🔴 2 Nov 09:11:40 · Rp 750.000 · TOKO_MAJU (QRIS) *\n") &&
          teks.includes("\n   🔴 2 Nov 16:45:00 · Rp 300.000 · \n") && hitung(teks, PENANDA_KELUAR_TANPA_ALASAN) === 3);
    harap("5a. uang MASUK tidak disorot (tetap '•', tanpa 🔴)",
          tercetakBiasa(teks, "SITI AMINAH") && !tercetakSorot(teks, "SITI AMINAH") && teks.includes("\n   masuk  2 · Rp 1.750.000\n"));
    harap("5a. potongan admin & batas tetap baris ℹ️ biasa (tidak disorot)",
          teks.includes("\n   ℹ️ 2 potongan admin bank · Rp 9.000 — tidak dirinci.\n   ℹ️ diperiksa sampai 2 Nov saja"));
    harap("5a. ringkas web tidak berubah: keluar {3, 3.050.000}; peringatan 'menutup hari' tidak ketambahan",
          ringkas.tanpaPemilikKeluar?.n === 3 && ringkas.tanpaPemilikKeluar?.rp === 3_050_000 &&
          !ringkas.peringatan.some((p) => /UANG KELUAR/.test(p)));
    const web = sisipkanBarisLembar(teks, "📊 Laporan web L2-41: https://contoh.test/l/x").split("\n");
    harap("5a. dengan tautan web: baris 3 = tautan, baris 4 = peringatan", web[2].startsWith("📊 Laporan web") && PERINGATAN_ATAS.test(web[3]));
  }

  // ── 5b. tanpa uang keluar: TIDAK ada sorotan apa pun ──
  {
    const bentuk: [string, IsiLapis2][] = [];
    bentuk.push(["0 baris", isiKosong()]);
    { const x = isiKosong(); x.kreditNganggur = [r(tgl(1), "08:00:00", 50_000, "A")]; x.rpKreditNganggur = 50_000; bentuk.push(["masuk saja", x]); }
    { const x = isiKosong(); x.nBiayaAdmin = 4; x.rpBiayaAdmin = 18_000; bentuk.push(["admin saja", x]); }
    { const x = isiKosong(); x.nganggurDiperiksa = false; bentuk.push(["tidak diperiksa", x]); }
    for (const [nama, x] of bentuk) {
      const t = susunLapis2(x, kepala);
      harap(`5b. "${nama}": tanpa peringatan, tanpa judul keluar, tanpa 🔴`,
            !t.includes("UANG KELUAR TANPA ALASAN") && !t.includes(PENANDA_KELUAR_TANPA_ALASAN) && !t.includes("🚨 ADA "));
    }
  }

  // ── 5c. keluar saja: judul langsung di bawah kepala blok (tanpa baris kosong) ──
  {
    const x = isiKosong();
    x.debetNganggur = [r(tgl(1), "09:00:00", 1_000_000, "X")]; x.rpDebetNganggur = 1_000_000;
    const t = susunLapis2(x, kepala);
    harap("5c. keluar saja: 'UANG DI MUTASI TANPA PEMILIK' lalu judul bersorot",
          t.endsWith("UANG DI MUTASI TANPA PEMILIK\n🚨 UANG KELUAR TANPA ALASAN — 1 · Rp 1.000.000\n   🔴 1 Nov 09:00:00 · Rp 1.000.000 · X"));
  }

  // ── 5d. 1919 rekening KIRIM: debet tanpa pemilik ikut disorot ──
  {
    noBaris = 0;
    const rows: Baris[] = [
      mutasi(tgl(1), "debet", 4_250_000, "PENERIMA 1919 A", { bank_id: BANK_LAIN }),
      mutasi(tgl(2), "debet", 600_000, "PENERIMA 1919 B", { bank_id: BANK_LAIN }),
      mutasi(tgl(2), "debet", 6_500, "ADMIN 1919", { bank_id: BANK_LAIN }),
      mutasi(tgl(1), "kredit", 20_000_000, "PINDAH SALDO DARI 1994", { bank_id: BANK_LAIN }),
      mutasi(tgl(1), "debet", 9_999_999, "MILIK 1994", { bank_id: BANK }),
      mutasi(tgl(2), "debet", 123_000, "SUDAH DIKLAIM 1919", { bank_id: BANK_LAIN, claimed_by_input_id: "inp-7" }),
    ];
    const db = dbTiruan({ parsed_transactions: rows });
    // Dua rekening aktif → jalankanPass membaca dengan bankId berkas ini (ketatRekening).
    const baca = async (jenis: "debet" | "kredit") =>
      bacaBarisNganggur(db as any, { accountId: AKUN, jenis, bankId: BANK_LAIN, dari: tgl(1), sampai: tgl(2), idTerpakai: new Set() });
    const bd = await baca("debet"), bk = await baca("kredit");
    const pd: PassNganggur = { unclaimedRows: bd.rows, unclaimedBelumLapor: bd.belumLapor, idNganggur: bd.ids };
    const pk: PassNganggur = { unclaimedRows: bk.rows, unclaimedBelumLapor: bk.belumLapor, idNganggur: bk.ids };
    const x: IsiLapis2 = { ...isiKosong(), bankLabel: "BSI ••1919 (KELUAR)", ...bahanNganggur(pk, pd, LANTAI),
      infoRekening: ["Masuk (kredit): arah ini milik rekening lain — tidak ada klaim yang menunggu di rekening ini"] };
    const t = susunLapis2(x, kepala), L = t.split("\n");
    harap("5d. 1919: dua debet tanpa pemilik disorot 🔴", tercetakSorot(t, "PENERIMA 1919 A") && tercetakSorot(t, "PENERIMA 1919 B"));
    harap("5d. 1919: peringatan atas (baris 3) SEBELUM baris ℹ️ rekening lain",
          L[2] === "🚨 ADA 2 UANG KELUAR TANPA ALASAN (Rp 4.850.000) — lihat bagian bawah" && L[3].startsWith("ℹ️ Masuk (kredit): arah ini milik rekening lain"), `${L[2]} | ${L[3]}`);
    harap("5d. 1919: isi ulang (kredit) tetap '•', admin 1919 tetap ℹ️, baris 1994 & yang diklaim tidak ikut",
          tercetakBiasa(t, "PINDAH SALDO DARI 1994") && t.includes("ℹ️ 1 potongan admin bank · Rp 6.500 — tidak dirinci.") &&
          !t.includes("MILIK 1994") && !t.includes("SUDAH DIKLAIM 1919"));
    // Pass debet 1919 batal (TIDAK_ADA_KLAIM): tetap dirinci & disorot, TIDAK distempel.
    const pBatal = await putaran(db, { dari: tgl(1), sampai: tgl(2), bankId: BANK_LAIN, batal: true });
    harap("5d. 1919 pass batal: debet tetap dirinci + disorot, tidak distempel",
          tercetakSorot(pBatal.teks, "PENERIMA 1919 A") && PERINGATAN_ATAS.test(pBatal.teks.split("\n")[2]) &&
          rows.every((b) => b.unclaimed_reported_at === null));
  }

  // ── 5e. laporan dipecah: baris 🔴 di pesan lanjutan tetap tersorot + judul diulang ──
  const cekPecah = (teks: string, isi: IsiLapis2, batas: number) => {
    const bagian = pecahPesanLapis2(teks, batas);
    const keluar = isi.debetNganggur, masuk = isi.kreditNganggur;
    // Penilai sambungan, dihitung dari TEKS ASLI, bukan dari aturan
    // pecahPesanLapis2 (temuan tinjauan 1: aturan lama "baris menjorok
    // sesudah judul keluar" ikut memasang 🚨 di depan baris ℹ️ admin/batas).
    // Isi daftar keluar = baris sesudah judul keluar yang diawali 🔴 atau
    // kalimat sisa "…dan" — sambungan sah HANYA kalau pesan lanjutan dimulai
    // di salah satunya. Awal tiap pesan = cacah baris isi pesan-pesan sebelumnya.
    const asli = teks.split("\n").filter((l) => l !== "");
    const iJudul = asli.findIndex((l) => l.startsWith(KEPALA_KELUAR));
    const daftarKeluar = new Set<number>();
    if (iJudul >= 0) {
      for (let j = iJudul + 1; j < asli.length && (asli[j].startsWith(BARIS_KELUAR) || asli[j].startsWith("   …dan ")); j++) daftarKeluar.add(j);
    }
    const adaSambungan = (b: string) => b.split("\n")[1] === SAMBUNGAN_KELUAR_LAPIS2;
    let mulai = 0;
    const awalPesan = bagian.map((b, i) => {
      let L = b.split("\n");
      if (i > 0) { L = L.slice(1); if (L[0] === SAMBUNGAN_KELUAR_LAPIS2) L = L.slice(1); }
      if (i < bagian.length - 1) L = L.slice(0, -2);
      const di = mulai;
      mulai += L.filter((l) => l !== "").length;
      return di;
    });
    return {
      bagian,
      panjangAman: bagian.every((b) => b.length <= batas),
      utuh: JSON.stringify(tanpaHias(bagian)) === JSON.stringify(teks.split("\n").filter((l) => l !== "")),
      keluarTersorot: keluar.every((k) => bagian.filter((b) => tercetakSorot(b, k.pihak)).length === 1 &&
                                         bagian.every((b) => !tercetakBiasa(b, k.pihak))),
      masukPolos: masuk.every((k) => bagian.every((b) => !tercetakSorot(b, k.pihak))),
      keluarDiLanjutan: keluar.filter((k) => bagian.slice(1).some((b) => tercetakSorot(b, k.pihak))).length,
      // Pesan lanjutan yang dimulai di baris 🔴 / kalimat sisa keluar WAJIB
      // membawa sambungan; SEMUA yang lain (baris masuk, judul blok, baris ℹ️
      // admin/batas, …) TIDAK — tidak ada lagi "terserah".
      sambunganBenar: bagian.every((b, i) => adaSambungan(b) === (i > 0 && daftarKeluar.has(awalPesan[i]))) &&
                      !bagian[0].includes(SAMBUNGAN_KELUAR_LAPIS2),
      // Alarm tanpa isi: pesan bersambungan yang tidak memuat satu pun baris
      // 🔴 atau kalimat sisa keluar (bentuk temuan 1). Harus selalu 0.
      sambunganPalsu: bagian.filter((b) => adaSambungan(b) &&
        !b.split("\n").some((l) => l.startsWith(BARIS_KELUAR) || l.startsWith("   …dan "))).length,
      // Jenis baris pertama tiap pesan lanjutan — supaya uji bisa memastikan
      // bentuk yang dulu kena (ℹ️ sesudah daftar keluar) benar-benar terjadi.
      awalLanjutan: bagian.slice(1).map((_, j) => {
        const i = j + 1, a = asli[awalPesan[i]] ?? "";
        const sesudahJudulKeluar = iJudul >= 0 && awalPesan[i] > iJudul;
        return { ada: adaSambungan(bagian[i]),
                 jenis: daftarKeluar.has(awalPesan[i]) ? (a.startsWith(BARIS_KELUAR) ? "🔴" : "…dan")
                      : sesudahJudulKeluar && a.startsWith("   ℹ️") ? "ℹ️-sesudah-keluar" : "lain" };
      }),
      nSambungan: bagian.filter(adaSambungan).length,
    };
  };
  {
    const nama = (p: string, i: number) => `${p}${String(i).padStart(3, "0")} `.padEnd(80, "N");
    const isi: IsiLapis2 = {
      ...isiKosong(),
      ...bahanNganggur(
        { unclaimedRows: Array.from({ length: 100 }, (_, i) => r(tgl(1 + (i % 3)), "23:59:59", 123_456_789 + i, nama("K", i))), unclaimedBelumLapor: 100 },
        { unclaimedRows: Array.from({ length: 100 }, (_, i) => r(tgl(1 + (i % 3)), "23:59:59", 987_654_321 + i, nama("D", i))), unclaimedBelumLapor: 140 },
        LANTAI),
      tunggakan: Array.from({ length: 12 }, (_, i) => ({ no_faktur: `SBR-1-${1000 + i}`, outlet: "BIREUEN", tgl: tgl(1), nominal: 1_000_000, umur: 3, sebab: "tidak ada di rekening" })),
    };
    const teks = sisipkanBarisLembar(susunLapis2(isi, { nomor: 12, sebelumNomor: 11, sebelumKapan: null }),
                                     "📊 Laporan web L2-12: https://contoh.test/lembar/xyz");
    const c = cekPecah(teks, isi, BATAS_PESAN_LAPIS2);
    harap(`5e. laporan ${teks.length} huruf → ${c.bagian.length} pesan, semua ≤ ${BATAS_TEKS_PESAN_TG}`,
          c.bagian.length >= 4 && c.panjangAman, c.bagian.map((b) => b.length).join(","));
    harap("5e. pesan pertama: '🟢 LAPIS 2' + tautan baris 3 + peringatan baris 4 (cacah 140)",
          c.bagian[0].startsWith("🟢 LAPIS 2") && c.bagian[0].split("\n")[2].startsWith("📊 Laporan web") &&
          /^🚨 ADA 140 UANG KELUAR TANPA ALASAN, termasuk 40 yang belum terbaca \(Rp [\d.]+, rupiah 100 yang dirinci\) — lihat bagian bawah$/.test(c.bagian[0].split("\n")[3]),
          c.bagian[0].split("\n")[3]);
    harap(`5e. ${c.keluarDiLanjutan} baris keluar jatuh di pesan lanjutan — SEMUA 100 tersorot 🔴 di tepat satu pesan`,
          c.keluarDiLanjutan > 0 && c.keluarTersorot);
    harap("5e. baris masuk tidak tersorot di pesan mana pun", c.masukPolos);
    harap(`5e. pesan lanjutan yang dimulai di tengah daftar keluar mengulang judulnya (${c.nSambungan}×), yang lain tidak`,
          c.nSambungan >= 1 && c.sambunganBenar);
    harap("5e. gabungan pesan = teks asli (sambungan bukan baris laporan)", c.utuh);
    harap("5e. pesan lanjutan tetap diawali '↪️ LAPIS 2 lanjutan', bukan '🟢 LAPIS 2'",
          c.bagian.slice(1).every((b) => b.startsWith(`${AWALAN_LANJUTAN_LAPIS2} `) && !b.startsWith("🟢 LAPIS 2")));

    // Acak: banyak bentuk, dua batas (tandaiSelesai & kirim ulang yang
    // mengurangi ruang untuk kepalanya), nama sembarang — termasuk nama masuk
    // yang menyamar sebagai judul keluar (menjorok, jadi tidak boleh dikira judul).
    let rusak = 0, adaSambungan = 0;
    const contohRusak: string[] = [];
    for (let c2 = 0; c2 < 200; c2++) {
      const nK = Math.floor(Math.random() * 101), nD = Math.floor(Math.random() * 101);
      const acakNama = (p: string, i: number) => {
        const u = Math.random();
        const dasar = u < 0.05 ? `${JUDUL_KELUAR_TANPA_ALASAN} PALSU ${p}${i}` : u < 0.1 ? `*_[]()~\`>#+-=|{}.! ${p}${i}` : `${p}${i} `;
        return dasar.padEnd(dasar.length + Math.floor(Math.random() * Math.max(0, 80 - dasar.length)), "x").slice(0, 80);
      };
      const sisaK = Math.random() < 0.2 ? Math.floor(Math.random() * 30) : 0;
      const sisaD = Math.random() < 0.2 ? Math.floor(Math.random() * 30) : 0;
      const isiA: IsiLapis2 = {
        ...isiKosong(),
        ...bahanNganggur(
          { unclaimedRows: Array.from({ length: nK }, (_, i) => r(tgl(1 + (i % 3)), "10:00:00", 1_000 + i * 777, acakNama("K", i))), unclaimedBelumLapor: nK + sisaK },
          { unclaimedRows: Array.from({ length: nD }, (_, i) => r(tgl(1 + (i % 3)), "10:00:00", Math.random() < 0.05 ? 2_500 : 3_000 + i * 913, acakNama("D", i))), unclaimedBelumLapor: nD + sisaD },
          LANTAI),
        gagal: Math.random() < 0.3 ? ["debet: Tidak ada klaim debet yang menunggu."] : [],
        infoRekening: Math.random() < 0.3 ? ["Masuk (kredit): arah ini milik rekening lain — tidak ada klaim yang menunggu di rekening ini"] : [],
      };
      const t = Math.random() < 0.5 ? susunLapis2(isiA, kepala) : sisipkanBarisLembar(susunLapis2(isiA, kepala), "📊 Laporan web L2-1: https://contoh.test/l/a");
      const batas = Math.random() < 0.5 ? BATAS_PESAN_LAPIS2 : BATAS_PESAN_LAPIS2 - 300;
      const h = cekPecah(t, isiA, batas);
      const nKeluar = isiA.debetNganggur.length + Number(isiA.sisaDebetNganggur ?? 0);
      const peringatanOk = nKeluar > 0
        ? PERINGATAN_ATAS.test(h.bagian[0].split("\n").find((l) => l.startsWith("🚨 ADA ")) ?? "") && hitung(t, "🚨 ADA ") === 1
        : !t.includes("🚨 ADA ") && !t.includes(JUDUL_KELUAR_TANPA_ALASAN + " — ") && h.nSambungan === 0;
      const ok = h.panjangAman && h.utuh && h.keluarTersorot && h.masukPolos && h.sambunganBenar && h.sambunganPalsu === 0 && peringatanOk &&
        h.bagian[0].startsWith("🟢 LAPIS 2") && (t.length <= batas ? h.bagian.length === 1 && h.bagian[0] === t : h.bagian.length >= 2);
      if (h.nSambungan > 0) adaSambungan++;
      if (!ok) { rusak++; if (contohRusak.length < 3) contohRusak.push(`nK=${nK} nD=${nD} batas=${batas} ${JSON.stringify({ ...h, bagian: h.bagian.length, awalLanjutan: undefined })}`); }
    }
    harap(`5e. 200 laporan acak (${adaSambungan} dengan sambungan): panjang ≤ batas, utuh, keluar 🔴, masuk polos, peringatan tepat`,
          rusak === 0 && adaSambungan > 0, `${rusak} rusak; ${contohRusak.join(" || ")}`);

    // Sapuan TETAP (bukan acak) di batas sungguhan 4000, bentuk temuan
    // tinjauan 1: masuk 0-60 × keluar 1-80, dengan potongan admin + batas
    // tanggal, sisa keluar 0 dan 7. Dulu sebagian pesan lanjutan yang dimulai
    // di baris "   ℹ️ N potongan admin bank …" / "   ℹ️ diperiksa sampai …"
    // ikut mendapat judul 🚨 — alarm tanpa satu pun baris 🔴. Sapuan ini
    // WAJIB memuat bentuk itu (dan bentuk "…dan" sisa keluar), bukan sekadar lolos.
    let rusakS = 0, nBentuk = 0;
    const jenisS: Record<string, { n: number; ada: number }> = {};
    const contohS: string[] = [];
    for (const sisaD of [0, 7]) for (let nK = 0; nK <= 60; nK++) for (let nD = 1; nD <= 80; nD++) {
      nBentuk++;
      const isiS: IsiLapis2 = {
        ...isiKosong(),
        ...bahanNganggur(
          { unclaimedRows: Array.from({ length: nK }, (_, i) => r(tgl(1 + (i % 2)), "10:00:00", 150_000 + i * 1_000, `PENGIRIM ${i} `.padEnd(30, "A"))), unclaimedBelumLapor: nK },
          { unclaimedRows: Array.from({ length: nD }, (_, i) => r(tgl(1 + (i % 2)), "11:00:00", 250_000 + i * 1_000, `PENERIMA ${i} `.padEnd(30, "B"))), unclaimedBelumLapor: nD + sisaD },
          LANTAI),
        nBiayaAdmin: 3, rpBiayaAdmin: 13_500, nganggurBatas: tgl(2),
      };
      const h = cekPecah(susunLapis2(isiS, kepala), isiS, BATAS_PESAN_LAPIS2);
      for (const a of h.awalLanjutan) {
        const j = (jenisS[a.jenis] ??= { n: 0, ada: 0 });
        j.n++; if (a.ada) j.ada++;
      }
      if (!(h.panjangAman && h.utuh && h.keluarTersorot && h.sambunganBenar && h.sambunganPalsu === 0)) {
        rusakS++; if (contohS.length < 2) contohS.push(`masuk ${nK} + keluar ${nD} (sisa ${sisaD}): ${JSON.stringify(h.awalLanjutan)}`);
      }
    }
    const js = (k: string) => jenisS[k] ?? { n: 0, ada: 0 };
    harap(`5e. sapuan ${nBentuk} bentuk di batas 4000: tidak ada 🚨 sambungan tanpa isi keluar ` +
          `(${js("ℹ️-sesudah-keluar").n} pesan lanjutan dimulai di baris ℹ️ sesudah daftar keluar → 0 bersambungan)`,
          rusakS === 0 && js("ℹ️-sesudah-keluar").n > 0 && js("ℹ️-sesudah-keluar").ada === 0,
          `${rusakS} rusak; ${JSON.stringify(jenisS)}; ${contohS.join(" || ")}`);
    harap(`5e. sapuan: pesan lanjutan yang dimulai di baris 🔴 (${js("🔴").n}) atau kalimat sisa keluar (${js("…dan").n}) SEMUA bersambungan, ` +
          `yang lain (${js("lain").n}) tidak`,
          js("🔴").n > 0 && js("🔴").ada === js("🔴").n && js("…dan").n > 0 && js("…dan").ada === js("…dan").n && js("lain").ada === 0,
          JSON.stringify(jenisS));
  }

  // ── 5f. pembanding versi SEBELUM sorotan: dilepas sorotannya = SAMA PERSIS ──
  const sebelumL = "lib/laporan/__sebelum_lapis2_sorot.ts";
  try {
    writeFileSync(sebelumL, execSync(`git show ${SEBELUM}:lib/laporan/lapis2.ts`, { encoding: "utf8", maxBuffer: 8 << 20 }));
    const L1 = await import("../" + sebelumL);
    let beda = 0, bedaTanpaKeluar = 0, nKeluar = 0;
    const contoh: string[] = [];
    for (let c = 0; c < 400; c++) {
      const nK = Math.floor(Math.random() * 15), nD = Math.random() < 0.35 ? 0 : Math.floor(Math.random() * 15);
      const x = isiKosong();
      x.kreditNganggur = Array.from({ length: nK }, (_, i) => r(tgl(1 + (i % 3)), "09:15:00", 10_000 * (i + 1), `K ${i}`));
      x.rpKreditNganggur = x.kreditNganggur.reduce((s, b) => s + b.nominal, 0);
      x.debetNganggur = Array.from({ length: nD }, (_, i) => r(tgl(1 + (i % 3)), "09:15:00", 20_000 * (i + 1), `D ${i}`));
      x.rpDebetNganggur = x.debetNganggur.reduce((s, b) => s + b.nominal, 0);
      if (Math.random() < 0.3) { x.sisaKreditNganggur = Math.floor(Math.random() * 20); x.mulaiSisaKreditNganggur = Math.random() < 0.5 ? tgl(3) : null; }
      if (Math.random() < 0.3) { x.sisaDebetNganggur = Math.floor(Math.random() * 20); x.mulaiSisaDebetNganggur = Math.random() < 0.5 ? tgl(3) : null; }
      if (Math.random() < 0.4) { x.nBiayaAdmin = 1 + Math.floor(Math.random() * 5); x.rpBiayaAdmin = 2_500 * x.nBiayaAdmin; }
      if (Math.random() < 0.3) x.nganggurBatas = tgl(2);
      if (Math.random() < 0.2) x.nganggurDiperiksa = false;
      if (Math.random() < 0.3) x.gagal = ["kredit: Tidak ada klaim kredit yang menunggu."];
      if (Math.random() < 0.3) x.infoRekening = ["Keluar (debet): 3 klaim milik rekening lain — dinilai di berkas rekening itu"];
      const lama = L1.susunLapis2Lengkap(x, kepala), baru = susunLapis2Lengkap(x, kepala);
      const adaKeluar = x.debetNganggur.length + Number(x.sisaDebetNganggur ?? 0) > 0;
      if (adaKeluar) nKeluar++;
      if (lepasSorotan(baru.teks) !== lama.teks || JSON.stringify(baru.ringkas) !== JSON.stringify(lama.ringkas)) {
        beda++; if (contoh.length < 2) contoh.push(`nK=${nK} nD=${nD}`);
      }
      if (!adaKeluar && baru.teks !== lama.teks) bedaTanpaKeluar++;
    }
    harap(`5f. 400 bentuk acak (${nKeluar} ber-keluar): sorotan dilepas = teks ${SEBELUM} SAMA PERSIS, ringkas web sama`, beda === 0, `${beda} beda ${contoh.join(" | ")}`);
    harap(`5f. bentuk tanpa uang keluar: teks SAMA PERSIS dengan ${SEBELUM} apa adanya`, bedaTanpaKeluar === 0, `${bedaTanpaKeluar}`);
  } catch (e) {
    harap("5f. lapis2 sebelum sorotan dapat dimuat dari git " + SEBELUM, false, String(e));
  } finally {
    if (existsSync(sebelumL)) unlinkSync(sebelumL);
  }

  // ── 5g. sorotan tidak bergantung parse_mode: kirimPesan tetap teks polos ──
  harap("5g. lib/telegram/bot.ts tidak memasang parse_mode (nama pihak bebas karakter tidak bisa menolak pesan)",
        !/parse_mode\s*:/.test(readFileSync("lib/telegram/bot.ts", "utf8")));
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
