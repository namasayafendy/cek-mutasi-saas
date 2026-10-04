// Matching algorithm with per-input rules + cross-bank flag.
// Phase 9.1: setiap input punya rules-nya sendiri (dari preset MatchRule).
//
// Fase B overhaul rekonsiliasi (2026-07-13): matching bertingkat 3-PASS GLOBAL
// untuk klaim Aceh Gadai (input yang membawa refFt / jamResi+namaPengirimResi):
//   Pass 1 REF      — token FT BSI di resi vs awalan no_ref mutasi. Unik & terkuat;
//                     menembus jendela tanggal (kredit lama tetap ketemu). Ref ketemu
//                     tapi nominal beda / sudah di-claim -> refIssue (alarm), TIDAK
//                     diam-diam jatuh ke tebakan nominal (pelajaran salah-pasang 1,1jt).
//   Pass 2 NAMA+JAM — nominal sama + jam resi ±5 menit + nama pengirim resi cocok
//                     (fuzzy per-kata) dalam jendela 14 hari ke belakang, 1 hari maju.
//                     Kombinasi (nama,nominal,jam) terbukti hampir unik di data:
//                     hanya 2 dobel dari 1.856 kredit.
//   Pass 3 NOMINAL  — perilaku lama (nominal + jendela rules per-input), fallback
//                     terakhir & satu-satunya jalur untuk input manual.
//   (27 Sep 2026) NAMA — nama pengirim SAMA PERSIS + nominal, ±1 hari, untuk resi
//                     tanpa jam; berjalan sebelum pencocokan nominal. Lihat
//                     cocokNamaTanpaJam di bawah.
//   (1 Okt 2026) Tebakan NOMINAL tidak lagi mengambil baris yang jam DAN nama
//                     resinya sendiri membantah — lihat resiBertentangan dan
//                     pagar (d) di PASS 4 (SJB-2-0056).
// Pass dijalankan GLOBAL (semua input pass-1 dulu, baru pass-2, baru pass-3) dengan
// satu claimed-set bersama — supaya input tanpa-ref tidak "menyambar" kredit yang
// ditunjuk ref input lain.

import { toDateISO } from "@/lib/format";
import type {
  PdfTransaction,
  UserInput,
  MatchResult,
  MatchSummary,
  MatchMode,
  RefIssue,
  MatchedBy,
  PemegangRef,
} from "@/lib/types";
import { diffDays } from "@/lib/format";

export type MatchRules = {
  lookback_days: number;
  forward_window_days: number;
  match_mode: MatchMode;
  tolerance_rp: number;
  tolerance_pct: number;
};

export const DEFAULT_RULES: MatchRules = {
  lookback_days: 3,
  forward_window_days: 0,
  match_mode: "exact",
  tolerance_rp: 0,
  tolerance_pct: 0,
};

// Parameter Pass 2 (disetujui 2026-07-13): jendela nama+jam lebih lebar dari
// jendela nominal-saja karena kuncinya jauh lebih spesifik.
const PASS2_LOOKBACK_DAYS = 14;
const PASS2_FORWARD_DAYS = 1;
const PASS2_JAM_TOLERANSI_MENIT = 5;
// Toleransi jam untuk PASS 3. Disamakan dengan PASS 2 supaya hanya ada SATU
// angka yang perlu dipikirkan saat menyetelnya. Waktu di resi adalah waktu
// nasabah menekan kirim; bank membukukannya beberapa saat kemudian.
const PASS3_JAM_TOLERANSI_MENIT = 5;

// ── UANG LAMA: BARIS MUTASI JAUH LEBIH TUA DARIPADA TRANSAKSINYA ──
//
// Uji resi bekas, 1 Oktober 2026. SJB-10-1386 (LHOKSEUMAWE, transaksi 1 Sep,
// Rp 80.000) memakai resi Junaidi bertanggal 29 Juni (FT261805QY44); PASS 1
// REF menembus jendela tanggal dan memasangkannya ke baris 29 Juni yang
// kebetulan belum berpemilik — hijau, tanpa satu peringatan pun. REF hanya
// membuktikan "uang ini PERNAH masuk", bukan "uang ini untuk transaksi ini".
//
// Batas 3 hari sama dengan jendela mundur aturan nominal (lookback 3 hari):
// transfer yang wajar mendarat paling lama beberapa hari sebelum transaksinya
// dicatat kasir. Yang lebih tua dari itu hampir selalu datang lewat REF (yang
// menembus jendela) atau resi yang tanggalnya memang lama. Bayar di muka
// memang ada (SBR-10-8501 41-48 hari, SBR-10-4595 29 hari), karena itu
// dipakai untuk MEMPERINGATKAN dan MENAHAN PENGUSIRAN — tidak pernah untuk
// menolak cocok.
export const BATAS_UANG_LAMA_HARI = 3;

/** Berapa hari baris mutasi mendahului TRANSAKSI-nya, kalau lebih dari
 *  BATAS_UANG_LAMA_HARI. null = tidak lama, atau tanggal transaksinya tidak
 *  diketahui (tidak diketahui ≠ lama; pemanggil yang perlu membedakan
 *  memeriksa tanggalTransaksi sendiri). Murni, tidak pernah melempar. */
export function uangLamaHari(
  tanggalTransaksi: Date | null | undefined,
  tglBaris: Date | null | undefined,
): number | null {
  if (!tanggalTransaksi || !tglBaris) return null;
  if (Number.isNaN(tanggalTransaksi.getTime()) || Number.isNaN(tglBaris.getTime())) return null;
  const hari = diffDays(tanggalTransaksi, tglBaris);
  return hari > BATAS_UANG_LAMA_HARI ? hari : null;
}

function nominalMatches(input: number, candidate: number, rules: MatchRules): boolean {
  if (rules.match_mode === "exact") return candidate === input;
  if (rules.match_mode === "tol_rp") {
    return Math.abs(candidate - input) <= rules.tolerance_rp;
  }
  if (rules.match_mode === "tol_pct") {
    const tol = Math.abs(input * rules.tolerance_pct) / 100;
    return Math.abs(candidate - input) <= tol;
  }
  return false;
}

/** "HH:MM" / "HH.MM" -> menit sejak 00:00; null kalau tak valid. */
function jamToMinutes(s: string | null | undefined): number | null {
  const m = String(s ?? "").trim().replace(".", ":").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Pagar 7 pengusiran (lihat PASS 1): pemegang baris tampak PEMILIK SAH —
 *  tanggal resinya sama dengan tanggal baris DAN jam resinya ±5 menit dari
 *  jam baris. Jam yang tidak terbaca di salah satu sisi = tidak terbukti
 *  (false), sehingga perilaku lama berlaku. Murni, tidak pernah melempar. */
export function pemegangCocokJam(
  pemegang: Pick<UserInput, "tanggal" | "jamResi">,
  tx: Pick<PdfTransaction, "tanggalDate" | "waktu">,
): boolean {
  if (!pemegang?.tanggal || !tx?.tanggalDate) return false;
  if (Number.isNaN(pemegang.tanggal.getTime()) || Number.isNaN(tx.tanggalDate.getTime())) return false;
  if (diffDays(pemegang.tanggal, tx.tanggalDate) !== 0) return false;
  const jp = jamToMinutes(pemegang.jamResi);
  const jt = jamToMinutes(tx.waktu);
  if (jp === null || jt === null) return false;
  return Math.abs(jp - jt) <= PASS2_JAM_TOLERANSI_MENIT;
}

/** Perbandingan nama longgar: cocok kalau ada kata >=4 huruf yang sama, atau
 *  salah satu nama termuat penuh di nama lain (utk nama pendek "M ALI" dsb).
 *  Nama pengirim mutasi bisa terpotong/berprefix — jangan pernah exact-only. */
export function namaCocok(a: string | null | undefined, b: string | null | undefined): boolean {
  const A = String(a ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const B = String(b ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!A || !B) return false;
  if (A === B) return true;
  const tokensA = A.split(" ").filter((t) => t.length >= 4);
  const tokensB = B.split(" ").filter((t) => t.length >= 4);
  if (tokensA.some((t) => B.includes(t))) return true;
  if (tokensB.some((t) => A.includes(t))) return true;
  if (A.includes(B) || B.includes(A)) return true;
  return false;
}

// ── NAMA TANPA JAM: pencocokan nama yang KETAT ──────────────────────────
//
// 27 September 2026, SJB-3-0211 (BIREUEN) Rp 50.000. Resi DANA tanpa tanggal
// dan jam; tanggalnya jatuh ke tanggal transaksi (26 Sep), padahal uangnya
// masuk 25 Sep 22.31 a.n. NENENG JUAIRIAH — nama yang SAMA PERSIS dengan resi.
// PASS 2 butuh jam, jadi dilewati; PASS 4 menemukan baris itu sebagai satu-
// satunya kandidat tapi beda hari, dan pagar anti-tebak-lintas-hari menolak
// (benar menolak — nominalnya diperebutkan empat resi). Pemilik menutupnya
// dengan tangan. Nama pengirim yang sama persis adalah bukti yang tidak pernah
// dipakai.
//
// SENGAJA BUKAN namaCocok. namaCocok longgar (satu kata ≥4 huruf yang sama
// sudah cukup) karena di PASS 2 ia ditopang jam ±5 menit. Di sini tidak ada
// jam, dan jendelanya melintasi hari — jadi namanya harus sama PERSIS setelah
// dinormalkan, atau salah satunya terpotong di batas kata.
//
// Diuji ke 60 hari data hidup: dari 542 klaim bernama ≥2 kata yang baris
// benarnya diketahui LEWAT JALAN LAIN (REF / NOMINAL_JAM / manual), 531 dapat
// tepat satu baris dan 530 benar; yang satu lagi (SBR-11-2096) justru dibenarkan
// ref dan jamnya sendiri — data lamanya yang tertukar. 30 resi bernama tanpa
// jam: 28 sama dengan hasil sekarang, N69940 tertangkap, 1 membongkar pasangan
// yang tertukar (SBR-12-0879 / SBR-4-0153).

/** Nama yang bukan nama orang: dompet digital, penyedia, placeholder AI. */
const NAMA_UMUM = new Set([
  "GOPAY", "GOPAY SALDO", "GO PAY", "DANA", "ID DANA", "DANA ID", "OVO",
  "SHOPEEPAY", "SHOPEE PAY", "AIRPAY", "DOMPET ANAK BANGSA",
  "VISIONET INTERNASIONAL PT", "ESPAY", "FLIP", "LINKAJA", "QRIS", "TRANSFER",
  "TABUNGAN BY JAGO", "TIDAK TERBACA", "TIDAK TERTERA",
]);

const rapikanNama = (s: string) =>
  s.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();

/** Nama di RESI (dibaca AI). null = tidak layak jadi kunci: tersamar
 *  ("dara ******", "0812****5803"), berangka, placeholder, nama penyedia, atau
 *  kurang dari dua kata sungguhan (≥3 huruf). */
export function namaResiKetat(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  if (/[0-9*•…()]|\.\.\.|x{4}/i.test(t)) return null;
  const n = rapikanNama(t);
  if (!n || NAMA_UMUM.has(n)) return null;
  if (n.split(" ").filter((w) => w.length >= 3).length < 2) return null;
  return n;
}

/** Nama di MUTASI. Buang dulu tempelan bank SEBELUM dibesarkan — tempelannya
 *  dikenali dari huruf campurannya (" Bank Seabank", " Bank BRI Jkt", " Dana"),
 *  sehingga nama besar semua seperti PRADANA tidak tersentuh. Juga awalan
 *  "DANA-" dan token FT yang terselip di nama (baris hasil parse ganda). */
export function namaMutasiKetat(s: string | null | undefined): string | null {
  let t = String(s ?? "").trim();
  if (!t) return null;
  t = t.replace(/\s+(Bank(\s+[A-Za-z]+)+|Dana)$/, "");
  t = t.replace(/^DANA\s*-\s*/i, "");
  t = t.replace(/\bFT\d{5}\S*/gi, " ");
  const n = rapikanNama(t);
  if (!n || NAMA_UMUM.has(n)) return null;
  return n;
}

/** Sama persis, atau salah satu terpotong TEPAT di batas kata dan yang lebih
 *  pendek masih ≥10 huruf (bank kadang memotong nama panjang). */
export function namaSamaKetat(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [pendek, panjang] = a.length <= b.length ? [a, b] : [b, a];
  return pendek.length >= 10 && panjang.startsWith(pendek) && panjang[pendek.length] === " ";
}

// ── RESI BERTENTANGAN DENGAN BARIS: JAM *DAN* NAMA SAMA-SAMA MEMBANTAH ──
//
// 1 Oktober 2026, sesudah uji resi bekas. PASS 4 menebak lewat nominal saja,
// dan selama ini buta terhadap jam dan nama yang SUDAH dibaca AI dari resi.
// Contoh hidup (data 60 hari): SJB-2-0056 (LANGSA, 11 Agu, Rp 2.530.000) —
// resinya a.n. ANDINI SAHPUTRI pukul 12:03 ref FT26223FW5JK; yang diambil
// baris 12.15 a.n. MUHAMMAD SIDDIQ (ref FT262233KZP0, nasabah Langsa lain).
// Hijau, tanpa satu pertanyaan pun. Insiden SJB-1-0186 (10 Agu, Rp 460.000)
// yang mengambil uang SBR-4-0182 lewat PASS 4 berpola sama, hanya saja
// resinya tanpa nama — ia ditahan pagar (c), bukan pagar ini.
//
// DUA-DUANYA wajib menyala; satu saja tidak cukup:
//   * jam saja: dari 32 cocok NOMINAL kredit yang resinya berjam & bernama,
//     7 yang sah jamnya meleset >5 menit (SJB-2-0271 12 menit, SBR-1-0407
//     8 jam — nama sama persis). Jam di resi bisa jam cetak, salah baca.
//   * nama saja: dari 543 cocok REF (kebenaran pasti) yang resinya bernama
//     layak, 3 namanya tidak cocok sama sekali ("Rehmen Abdilleh" vs RAHMAN
//     ABDILLAH, "Ari Kandang" vs DARKASYI) — tapi jamnya tepat; di cocok
//     NOMINAL ada 2 lagi (resi "POLTEK LHOKSEUMAWE" / "SPBU PT. KANA TAMIT",
//     jam tepat). Nama baris juga sering kosong/nama dompet.
//   Gabungannya: 0 dari 543 pasangan REF, 1 dari 32 cocok NOMINAL.
//
// Jam dibandingkan sebagai JAM DINDING (memutar lewat tengah malam: 23:58 vs
// 00:02 = 4 menit), bukan tanggal+jam: tanggal resi kadang hanya tempelan
// tanggal transaksi (tgl_fallback). Urusan beda hari sudah dijaga pagar
// lintas hari sendiri.
//
// TIDAK untuk klaim DEBET (TFKD-): di baris debet nama "pengirim" adalah
// PT ACEH GADAI SYARIAH, sedangkan nama di resi transfer keluar adalah
// PENERIMA — keduanya tidak akan pernah cocok.

/** true = jam resi DAN nama resi sama-sama membantah baris ini sebagai uang
 *  resi tersebut. Syaratnya: jam terbaca di dua sisi dan berselisih >5 menit
 *  (jam dinding), nama resi layak (namaResiKetat), nama baris layak
 *  (namaMutasiKetat — kosong/nama dompet bukan bantahan), dan namaCocok yang
 *  longgar pun menolak. Murni, tidak pernah melempar (gagal = false =
 *  perilaku lama). */
export function resiBertentangan(
  input: Pick<UserInput, "id" | "jamResi" | "namaPengirimResi">,
  tx: Pick<PdfTransaction, "waktu" | "namaPengirim">,
): boolean {
  try {
    if (String(input?.id ?? "").startsWith("TFKD-")) return false;
    const ji = jamToMinutes(input?.jamResi);
    const jt = jamToMinutes(tx?.waktu);
    if (ji === null || jt === null) return false;
    const selisih = Math.abs(ji - jt);
    if (Math.min(selisih, 24 * 60 - selisih) <= PASS2_JAM_TOLERANSI_MENIT) return false;
    const nama = namaResiKetat(input?.namaPengirimResi);
    if (!nama) return false;
    const namaBaris = namaMutasiKetat(tx?.namaPengirim);
    if (!namaBaris) return false;
    return !namaCocok(nama, tx.namaPengirim) && !namaCocok(nama, namaBaris);
  } catch {
    return false;
  }
}

export type RunMatchingOptions = {
  /** Per-input rules getter. Diberi 1 input, harus return rules-nya. */
  getRulesForInput?: (input: UserInput) => MatchRules;
  /** Force cross-bank ke semua input (skip filter bank). Untuk leftover re-run. */
  forceCrossBank?: boolean;
  /**
   * "all" (default) — match semua input dari awal.
   * "leftover-only" — proses HANYA input dengan status no_candidate, sisanya di-keep.
   */
  mode?: "all" | "leftover-only";
  /**
   * PASS 3b (nama persis tanpa jam) HANYA berjalan kalau pemanggil mengisi
   * ini. Isinya baris yang SUDAH DIPEGANG di luar kolam (kolam hanya memuat
   * berkas + carry-over yang BEBAS), supaya pagar "dua baris bernama sama =
   * urusan manusia" juga melihat baris terpegang di luar berkas. Tanpa itu
   * pagarnya buta sebelah, jadi pemanggil yang tidak bisa memuatnya (layar
   * /check lama) tidak mendapat PASS 3b sama sekali.
   */
  nama?: {
    terpegangLuar: { tanggalDate: Date; kredit: number; namaPengirim: string | null; bankId?: string | null }[];
  };
  /**
   * Tebakan NOMINAL saja untuk SETOR KE PUSAT (PASS 4) HANYA boleh kalau
   * pemanggil mengisi ini. Isinya baris bernominal setoran yang SUDAH
   * DIPEGANG di luar kolam, supaya syarat "kreditnya tepat satu dalam
   * jendela" juga menghitung kredit kembar yang sudah dipegang transaksi lain
   * di luar berkas. Tanpa itu syaratnya buta sebelah, jadi pemanggil yang
   * tidak bisa memuatnya (layar /check lama, riwayat) tidak pernah menebak
   * setoran lewat nominal — setorannya ditahan untuk /belum-cocok.
   */
  setoran?: {
    terpegangLuar: { tanggalDate: Date; kredit: number; bankId?: string | null; waktu?: string | null }[];
    /** Rentang tanggal yang kolamnya LENGKAP (perbaikan tinjauan S7): batas
     *  bawah = awal berkas (dinaikkan kalau mutasinya tidak nyambung dengan
     *  catatan terakhir), batas atas = akhir berkas. Syarat "kredit tepat
     *  satu" hanya bermakna kalau SELURUH jendela setoran ada di dalamnya —
     *  kredit yang baru dibukukan sesudah akhir berkas belum terlihat.
     *  Kosong = tidak diketahui → setoran TIDAK ditebak lewat nominal saja. */
    cakupan?: { dari: Date; sampai: Date } | null;
  };
};

/** Jendela tanggal BARIS untuk klaim SETOR KE PUSAT (perbaikan tinjauan S7):
 *  [tanggal slip, tanggal slip + maju]. Tidak pernah mundur: tanggal setoran
 *  di cek-mutasi adalah tanggal SLIP (gerbang Lapis 1 menahan slip yang
 *  tanggalnya tak terbaca / di luar [tgl−1, tgl]), dan kredit yang dibukukan
 *  SEBELUM uangnya disetor mustahil milik setoran itu — tanpa batas ini uang
 *  lama tak bertuan atau uang nasabah yang klaimnya belum lahir bisa
 *  "membuktikan" kas outlet −N yang tidak pernah disetor. Maju mengikuti
 *  aturan klaimnya (TFK- 1 hari: setoran sore / agen akhir pekan dibukukan
 *  esoknya). `days` = diffDays(tanggal klaim, tanggal baris). */
export function dalamJendelaSetoran(days: number, rules: Pick<MatchRules, "forward_window_days">): boolean {
  const maju = Math.max(0, Number(rules.forward_window_days ?? 0) || 0);
  return days === 0 || (days < 0 && Math.abs(days) <= maju);
}

// ── SETOR KE PUSAT (5 Oktober 2026) ─────────────────────────────────────
//
// Uang kas TUNAI outlet yang disetor ke rekening PT (teller / CRM / agen BSI
// / m-banking), nomor STP-…. Di mutasi BSI setoran teller berbunyi "SETR" /
// "Setoran" / "SETOR TUNAI", NAMA PENGIRIMNYA KOSONG, ref berekor "/52"; agen
// berbunyi "LKP100042CASH-… TRF Dari - <nama penyetor>". Nominalnya bulat dan
// besar (≥ Rp 5 jt) — persis jenis angka yang paling sering kembar
// (20.000.000, 25.000.000). Keputusan pemilik:
//   #14 cocok lewat NOMINAL saja HANYA bila kandidatnya TUNGGAL tanpa
//       pesaing; selain itu /belum-cocok;
//   #15 dilarang double claim: satu baris mutasi tidak boleh dipegang setoran
//       DAN transaksi lain; tabrakan → /belum-cocok, dibereskan manual.
// Maka untuk setoran:
//   PASS 1 REF       — boleh (ref FT menunjuk persis); TIDAK pernah mengusir
//                      dan TIDAK pernah diusir (pagar 8);
//   PASS 2 NAMA+JAM  — dilewati (jendela 14 hari terlalu longgar untuk slip
//                      yang tanggalnya wajib [tgl−1, tgl]); hari yang sama
//                      tetap tertangkap PASS 3;
//   PASS 3 NOMINAL+JAM — hanya bila di hari itu dalam ±5 menit ada TEPAT
//                      SATU kredit bernominal sama (terpegang atau tidak),
//                      tidak ada klaim lain yang bisa mengakuinya, pemanggil
//                      memuat baris terpegang di luar kolam, dan REF slip
//                      tidak menunjuk baris bernominal beda;
//   PASS 3b NAMA     — dilewati (nama baris teller kosong; nama agen = nama
//                      penyetor, bukan bukti tujuan);
//   PASS 4 NOMINAL   — hanya bila dalam jendela SETORAN [tgl slip, tgl slip
//                      + maju] (tidak mundur — dalamJendelaSetoran) ada TEPAT
//                      SATU kredit bernominal sama (dihitung SEMUA: bebas,
//                      terpegang di kolam, terpegang di luar kolam), bebas,
//                      tidak dibantah (REF_NOMINAL_BEDA, jam slip meleset >5
//                      menit di hari yang sama, jam+nama resi), jendelanya
//                      seluruhnya di dalam cakupan berkas, dan tidak ada klaim
//                      lain di jalan ini yang jendelanya juga mencakup baris
//                      itu. Selain itu all_taken + setoranTidakDitebak
//                      (DITAHAN → /belum-cocok; yang membawa REF_NOMINAL_BEDA
//                      dikirim sebagai alarm REF).
// Setoran TETAP dihitung di `rebutan` seperti klaim lain, supaya penjaga
// anti-tebak-lintas-hari klaim nasabah tidak melonggar karena kehadirannya.

/** true = input ini klaim SETOR KE PUSAT. Murni, tidak pernah melempar. */
export function adalahSetoran(input: Pick<UserInput, "setoran" | "noFaktur"> | null | undefined): boolean {
  if (!input) return false;
  if (input.setoran === true) return true;
  return /^STP-/i.test(String(input.noFaktur ?? ""));
}

export function runMatching(
  inputs: UserInput[],
  transactions: PdfTransaction[],
  outletColors: Map<string, string>,
  options?: RunMatchingOptions,
): { inputs: UserInput[]; summary: MatchSummary } {
  const getRules = options?.getRulesForInput ?? (() => DEFAULT_RULES);
  const forceCrossBank = options?.forceCrossBank ?? false;
  const mode = options?.mode ?? "all";

  const claimed = new Set<string>();
  const disepak: MatchSummary["disepak"] = [];
  // Klaim yang SUDAH memegang baris dari sesi lama hanya boleh bergerak kalau
  // pada jalan ini ia tersepak. Selain itu ia diam: tidak mencari baris lain
  // (itu jalan menuju satu klaim dua baris), tidak dihitung bersaing.
  const disepakIds = new Set<string>();
  const diamSaja = (input: UserInput) =>
    (!!(input as any).sudahMemegang || !!(input as any).tidakBolehMengusir) && !disepakIds.has(String(input.id));
  // Korban HANYA boleh disepak kalau ia ADA di daftar input jalan ini —
  // itulah satu-satunya kendaraan untuk mencocokkannya ulang dan melaporkan
  // nasibnya. Pemegang yang identitasnya diketahui dari database tapi tidak
  // ikut ditarik (di luar jendela 60 hari, atau di bawah lantai laporan)
  // TIDAK disepak: pengusirnya jatuh ke alarm REF_SUDAH_DIKLAIM seperti dulu.
  // Ditemukan pemeriksa: tanpa syarat ini, mulai 11 September 2026 pemegang
  // tertua bisa dilepas di DB tanpa pernah dilaporkan ke gadai.
  const inputById = new Map<string, UserInput>(inputs.map((i) => [String(i.id), i]));
  const txKey = (t: PdfTransaction) => `${t.bankId ?? "_"}-${t.page}-${t.no}`;

  // Mode leftover-only: tx yang sudah matched di sebelumnya HARUS di-skip
  if (mode === "leftover-only") {
    for (const input of inputs) {
      const m = input.match;
      if (m?.status === "matched") {
        const matchedTx = transactions.find(
          (t) =>
            t.no === m.txNo &&
            t.tanggalDate.getTime() === m.txDate.getTime() &&
            t.kredit === input.nominal &&
            (!m.txBankId || t.bankId === m.txBankId),
        );
        if (matchedTx) claimed.add(txKey(matchedTx));
      }
    }
  }

  // Input yang ikut diproses run ini (leftover-only: hanya no_candidate).
  const shouldProcess = (input: UserInput) =>
    mode !== "leftover-only" || input.match?.status === "no_candidate";

  // Hasil per-index; null = belum resolved (lanjut pass berikutnya).
  const resolved: (MatchResult | null)[] = inputs.map(() => null);
  // refIssue ditemukan di Pass 1 tapi input jatuh ke pass berikutnya -> tempel di hasil akhir.
  const pendingRefIssue: (RefIssue | undefined)[] = inputs.map(() => undefined);
  // Siapa yang mengambil baris PADA JALAN INI (txKey -> id input). `claimed`
  // hanya tahu "sudah diambil"; alarm REF_SUDAH_DIKLAIM perlu tahu OLEH SIAPA
  // untuk bisa menyebut kontraknya.
  const pengambilDiJalan = new Map<string, string>();
  // Id input yang SUDAH memegang baris pada jalan ini — ia tidak lagi
  // bersaing memperebutkan baris lain (dipakai penjaga pesaing setoran).
  const sudahAmbilDiJalan = new Set<string>();

  function buildMatched(input: UserInput, picked: PdfTransaction, matchedBy: MatchedBy): MatchResult {
    claimed.add(txKey(picked));
    pengambilDiJalan.set(txKey(picked), String(input.id));
    sudahAmbilDiJalan.add(String(input.id));
    const colorHex = outletColors.get(input.outletId) ?? "#FFEB3B";
    return {
      status: "matched",
      txNo: picked.no,
      txDate: picked.tanggalDate,
      colorHex,
      txBankId: picked.bankId,
      matchedBy,
    };
  }

  // ── Bahan penjaga SETOR KE PUSAT (lihat blok SETOR KE PUSAT di atas) ──
  // null = pemanggil tidak memuat baris terpegang di luar kolam → setoran
  // tidak pernah ditebak lewat nominal saja (PASS 4).
  const setoranLuar = options?.setoran?.terpegangLuar ?? null;
  /** Masih adakah KLAIM LAIN pada jalan ini yang bisa mengakui baris `tx`?
   *  Klaim lain = belum memegang baris apa pun (tidak terjawab PASS 1-3 dan
   *  belum mengambil baris di PASS 4), bernominal sama, dan baris itu masuk
   *  jendela aturannya sendiri. pakaiJam: klaim yang jamnya terbaca dan
   *  meleset >5 menit dari jam baris bukan pesaing (jam baris & jam klaim
   *  sama-sama harus terbaca untuk membebaskannya). Konservatif sengaja:
   *  ragu = pesaing = /belum-cocok. */
  const pesaingSetoran = (idx: number, tx: PdfTransaction, pakaiJam: boolean, hanyaSetoran = false): boolean => {
    const jt = jamToMinutes(tx.waktu);
    return inputs.some((j, jdx) => {
      if (jdx === idx || !shouldProcess(j) || diamSaja(j)) return false;
      if (hanyaSetoran && !adalahSetoran(j)) return false;
      if (resolved[jdx] || sudahAmbilDiJalan.has(String(j.id))) return false;
      const rj = getRules(j);
      const lewatiBank = forceCrossBank || !j.bankId;
      if (!lewatiBank && j.bankId && tx.bankId && j.bankId !== tx.bankId) return false;
      if (!nominalMatches(j.nominal, tx.kredit, rj)) return false;
      const days = diffDays(j.tanggal, tx.tanggalDate);
      // Pesaing SETORAN dinilai dengan jendela setoran sendiri (tidak mundur).
      const dalam = adalahSetoran(j)
        ? dalamJendelaSetoran(days, rj)
        : (days >= 0 && days <= rj.lookback_days) || (days < 0 && Math.abs(days) <= rj.forward_window_days);
      if (!dalam) return false;
      if (pakaiJam) {
        const jj = jamToMinutes(j.jamResi);
        if (jj !== null && jt !== null && Math.abs(jj - jt) > PASS3_JAM_TOLERANSI_MENIT) return false;
      }
      return true;
    });
  };

  // ── PASS 1: REF (global, sebelum semua yang lain) ──
  //
  // Dibandingkan dalam bentuk KANONIK, bukan apa adanya. Nomor referensi di
  // sisi klaim dibaca AI dari foto resi, sementara di sisi mutasi ia diambil
  // dari PDF bank — dan pasangan huruf/angka yang bentuknya kembar adalah
  // salah baca yang paling sering terjadi. SBR-1-0127 (5 Agustus 2026):
  //
  //   bank menulis : FT26212Z0R4C\Q53/213   ← angka NOL
  //   AI membaca   : FT26212ZOR4C           ← huruf O
  //
  // Beda satu karakter, dan pencocokan lewat jalur TERKUAT gagal total; ia
  // jatuh ke tebakan nominal, lalu ke vonis "tidak ada di rekening".
  //
  // Yang disamakan hanya pasangan yang memang kembar bentuknya (O/0, I/1, S/5,
  // B/8, Z/2) dan tanda baca dibuang — bank menulis ref yang sama dengan
  // pemisah yang tidak konsisten. Tabrakan palsu praktis mustahil: ref bank
  // 12 karakter atau lebih, dan nominalnya tetap wajib sama persis di bawah.
  const kanonRef = (s: unknown) =>
    String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      .replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5")
      .replace(/B/g, "8").replace(/Z/g, "2");

  inputs.forEach((input, idx) => {
    if (!shouldProcess(input) || diamSaja(input)) return;
    const refUp = kanonRef(input.refFt);
    if (!refUp) return;

    const hits = transactions.filter((tx) =>
      kanonRef(tx.noRef).startsWith(refUp),
    );
    if (hits.length === 0) return; // ref tak ketemu BUKAN alarm — lanjut pass 2/3

    const nominalHits = hits.filter((tx) => tx.kredit === input.nominal);
    if (nominalHits.length === 0) {
      // Ref ketemu tapi nominal BEDA — indikasi resi diedit / salah baca AI.
      // Jangan match; biarkan pass berikutnya jalan, tapi bawa penanda alarm.
      pendingRefIssue[idx] = "REF_NOMINAL_BEDA";
      return;
    }

    const available = nominalHits.filter(
      (tx) => !tx.claimedByOther && !claimed.has(txKey(tx)),
    );
    // ── BUKTI KUAT MENGUSIR BUKTI LEMAH (5 September 2026) ──
    //
    // Ref+nominal cocok, tapi barisnya sudah dipegang klaim lain. Kalau
    // pemegangnya cuma cocok lewat NOMINAL (tebakan), sementara klaim ini
    // membawa nomor referensi yang menunjuk PERSIS ke baris itu, yang benar
    // bukan memarkir klaim ber-ref — melainkan mengusir tebakannya.
    //
    // Kejadian nyata: SJB-2-0036 (LANGSA, tanpa ref/jam/nama) mengambil baris
    // WAHYUDI PRAKARSA Rp 70.000 hanya karena nominalnya sama, saat berkas
    // Agustus diproses. Tiga hari kemudian SBR-11-2096 datang dengan ref
    // FT262438R70Q yang menunjuk baris itu — dan diparkir, sementara tebakan
    // yang salah tetap "cocok".
    //
    // TIGA PAGAR, dari aturan pemilik ("yang manual dan yang kuat sesuai ref
    // apa pun ceritanya tidak bisa disepak"):
    //   1. Pemegang MANUAL tidak disentuh — manusia sudah memutuskan.
    //   2. Pemegang ber-REF atau NAMA+JAM tidak disentuh — buktinya setara
    //      atau lebih kuat; tabrakan begini adalah anomali untuk manusia.
    //      NAMA (nama persis tanpa jam, ±1 hari) boleh diusir: ref yang
    //      menunjuk barisnya lebih pasti daripada nama yang kebetulan sama.
    //      WAJIB seirama dengan daftar pemegang lemah di gadai
    //      (app/api/transfer-klaim/route.ts) — keduanya diubah 27 Sep 2026.
    //   3. Pemegang harus klaim gadai (punya id) supaya bisa dicocokkan ulang
    //      dan dilaporkan; input lokal tak punya jalur itu.
    // Ditambah: pemegang bukan diri sendiri, dan baris belum diambil pada
    // jalan ini. Pengusiran dicatat ke `summary.disepak` — pemanggil WAJIB
    // mempersistenkan pelepasannya sebelum menyimpan sesi.
    //   4. PENGUSIRNYA sendiri belum memegang baris apa pun. Klaim yang sudah
    //      terbukti di sesi lama lalu mengusir pemegang lain akan memegang DUA
    //      baris — dan indeks unik tidak menjaga arah itu. Kasus nyata:
    //      SBR-11-2096 sudah dipasangkan manual ke baris FIKRI AZIZI; tanpa
    //      pagar ini ia akan ikut merebut baris WAHYUDI yang ref-nya cocok.
    //
    // ── RESI BEKAS TIDAK BOLEH MENGUSIR (1 Oktober 2026) ──
    //
    // Aturan "ref mengalahkan tebakan" mengandaikan klaim ber-ref itu PEMILIK
    // barisnya. Resi bekas membalik andaian itu: resinya asli, ref-nya persis,
    // tapi uangnya sudah dipakai — dan yang terusir justru pemilik sah, lalu
    // dilaporkan "salah klaim, disepak". Disimulasikan ke data hidup pada uji
    // resi bekas: SJB-1-0250 memegang baris 18 Agu 20.48 ANUAR MUDDIN
    // Rp 300.000 (FT262309MB08) lewat NOMINAL, jam resinya 20:48; resi yang
    // sama difoto ulang untuk transaksi 30 Sep mengusirnya tanpa syarat.
    // Dua pagar tambahan; kalau salah satu menyala, pengusiran BATAL dan klaim
    // ber-ref jatuh ke alarm REF_SUDAH_DIKLAIM di bawah — manusia memutuskan:
    //   6. Baris yang ditunjuk ref-nya lebih dari BATAS_UANG_LAMA_HARI lebih
    //      tua daripada TRANSAKSI pengusir (uangLamaHari) — tanda resi bekas.
    //   7. Pemegang lama sendiri tampak pemilik sah: tanggal resinya SAMA
    //      dengan tanggal baris DAN jam resinya ±5 menit dari jam baris.
    //      Tebakan nominal yang dikuatkan jam & tanggal resinya sendiri bukan
    //      tebakan lagi.
    if (available.length === 0 && !(input as any).sudahMemegang && !(input as any).tidakBolehMengusir) {
      const LEMAH = new Set(["NOMINAL", "NOMINAL_JAM", "NAMA"]);
      const korban = nominalHits
        .filter((tx) => {
          if (!tx.claimedByOther || !tx.pemegang || tx.pemegang.manual) return false;
          const kid = tx.pemegang.gadaiKlaimId;
          if (!kid || kid === String(input.id)) return false;
          if (!LEMAH.has(String(tx.pemegang.matchedBy ?? "").toUpperCase())) return false;
          if (claimed.has(txKey(tx))) return false;
          // Pagar 5: korban harus ikut di jalan ini, dan bukan resi ketikan owner.
          const korbanInput = inputById.get(String(kid));
          if (!korbanInput) return false;
          if (String((korbanInput as any).sumber ?? "").toUpperCase() === "MANUAL") return false;
          // Pagar 6: pengusir tampak resi bekas.
          if (uangLamaHari(input.tanggalTransaksi, tx.tanggalDate) !== null) return false;
          // Pagar 7: pemegang lama tampak pemilik sah.
          if (pemegangCocokJam(korbanInput, tx)) return false;
          // Pagar 8 (5 Okt 2026, KEPUTUSAN OWNER #15): pengusiran tidak
          // pernah melintasi SETORAN KE PUSAT — baik setoran yang mengusir,
          // maupun setoran yang diusir. Satu baris yang diakui setoran DAN
          // transaksi lain adalah anomali untuk manusia (/belum-cocok), bukan
          // untuk dipindah diam-diam; pengusirnya jatuh ke alarm
          // REF_SUDAH_DIKLAIM di bawah.
          if (adalahSetoran(input) || tx.pemegang.setoran || adalahSetoran(korbanInput)) return false;
          return true;
        })
        .sort((a, b) =>
          Math.abs(diffDays(input.tanggal, a.tanggalDate)) -
          Math.abs(diffDays(input.tanggal, b.tanggalDate)));
      if (korban.length > 0) {
        const tx = korban[0];
        disepak.push({
          txKey: txKey(tx),
          parsedTxId: tx.parsedTxId ?? null,
          noRef: tx.noRef ?? null,
          tanggal: tx.tanggal,
          kredit: tx.kredit,
          pemegangInputId: tx.pemegang!.inputId,
          pemegangKlaimId: String(tx.pemegang!.gadaiKlaimId),
          pemegangMatchedBy: tx.pemegang!.matchedBy ?? null,
          olehKlaimId: String(input.id),
          olehNoFaktur: (input as any).noFaktur ?? null,
        });
        // Baris ini sekarang bebas untuk klaim ber-ref, dan pemegang lamanya
        // akan dicocokkan ulang oleh pass 2-4 pada jalan yang SAMA — barisnya
        // yang lama sudah masuk `claimed`, jadi ia tidak bisa merebutnya balik.
        disepakIds.add(String(tx.pemegang!.gadaiKlaimId));
        tx.claimedByOther = false;
        tx.pemegang = undefined;
        resolved[idx] = buildMatched(input, tx, "REF");
        return;
      }
    }
    if (available.length > 0) {
      // Ref unik — kalau (langka) >1, pilih tanggal terdekat ke input.
      available.sort(
        (a, b) =>
          Math.abs(diffDays(input.tanggal, a.tanggalDate)) -
          Math.abs(diffDays(input.tanggal, b.tanggalDate)),
      );
      resolved[idx] = buildMatched(input, available[0], "REF");
      return;
    }

    // Uangnya TERIDENTIFIKASI (ref+nominal cocok) tapi kreditnya sudah dipakai
    // input lain (sesi lama / manual / run ini). JANGAN jatuh ke tebakan nominal —
    // itu mereproduksi bug salah-pasang. Vonis: bentrok + penanda alarm.
    //
    // PEMEGANGNYA ikut dicatat (1 Oktober 2026). Alarm ini adalah bentuk
    // paling lazim resi bekas, dan dulu sampai ke pemilik sebagai "nomor resi
    // bermasalah" atau — sesudah gadai memvonisnya — "tidak ada di rekening".
    // Dua-duanya mengirim orang mencari uang yang tidak hilang. Yang perlu
    // dibaca: baris tanggal berapa, dipegang KONTRAK mana.
    const datesSet = new Set<string>();
    for (const c of nominalHits) datesSet.add(c.tanggal);
    const dipegang: PemegangRef[] = nominalHits
      .map((tx): PemegangRef => {
        const olehJalan = pengambilDiJalan.get(txKey(tx));
        const p = tx.claimedByOther ? tx.pemegang : undefined;
        const inputJalan = olehJalan ? inputById.get(olehJalan) : undefined;
        // Baris cek_inputs lama sering belum menyimpan nomor kontrak; kalau
        // pemegangnya ikut ditarik di jalan ini (daftar pemegang lemah dari
        // gadai), nomornya diambil dari situ.
        const inputPemegang = p?.gadaiKlaimId ? inputById.get(String(p.gadaiKlaimId)) : undefined;
        return {
          tanggal: toDateISO(tx.tanggalDate),
          kredit: tx.kredit,
          parsedTxId: tx.parsedTxId ?? null,
          inputId: p?.inputId ?? null,
          gadaiKlaimId: p?.gadaiKlaimId ?? olehJalan ?? null,
          noFaktur: p?.noFaktur ?? (inputPemegang as any)?.noFaktur ?? (inputJalan as any)?.noFaktur ?? null,
          caraPemegang: p ? (p.manual ? "MANUAL" : (p.matchedBy ?? null)) : null,
          diJalanIni: !p && !!olehJalan,
        };
      })
      .sort((a, b) =>
        Math.abs(diffDays(input.tanggal, new Date(`${a.tanggal}T12:00:00Z`))) -
        Math.abs(diffDays(input.tanggal, new Date(`${b.tanggal}T12:00:00Z`))));
    resolved[idx] = {
      status: "all_taken",
      conflictCount: nominalHits.length,
      conflictDates: Array.from(datesSet),
      refIssue: "REF_SUDAH_DIKLAIM",
      dipegang,
    };
  });

  // ── PASS 2: NAMA PENGIRIM + JAM (global) ──
  inputs.forEach((input, idx) => {
    if (!shouldProcess(input) || resolved[idx] || diamSaja(input)) return;
    // Setoran: jendela 14 hari terlalu longgar (lihat SETOR KE PUSAT di atas).
    if (adalahSetoran(input)) return;
    const jamInput = jamToMinutes(input.jamResi);
    const nama = String(input.namaPengirimResi ?? "").trim();
    if (jamInput === null || !nama) return;

    const skipBankFilter = forceCrossBank || !input.bankId;
    const candidates = transactions.filter((tx) => {
      if (tx.claimedByOther) return false;
      if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) {
        return false;
      }
      if (tx.kredit !== input.nominal) return false;
      const days = diffDays(input.tanggal, tx.tanggalDate);
      if (!((days >= 0 && days <= PASS2_LOOKBACK_DAYS) || (days < 0 && Math.abs(days) <= PASS2_FORWARD_DAYS))) {
        return false;
      }
      const jamTx = jamToMinutes(tx.waktu);
      if (jamTx === null || Math.abs(jamTx - jamInput) > PASS2_JAM_TOLERANSI_MENIT) {
        return false;
      }
      return namaCocok(nama, tx.namaPengirim);
    });

    const available = candidates.filter((tx) => !claimed.has(txKey(tx)));
    if (available.length === 0) return; // lanjut pass 3 (jangan vonis dari pass 2)

    available.sort((a, b) => {
      const ja = Math.abs((jamToMinutes(a.waktu) ?? 0) - jamInput);
      const jb = Math.abs((jamToMinutes(b.waktu) ?? 0) - jamInput);
      if (ja !== jb) return ja - jb;
      const da = Math.abs(diffDays(input.tanggal, a.tanggalDate));
      const db = Math.abs(diffDays(input.tanggal, b.tanggalDate));
      if (da !== db) return da - db;
      return a.no - b.no;
    });
    resolved[idx] = buildMatched(input, available[0], "NAMA_JAM");
  });


  // ── PASS 3: NOMINAL + JAM, HARI YANG SAMA (ditambahkan 3 September 2026) ──
  //
  // Permintaan pemilik, sesudah ditemukan bahwa jam yang SUDAH dibaca AI tidak
  // pernah terpakai: PASS 2 mensyaratkan nama DAN jam, jadi resi yang jamnya
  // terbaca tapi namanya tidak langsung terjun ke pencocokan nominal — dan
  // pencocokan nominal buta terhadap jam. Pemenangnya di sana ditentukan urutan
  // baris di PDF, yang untuk dua kredit bernominal sama di hari yang sama
  // praktis undian.
  //
  // Kejadian nyata 30 Agustus 2026: dua klaim GoPay Rp 150.000 di KR. GEUKUEH
  // dan dua baris DOMPET ANAK BANGSA Rp 150.000 pada hari yang sama. Keduanya
  // dipasangkan lewat urutan baris; hasilnya KEBETULAN benar. Uangnya memang
  // tidak akan hilang (hari & nominal sama), tapi KONTRAK-nya bisa tertukar,
  // dan tidak akan ada yang tahu.
  //
  // WAJIB HARI YANG SAMA, dan pembatasan ini disengaja. Tanpa nama yang
  // menguatkan, jam di hari yang BERBEDA bukan bukti melainkan kebetulan:
  // SBR-4-0419 (1 Sep, jam resi 18:02) tercocok ke setoran 30 Agustus jam
  // 17.57 — beda hanya 5 menit, dan tetap salah kontrak. Toleransi jam berapa
  // pun tidak akan menolak pasangan itu; yang salah di sana TANGGALNYA. Maka
  // tebakan lintas hari tetap urusan PASS 4 dengan pagarnya sendiri.
  //
  // Kalau jamnya tidak terbaca, atau tidak ada kandidat sejam pun, pass ini
  // DIAM dan membiarkan PASS 4 bekerja seperti biasa — permintaan pemilik:
  // "yang penting nominal sama, tetap ter-matched".
  inputs.forEach((input, idx) => {
    if (!shouldProcess(input) || resolved[idx] || diamSaja(input)) return;
    const jamInput = jamToMinutes(input.jamResi);
    if (jamInput === null) return;                 // jam tak terbaca -> PASS 4

    const rules = getRules(input);
    const skipBankFilter = forceCrossBank || !input.bankId;
    const candidates = transactions.filter((tx) => {
      if (tx.claimedByOther) return false;
      if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) {
        return false;
      }
      if (!nominalMatches(input.nominal, tx.kredit, rules)) return false;
      if (diffDays(input.tanggal, tx.tanggalDate) !== 0) return false;   // HARI SAMA
      const jamTx = jamToMinutes(tx.waktu);
      if (jamTx === null) return false;
      return Math.abs(jamTx - jamInput) <= PASS3_JAM_TOLERANSI_MENIT;
    });

    const available = candidates.filter((tx) => !claimed.has(txKey(tx)));
    if (available.length === 0) return;            // biar PASS 4 yang mencoba

    // Setoran: jam hanya bukti kalau calonnya TUNGGAL. Dihitung SEMUA kredit
    // bernominal sama di hari itu dalam ±5 menit — yang sudah dipegang juga
    // (di kolam maupun di luar kolam) — dan klaim lain yang bisa mengakui
    // baris itu. Ragu = diam; PASS 4 setoran yang memutuskan (dan pada
    // keadaan yang sama ia juga menolak menebak → /belum-cocok).
    if (adalahSetoran(input)) {
      // Perbaikan tinjauan S7: pemanggil yang tidak memuat baris terpegang di
      // luar kolam (layar /check lama, Riwayat Cek) tidak pernah menebak
      // setoran — sama seperti PASS 4. Dan REF slip yang sudah menunjuk baris
      // bernominal LAIN (REF_NOMINAL_BEDA: AI salah baca angka di slip kertas,
      // atau kasir menyetor kurang) adalah bantahan — jangan ambil kredit
      // bernominal sama milik orang lain; PASS 4 menahannya sebagai alarm.
      if (setoranLuar === null || pendingRefIssue[idx]) return;
      const sejam = (jt: number | null) => jt === null || Math.abs(jt - jamInput) <= PASS3_JAM_TOLERANSI_MENIT;
      const semuaSejam = transactions.filter((tx) => {
        if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) return false;
        if (!nominalMatches(input.nominal, tx.kredit, rules)) return false;
        if (diffDays(input.tanggal, tx.tanggalDate) !== 0) return false;
        const jt = jamToMinutes(tx.waktu);
        return jt !== null && sejam(jt);
      });
      const luarSejam = (setoranLuar ?? []).filter((t) => {
        if (!skipBankFilter && input.bankId && t.bankId && input.bankId !== t.bankId) return false;
        if (!nominalMatches(input.nominal, t.kredit, rules)) return false;
        if (diffDays(input.tanggal, t.tanggalDate) !== 0) return false;
        return sejam(jamToMinutes(t.waktu ?? null));
      });
      if (semuaSejam.length !== 1 || luarSejam.length > 0 || available.length !== 1) return;
      if (pesaingSetoran(idx, available[0], true)) return;
    }

    // Yang jamnya PALING DEKAT menang. Seri dipecah nomor baris, sama seperti
    // pass lain — tapi seri di sini berarti dua kredit berjarak menit yang
    // sama persis dari resi, yang praktis tidak terjadi.
    available.sort((a, b) => {
      const ja = Math.abs((jamToMinutes(a.waktu) ?? 0) - jamInput);
      const jb = Math.abs((jamToMinutes(b.waktu) ?? 0) - jamInput);
      if (ja !== jb) return ja - jb;
      return a.no - b.no;
    });
    resolved[idx] = buildMatched(input, available[0], "NOMINAL_JAM");
  });

  // ── PASS 3b: NAMA PERSIS TANPA JAM, ±1 HARI (27 September 2026) ──
  //
  // Untuk resi yang namanya terbaca tapi jamnya TIDAK (resi DANA). Berjalan
  // SEBELUM hitungan rebutan PASS 4, supaya klaim yang sudah terjawab lewat
  // nama berhenti dihitung sebagai pesaing saudaranya.
  //
  // Pagarnya — semua harus terpenuhi, kalau tidak pass ini DIAM dan PASS 4
  // bekerja seperti biasa (dengan pagarnya sendiri):
  //   * nama resi layak (namaResiKetat) dan jam resi memang tidak terbaca;
  //   * di jendela ±1 hari, dengan nominal sama, TEPAT SATU baris yang namanya
  //     sama persis — dihitung SEMUA baris yang terlihat, terpegang atau
  //     tidak. Dua baris bernama sama = pembayaran ganda atau baris hasil
  //     parse ganda (5 Agu); keduanya urusan manusia;
  //   * baris itu BEBAS;
  //   * tidak ada input lain di jalan ini dengan nama persis & nominal sama
  //     dalam ±2 hari (dua klaim untuk satu pengirim = kembar, bukan tebakan).
  const namaKetatPer = inputs.map((i) =>
    jamToMinutes(i.jamResi) === null ? namaResiKetat(i.namaPengirimResi) : null);
  const terpegangLuar = options?.nama?.terpegangLuar ?? null;
  if (terpegangLuar) inputs.forEach((input, idx) => {
    if (!shouldProcess(input) || resolved[idx] || diamSaja(input)) return;
    // Debet menuntut tanggal PERSIS (GADAI_DEBET_RULES); pass ini ±1 hari.
    if (String(input.id).startsWith("TFKD-")) return;
    // Setoran: nama baris teller kosong, nama agen = nama penyetor — bukan
    // bukti uang itu milik setoran ini (lihat SETOR KE PUSAT di atas).
    if (adalahSetoran(input)) return;
    const nama = namaKetatPer[idx];
    if (!nama) return;

    const saudara = inputs.some((j, jdx) =>
      jdx !== idx && j.nominal === input.nominal &&
      Math.abs(diffDays(input.tanggal, j.tanggal)) <= 2 &&
      namaSamaKetat(nama, namaResiKetat(j.namaPengirimResi)));
    if (saudara) return;

    const skipBankFilter = forceCrossBank || !input.bankId;
    const bernama = transactions.filter((tx) => {
      if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) return false;
      if (tx.kredit !== input.nominal) return false;
      if (Math.abs(diffDays(input.tanggal, tx.tanggalDate)) > 1) return false;
      return namaSamaKetat(nama, namaMutasiKetat(tx.namaPengirim));
    });
    const luar = terpegangLuar.filter((t) => {
      if (!skipBankFilter && input.bankId && t.bankId && input.bankId !== t.bankId) return false;
      if (t.kredit !== input.nominal) return false;
      if (Math.abs(diffDays(input.tanggal, t.tanggalDate)) > 1) return false;
      return namaSamaKetat(nama, namaMutasiKetat(t.namaPengirim));
    });
    if (bernama.length !== 1 || luar.length > 0) return;
    const tx = bernama[0];
    if (tx.claimedByOther || claimed.has(txKey(tx))) return;
    resolved[idx] = buildMatched(input, tx, "NAMA");
  });

  // ── PASS 4: NOMINAL + jendela rules (perilaku lama; jalur input manual) ──
  //
  // REBUTAN NOMINAL: kalau pada SATU tanggal ada LEBIH DARI SATU input dengan
  // nominal yang sama, mereka berebut kredit yang sama. Yang diproses belakangan
  // akan kehabisan kandidat sehari dan tersisa kandidat LINTAS HARI — lalu
  // mengambilnya diam-diam. Persis insiden 23 Juli 2026 KRUKUH LAMA: tiga input
  // @Rp 100.000, dua kredit hari itu, yang ketiga menyambar kredit 24 Juli.
  // Penjaga "kandidat lebih dari satu" TIDAK menutup ini, karena saat giliran
  // input ketiga kandidatnya memang tinggal SATU.
  // Aturan: untuk nominal yang sedang diperebutkan, tebakan LINTAS HARI dilarang.
  const rebutan = new Set<string>();
  {
    const hitung = new Map<string, number>();
    inputs.forEach((i, idx) => {
      if (!shouldProcess(i)) return;
      // Yang SUDAH terpasang lewat pass 1-3 tidak lagi bersaing memperebutkan
      // nominal — ia sudah memegang barisnya sendiri. Menghitungnya membuat
      // klaim yang tersisa tampak "direbutkan" padahal ia sendirian, lalu
      // ditolak menebak lintas hari ke satu-satunya baris yang bebas.
      // Terlihat pada pengusiran: SBR-11-2096 mengambil baris 31 Agu lewat
      // ref, SJB-2-0036 yang terusir tinggal sendirian mengejar Rp 70.000 —
      // tapi dihitung bersaing dengan pengusirnya sendiri.
      // HANYA yang benar-benar MEMEGANG baris (status matched) yang berhenti
      // bersaing. Yang all_taken tidak memegang apa-apa dan tetap pesaing —
      // mengecualikannya (versi pertama aturan ini) melonggarkan penjaga
      // anti-tebak-lintas-hari untuk saudaranya, ditemukan pemeriksa.
      if (resolved[idx]?.status === "matched") return;
      if (diamSaja(i)) return;
      const k = `${toDateISO(i.tanggal)}|${i.nominal}`;
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
    });
    for (const [k, n] of hitung) if (n > 1) rebutan.add(k);
  }

  // Baris BEBAS yang ditolak ditebak, per input — diperiksa ulang sesudah
  // semua input diproses (lihat di bawah).
  const barisTolak = new Map<number, PdfTransaction[]>();
  const urutTglKronologis = (d: string[]) => [...d].sort((a, b) => {
    const k = (x: string) => { const [dd, mm, yy] = x.split(/[-/]/).map(Number); return yy * 10000 + mm * 100 + dd; };
    return k(a) - k(b);
  });

  const resultInputs: UserInput[] = inputs.map((input, idx) => {
    if (!shouldProcess(input) || diamSaja(input)) return input;
    if (resolved[idx]) {
      const withIssue = pendingRefIssue[idx]
        ? { ...resolved[idx]!, refIssue: resolved[idx]!.refIssue ?? pendingRefIssue[idx] }
        : resolved[idx]!;
      return { ...input, match: withIssue };
    }

    const rules = getRules(input);
    // Bank filter:
    // - input.bankId kosong/null → "Semua bank" → skip filter
    // - forceCrossBank=true → skip filter (re-run leftover ke semua bank)
    // - else: filter strict
    const skipBankFilter = forceCrossBank || !input.bankId;

    // ── PASS 4 SETOR KE PUSAT: NOMINAL SAJA HANYA UNTUK CALON TUNGGAL ──
    //
    // KEPUTUSAN OWNER #14/#15 (lihat blok SETOR KE PUSAT di atas). Setoran
    // TIDAK memakai jalur nominal klaim nasabah di bawah: di sana kandidat
    // ganda tetap ditebak (urutan baris PDF) dan hanya ditandai `ambiguous`.
    // Untuk setoran, kredit kembar = tidak ada yang tahu mana miliknya.
    if (adalahSetoran(input)) {
      // Jendela SETORAN: [tgl slip, tgl slip + maju] — tidak mundur (lihat
      // dalamJendelaSetoran).
      const dalamJendela = (t: { tanggalDate: Date; kredit: number; bankId?: string | null }) => {
        if (!skipBankFilter && input.bankId && t.bankId && input.bankId !== t.bankId) return false;
        if (!nominalMatches(input.nominal, t.kredit, rules)) return false;
        return dalamJendelaSetoran(diffDays(input.tanggal, t.tanggalDate), rules);
      };
      // SEMUA kredit bernominal sama di jendela: bebas, terpegang di kolam,
      // diambil klaim lain pada jalan ini, dan terpegang di luar kolam.
      const semua = transactions.filter(dalamJendela);
      const luar = (setoranLuar ?? []).filter(dalamJendela);
      const bebas = semua.filter((tx) => !tx.claimedByOther && !claimed.has(txKey(tx)));
      if (semua.length === 0 && luar.length === 0) {
        return { ...input, match: { status: "no_candidate", refIssue: pendingRefIssue[idx] } as MatchResult };
      }
      const hariSendiriDipegang = semua.some((tx) =>
        diffDays(input.tanggal, tx.tanggalDate) === 0 && (tx.claimedByOther || claimed.has(txKey(tx))))
        || luar.some((t) => diffDays(input.tanggal, t.tanggalDate) === 0);
      const tunggal = setoranLuar !== null && semua.length === 1 && luar.length === 0 && bebas.length === 1;
      // ── Bukti yang MEMBANTAH tebakan (perbaikan tinjauan S7) ──
      // resiBertentangan() mensyaratkan nama di dua sisi, sedangkan baris
      // teller tidak punya nama — jadi untuk setoran ia praktis tidak pernah
      // menyala. Bantahan setoran dinilai sendiri, masing-masing cukup untuk
      // menahan (→ /belum-cocok, bukan menebak):
      //   (1) REF slip sudah menunjuk baris bernominal BEDA (REF_NOMINAL_BEDA)
      //       — bukti terkuatnya berkata uangnya di baris lain;
      //   (2) jam slip DAN jam baris terbaca di HARI YANG SAMA dan berselisih
      //       >5 menit — sama dengan pagar (e): jam meleset = bukan baris
      //       setoran ini (beda hari tidak dinilai jamnya: pembukuan esok hari);
      //   (3) jendela setoran tidak seluruhnya di dalam cakupan berkas — kredit
      //       kembarnya bisa saja belum terlihat (dibukukan sesudah akhir
      //       berkas / jatuh di lubang sebelum awal berkas).
      const jamSlip = jamToMinutes(input.jamResi);
      const jamDibantah = (tx: PdfTransaction) => {
        if (jamSlip === null || diffDays(input.tanggal, tx.tanggalDate) !== 0) return false;
        const jt = jamToMinutes(tx.waktu);
        return jt !== null && Math.abs(jt - jamSlip) > PASS3_JAM_TOLERANSI_MENIT;
      };
      const cakupan = options?.setoran?.cakupan ?? null;
      const tercakup = (() => {
        if (!cakupan) return false;
        const maju = Math.max(0, Number(rules.forward_window_days ?? 0) || 0);
        const ujung = new Date(input.tanggal.getTime());
        ujung.setUTCDate(ujung.getUTCDate() + maju);
        // diffDays dipakai supaya jam di dalam Date tidak ikut menentukan.
        return diffDays(input.tanggal, cakupan.dari) >= 0 && diffDays(ujung, cakupan.sampai) <= 0;
      })();
      if (tunggal && !pendingRefIssue[idx] && tercakup && !jamDibantah(bebas[0]) &&
          !resiBertentangan(input, bebas[0]) && !pesaingSetoran(idx, bebas[0], false)) {
        return { ...input, match: buildMatched(input, bebas[0], "NOMINAL") };
      }
      // DITAHAN → /belum-cocok. Yang disebut "masih bebas" hanya baris bebas;
      // kalau tidak ada satu pun, ini bentrok biasa (semua sudah dipegang).
      if (bebas.length > 0) barisTolak.set(idx, bebas);
      const sebut = bebas.length > 0 ? bebas : semua;
      return {
        ...input,
        match: {
          status: "all_taken",
          conflictCount: bebas.length > 0 ? bebas.length : semua.length + luar.length,
          conflictDates: urutTglKronologis([...new Set(sebut.map((t) => t.tanggal))]),
          hariSendiriDipegang,
          barisBebas: bebas.length > 0,
          setoranTidakDitebak: true,
          refIssue: pendingRefIssue[idx] ?? undefined,
        },
      };
    }

    const allCandidates = transactions.filter((tx) => {
      if (tx.claimedByOther) return false;
      if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) {
        return false;
      }
      if (!nominalMatches(input.nominal, tx.kredit, rules)) return false;
      const days = diffDays(input.tanggal, tx.tanggalDate);
      if (days >= 0 && days <= rules.lookback_days) return true;
      if (days < 0 && Math.abs(days) <= rules.forward_window_days) return true;
      return false;
    });

    const available = allCandidates.filter((tx) => !claimed.has(txKey(tx)));

    if (available.length > 0) {
      available.sort((a, b) => {
        const da = diffDays(input.tanggal, a.tanggalDate);
        const db = diffDays(input.tanggal, b.tanggalDate);
        const aAbs = Math.abs(da);
        const bAbs = Math.abs(db);
        if (aAbs !== bAbs) return aAbs - bAbs;
        if (da !== db) return db - da;
        return a.no - b.no;
      });

      // ── (c) UANG HARI SENDIRI SUDAH DIAMBIL ORANG LAIN ──
      //
      // Pagar (a) dan (b) hanya melihat KE DALAM SATU SESI. Lintas sesi ia
      // buta, dan di situ kebocorannya — kejadian nyata SJB-1-0186:
      //
      //   Kasir mencatat perpanjang yang SAMA dua kali (BB-...-3763 pukul
      //   16:05 dan BB-...-5153 pukul 19:54), masing-masing menuntut porsi
      //   bank Rp 460.000. Klaim pertama dicocokkan pada sesi 11 Agustus dan
      //   mengambil satu-satunya kredit Rp 460.000 tanggal 10 Agustus. Klaim
      //   kedua baru diproses pada sesi 13 Agustus — di sesi itu ia SENDIRIAN,
      //   jadi (b) tidak menyala; dan baris hari itu sudah `claimedByOther`
      //   sehingga kandidat tersisa cuma SATU, jadi (a) juga tidak menyala.
      //   Hasilnya ia menebak ke tanggal 11 Agustus dan MENGAMBIL pembayaran
      //   Rp 460.000 milik SBR-4-0182 yang masuk 25 jam kemudian.
      //
      // Polanya khas dan mudah dikenali: "uang bernominal ini di HARI SAYA
      // SENDIRI ada, tapi sudah dipegang orang lain". Itu bukan alasan untuk
      // mengambil uang hari berikutnya — itu justru pertanda saya kembar, atau
      // pemegang yang satu itu yang salah. Dua-duanya urusan manusia.
      // (Dihitung di sini, sebelum pagar (d), karena keduanya memakainya.)
      const adaHariSamaTapiSudahDiambil = transactions.some((tx) => {
        if (!nominalMatches(input.nominal, tx.kredit, rules)) return false;
        if (diffDays(input.tanggal, tx.tanggalDate) !== 0) return false;
        if (!skipBankFilter && input.bankId && tx.bankId && input.bankId !== tx.bankId) return false;
        return tx.claimedByOther || claimed.has(txKey(tx));
      });

      // ── (d) JAM DAN NAMA RESI MEMBANTAH BARISNYA (1 Oktober 2026) ──
      //
      // Lihat resiBertentangan di atas (SJB-2-0056: resi ANDINI SAHPUTRI
      // 12:03, baris MUHAMMAD SIDDIQ 12.15). Baris yang dibantah resinya
      // sendiri bukan calon — ia keluar dari tebakan; urutan sisanya TIDAK
      // diubah (hari sama tetap duluan).
      //
      // Kalau SEMUA baris bebas dibantah, mesin tidak menebak: all_taken +
      // barisBebas + bertentangan — DITAHAN, bukan UNMATCHED. Uangnya bisa
      // saja ada di baris lain/berkas lain; yang pasti hanya: bukan baris-baris
      // ini yang cocok dengan resinya.
      //
      // Kalau masih ada calon, pagar lintas hari di bawah tetap menghitung
      // `available` (SEMUA baris bebas bernominal sama, termasuk yang
      // dibantah): calon lintas hari yang tersisa sesudah baris hari sendiri
      // dibantah BUKAN "satu-satunya kandidat", jadi tetap ditolak ditebak.
      // Klaim yang tidak satu baris pun dibantah berjalan persis seperti dulu.
      const calon = available.filter((tx) => !resiBertentangan(input, tx));
      if (calon.length === 0) {
        barisTolak.set(idx, available);
        return {
          ...input,
          match: {
            status: "all_taken",
            conflictCount: available.length,
            conflictDates: urutTglKronologis([...new Set(available.map((t) => t.tanggal))]),
            hariSendiriDipegang: adaHariSamaTapiSudahDiambil,
            barisBebas: true,
            bertentangan: true,
            refIssue: pendingRefIssue[idx] ?? undefined,
          },
        };
      }

      // ── SALAH-COCOK DIAM: JANGAN MENEBAK LINTAS HARI ──────────────
      // Insiden nyata 23 Juli 2026 (KRUKUH LAMA): tiga input @Rp 100.000,
      // di mutasi hari itu cuma ada DUA kredit @Rp 100.000. Yang ketiga
      // dicocokkan ke kredit tanggal 24 Juli — beda hari, TANPA alarm apa pun,
      // dan statusnya hijau. Salah-cocok yang diam jauh lebih berbahaya
      // daripada alarm palsu: ia tidak menimbulkan peringatan sama sekali.
      //
      // Aturan: kalau kandidatnya LEBIH DARI SATU dan yang terbaik pun BUKAN
      // hari yang sama, sistem MENOLAK menebak dan melemparkannya ke manusia.
      // Tebakan lintas hari hanya diterima kalau ia satu-satunya kandidat.
      // "Yang terbaik" = calon pertama yang tidak dibantah resinya (pagar d);
      // "lebih dari satu" tetap menghitung semua baris bebas (`available`).
      const bedaHari = diffDays(input.tanggal, calon[0].tanggalDate) !== 0;
      const sedangDirebutkan = rebutan.has(`${toDateISO(input.tanggal)}|${input.nominal}`);

      if (bedaHari && (available.length > 1 || sedangDirebutkan || adaHariSamaTapiSudahDiambil)) {
        // Yang disebut "masih bebas" hanya CALON. Baris yang dibantah resinya
        // tidak ikut: /belum-cocok menjangkar ke tanggal terdekat di daftar ini
        // dan menandainya "baris bebas yang tidak ditebak (beda hari)" — baris
        // hari-sama yang dibantah tidak boleh mendapat tanda itu.
        const datesSet = new Set<string>();
        for (const c of calon) datesSet.add(c.tanggal);
        // SEMUA baris bebas dicatat (bukan hanya calon) — pemeriksaan ulang di
        // akhir jalan memilah lagi mana yang masih calon.
        barisTolak.set(idx, available);
        return {
          ...input,
          match: {
            status: "all_taken",
            conflictCount: calon.length,
            conflictDates: urutTglKronologis(Array.from(datesSet)),
            hariSendiriDipegang: adaHariSamaTapiSudahDiambil,
            // Baris-baris di atas BEBAS — mesin hanya menolak menebaknya.
            // Tanpa penanda ini ia terbaca "sudah ke-claim input lain" di
            // semua layar, dan pemilik mencari pemegang yang tidak ada
            // (SJB-3-0211, 27 Sep 2026).
            barisBebas: true,
            refIssue: pendingRefIssue[idx] ?? undefined,
          },
        };
      }

      // ── (e) SETORAN KE PUSAT YANG BELUM TERJAWAB MENGAKUI BARIS YANG SAMA ──
      //
      // 5 Oktober 2026, KEPUTUSAN OWNER #15: satu baris mutasi tidak boleh
      // dipegang setoran DAN transaksi lain, dan tabrakannya urusan manusia.
      // Setoran sendiri menolak menebak kalau ada pesaing — tanpa pagar ini
      // klaim nasabah yang bernominal sama justru mengambil barisnya lewat
      // tebakan nominal, dan setoran yang mungkin pemilik sahnya tertinggal
      // "berebut". Hanya menyala kalau ada klaim SETORAN di jalan ini yang
      // belum memegang baris apa pun dan jendelanya mencakup baris itu;
      // tanpa setoran perilakunya persis seperti dulu.
      if (pesaingSetoran(idx, calon[0], true, true)) {
        barisTolak.set(idx, available);
        return {
          ...input,
          match: {
            status: "all_taken",
            conflictCount: calon.length,
            conflictDates: urutTglKronologis([...new Set(calon.map((t) => t.tanggal))]),
            hariSendiriDipegang: adaHariSamaTapiSudahDiambil,
            barisBebas: true,
            rebutanSetoran: true,
            refIssue: pendingRefIssue[idx] ?? undefined,
          },
        };
      }

      const match = buildMatched(input, calon[0], "NOMINAL");
      if (pendingRefIssue[idx]) match.refIssue = pendingRefIssue[idx];
      // Fase D: >1 kandidat tersedia = tebakan ambigu — tandai supaya kelihatan
      // di panel & laporan (kandidat lain bisa saja milik nasabah lain).
      // Baris yang dibantah resinya bukan pesaing — ia tidak dihitung.
      if (calon.length > 1 && match.status === "matched") {
        match.ambiguous = calon.length;
      }
      return { ...input, match };
    }

    if (allCandidates.length > 0) {
      const datesSet = new Set<string>();
      for (const c of allCandidates) datesSet.add(c.tanggal);
      const conflictDates = Array.from(datesSet).sort((a, b) => {
        const [da, ma, ya] = a.split("-").map(Number);
        const [db, mb, yb] = b.split("-").map(Number);
        return (ya * 10000 + ma * 100 + da) - (yb * 10000 + mb * 100 + db);
      });
      const match: MatchResult = {
        status: "all_taken",
        conflictCount: allCandidates.length,
        conflictDates,
        refIssue: pendingRefIssue[idx],
      };
      return { ...input, match };
    }

    const match: MatchResult = { status: "no_candidate", refIssue: pendingRefIssue[idx] };
    return { ...input, match };
  });

  // ── "BEBAS" HARUS MASIH BENAR DI AKHIR JALAN ──
  //
  // PASS 4 berjalan berurutan. Baris yang bebas saat input A menolak
  // menebaknya bisa diambil input B yang diproses BELAKANGAN (tanggal lain,
  // sendirian, boleh menebak). Tanpa pemeriksaan ulang, A tetap berbunyi
  // "baris masih BEBAS" untuk baris yang sudah dipegang B (temuan peninjau
  // 27 Sep 2026). Yang tersisa bebas saja yang disebut; kalau habis, ia
  // kembali menjadi bentrok biasa.
  //
  // Pagar (d) ikut dipilah ulang (1 Okt 2026): `rows` memuat SEMUA baris bebas
  // saat penolakan, termasuk yang dibantah resinya. Yang disebut "bebas" hanya
  // CALON yang tersisa; kalau calonnya habis diambil tapi baris yang dibantah
  // masih bebas, penolakannya menjadi BERTENTANGAN — bukan "berebut".
  for (const [idx, rows] of barisTolak) {
    const m = resultInputs[idx]?.match as any;
    if (!m || m.status !== "all_taken" || !m.barisBebas) continue;
    const sisa = rows.filter((t) => !claimed.has(txKey(t)));
    // Setoran: tidak ada semantik "dibantah resi" / "beda hari" — cukup
    // sebut ulang baris yang masih bebas; kalau habis, bentrok biasa.
    if (m.setoranTidakDitebak) {
      if (sisa.length === 0) { m.barisBebas = false; continue; }
      m.conflictCount = sisa.length;
      m.conflictDates = urutTglKronologis([...new Set(sisa.map((t) => t.tanggal))]);
      continue;
    }
    if (sisa.length === 0) {
      m.barisBebas = false;
      // "Dibantah resinya" hanya bermakna selama barisnya bebas. Kalau semua
      // sudah diambil klaim lain, ini bentrok biasa (BEREBUT) — jangan
      // tersimpan sebagai BERTENTANGAN untuk baris yang sudah berpemilik.
      if (m.bertentangan) delete m.bertentangan;
      continue;
    }
    const inputIni = resultInputs[idx];
    const calonSisa = sisa.filter((t) => !resiBertentangan(inputIni, t));
    const disebut = calonSisa.length > 0 ? calonSisa : sisa;
    if (calonSisa.length > 0) delete m.bertentangan;
    else m.bertentangan = true;
    m.conflictCount = disebut.length;
    m.conflictDates = urutTglKronologis([...new Set(disebut.map((t) => t.tanggal))]);
  }

  const matched = resultInputs.filter((i) => i.match?.status === "matched");
  const noCandidate = resultInputs.filter((i) => i.match?.status === "no_candidate");
  const allTaken = resultInputs.filter((i) => i.match?.status === "all_taken");
  const unclaimed = transactions.filter(
    (tx) => !tx.claimedByOther && !claimed.has(txKey(tx)),
  );

  const summary: MatchSummary = {
    disepak,
    totalInput: resultInputs.length,
    matched: matched.length,
    noCandidate,
    allTaken,
    unclaimed,
  };

  return { inputs: resultInputs, summary };
}
