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
};

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

  function buildMatched(input: UserInput, picked: PdfTransaction, matchedBy: "REF" | "NAMA_JAM" | "NOMINAL"): MatchResult {
    claimed.add(txKey(picked));
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

  // ── PASS 1: REF (global, sebelum semua yang lain) ──
  inputs.forEach((input, idx) => {
    if (!shouldProcess(input)) return;
    const refUp = String(input.refFt ?? "").trim().toUpperCase();
    if (!refUp) return;

    const hits = transactions.filter((tx) =>
      String(tx.noRef ?? "").toUpperCase().startsWith(refUp),
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
    const datesSet = new Set<string>();
    for (const c of nominalHits) datesSet.add(c.tanggal);
    resolved[idx] = {
      status: "all_taken",
      conflictCount: nominalHits.length,
      conflictDates: Array.from(datesSet),
      refIssue: "REF_SUDAH_DIKLAIM",
    };
  });

  // ── PASS 2: NAMA PENGIRIM + JAM (global) ──
  inputs.forEach((input, idx) => {
    if (!shouldProcess(input) || resolved[idx]) return;
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

  // ── PASS 3: NOMINAL + jendela rules (perilaku lama; jalur input manual) ──
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
    for (const i of inputs) {
      if (!shouldProcess(i)) continue;
      const k = `${toDateISO(i.tanggal)}|${i.nominal}`;
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
    }
    for (const [k, n] of hitung) if (n > 1) rebutan.add(k);
  }

  const resultInputs: UserInput[] = inputs.map((input, idx) => {
    if (!shouldProcess(input)) return input;
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
      const bedaHari = diffDays(input.tanggal, available[0].tanggalDate) !== 0;
      const sedangDirebutkan = rebutan.has(`${toDateISO(input.tanggal)}|${input.nominal}`);
      // Tolak menebak lintas hari kalau (a) kandidatnya masih lebih dari satu,
      // ATAU (b) nominal ini sedang diperebutkan beberapa input di tanggal yang
      // sama — (b) yang benar-benar menutup insiden KRUKUH.
      if (bedaHari && (available.length > 1 || sedangDirebutkan)) {
        const datesSet = new Set<string>();
        for (const c of available) datesSet.add(c.tanggal);
        return {
          ...input,
          match: {
            status: "all_taken",
            conflictCount: available.length,
            conflictDates: Array.from(datesSet).sort(),
            refIssue: pendingRefIssue[idx] ?? undefined,
          },
        };
      }

      const match = buildMatched(input, available[0], "NOMINAL");
      if (pendingRefIssue[idx]) match.refIssue = pendingRefIssue[idx];
      // Fase D: >1 kandidat tersedia = tebakan ambigu — tandai supaya kelihatan
      // di panel & laporan (kandidat lain bisa saja milik nasabah lain).
      if (available.length > 1 && match.status === "matched") {
        match.ambiguous = available.length;
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

  const matched = resultInputs.filter((i) => i.match?.status === "matched");
  const noCandidate = resultInputs.filter((i) => i.match?.status === "no_candidate");
  const allTaken = resultInputs.filter((i) => i.match?.status === "all_taken");
  const unclaimed = transactions.filter(
    (tx) => !tx.claimedByOther && !claimed.has(txKey(tx)),
  );

  const summary: MatchSummary = {
    totalInput: resultInputs.length,
    matched: matched.length,
    noCandidate,
    allTaken,
    unclaimed,
  };

  return { inputs: resultInputs, summary };
}
