// Matching algorithm with configurable rules from account_settings.

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

export function runMatching(
  inputs: UserInput[],
  transactions: PdfTransaction[],
  outletColors: Map<string, string>,
  rules: MatchRules = DEFAULT_RULES,
  options?: { crossBank?: boolean },
): { inputs: UserInput[]; summary: MatchSummary } {
  const claimed = new Set<string>();
  // Phase 1E.2: tx key include bankId untuk hindari collision antar bank yang
  // kebetulan punya page+no sama
  const txKey = (t: PdfTransaction) => `${t.bankId ?? "_"}-${t.page}-${t.no}`;
  const crossBank = options?.crossBank ?? false;

  const resultInputs: UserInput[] = inputs.map((input) => {
    // Filter candidates: nominal match (with tolerance) + within date window
    // + bank match (kecuali crossBank=true)
    const allCandidates = transactions.filter((tx) => {
      if (!crossBank && input.bankId && tx.bankId && input.bankId !== tx.bankId) {
        return false;
      }
      if (!nominalMatches(input.nominal, tx.kredit, rules)) return false;
      const days = diffDays(input.tanggal, tx.tanggalDate);
      // days >= 0 means tx is on or before input date (lookback)
      // days < 0 means tx is after input date (forward window)
      if (days >= 0 && days <= rules.lookback_days) return true;
      if (days < 0 && Math.abs(days) <= rules.forward_window_days) return true;
      return false;
    });

    const available = allCandidates.filter((tx) => !claimed.has(txKey(tx)));

    if (available.length > 0) {
      // Pilih: tanggal terdekat dengan input. Jika tie, tanggal yg sama atau sebelum (positive days) > setelah.
      // Then by no (smallest = earlier in same day).
      available.sort((a, b) => {
        const da = diffDays(input.tanggal, a.tanggalDate); // 0 = same, +n = a is earlier, -n = a is later
        const db = diffDays(input.tanggal, b.tanggalDate);
        // Prefer absolute closer; when |a|==|b|, prefer earlier (positive days) over later (negative days)
        const aAbs = Math.abs(da);
        const bAbs = Math.abs(db);
        if (aAbs !== bAbs) return aAbs - bAbs;
        if (da !== db) return db - da; // prefer larger days (more positive = earlier)
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
