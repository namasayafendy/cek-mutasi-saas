// Matching algorithm: cocokkan input user dengan transaksi PDF.
// Aturan:
// - Nominal harus sama persis (rupiah, integer)
// - Tanggal di PDF <= tanggal input user
// - Tanggal di PDF >= tanggal input user - 3 hari (max lookback)
// - Transaksi yg sudah ke-claim tidak bisa dipakai 2x
// - Pilih kandidat dengan tanggal terdekat (terbaru tapi tidak melewati input)
// - Tie-break: no terkecil (urutan kronologis di hari yang sama)

import type {
  PdfTransaction,
  UserInput,
  MatchResult,
  MatchSummary,
} from "@/lib/types";
import { diffDays } from "@/lib/format";

const MAX_LOOKBACK_DAYS = 3;

export function runMatching(
  inputs: UserInput[],
  transactions: PdfTransaction[],
  outletColors: Map<string, string>,
): { inputs: UserInput[]; summary: MatchSummary } {
  const claimed = new Set<string>();
  const txKey = (t: PdfTransaction) => `${t.page}-${t.no}`;

  const resultInputs: UserInput[] = inputs.map((input) => {
    const allCandidates = transactions.filter((tx) => {
      if (tx.kredit !== input.nominal) return false;
      const days = diffDays(input.tanggal, tx.tanggalDate);
      return days >= 0 && days <= MAX_LOOKBACK_DAYS;
    });
    const available = allCandidates.filter((tx) => !claimed.has(txKey(tx)));

    if (available.length > 0) {
      available.sort((a, b) => {
        const dDiff = b.tanggalDate.getTime() - a.tanggalDate.getTime();
        if (dDiff !== 0) return dDiff;
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
      };
      return { ...input, match };
    }

    if (allCandidates.length > 0) {
      // Ada kandidat tapi semua sudah dipakai input lain.
      // Kumpulkan tanggal-tanggal kandidat (urut, unik) supaya user tau kapan-nya.
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
