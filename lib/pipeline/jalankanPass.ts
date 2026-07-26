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
    | "KIRIM_GAGAL";
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
  /** Klaim yang sudah terbukti cocok di sesi sebelumnya (vonisnya gagal
   *  terkirim waktu itu), dilaporkan ulang tanpa dicocokkan lagi. */
  sudahTerbuktiSebelumnya: number;

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
    klaimDinilai: 0, cocok: 0, belumKetemu: 0,
    ditahanDiLuarPeriode: 0, ditahanKonflik: 0, sudahTerbuktiSebelumnya: 0,
    terkirim: null, batal: null,
    unclaimedCount: 0, unclaimedTotal: 0,
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
  hasil.klaimDitarik = tarik.inputs.length;
  hasil.outletTakDikenal = tarik.unmappedOutlets;

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
    });
  }
  if (inputs.length === 0) {
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
      const carry = await loadCarryoverPdfTxs(supabase, {
        accountId, bankId, jenis,
        fromDate: toDateISO(dariTgl),
        beforeDate: toDateISO(awalBerkas),
      });
      for (const t of carry) pool.push({ ...t, bankId });
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
    // Dipotong 500 supaya tidak pernah menyentuh batas 1000 baris PostgREST —
    // pemotongan senyap di titik seperti ini pernah membuat kas dobel.
    for (let i = 0; i < idPool.length; i += 500) {
      const { data, error } = await supabase
        .from("parsed_transactions")
        .select("id")
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
      for (const r of (data ?? []) as any[]) terklaim.add(String(r.id));
    }
    for (const t of pool) {
      if (t.parsedTxId && terklaim.has(t.parsedTxId)) t.claimedByOther = true;
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
      const { data } = await supabase
        .from("cek_inputs")
        .select("gadai_klaim_id")
        .in("gadai_klaim_id", idKlaim.slice(i, i + 500))
        .not("matched_tx_id", "is", null)
        .is("deleted_at", null);
      for (const r of (data ?? []) as any[]) {
        if (r.gadai_klaim_id) sudahTerbukti.add(String(r.gadai_klaim_id));
      }
    }
  }

  // ── Cocokkan ──
  onLangkah?.(`Mencocokkan ${inputs.length} klaim dengan ${pool.length} baris mutasi...`);
  const outletColors = new Map<string, string>(outlets.map((o) => [o.id, o.warna_hex]));
  const rulesById = new Map<string, MatchRulePreset>(rules.map((r) => [r.id, r]));
  const { inputs: hasilInputs, summary } = runMatching(inputs, pool, outletColors, {
    getRulesForInput: (i) => gadaiAwareRules(i, rulesById),
  });

  const unclaimedIni = summary.unclaimed.filter((t) => t.source === "current");
  hasil.unclaimedCount = unclaimedIni.length;
  hasil.unclaimedTotal = unclaimedIni.reduce((s, t) => s + t.kredit, 0);

  // ── P3: jangan memvonis klaim di luar periode ──
  const laporan: { id: string; matched: boolean; matched_by: string | null; ref_issue: string | null; ambiguous: number }[] = [];
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

    // Sudah pernah dibuktikan di sesi sebelumnya (vonisnya yang gagal terkirim).
    if (m?.status !== "matched" && sudahTerbukti.has(i.id)) {
      hasil.sudahTerbuktiSebelumnya++;
      laporan.push({ id: i.id, matched: true, matched_by: "SESI_LAMA", ref_issue: null, ambiguous: 0 });
      continue;
    }

    if (m?.status === "matched") {
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
      continue;
    }

    // Tidak cocok: hanya boleh divonis kalau tanggalnya memang tercakup berkas ini.
    const iso = toDateISO(i.tanggal);
    if (iso < batasBawah) {
      hasil.ditahanDiLuarPeriode++;
      continue;
    }
    // Batas atas memakai jendela MAJU aturan klaim itu sendiri: transfer malam
    // sering baru dibukukan bank keesokan harinya, jadi klaim di ujung periode
    // belum tentu bisa dinilai oleh berkas ini.
    const maju = gadaiAwareRules(i, rulesById).forward_window_days ?? 0;
    if (iso > geserHari(periodEnd, -maju)) {
      hasil.ditahanDiLuarPeriode++;
      continue;
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
  if (laporan.length === 0) {
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
    const inputsBank = hasilInputs.filter((i) => i.bankId === bankId || !i.bankId);
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
    hasil.batal = {
      kode: "GAGAL_SIMPAN_SESI",
      pesan: `Sesi gagal disimpan (${e instanceof Error ? e.message : String(e)}) — vonis TIDAK dikirim supaya baris mutasi tidak bisa dipakai dua kali.`,
    };
    return hasil;
  }

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
    const unclaimedPayload =
      jenis === "kredit"
        ? {
            count: unclaimedIni.length,
            total: hasil.unclaimedTotal,
            rows: unclaimedIni.slice(0, 40).map((t) => ({
              t: toDateISO(t.tanggalDate),
              j: t.waktu || "",
              n: t.kredit,
              p: t.namaPengirim || "",
            })),
          }
        : null;
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
  return hasil;
}
