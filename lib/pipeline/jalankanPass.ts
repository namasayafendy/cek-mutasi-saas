// ============================================================
// KANAL MASUK MUTASI — Pelari satu pass (Fase 1)
// File: lib/pipeline/jalankanPass.ts
//
// Menjalankan SATU arah (KREDIT atau DEBET) dari awal sampai akhir, tanpa
// satu pun tombol dan tanpa React.
//
// KENAPA TIDAK MENIRU LAYAR /check: di sana pencocokan bersifat REAKTIF
// (dua useMemo di check-client.tsx). Tidak ada fungsi "jalankan matching"
// yang bisa dipanggil. Kalau auto-runner meniru pola itu — setInputs lalu
// membaca hasilnya — ia akan membaca nilai LAMA/KOSONG pada tick yang sama
// dan mengirim `matched:false` MASSAL ke Aceh Gadai. Karena itu di sini
// runMatching dipanggil langsung sebagai fungsi murni, berurutan, di-await.
//
// ── TIGA PENJAGA YANG SEBELUMNYA TIDAK ADA SAMA SEKALI ──
// Semuanya lahir dari satu kenyataan: /api/transfer-klaim/result di aplikasi
// gadai BUKAN pembaca pasif. Ia memvonis UNMATCHED dan MEMBUKA ULANG
// penutupan tf_masuk yang sudah dibereskan owner — lengkap dengan menyebut
// nama penutupnya ke Telegram. Tidak ada tombol undo. Selama ini satu-satunya
// penjaganya adalah MATA MANUSIA yang melihat layar sebelum menekan "Kirim".
// Otomatisasi menghapus mata itu, jadi penjaganya harus ditulis:
//
//   P1. Mutasi terbukti tidak utuh (complete === false, chainBreaks > 0, atau
//       ada baris yang gagal masuk DB) → JANGAN kirim sama sekali.
//   P2. periodEnd null → JANGAN kirim. Di sisi gadai, period_end kosong
//       membuat SEMUA klaim tak-cocok divonis terminal seketika
//       (result/route.ts:119) — jalur RECHECK tidak pernah terpakai.
//   P3. Klaim yang tanggalnya DI LUAR periode mutasi ini tidak boleh divonis
//       "tidak ketemu". Ini lubang yang paling berbahaya sekaligus paling
//       tidak kelihatan: pullGadaiClaims menarik 60 HARI klaim, sedangkan
//       satu kiriman Telegram biasanya hanya memuat 2-4 hari. Tanpa saringan
//       ini, satu berkas 3 hari akan memvonis klaim 57 hari lainnya UNMATCHED
//       secara palsu. Yang di luar periode cukup DIDIAMKAN — ia tetap PENDING
//       dan ikut tertarik lagi pada kiriman berikutnya.
//
// Catatan: `complete === null` BUKAN "tidak lengkap". Hanya parser BSI BSINet
// yang mengisi total tercetak; untuk bank lain nilainya memang null. Menyamakan
// null dengan false akan memblokir bank non-BSI selamanya; menyamakannya
// dengan "aman" adalah berbohong. Jadi: lewat, tapi DIKATAKAN apa adanya.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { runMatching, DEFAULT_RULES, type MatchRules } from "@/lib/matching";
import { loadCarryoverPdfTxs } from "@/lib/sessions/carryover";
import { loadRefPoolTxs } from "@/lib/sessions/ref-pool";
import { toDateISO, parseDateISO } from "@/lib/format";
import { pullGadaiClaims, pushGadaiResults } from "@/app/(app)/check/actions-gadai";
import type { BankUpload } from "@/lib/pipeline/prosesSatuBank";

/**
 * Catat satu klaim ke rekap PER TANGGAL.
 *
 * Rekap ini adalah alat sanding-menyanding antara dua lapisan. Pemilik
 * memeriksa Lapis 1 setiap hari; kalau jumlah resi tanggal X di Lapis 2 tidak
 * sama dengan jumlah yang dinyatakan cocok pada laporan Lapis 1 tanggal X,
 * berarti ada resi yang lolos di antara keduanya — dan tanpa rekap ini,
 * kebocoran semacam itu tidak punya tempat untuk terlihat.
 */
function catatTanggal(hasil: any, klaim: any, arah: string) {
  const tgl = toDateISO(klaim.tanggal);
  if (!tgl) return;
  const nominal = Number(klaim.nominal ?? 0);
  // Arah dicatat TERPISAH. Menggabungkan masuk dan keluar jadi satu angka
  // membuat rekap ini mustahil disandingkan dengan Lapis 1 — di sana keduanya
  // memang dilaporkan terpisah, dan menjumlahkannya di sini berarti pemiliknya
  // harus membongkar sendiri angka yang kita gabungkan tanpa alasan.
  const masuk = arah !== 'debet';
  let ada = hasil.perTanggal.find((x: any) => x.tgl === tgl);
  if (!ada) {
    ada = { tgl, jml: 0, rp: 0, masukJml: 0, masukRp: 0, keluarJml: 0, keluarRp: 0 };
    hasil.perTanggal.push(ada);
  }
  ada.jml += 1; ada.rp += nominal;
  if (masuk) { ada.masukJml += 1; ada.masukRp += nominal; }
  else { ada.keluarJml += 1; ada.keluarRp += nominal; }
}
import type {
  Jenis,
  MatchRulePreset,
  MatchSummary,
  Outlet,
  PdfTransaction,
  UserInput,
} from "@/lib/types";

/** Salinan aturan dari check-client.tsx:26-58. DISALIN SADAR, bukan tak sengaja.
 *  Utang yang harus diakui: sudah ada salinan kedua di cek-history yang
 *  MENYIMPANG (di sana klaim TFK- tidak dapat jendela maju 1 hari). Versi yang
 *  benar adalah versi check-client, dan itulah yang disalin ke sini. */
const GADAI_DEBET_RULES: MatchRules = {
  lookback_days: 0,
  forward_window_days: 0,
  match_mode: "exact",
  tolerance_rp: 0,
  tolerance_pct: 0,
};

/** Geser tanggal YYYY-MM-DD sejauh N hari. Selalu lewat UTC — seluruh tanggal
 *  di sistem ini adalah UTC-noon, dan memakai getter lokal akan menggeser hari
 *  lalu langsung merusak aturan debet yang menuntut tanggal PERSIS. */
function geserHari(iso: string, hari: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function ruleToMatchRules(rule: MatchRulePreset | undefined): MatchRules {
  if (!rule) return DEFAULT_RULES;
  return {
    lookback_days: rule.lookback_days,
    forward_window_days: rule.forward_window_days,
    match_mode: rule.match_mode,
    tolerance_rp: rule.tolerance_rp,
    tolerance_pct: Number(rule.tolerance_pct),
  };
}

function gadaiAwareRules(input: UserInput, rulesById: Map<string, MatchRulePreset>): MatchRules {
  if (String(input.id).startsWith("TFKD-")) return GADAI_DEBET_RULES;
  const base = ruleToMatchRules(rulesById.get(input.matchRuleId));
  // Transfer malam sering baru dibukukan bank pada tanggal kalender berikutnya.
  if (String(input.id).startsWith("TFK-")) {
    return { ...base, forward_window_days: Math.max(1, base.forward_window_days) };
  }
  return base;
}

export interface AlasanBatal {
  kode:
    | "MUTASI_TIDAK_UTUH"
    | "RANTAI_PUTUS"
    | "GAGAL_SIMPAN_BARIS"
    | "GAGAL_SIMPAN_SESI"
    | "PERIODE_KOSONG"
    | "TIDAK_ADA_KLAIM"
    | "TARIK_GAGAL"
    | "KIRIM_GAGAL"
    | "GAGAL_SEPAK";
  pesan: string;
}

export interface HasilPass {
  jenis: Jenis;
  /** Periode yang benar-benar tercakup berkas ini (YYYY-MM-DD). */
  periodStart: string | null;
  periodEnd: string | null;

  klaimDitarik: number;
  /** Klaim yang dibuang saat konversi karena tanggal tak sah / nominal nol.
   *  Dibuang diam-diam oleh layar biasa (input-panel.tsx:51) — di sini dihitung
   *  supaya tidak ada klaim yang lenyap tanpa disebut. */
  klaimDibuang: number;
  outletTakDikenal: string[];

  /** Rekap resi yang diuji, PER TANGGAL.
   *
   *  Ini alat sanding-menyanding antar lapisan, bukan hiasan. Pemilik membaca
   *  Lapis 1 tiap hari; kalau jumlah resi tanggal X di sini tidak sama dengan
   *  yang dinyatakan cocok di Lapis 1 tanggal X, ada resi yang lolos di antara
   *  keduanya — dan tanpa rekap ini, kebocoran itu tidak punya tempat terlihat. */
  /** Rekap per tanggal, MASUK dan KELUAR dipisah — angka inilah yang
   *  disandingkan dengan baris "total resi" di laporan Lapis 1. */
  perTanggal: {
    tgl: string; jml: number; rp: number;
    masukJml: number; masukRp: number; keluarJml: number; keluarRp: number;
  }[];

  /** Resi yang divonis tidak ada di rekening, LENGKAP dengan kontrak & outlet.
   *  Cacah saja tidak bisa ditindaklanjuti — pemilik harus tahu membuka apa. */
  tidakKetemu: { no_faktur: string; outlet: string; tgl: string; nominal: number; sebab: string }[];

  /** Baris mutasi yang tidak diklaim transaksi mana pun — KEDUA arah.
   *  Arah debet = uang KELUAR yang tidak diminta siapa pun; pertanyaan paling
   *  mahal yang paling lama tidak pernah ditanyakan sistem ini. */
  unclaimedRows: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];

  /** Cacah UTUH baris tak terklaim yang BELUM PERNAH dilaporkan. Bisa lebih
   *  besar dari unclaimedRows.length — daftarnya dipotong 25, cacahnya tidak.
   *  Beda dari unclaimedTotal, yang berisi RUPIAH baris tak terklaim periode ini. */
  unclaimedBelumLapor: number;

  /** Tanggal terakhir yang BENAR-BENAR diperiksa untuk "tanpa pemilik".
   *  null = seluruh periode berkas diperiksa. Terisi = ada ekor tanggal yang
   *  SENGAJA dilewati karena klaimnya belum mungkin lahir (cron malam gadai
   *  belum menyapunya). Wajib disebut di laporan: ekor yang tidak diuji dan
   *  ekor yang bersih terdengar sama persis kalau batasnya didiamkan. */
  unclaimedBatas: string | null;

  /** Apakah pemeriksaan "tanpa pemilik" benar-benar DIJALANKAN.
   *  false + nol baris BUKAN "bersih" — itu "belum diperiksa", dan (0) adalah
   *  bunyi paling berbahaya di laporan ini karena terbaca seperti kabar baik. */
  unclaimedDiperiksa: boolean;

  /** Klaim yang benar-benar dinilai dan dilaporkan ke gadai. */
  klaimDinilai: number;
  cocok: number;
  /** Dihitung SESUDAH semua saringan — hanya klaim yang benar-benar divonis
   *  "tidak ketemu". Kalau dihitung sebelum saringan, angkanya menakut-nakuti
   *  padahal sebagian besar cuma belum tercakup berkas ini. */
  belumKetemu: number;
  /** Klaim tak-cocok yang SENGAJA tidak divonis karena di luar periode (P3). */
  ditahanDiLuarPeriode: number;
  /** Klaim yang kandidatnya ADA tapi sudah dipakai transaksi lain (all_taken).
   *  Ini KONFLIK yang butuh keputusan manusia, bukan "uangnya tidak ada" —
   *  memvonisnya UNMATCHED berarti mengubah "saya menolak menebak" menjadi
   *  "uang tidak ditemukan", dan itu tuduhan terhadap kasir. */
  ditahanKonflik: number;
  /** IDENTITAS klaim yang ditahan (berebut / di luar periode). Cacahnya sudah
   *  lama ada; tanpa daftarnya laporan hanya bisa bilang "1 resi berebut"
   *  tanpa menyebut kontrak mana — dan cacah yang tak bisa ditindaklanjuti
   *  sama saja dengan tidak dilaporkan. Ditambahkan 5 September 2026 atas
   *  permintaan pemilik: yang belum cocok disebut "no kontrak, rupiah, alasan". */
  ditahanDaftar: { id: string; no_faktur: string; outlet: string; tgl: string; nominal: number;
                   sebab: "BEREBUT" | "LUAR_PERIODE" | "DISEPAK_TAK_KETEMU" }[];
  /** Pengusiran yang terjadi pada jalan ini (bukti kuat mengusir bukti lemah),
   *  sudah DIPERSISTENKAN. Dibawa ke laporan sebagai jejak: pemilik berhak
   *  tahu baris bank mana yang pindah pemilik tanpa ia menekan apa pun. */
  disepak: {
    olehKlaimId: string; olehNoFaktur: string | null;
    pemegangKlaimId: string; pemegangMatchedBy: string | null;
    noRef: string | null; tanggal: string; kredit: number;
    /** Nasib pemegang lama pada jalan ini: cocok ke baris lain, atau tidak. */
    nasib: "COCOK_ULANG" | "TAK_KETEMU";
  }[];
  /** Klaim yang sudah terbukti cocok di sesi sebelumnya (vonisnya gagal
   *  terkirim waktu itu), dilaporkan ulang tanpa dicocokkan lagi. */
  sudahTerbuktiSebelumnya: number;

  /** ── HASIL PENANGANAN MANUAL, DIHITUNG TERPISAH ──
   *
   *  Resi yang diketik OWNER sendiri di Lapis 1 (sumber MANUAL) masuk ke sini
   *  seperti resi bacaan AI, tapi asal-usulnya berbeda dan pengawasannya harus
   *  berbeda pula: yang satu dibaca mesin dari foto, yang satu diketik manusia
   *  dari ingatan atau catatan. Menyatukan cacahnya membuat penanganan tangan
   *  tak bisa dibedakan dari alur biasa — padahal justru barisan itu yang
   *  paling perlu dilihat apakah benar mendarat di rekening.
   *  Keputusan pemilik 29 Juli 2026. */
  manualDinilai: number;
  manualCocok: number;

  /** Klaim yang DITAHAN gerbang Lapis 1 dan tidak pernah sampai ke sini.
   *  null = sisi gadai belum mengirimkannya (versi lama) — "tidak diketahui",
   *  BUKAN nol. */
  tertahanGerbang: { jml: number; rp: number;
                     perSebab: { sebab: string; teks: string; n: number; rp: number }[];
                     gerbangError: string | null } | null;

  /** null kalau pengiriman memang tidak dilakukan (lihat `batal`). */
  terkirim: { updated: number; unmatched: number; recheck: number; alarm: number; alertSent: boolean } | null;
  batal: AlasanBatal | null;

  /** Bahan laporan, bukan vonis. */
  unclaimedCount: number;
  unclaimedTotal: number;
}

export interface OpsiPass {
  supabase: SupabaseClient<any, any, any>;
  accountId: string;
  userId: string;
  jenis: Jenis;
  upload: BankUpload;
  outlets: Outlet[];
  /** match_rules yang SUDAH difilter untuk jenis ini (jenis = X atau 'both'). */
  rules: MatchRulePreset[];
  onLangkah?: (teks: string) => void;
  /** Dipanggil sesaat SEBELUM pengiriman ke gadai, untuk kunci sekali-kirim
   *  di DB (compare-and-set). Kembalikan false = sudah pernah terkirim, batal.
   *  Ini bukan hiasan: React StrictMode menjalankan efek dua kali di dev, dan
   *  tautan yang sama bisa dibuka di dua HP. */
  kunciKirim?: () => Promise<boolean>;
  /** Dipanggil kalau pengiriman GAGAL sesudah kunci diambil, supaya kuncinya
   *  dilepas lagi — kunci yang tidak pernah dilepas = job terkunci selamanya. */
  lepasKunci?: () => Promise<void>;
}

export async function jalankanPass(opsi: OpsiPass): Promise<HasilPass> {
  const { supabase, accountId, userId, jenis, upload, outlets, rules, onLangkah } = opsi;
  const arah = jenis === "debet" ? "debet" : "kredit";

  const txsBerkas =
    jenis === "kredit" ? upload.parsedKredit.transactions : upload.parsedDebet.transactions;

  // ── Periode nyata berkas ini (dasar seluruh penjagaan) ──
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const tx of txsBerkas) {
    const iso = toDateISO(tx.tanggalDate);
    if (!periodEnd || iso > periodEnd) periodEnd = iso;
    if (!periodStart || iso < periodStart) periodStart = iso;
  }

  const hasil: HasilPass = {
    jenis, periodStart, periodEnd,
    klaimDitarik: 0, klaimDibuang: 0, outletTakDikenal: [],
    perTanggal: [], tidakKetemu: [], unclaimedRows: [], unclaimedBelumLapor: 0,
    unclaimedBatas: null, unclaimedDiperiksa: false,
    klaimDinilai: 0, cocok: 0, belumKetemu: 0,
    ditahanDiLuarPeriode: 0, ditahanKonflik: 0, sudahTerbuktiSebelumnya: 0,
    ditahanDaftar: [],
    disepak: [],
    manualDinilai: 0, manualCocok: 0, tertahanGerbang: null,
    terkirim: null, batal: null,
    unclaimedCount: 0, unclaimedTotal: 0,
  };
  const tglTampil = (iso: string) => String(iso ?? "").slice(0, 10).split("-").reverse().join("/");
  const rpTampil = (n: number) => "Rp " + Math.round(Number(n || 0)).toLocaleString("id-ID");

  /**
   * BARIS MUTASI TANPA PEMILIK — dibaca, BELUM distempel.
   *
   * Membaca dan menstempel SENGAJA dipisah. Stempel berarti "sudah dikatakan
   * kepada pemiliknya", dan itu baru benar sesudah vonisnya benar-benar
   * terkirim — bukan pada saat daftarnya disusun. Versi lama menyatukan
   * keduanya, dan akibatnya baris bisa berstempel "sudah dilaporkan" pada pass
   * yang batal di tengah jalan: "sekali saja" berubah jadi NOL kali.
   *
   * @param idTerpakai id parsed_transactions yang dipakai run INI. Ini JARING
   *   KEDUA, bukan penyaring utama. Penyaring utamanya adalah DB sendiri
   *   (claimed_by_input_id sudah tertulis sebelum fungsi ini dipanggil). Jaring
   *   ini menutup satu jalur yang penyaring utama tidak bisa lihat: di
   *   lib/sessions/save.ts insert cek_inputs yang gagal hanya di-console.error
   *   TANPA melempar, jadi saveSession bisa "berhasil" sambil tidak mengklaim
   *   apa pun — dan tanpa jaring ini seluruh baris yang cocok akan dituduh
   *   menganggur.
   * @returns id baris yang masuk daftar; itulah yang boleh distempel nanti.
   */
  const bacaNganggur = async (idTerpakai: Set<string>): Promise<string[]> => {
    if (!periodStart || !periodEnd) return [];
    try {
      // ── JANGAN TANYAKAN YANG JAWABANNYA BELUM MUNGKIN ADA ──
      //
      // Klaim gadai lahir dari cron malam: sisi KELUAR 01:25 WIB, sisi MASUK
      // 02:30-06:30 WIB, dan keduanya menyapu transaksi HARI SEBELUMNYA. Jadi
      // baris mutasi bertanggal HARI INI mustahil punya pemilik — menyebutnya
      // "uang tanpa pemilik" adalah kesalahan yang SAMA seperti membaca sebelum
      // klaimnya tertulis, hanya pada skala hari bukan milidetik. Pada 30 Juli
      // 2026, 5 dari 15 baris yang benar-benar belum terklaim persis kelas ini.
      //
      // Sesudah 07:00 WIB seluruh cron malam untuk KEMARIN pasti sudah selesai;
      // sebelum itu belum, jadi batasnya mundur satu hari lagi.
      const wibSkrg = new Date(Date.now() + 7 * 3_600_000);
      const batasKlaim = geserHari(wibSkrg.toISOString().slice(0, 10),
                                   wibSkrg.getUTCHours() >= 7 ? -1 : -2);
      const batasAkhir = batasKlaim < periodEnd ? batasKlaim : periodEnd;
      hasil.unclaimedBatas = batasAkhir < periodEnd ? batasAkhir : null;
      hasil.unclaimedDiperiksa = true;
      if (batasAkhir < periodStart) return [];

      const kolom = jenis === "debet" ? "nominal_debet" : "nominal_kredit";
      const { data: barisBaru, count } = await supabase
        .from("parsed_transactions")
        .select(`id, tanggal, jam, ${kolom}, nama_pengirim, nama_penerima, deskripsi`, { count: "exact" })
        .eq("account_id", accountId)
        .gte("tanggal", periodStart as string)
        .lte("tanggal", batasAkhir)
        .is("claimed_by_input_id", null)
        .is("unclaimed_reported_at", null)
        // Baris yang sudah dihapus bukan "uang tanpa pemilik". Pembaca lain
        // (carryover, persist) juga belum punya saringan ini — di sini ia
        // paling mahal kalau luput, karena keluarannya sebuah tuduhan.
        .is("deleted_at", null)
        .gt(kolom, 0)
        .order("tanggal", { ascending: true })
        .limit(25);

      const semua = (barisBaru ?? []) as any[];
      const rows = semua.filter((t) => !idTerpakai.has(String(t.id)));
      const tersaring = semua.length - rows.length;

      // Cacah UTUH dilaporkan terpisah dari yang ditampilkan. Memotong di 25
      // tanpa menyebut sisanya berbunyi persis seperti "cuma segini".
      // Dikurangi yang tersaring jaring memori: arah galatnya jadi "sedikit
      // melebihkan sisa", dan itu arah yang aman — paling banyak ia menambah
      // baris "masih ada N lagi", bukan menghilangkan sesuatu.
      hasil.unclaimedBelumLapor = Math.max(0, Number(count ?? semua.length) - tersaring);
      hasil.unclaimedRows = rows.map((t) => ({
        tgl: String(t.tanggal ?? "").slice(0, 10),
        jam: String(t.jam ?? ""),
        nominal: Number(t[kolom] ?? 0),
        pihak: String(t.nama_pengirim || t.nama_penerima || ""),
        ket: String(t.deskripsi ?? "").slice(0, 60),
      }));
      if (tersaring > 0) {
        console.warn(`[jalankanPass] ${tersaring} baris disaring jaring memori — ` +
                     `saveSession mungkin tidak menulis klaim (${jenis})`);
      }
      return rows.map((t) => String(t.id));
    } catch (e) {
      // Gagal membaca BUKAN berarti tidak ada. unclaimedDiperiksa dibiarkan
      // apa adanya supaya laporan bisa membedakan "nol karena diperiksa" dari
      // "nol karena tidak sempat diperiksa".
      console.error("[jalankanPass] gagal baca baris tanpa pemilik:", e);
      hasil.unclaimedDiperiksa = false;
      return [];
    }
  };

  /** Stempel "sudah diberitahukan". Dipanggil HANYA sesudah vonis terkirim. */
  const stempelNganggur = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const { error } = await supabase
        .from("parsed_transactions")
        .update({ unclaimed_reported_at: new Date().toISOString() })
        .in("id", ids);
      // Gagal menstempel berarti baris ini akan disebut lagi besok.
      // Mengulang jauh lebih baik daripada menghilangkannya.
      if (error) console.error("[jalankanPass] gagal menstempel baris tanpa pemilik:", error.message);
    } catch (e) {
      console.error("[jalankanPass] gagal menstempel baris tanpa pemilik:", e);
    }
  };

  // ── P1: mutasi harus terbukti utuh ──
  const ig = upload.integrity;
  if (ig?.complete === false) {
    hasil.batal = {
      kode: "MUTASI_TIDAK_UTUH",
      pesan:
        `Total tercetak bank tidak cocok dengan baris terbaca ` +
        `(kurang kredit Rp ${Math.abs(ig.missingKredit).toLocaleString("id-ID")}, ` +
        `debet Rp ${Math.abs(ig.missingDebet).toLocaleString("id-ID")}).`,
    };
    return hasil;
  }
  if ((ig?.chainBreaks ?? 0) > 0) {
    hasil.batal = {
      kode: "RANTAI_PUTUS",
      pesan: `Rantai saldo putus di ${ig?.chainBreaks} tempat — ada baris di dalam periode yang tidak terbaca.`,
    };
    return hasil;
  }
  const gagalSimpan = Number(upload.persistInfo?.errorCount ?? 0);
  if (gagalSimpan > 0) {
    // Kalau sebagian baris gagal masuk DB, kolam pencocokan bolong — dan
    // bolongnya akan tampak seperti "transfer tidak ditemukan".
    hasil.batal = {
      kode: "GAGAL_SIMPAN_BARIS",
      pesan: `${gagalSimpan} baris mutasi gagal disimpan ke database.`,
    };
    return hasil;
  }

  // ── P2: tanpa periodEnd, sisi gadai memvonis semuanya terminal ──
  if (!periodEnd || !periodStart) {
    hasil.batal = {
      kode: "PERIODE_KOSONG",
      pesan: `Tidak ada transaksi ${jenis} di berkas ini, jadi periodenya tidak bisa ditentukan.`,
    };
    return hasil;
  }

  // ── Tarik klaim dari Aceh Gadai ──
  onLangkah?.(`Menarik klaim ${jenis} dari Aceh Gadai...`);
  const tarik = await pullGadaiClaims(arah);
  if (!tarik.ok) {
    hasil.batal = { kode: "TARIK_GAGAL", pesan: tarik.error };
    return hasil;
  }
  // Pemegang lemah ikut di tarik.inputs sebagai kandidat korban — bukan klaim
  // yang "ditarik untuk dinilai". Menghitungnya membengkakkan angka ini ±750.
  hasil.klaimDitarik = tarik.inputs.filter((i) => i.sudahMemegang !== true).length;
  hasil.outletTakDikenal = tarik.unmappedOutlets;
  hasil.tertahanGerbang = tarik.tertahan ?? null;
  // Dicatat SEBELUM klaim dibuang/disaring, supaya keanggotaannya tidak ikut
  // berubah di tengah jalan bersama saringan-saringan di bawah.
  const manualIds = new Set(
    tarik.inputs
      .filter((i) => String(i.sumber ?? "").toUpperCase() === "MANUAL")
      .map((i) => String(i.id)),
  );

  const inputs: UserInput[] = [];
  for (const i of tarik.inputs) {
    const dt = parseDateISO(i.tanggalISO);
    if (!dt || !i.nominal) {
      hasil.klaimDibuang++;
      continue;
    }
    inputs.push({
      id: i.id,
      tanggal: dt,
      outletId: i.outletId,
      bankId: i.bankId,
      matchRuleId: i.matchRuleId,
      nominal: i.nominal,
      refFt: i.refFt,
      jamResi: i.jamResi,
      namaPengirimResi: i.namaPengirimResi,
      sudahMemegang: i.sudahMemegang === true,
      sumber: i.sumber ?? null,
      // Ikut dibawa supaya daftar "tidak ditemukan" bisa menyebut kontrak dan
      // outletnya. Sebelum ini keduanya dibuang di sini, sehingga laporan
      // menulis "1. - · -" dan pemiliknya cuma dapat nominal — cukup untuk
      // tahu ada masalah, tidak cukup untuk tahu harus membuka apa.
      noFaktur: i.noFaktur ?? null,
      outletNama: i.outletNama ?? null,
    });
  }
  if (inputs.length === 0) {
    // TIDAK ADA KLAIM justru keadaan yang PALING perlu melaporkan uang tanpa
    // pemilik: mutasinya bergerak dan tidak ada satu pun yang mengakuinya.
    // Memindahkan blok nganggur ke bawah saveSession tanpa jalur ini akan
    // membuat berkas semacam itu bungkam sama sekali.
    // DIBACA, TIDAK DISTEMPEL — pass ini batal, jadi hak "disebut sekali"
    // belum boleh dibakar. Himpunan terpakai kosong karena tidak ada satu pun
    // klaim yang dicocokkan.
    await bacaNganggur(new Set());
    hasil.batal = { kode: "TIDAK_ADA_KLAIM", pesan: `Tidak ada klaim ${jenis} yang menunggu.` };
    return hasil;
  }

  // ── Rakit kolam pencocokan: berkas ini + carry-over + ref-pool ──
  onLangkah?.("Menyiapkan kolam pencocokan...");
  const bankId = upload.bank.id;
  const pool: PdfTransaction[] = txsBerkas.map((t) => ({ ...t, bankId }));

  const maxLookback = Math.max(...rules.map((r) => r.lookback_days), 30);
  const awalBerkas = parseDateISO(periodStart);
  if (awalBerkas) {
    const dariTgl = new Date(awalBerkas);
    dariTgl.setUTCDate(dariTgl.getUTCDate() - maxLookback * 3);
    try {
      // Batas atas MELEWATI periodEnd, bukan berhenti di periodStart.
      //
      // Aturan lama menganggap berkas selalu memuat lengkap seluruh periodenya
      // sendiri. SBR-1-0127 membuktikan sebaliknya: baris Rp 1.032.000 tanggal
      // 31 Juli 14.55 ada di database sejak 1 Agustus, tapi tidak ikut di
      // berkas 5 Agustus yang periodenya JUGA mulai 31 Juli. Ia bukan
      // carry-over (tanggalnya bukan sebelum periodStart) dan bukan isi berkas
      // — jadi tidak ada satu jalan pun untuk sampai ke kolam, dan vonisnya
      // jadi "tidak ada di rekening" atas uang yang sebenarnya masuk.
      const akhirBerkas = periodEnd ?? toDateISO(awalBerkas);
      const carry = await loadCarryoverPdfTxs(supabase, {
        accountId, bankId, jenis,
        fromDate: toDateISO(dariTgl),
        beforeDate: geserHari(akhirBerkas, 1),
      });
      // Saringan ganda. Kunci memakai tanggal+jam+nominal+ref, BUKAN nomor
      // baris — nomor baris hanya berarti di dalam satu berkas, jadi transaksi
      // yang sama bisa bernomor lain di unduhan berbeda dan lolos jadi kembar.
      // Kembar di kolam = satu uang bisa diklaim dua kali.
      const kunciTx = (t: any) =>
        `${toDateISO(t.tanggalDate)}|${String(t.jam ?? "")}|` +
        `${jenis === "debet" ? t.debet : t.kredit}|${String(t.noRef ?? "").toUpperCase()}`;
      const sudahDiKolam = new Set(pool.map(kunciTx));
      let ditambah = 0;
      for (const t of carry) {
        const k = kunciTx(t);
        if (sudahDiKolam.has(k)) continue;
        sudahDiKolam.add(k);
        pool.push({ ...t, bankId });
        ditambah++;
      }
      if (ditambah > 0) console.info(`[pass] kolam ditambah ${ditambah} baris dari database`);
    } catch (e) {
      console.error("[pass] carry-over gagal dimuat:", e);
    }
  }

  // Ref-pool HANYA untuk kredit. Ia mengambil baris ber-nominal_kredit > 0
  // saja, sementara Pass-1 REF mengabaikan tanggal maupun aturan — kalau
  // dipanggil di pass debet, klaim TFKD- bisa menempel ke baris KREDIT.
  if (jenis === "kredit") {
    const refFts = [...new Set(inputs.map((i) => (i.refFt || "").toUpperCase()).filter(Boolean))];
    if (refFts.length > 0) {
      const paling = inputs.reduce(
        (min, i) => (i.tanggal.getTime() < min.getTime() ? i.tanggal : min),
        inputs[0].tanggal,
      );
      try {
        const rp = await loadRefPoolTxs(supabase, { accountId, refFts, earliestInput: paling });
        const sudahAda = new Set(pool.map((t) => t.parsedTxId).filter(Boolean));
        for (const t of rp) if (!t.parsedTxId || !sudahAda.has(t.parsedTxId)) pool.push(t);
      } catch (e) {
        console.error("[pass] ref-pool gagal dimuat:", e);
      }
    }
  }

  // ── Tandai baris yang SUDAH dipakai transaksi lain ──
  //
  // Ini menutup lubang yang justru dibuka oleh rancangan ini sendiri. Aturan
  // operasionalnya adalah "selalu export dengan tumpang tindih H-1", jadi baris
  // yang sama akan masuk berkali-kali. persistTransactions memang men-dedup, dan
  // carry-over sudah menyaring yang belum ter-claim — tapi baris dari BERKAS YANG
  // SEDANG DIPROSES tidak pernah diperiksa status klaimnya sama sekali
  // (lookupParsedTxIds hanya membaca id + no_ref). Akibatnya satu kredit bank yang
  // sudah dipakai membuktikan transaksi A bisa dipakai LAGI untuk membuktikan
  // transaksi B — dua transaksi, satu uang, dua-duanya berstatus "cocok".
  // Itu persis bentuk penipuan resi-kembar yang sistem ini dibangun untuk menangkap.
  {
    const idPool = [...new Set(pool.map((t) => t.parsedTxId).filter(Boolean))] as string[];
    const terklaim = new Set<string>();
    const pemegangBaris = new Map<string, { inputId: string; manualBaris: boolean }>();
    // Dipotong 500 supaya tidak pernah menyentuh batas 1000 baris PostgREST —
    // pemotongan senyap di titik seperti ini pernah membuat kas dobel.
    for (let i = 0; i < idPool.length; i += 500) {
      const { data, error } = await supabase
        .from("parsed_transactions")
        .select("id, claimed_by_input_id, manual_claim_reason")
        .in("id", idPool.slice(i, i + 500))
        .not("claimed_by_input_id", "is", null);
      if (error) {
        console.error("[pass] gagal membaca status klaim:", error);
        hasil.batal = {
          kode: "GAGAL_SIMPAN_BARIS",
          pesan: "Tidak bisa memastikan baris mutasi mana yang sudah terpakai — pencocokan dihentikan supaya tidak ada uang yang dihitung dua kali.",
        };
        return hasil;
      }
      for (const r of (data ?? []) as any[]) {
        terklaim.add(String(r.id));
        pemegangBaris.set(String(r.id), {
          inputId: String(r.claimed_by_input_id),
          manualBaris: !!r.manual_claim_reason,
        });
      }
    }
    // ── SIAPA PEMEGANGNYA — bukan cuma "sudah dipegang" ──
    //
    // Aturan "bukti kuat mengusir bukti lemah" (matching.ts, PASS 1) perlu tahu
    // cara pemegang lama mencocokkan: NOMINAL boleh diusir oleh REF; MANUAL,
    // REF, NAMA_JAM tidak boleh disentuh. Tanpa ini semua pemegang terlihat
    // sama, dan aturannya harus memilih antara mengusir semua atau tidak sama
    // sekali — dua-duanya salah.
    const pemegangInput = new Map<string, { matchedBy: string | null; manual: boolean; gadaiKlaimId: string | null }>();
    {
      const idInput = [...new Set([...pemegangBaris.values()].map((p) => p.inputId))];
      for (let i = 0; i < idInput.length; i += 500) {
        const { data, error } = await supabase
          .from("cek_inputs")
          .select("id, matched_by, match_status, manual_claim_reason, gadai_klaim_id")
          .in("id", idInput.slice(i, i + 500));
        if (error) {
          console.error("[pass] gagal membaca pemegang baris:", error);
          hasil.batal = {
            kode: "GAGAL_SIMPAN_BARIS",
            pesan: "Tidak bisa membaca siapa pemegang baris mutasi — pencocokan dihentikan supaya tidak ada baris yang berpindah tangan tanpa dasar.",
          };
          return hasil;
        }
        for (const r of (data ?? []) as any[]) {
          pemegangInput.set(String(r.id), {
            matchedBy: r.matched_by ? String(r.matched_by) : null,
            // MANUAL dalam tiga bentuk, semuanya mengunci: (1) penutupan tangan
            // di sini (manual_claimed / alasan), (2) resi yang DIKETIK owner
            // sendiri di Lapis 1 — id klaimnya berpola TFKM- (lib/sessions/
            // save.ts). Yang kedua tidak menyimpan `sumber` di cek_inputs, jadi
            // polanya yang dibaca. Aturan pemilik: yang manual, apa pun
            // ceritanya, tidak boleh disepak.
            // Resi ketikan owner: sisi MASUK ber-id TFKM-…, sisi KELUAR ber-id
            // TFKD-{req}-M{acak} (app/api/tf-keluar/resi/route.ts:376). Keduanya
            // dikenali dari polanya DAN dari `sumber` pada input korban.
            manual: String(r.match_status ?? "") === "manual_claimed" || !!r.manual_claim_reason
                    || /^TFKM-/i.test(String(r.gadai_klaim_id ?? ""))
                    || /^TFKD-\d+-M/i.test(String(r.gadai_klaim_id ?? "")),
            gadaiKlaimId: r.gadai_klaim_id ? String(r.gadai_klaim_id) : null,
          });
        }
      }
    }
    for (const t of pool) {
      if (!t.parsedTxId || !terklaim.has(t.parsedTxId)) continue;
      t.claimedByOther = true;
      const pb = pemegangBaris.get(t.parsedTxId);
      const pi = pb ? pemegangInput.get(pb.inputId) : undefined;
      if (pb && pi) {
        t.pemegang = {
          inputId: pb.inputId,
          matchedBy: pi.matchedBy,
          // Manual dari SISI MANA PUN mengunci: catatan di barisnya atau di
          // inputnya sama-sama berarti manusia sudah memutuskan.
          manual: pi.manual || pb.manualBaris,
          gadaiKlaimId: pi.gadaiKlaimId,
        };
      }
    }
  }

  // ── Klaim yang SUDAH terbukti di sesi sebelumnya ──
  //
  // Kalau sebuah pass berhasil menyimpan sesi tapi gagal mengirim vonis, klaimnya
  // tetap PENDING di gadai sementara baris mutasinya sudah ter-claim di sini.
  // Tanpa langkah ini, percobaan berikutnya akan melihat barisnya "sudah dipakai",
  // memvonisnya konflik, dan klaim itu menggantung selamanya. Jadi sebelum
  // mencocokkan, tanyakan dulu: apakah klaim ini memang sudah pernah dibuktikan?
  const sudahTerbukti = new Set<string>();
  {
    const idKlaim = inputs.map((i) => i.id);
    for (let i = 0; i < idKlaim.length; i += 500) {
      const { data, error: errTerbukti } = await supabase
        .from("cek_inputs")
        .select("gadai_klaim_id")
        .in("gadai_klaim_id", idKlaim.slice(i, i + 500))
        .not("matched_tx_id", "is", null)
        .is("deleted_at", null);
      if (errTerbukti) {
        // Daftar ini menjadi pagar 4 aturan sepak ("pengusir yang sudah
        // memegang baris tidak boleh mengusir"). Kueri yang gagal dulu
        // dibiarkan lewat — dan pagar yang gagal terbaca sama dengan pagar
        // yang tidak ada. Sekarang berhenti.
        hasil.batal = {
          kode: "GAGAL_SIMPAN_BARIS",
          pesan: "Tidak bisa memastikan klaim mana yang sudah memegang baris mutasi — pencocokan dihentikan supaya tidak ada klaim yang memegang dua baris.",
        };
        return hasil;
      }
      for (const r of (data ?? []) as any[]) {
        if (r.gadai_klaim_id) sudahTerbukti.add(String(r.gadai_klaim_id));
      }
    }
  }

  // ── Cocokkan ──
  onLangkah?.(`Mencocokkan ${inputs.length} klaim dengan ${pool.length} baris mutasi...`);
  const outletColors = new Map<string, string>(outlets.map((o) => [o.id, o.warna_hex]));
  const rulesById = new Map<string, MatchRulePreset>(rules.map((r) => [r.id, r]));
  // Klaim PENDING di gadai yang ternyata sudah memegang baris di sini (vonis
  // lama gagal terkirim): tidak boleh mengusir dan tidak dicocokkan ulang —
  // tapi TETAP dilaporkan lewat jalur SESI_LAMA di bawah. Ditandai terpisah
  // dari `sudahMemegang` (daftar pemegang dari gadai) yang memang tidak
  // dilaporkan; menyamakan keduanya mematikan SESI_LAMA (temuan pemeriksa).
  for (const i of inputs) {
    if (sudahTerbukti.has(String(i.id)) && !(i as any).sudahMemegang) (i as any).tidakBolehMengusir = true;
  }

  const { inputs: hasilInputs, summary } = runMatching(inputs, pool, outletColors, {
    getRulesForInput: (i) => gadaiAwareRules(i, rulesById),
  });

  // ── PELEPASAN PEMEGANG LAMA DIPERSISTENKAN DULU, SEBELUM SESI DISIMPAN ──
  //
  // Pengusiran di matching.ts baru terjadi di memori. Kalau sesi disimpan
  // begitu saja: indeks unik `uq_cek_inputs_satu_baris_satu_klaim_gadai`
  // menolak pemegang baru, dan RPC claim_parsed_transactions hanya mengklaim
  // baris yang claimed_by_input_id-nya NULL — jadi pemegang baru diam-diam
  // tidak pernah tercatat, sementara laporan sudah bilang "cocok".
  //
  // Urutan dan pagarnya:
  //   1. Baris mutasi dilepas dengan CAS (hanya kalau pemegangnya memang
  //      input lama itu). Kalau nol baris berubah, ada yang mendahului kita —
  //      berhenti, jangan menebak.
  //   2. Baris cek_inputs lama DIHAPUS-LUNAK (deleted_at), bukan dihapus:
  //      jejaknya tetap ada, dan indeks unik (parsial pada deleted_at IS NULL)
  //      langsung membebaskan slotnya.
  //   3. Dicatat ke audit_logs.
  //   Gagal di mana pun = seluruh jalan dibatalkan sebelum menyimpan atau
  //   mengirim apa pun. Setengah jalan di sini berarti satu uang dua pemilik.
  const klaimDisepak = new Set<string>();
  // Jejak pelepasan yang SUDAH dipersistenkan — untuk dibalik kalau langkah
  // sesudahnya (simpan sesi / klaim baris) gagal. Setengah jalan di sini
  // berarti baris bebas tanpa pemilik sementara gadai masih menganggapnya
  // cocok; membalik lebih murah daripada mencari.
  const dilepas: { parsedTxId: string; inputLama: string; olehKlaimId: string }[] = [];
  const batalkanPelepasan = async () => {
    for (const r of dilepas) {
      // Baris pengusir yang mungkin sempat tersimpan oleh saveSession harus
      // dinonaktifkan DULU — indeks unik menolak dua pemegang hidup.
      await supabase.from("cek_inputs")
        .update({ deleted_at: new Date().toISOString() })
        .eq("matched_tx_id", r.parsedTxId).eq("gadai_klaim_id", r.olehKlaimId).is("deleted_at", null);
      await supabase.from("cek_inputs")
        .update({ deleted_at: null })
        .eq("id", r.inputLama);
      await supabase.from("parsed_transactions")
        .update({ claimed_by_input_id: r.inputLama, claimed_at: new Date().toISOString() })
        .eq("id", r.parsedTxId)
        .or(`claimed_by_input_id.is.null,claimed_by_input_id.eq.${r.inputLama}`);
      await supabase.from("audit_logs").insert({
        account_id: accountId, user_id: userId,
        action: "KLAIM_DISEPAK_DIBATALKAN", target_type: "cek_inputs", target_id: r.inputLama,
        metadata: { baris: r.parsedTxId, oleh: r.olehKlaimId },
      }).then(() => {}, () => {});
    }
  };
  for (const d of (summary.disepak ?? [])) {
    if (!d.parsedTxId) {
      await batalkanPelepasan();
      hasil.batal = { kode: "GAGAL_SEPAK", pesan: `Baris ${d.txKey} tidak punya id di database — pengusiran dibatalkan.` };
      return hasil;
    }
    const { data: lepas, error: eLepas } = await supabase
      .from("parsed_transactions")
      .update({ claimed_by_input_id: null, claimed_at: null })
      .eq("id", d.parsedTxId)
      .eq("claimed_by_input_id", d.pemegangInputId)
      .select("id");
    if (eLepas || !lepas || lepas.length === 0) {
      await batalkanPelepasan();
      hasil.batal = {
        kode: "GAGAL_SEPAK",
        pesan: `Baris ${tglTampil(d.tanggal)} ${rpTampil(d.kredit)} tidak bisa dilepas dari ${d.pemegangKlaimId}` +
               (eLepas ? `: ${eLepas.message}` : " — pemegangnya sudah berubah") + ". Jalan dihentikan.",
      };
      return hasil;
    }
    const { data: nonaktif, error: eInput } = await supabase
      .from("cek_inputs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", d.pemegangInputId)
      .is("deleted_at", null)
      .select("id");
    if (eInput || !nonaktif || nonaktif.length !== 1) {
      // Baris sudah dilepas di langkah 1 — kembalikan dulu, baru berhenti.
      await supabase.from("parsed_transactions")
        .update({ claimed_by_input_id: d.pemegangInputId, claimed_at: new Date().toISOString() })
        .eq("id", d.parsedTxId).is("claimed_by_input_id", null);
      await batalkanPelepasan();
      hasil.batal = { kode: "GAGAL_SEPAK", pesan: `Klaim lama ${d.pemegangKlaimId} tidak bisa dinonaktifkan` + (eInput ? `: ${eInput.message}` : " (baris input tidak ditemukan / sudah nonaktif)") + ". Jalan dihentikan." };
      return hasil;
    }
    dilepas.push({ parsedTxId: d.parsedTxId, inputLama: d.pemegangInputId, olehKlaimId: d.olehKlaimId });
    await supabase.from("audit_logs").insert({
      account_id: accountId, user_id: userId,
      action: "KLAIM_DISEPAK", target_type: "cek_inputs", target_id: d.pemegangInputId,
      metadata: {
        baris: d.parsedTxId, no_ref: d.noRef, tanggal: d.tanggal, kredit: d.kredit,
        pemegang_lama: d.pemegangKlaimId, cara_lama: d.pemegangMatchedBy,
        oleh: d.olehKlaimId, oleh_no_faktur: d.olehNoFaktur, cara_baru: "REF",
      },
    }).then(({ error }) => { if (error) console.error("[pass] audit KLAIM_DISEPAK gagal:", error.message); });
    klaimDisepak.add(d.pemegangKlaimId);
  }

  const unclaimedIni = summary.unclaimed.filter((t) => t.source === "current");
  hasil.unclaimedCount = unclaimedIni.length;
  // Untuk arah debet, nilainya ada di kolom debet — bukan kredit. Dulu kedua
  // arah sama-sama menjumlah `kredit`, sehingga total debet-nganggur selalu
  // nol dan "tidak ada uang keluar yang mencurigakan" terlihat benar tanpa
  // pernah diperiksa.
  const nilaiBaris = (t: any) => Number(jenis === "debet" ? (t.debet ?? 0) : (t.kredit ?? 0));
  hasil.unclaimedTotal = unclaimedIni.reduce((s, t) => s + nilaiBaris(t), 0);
  // Barisnya dibawa ke laporan untuk KEDUA arah.
  //
  // Arah debet adalah pertanyaan yang paling mahal dan paling lama tidak
  // ditanya: "uang KELUAR dari rekening yang tidak diminta siapa pun".
  // Selama ini laporan berkata "✅ Semua transfer keluar ketemu di mutasi" —
  // kalimat yang hanya menguji arah sebaliknya (permintaan → mutasi), tidak
  // pernah mutasi → permintaan. Uang keluar tanpa pasangan tidak punya satu
  // tempat pun untuk muncul.
  // ── DISEBUT SEKALI SAJA, DAN "SEKALI" HARUS BENAR-BENAR TERJADI ──
  //
  // Versi pertama menandai per-UNGGAHAN: hanya baris yang sidik jarinya baru
  // masuk pada berkas ini yang dilaporkan. Itu keliru halus dengan akibat
  // besar. Berkas 28 Juli memuat 19-28 Juli, dan sebagian besar barisnya sudah
  // tersimpan oleh unggahan 27 Juli — yang berjalan SEBELUM laporan Lapis 2
  // ada. Baris-baris itu tidak akan pernah "baru" lagi, jadi tidak pernah
  // punya kesempatan kedua: "sekali" berubah menjadi NOL kali. Yang tak pernah
  // disebut satu kali pun: 33 baris kredit (Rp 125.714.000) dan 27 baris debet
  // (Rp 58.042.500) sejak 22 Juli.
  //
  // Sekarang yang ditandai adalah BARISNYA. Sebuah baris dilaporkan kalau ia
  // belum terklaim DAN belum pernah dilaporkan; sesudah masuk laporan ia
  // distempel. Kebaruan tidak bisa menggantikan ingatan — ia hanya tahu "baru
  // bagi berkas ini", sedangkan yang perlu diketahui adalah "sudah pernah
  // dikatakan kepada pemiliknya atau belum".
  //
  // Keputusan pemilik 28 Juli 2026: "cukup beritahu sekali saja."
  // ── DIPINDAH KE BAWAH, SESUDAH SESI TERSIMPAN (30 Juli 2026) ──
  //
  // Blok ini DULU berada di sini, dan di sini ia SELALU salah. Ia bertanya ke
  // basis data "baris mana yang tidak punya pemilik?" — padahal yang MENULIS
  // pemiliknya (claimed_by_input_id) adalah saveSession, yang baru berjalan
  // jauh di bawah. Jadi setiap baris yang baru saja dicocokkan pada jalan INI
  // masih tampak menganggur, lalu dilaporkan sebagai "uang tanpa pemilik" DAN
  // distempel "sudah pernah dilaporkan".
  //
  // Terukur pada unggahan mutasi asli pertama (30 Juli 2026, 11:25 WIB):
  // 41 baris dilaporkan, 26 di antaranya diklaim pada jalan yang sama itu juga.
  // Cap waktunya berselisih 0,4 detik — distempel 04:25:58.898, klaimnya ditulis
  // 04:25:59.331. Laporannya benar pada mikrodetik ia diambil dan salah sesudahnya.
  //
  // Akibatnya bukan cuma angka keliru: 63% isi blok itu kebisingan, dan
  // kebisingan sebanyak itu membuat blok yang paling mahal di laporan ini
  // berhenti dibaca — termasuk pada tujuh baris yang memang perlu dijawab.
  //
  // Perhatikan bahwa `unclaimedCount`/`unclaimedTotal` di atas TIDAK terkena:
  // keduanya dihitung dari summary.unclaimed (hasil pencocokan di memori) yang
  // memang sudah mengecualikan baris yang cocok pada jalan ini. Hanya DAFTAR-nya
  // yang salah sumber. Itu sebabnya sisi gadai tidak pernah melihat gejalanya.

  // ── P3: jangan memvonis klaim di luar periode ──
  const laporan: { id: string; matched: boolean; matched_by: string | null; ref_issue: string | null; ambiguous: number; catatan?: string | null }[] = [];
  // Identitas yang ditahan, dibawa ke laporan. Dipotong 80 supaya satu berkas
  // yang salah periode tidak mengirim ratusan baris; sisanya tetap terhitung
  // di cacahnya.
  const catatDitahan = (i: any, sebab: "BEREBUT" | "LUAR_PERIODE" | "DISEPAK_TAK_KETEMU") => {
    if (hasil.ditahanDaftar.length >= 80) return;
    hasil.ditahanDaftar.push({
      id: String(i.id),
      no_faktur: String(i.noFaktur ?? i.no_faktur ?? "-"),
      outlet: String(i.outletNama ?? i.outlet ?? "-"),
      tgl: toDateISO(i.tanggal),
      nominal: Number(i.nominal ?? 0),
      sebab,
    });
  };
  // Kalau mutasi ini TIDAK NYAMBUNG dengan catatan terakhir, ada transaksi
  // sebelum periodStart yang belum pernah masuk. Klaim yang jendela mundurnya
  // menyentuh lubang itu tidak boleh divonis: uangnya bisa saja mendarat di
  // dalam lubang. Batas bawah dinaikkan sejauh jendela mundur terlebar.
  const adaLubangSebelumnya = ig?.connected === false;
  const batasBawah = adaLubangSebelumnya
    ? geserHari(periodStart, maxLookback)
    : periodStart;

  for (const i of hasilInputs) {
    const m = i.match;

    // ── PEMEGANG LEMAH YANG TIDAK TERSEPAK: BUKAN URUSAN JALAN INI ──
    //
    // Ia dibawa hanya sebagai kandidat korban. Tidak dicocokkan (matching.ts
    // melewatinya), tidak dilaporkan, tidak dihitung — kalau masuk `laporan`
    // ia membengkakkan "diterima/dicocokkan" di Lapis 2 dan cacah "Cocok" di
    // alert gadai dengan ratusan klaim lama tiap sesi.
    if ((i as any).sudahMemegang && !klaimDisepak.has(String(i.id))) continue;

    // ── YANG BARU DISEPAK: WAJIB dilaporkan pada jalan ini, apa pun nasibnya ──
    //
    // Barisnya sudah dilepas di database. Kalau ia tidak dilaporkan sekarang,
    // sisi gadai tetap mengira ia MATCHED sementara di sini ia tidak memegang
    // apa-apa — dua buku yang saling bertentangan, dan tak ada yang melihat.
    // Karena itu ia melewati penjaga luar-periode DAN penjaga konflik:
    //   cocok ulang  -> dikirim sebagai cocok (baris baru), tanpa keributan;
    //   tidak ketemu -> dikirim UNMATCHED ber-sebab DISEPAK, masuk
    //                   /belum-cocok, dan terus disebut Lapis 2 sampai manusia
    //                   membereskannya (permintaan pemilik 5 September 2026).
    if (klaimDisepak.has(String(i.id))) {
      const d = (summary.disepak ?? []).find((x) => x.pemegangKlaimId === String(i.id));
      if (m?.status === "matched") {
        catatTanggal(hasil, i, arah);
        laporan.push({ id: i.id, matched: true, matched_by: m.matchedBy ?? "NOMINAL", ref_issue: null, ambiguous: m.ambiguous ?? 0 });
        if (d) hasil.disepak.push({ olehKlaimId: d.olehKlaimId, olehNoFaktur: d.olehNoFaktur, pemegangKlaimId: d.pemegangKlaimId,
          pemegangMatchedBy: d.pemegangMatchedBy, noRef: d.noRef, tanggal: d.tanggal, kredit: d.kredit, nasib: "COCOK_ULANG" });
      } else {
        const catatan = `DISEPAK: baris ${tglTampil(d?.tanggal ?? "")} ${rpTampil(d?.kredit ?? i.nominal)}` +
          (d?.noRef ? ` ref ${d.noRef}` : "") + ` ternyata milik ${d?.olehNoFaktur ?? d?.olehKlaimId ?? "klaim ber-ref"}; ` +
          `pencocokan ulang tidak menemukan baris lain — cocokkan manual.`;
        catatTanggal(hasil, i, arah);
        catatDitahan(i, "DISEPAK_TAK_KETEMU");
        if (hasil.tidakKetemu.length < 60) {
          hasil.tidakKetemu.push({
            no_faktur: String((i as any).noFaktur ?? "-"), outlet: String((i as any).outletNama ?? "-"),
            tgl: toDateISO(i.tanggal), nominal: Number((i as any).nominal ?? 0), sebab: "salah klaim, disepak — tidak ada baris lain",
          });
        }
        laporan.push({ id: i.id, matched: false, matched_by: null, ref_issue: "DISEPAK", ambiguous: 0, catatan } as any);
        if (d) hasil.disepak.push({ olehKlaimId: d.olehKlaimId, olehNoFaktur: d.olehNoFaktur, pemegangKlaimId: d.pemegangKlaimId,
          pemegangMatchedBy: d.pemegangMatchedBy, noRef: d.noRef, tanggal: d.tanggal, kredit: d.kredit, nasib: "TAK_KETEMU" });
      }
      continue;
    }

    // Sudah pernah dibuktikan di sesi sebelumnya (vonisnya yang gagal terkirim).
    if (m?.status !== "matched" && sudahTerbukti.has(i.id)) {
      hasil.sudahTerbuktiSebelumnya++;
      laporan.push({ id: i.id, matched: true, matched_by: "SESI_LAMA", ref_issue: null, ambiguous: 0 });
      continue;
    }

    if (m?.status === "matched") {
      // Rincian per tanggal dikumpulkan untuk laporan LAPIS 2. Gunanya bukan
      // hiasan: pemilik memeriksa Lapis 1 tiap hari, jadi angka per tanggal
      // di sini HARUS bisa disandingkan dengan angka hari itu di Lapis 1.
      // Kalau keduanya beda, ada resi yang lolos di antara dua lapisan.
      catatTanggal(hasil, i, arah);
      laporan.push({
        id: i.id,
        matched: true,
        matched_by: m.matchedBy ?? "NOMINAL",
        ref_issue: m.refIssue ?? null,
        ambiguous: m.ambiguous ?? 0,
      });
      continue;
    }

    // KONFLIK (all_taken): kandidatnya ADA tapi sudah dipakai transaksi lain.
    // Ini bukan "uangnya tidak ada" — ini dua transaksi memperebutkan satu
    // kredit, dan yang benar harus diputuskan manusia. Dikirim sebagai
    // matched:false, ia akan divonis UNMATCHED terminal dan berbunyi seperti
    // tuduhan. Kecuali kalau ia membawa ref_issue: itu memang alarm yang
    // dirancang untuk berbunyi keras di sisi gadai, jadi tetap dikirim.
    if (m?.status === "all_taken" && !m.refIssue) {
      hasil.ditahanKonflik++;
      catatDitahan(i, "BEREBUT");
      continue;
    }

    // Tidak cocok: hanya boleh divonis kalau tanggalnya memang tercakup berkas ini.
    const iso = toDateISO(i.tanggal);
    if (iso < batasBawah) {
      hasil.ditahanDiLuarPeriode++;
      catatDitahan(i, "LUAR_PERIODE");
      continue;
    }
    // Batas atas memakai jendela MAJU aturan klaim itu sendiri: transfer malam
    // sering baru dibukukan bank keesokan harinya, jadi klaim di ujung periode
    // belum tentu bisa dinilai oleh berkas ini.
    const maju = gadaiAwareRules(i, rulesById).forward_window_days ?? 0;
    if (iso > geserHari(periodEnd, -maju)) {
      hasil.ditahanDiLuarPeriode++;
      catatDitahan(i, "LUAR_PERIODE");
      continue;
    }

    catatTanggal(hasil, i, arah);
    // Yang tidak ketemu disebut LENGKAP dengan kontrak & outletnya. Cacah saja
    // tidak bisa ditindaklanjuti — pemilik harus tahu harus membuka apa.
    if (hasil.tidakKetemu.length < 60) {
      hasil.tidakKetemu.push({
        no_faktur: String((i as any).noFaktur ?? (i as any).no_faktur ?? "-"),
        outlet:    String((i as any).outletNama ?? (i as any).outlet ?? "-"),
        tgl:       toDateISO(i.tanggal),
        nominal:   Number((i as any).nominal ?? 0),
        sebab:     m?.refIssue ? "nomor resi bermasalah" : "tidak ada di rekening",
      });
    }
    laporan.push({
      id: i.id,
      matched: false,
      matched_by: null,
      ref_issue: m?.refIssue ?? null,
      ambiguous: 0,
    });
  }

  hasil.klaimDinilai = laporan.length;
  hasil.cocok = laporan.filter((r) => r.matched).length;
  hasil.belumKetemu = laporan.length - hasil.cocok;
  const manualDinilaiRows = laporan.filter((r) => manualIds.has(String(r.id)));
  hasil.manualDinilai = manualDinilaiRows.length;
  hasil.manualCocok = manualDinilaiRows.filter((r) => r.matched).length;
  if (laporan.length === 0) {
    // Sama seperti cabang di atas: dibaca, tidak distempel. Himpunan terpakai
    // aman kosong — laporan.length === 0 berarti tidak ada satu pun input
    // berstatus matched (setiap matched pasti mem-push ke `laporan`).
    await bacaNganggur(new Set());
    hasil.batal = {
      kode: "TIDAK_ADA_KLAIM",
      pesan: `Semua klaim ${jenis} berada di luar periode berkas ini — tidak ada yang bisa dinilai.`,
    };
    return hasil;
  }

  // ── Simpan sesi DULU, baru kirim ──
  // Urutannya sengaja: kalau pengiriman berhasil tapi sesi gagal tersimpan,
  // mutasi tidak pernah ter-claim padahal vonisnya sudah mendarat di gadai —
  // bentuk "setengah jadi" yang paling sulit dilihat.
  onLangkah?.("Menyimpan sesi...");
  try {
    const { saveSession } = await import("@/lib/sessions/save");
    // Pemegang lemah yang tidak tersepak TIDAK disimpan sebagai baris sesi:
    // ia bukan input jalan ini, dan ±750 baris ber-match_status NULL tiap
    // sesi hanya membengkakkan riwayat dan cacah total_input.
    const inputsBank = hasilInputs.filter((i) =>
      (i.bankId === bankId || !i.bankId) &&
      !((i as any).sudahMemegang && !klaimDisepak.has(String(i.id))));
    if (inputsBank.length > 0) {
      const subSummary: MatchSummary = {
        totalInput: inputsBank.length,
        matched: inputsBank.filter((i) => i.match?.status === "matched").length,
        noCandidate: inputsBank.filter((i) => i.match?.status === "no_candidate"),
        allTaken: inputsBank.filter((i) => i.match?.status === "all_taken"),
        unclaimed: pool.filter(
          (t) =>
            t.bankId === bankId &&
            t.source === "current" &&
            !inputsBank.some(
              (i) =>
                i.match?.status === "matched" &&
                (i.match.txBankId ?? i.bankId) === bankId &&
                i.match.txNo === t.no &&
                i.match.txDate.getTime() === t.tanggalDate.getTime(),
            ),
        ),
      };
      await saveSession(supabase, {
        accountId, userId, bankId, jenis,
        inputs: inputsBank,
        summary: subSummary,
        matchingPool: pool,
        pdfTotalAmount: txsBerkas.reduce((s, t) => s + t.kredit, 0),
        periodStart: parseDateISO(periodStart),
        periodEnd: parseDateISO(periodEnd),
        carryOverUsed: pool.some((t) => t.source === "carryover"),
        multiBankUsed: false,
      });
    }
  } catch (e) {
    // DULU ini hanya console.error, dan itu keliru: kalau sesi gagal tersimpan,
    // baris mutasi tidak pernah ter-claim. Vonis "cocok" tetap mendarat di gadai,
    // tapi di sini uangnya masih menganggur — sehingga kiriman berikutnya bisa
    // memakainya lagi untuk transaksi yang berbeda. Komentar di atas menjanjikan
    // urutan ini melindungi; sekarang ia benar-benar melindungi.
    console.error("[pass] gagal menyimpan sesi:", e);
    if (dilepas.length) await batalkanPelepasan();
    hasil.batal = {
      kode: "GAGAL_SIMPAN_SESI",
      pesan: `Sesi gagal disimpan (${e instanceof Error ? e.message : String(e)}) — vonis TIDAK dikirim supaya baris mutasi tidak bisa dipakai dua kali.`,
    };
    return hasil;
  }

  // ── VERIFIKASI: BARIS YANG DILEPAS KINI BENAR-BENAR DIPEGANG PENGUSIRNYA ──
  //
  // Antara pelepasan (di atas) dan klaim baru (di dalam saveSession) tidak ada
  // transaksi. Di jendela itu /belum-cocok atau sesi lain bisa mengambil
  // barisnya; insert cek_inputs pengusir lalu ditolak indeks unik, save.ts
  // hanya console.error, dan vonis "cocok" tetap akan dikirim ke gadai untuk
  // baris yang tidak dipegang siapa pun. Diperiksa langsung ke basis data:
  // setiap baris yang dilepas harus punya pemegang baru. Kalau tidak, semua
  // pelepasan dibalik dan vonis TIDAK dikirim.
  if (dilepas.length) {
    const { data: cekBaris, error: eCek } = await supabase
      .from("parsed_transactions")
      .select("id, claimed_by_input_id")
      .in("id", dilepas.map((r) => r.parsedTxId));
    // Bukan sekadar "ada pemegang" — pemegangnya harus SI PENGUSIR. Di jendela
    // lepas→klaim, input lokal (yang tidak dijaga indeks unik) bisa menyambar
    // barisnya; "ada pemegang" akan meloloskannya (temuan pemeriksa).
    const idPemegangBaru = [...new Set(((cekBaris ?? []) as any[]).map((b) => b.claimed_by_input_id).filter(Boolean))] as string[];
    const { data: pemegangBaru, error: ePb } = idPemegangBaru.length
      ? await supabase.from("cek_inputs").select("id, gadai_klaim_id").in("id", idPemegangBaru)
      : { data: [], error: null };
    const klaimDariInput = new Map<string, string | null>(
      ((pemegangBaru ?? []) as any[]).map((r) => [String(r.id), r.gadai_klaim_id ? String(r.gadai_klaim_id) : null]));
    const tanpaPemegang = (eCek || ePb) ? dilepas.map((r) => r.parsedTxId)
      : dilepas.filter((r) => {
          const b = ((cekBaris ?? []) as any[]).find((x) => String(x.id) === r.parsedTxId);
          if (!b || !b.claimed_by_input_id) return true;
          return klaimDariInput.get(String(b.claimed_by_input_id)) !== r.olehKlaimId;
        }).map((r) => r.parsedTxId);
    if (tanpaPemegang.length) {
      await batalkanPelepasan();
      hasil.batal = {
        kode: "GAGAL_SEPAK",
        pesan: `${tanpaPemegang.length} baris yang dilepas tidak berakhir di tangan klaim ber-ref` +
               (eCek ? ` (${eCek.message})` : ePb ? ` (${ePb.message})` : "") + " — pelepasan dibalik, vonis TIDAK dikirim.",
      };
      return hasil;
    }
  }

  // ── BARIS MUTASI TANPA PEMILIK — DIBACA SESUDAH SESI TERSIMPAN ──
  //
  // Tempatnya di SINI, bukan sebelum pencocokan. Sesudah saveSession,
  // claimed_by_input_id sudah tertulis, jadi basis data SENDIRI yang
  // mengecualikan baris yang baru diklaim — tanpa daftar id di URL, dan
  // dengan count:"exact" yang ikut benar.
  //
  // Kalau saveSession GAGAL, kode di atas sudah return: tidak dibaca, tidak
  // distempel. Laporan akan berkata "belum diperiksa", bukan "(0)".
  //
  // JARING KEDUA: id baris yang dipakai run ini, disusun dengan kunci yang SAMA
  // PERSIS seperti findMatchedTxId di lib/sessions/save.ts:81-87. Kesamaan kunci
  // itu bukan kerapian — ia yang membuat himpunan "yang saya kecualikan" tidak
  // bisa menyimpang dari himpunan "yang saveSession klaim". Gunanya menutup satu
  // jalur yang DB tidak bisa perlihatkan: insert cek_inputs yang gagal di
  // save.ts hanya di-console.error tanpa melempar, jadi saveSession bisa
  // "berhasil" sambil tidak mengklaim apa pun.
  const kunciPool = new Map<string, string>();
  for (const t of pool) {
    if (!t.parsedTxId) continue;
    const k = `${t.bankId ?? "_"}|${t.no}|${t.tanggalDate.getTime()}|${t.kredit}`;
    if (!kunciPool.has(k)) kunciPool.set(k, t.parsedTxId);
  }
  const idTerpakai = new Set<string>();
  for (const i of hasilInputs) {
    if (i.match?.status !== "matched") continue;
    const k = `${i.match.txBankId ?? i.bankId ?? "_"}|${i.match.txNo}|${i.match.txDate.getTime()}|${i.nominal}`;
    const id = kunciPool.get(k);
    if (id) idTerpakai.add(id);
  }
  const idNganggur = await bacaNganggur(idTerpakai);

  // ── Kunci sekali-kirim, lalu kirim ──
  if (opsi.kunciKirim) {
    const boleh = await opsi.kunciKirim();
    if (!boleh) {
      hasil.batal = { kode: "KIRIM_GAGAL", pesan: "Hasil pass ini sudah pernah dikirim ke Aceh Gadai." };
      return hasil;
    }
  }

  // Sejak kunci diambil sampai gadai menjawab, SEMUA jalan keluar wajib melepas
  // kuncinya kembali. Kunci yang diambil lalu ditinggalkan karena satu lemparan
  // di tengah membuat berkas itu tidak akan pernah bisa dikirim lagi — dan tidak
  // ada layar mana pun untuk membukanya kembali tanpa SQL.
  let kirim: Awaited<ReturnType<typeof pushGadaiResults>>;
  try {
    onLangkah?.(`Mengirim ${laporan.length} hasil ke Aceh Gadai...`);
    // Dikirim untuk KEDUA arah. Dulu `null` untuk debet — itulah kenapa uang
    // keluar tanpa pasangan tidak pernah sampai ke sisi gadai sama sekali.
    const unclaimedPayload = {
      arah: jenis,
      count: unclaimedIni.length,
      total: hasil.unclaimedTotal,
      rows: unclaimedIni.slice(0, 40).map((t: any) => ({
        t: toDateISO(t.tanggalDate),
        j: t.waktu || "",
        n: nilaiBaris(t),
        p: t.namaPengirim || t.namaPenerima || "",
      })),
    };
    kirim = await pushGadaiResults(laporan, arah, periodEnd, periodStart, unclaimedPayload);
  } catch (e) {
    if (opsi.lepasKunci) await opsi.lepasKunci();
    hasil.batal = { kode: "KIRIM_GAGAL", pesan: e instanceof Error ? e.message : String(e) };
    return hasil;
  }

  if (!kirim.ok) {
    // Kunci dilepas supaya kiriman ulang yang sah masih mungkin. Endpoint
    // /result berat (memicu laporan Telegram di sisi gadai), jadi pelepasan
    // kunci ini SENGAJA tidak disertai retry otomatis — owner yang memutuskan.
    if (opsi.lepasKunci) await opsi.lepasKunci();
    hasil.batal = { kode: "KIRIM_GAGAL", pesan: kirim.error };
    return hasil;
  }

  hasil.terkirim = {
    updated: kirim.updated,
    unmatched: kirim.unmatched,
    recheck: kirim.recheck,
    alarm: kirim.alarm,
    alertSent: kirim.alertSent,
  };

  // ── STEMPEL "SUDAH DIBERITAHUKAN" — paling akhir, dan itu disengaja ──
  //
  // Stempel adalah pernyataan "pemiliknya sudah diberi tahu", jadi ia hanya
  // boleh dipasang sesudah vonisnya benar-benar terkirim. Semua jalan keluar di
  // atas (sesi gagal, kunci ditolak, kirim gagal) meninggalkan barisnya TANPA
  // stempel, sehingga ia disebut lagi pada unggahan berikutnya.
  //
  // Konsekuensinya diterima sadar: satu baris bisa disebut DUA KALI kalau
  // kiriman pertama gagal di tengah. Mengulang jauh lebih baik daripada
  // menghilangkan — dan itu sikap yang sama dengan komentar penstempelan sejak
  // awal, hanya sekarang benar-benar dijalankan.
  await stempelNganggur(idNganggur);
  return hasil;
}
