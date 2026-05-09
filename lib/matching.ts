// Matching algorithm with per-input rules + cross-bank flag.
// Phase 9.1: setiap input punya rules-nya sendiri (dari preset MatchRule).

import type {
  PdfTransaction,
  UserInput,
  MatchResult,
  MatchSummary,
  MatchMode,
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

  const resultInputs: UserInput[] = inputs.map((input) => {
    if (mode === "leftover-only" && input.match?.status !== "no_candidate") {
      return input;
    }

    const rules = getRules(input);
    // Bank filter:
    // - input.bankId kosong/null → "Semua bank" → skip filter
    // - forceCrossBank=true → skip filter (re-run leftover ke semua bank)
    // - else: filter strict
    const skipBankFilter = forceCrossBank || !input.bankId;

    const allCandidates = transactions.filter((tx) => {
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
      const picked = available[0];
      claimed.add(txKey(picked));
      const colorHex = outletColors.get(input.outletId) ?? "#FFEB3B";
      const match: MatchResult = {
        status: "matched",
        txNo: picked.no,
        txDate: picked.tanggalDate,
        colorHex,
        txBankId: picked.bankId,
      };
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
      };
      return { ...input, match };
    }

    const match: MatchResult = { status: "no_candidate" };
    return { ...input, match };
  });

  const matched = resultInputs.filter((i) => i.match?.status === "matched");
  const noCandidate = resultInputs.filter((i) => i.match?.status === "no_candidate");
  const allTaken = resultInputs.filter((i) => i.match?.status === "all_taken");
  const unclaimed = transactions.filter((tx) => !claimed.has(txKey(tx)));

  const summary: MatchSummary = {
    totalInput: resultInputs.length,
    matched: matched.length,
    noCandidate,
    allTaken,
    unclaimed,
  };

  return { inputs: resultInputs, summary };
}
