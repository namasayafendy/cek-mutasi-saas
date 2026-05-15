// Save cek session: cek_session row + cek_inputs rows + update parsed_transactions.claimed_by_input_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UserInput,
  MatchSummary,
  PdfTransaction,
  Jenis,
} from "@/lib/types";
import { toDateISO } from "@/lib/format";

export type SaveSessionInput = {
  accountId: string;
  userId: string;
  bankId: string;
  jenis: Jenis;
  inputs: UserInput[];
  summary: MatchSummary;
  /** Phase 4.3: matching pool (current PDF + carry-over) untuk lookup parsedTxId saat link claim */
  matchingPool?: PdfTransaction[];
  /** Total nominal di PDF mutasi yang baru di-upload (untuk cek_session.total_nominal_input is misleading; we use tx values) */
  pdfTotalAmount: number;
  /** Periode mutasi (dari first/last tx date di PDF) */
  periodStart: Date | null;
  periodEnd: Date | null;
  carryOverUsed?: boolean;
  multiBankUsed?: boolean;
};

export type SavedSession = {
  sessionId: string;
  carryoverClaimed: number;
};

export async function saveSession(
  supabase: SupabaseClient,
  args: SaveSessionInput,
): Promise<SavedSession> {
  const totalNominalInput = args.inputs.reduce((s, i) => s + i.nominal, 0);
  const totalNominalMatched = args.inputs
    .filter((i) => i.match?.status === "matched")
    .reduce((s, i) => s + i.nominal, 0);

  // 1. Insert cek_session
  const { data: sessionData, error: sessionErr } = await supabase
    .from("cek_sessions")
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      jenis: args.jenis,
      period_mutasi_start: args.periodStart ? toDateISO(args.periodStart) : null,
      period_mutasi_end: args.periodEnd ? toDateISO(args.periodEnd) : null,
      total_input: args.inputs.length,
      total_matched: args.summary.matched,
      total_unmatched: args.summary.noCandidate.length,
      total_conflict: args.summary.allTaken.length,
      total_nominal_input: totalNominalInput,
      total_nominal_matched: totalNominalMatched,
      carry_over_used: args.carryOverUsed ?? false,
      multi_bank_used: args.multiBankUsed ?? false,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (sessionErr || !sessionData) {
    throw new Error(`Gagal save session: ${sessionErr?.message ?? "unknown"}`);
  }
  const sessionId = sessionData.id;

  // 2. Insert cek_inputs (batch)
  // Phase 4.3 + 1E.2: lookup parsedTxId pakai key (bankId+no+date+nominal)
  // supaya multi-bank tidak collide. Bank dari MatchResult.txBankId (Phase 1E.2).
  const poolByKey = new Map<string, PdfTransaction>();
  if (args.matchingPool) {
    for (const tx of args.matchingPool) {
      const k = `${tx.bankId ?? "_"}|${tx.no}|${tx.tanggalDate.getTime()}|${tx.kredit}`;
      poolByKey.set(k, tx);
    }
  }

  function findMatchedTxId(input: UserInput): string | null {
    if (input.match?.status !== "matched") return null;
    // Phase 1E.2: pakai txBankId dari match kalau ada (cross-bank), fallback ke input.bankId
    const bankId = input.match.txBankId ?? input.bankId;
    const key = `${bankId ?? "_"}|${input.match.txNo}|${input.match.txDate.getTime()}|${input.nominal}`;
    const tx = poolByKey.get(key);
    return tx?.parsedTxId ?? null;
  }

  const inputRows = args.inputs.map((i) => ({
    session_id: sessionId,
    account_id: args.accountId,
    tanggal_input: toDateISO(i.tanggal),
    outlet_id: i.outletId || null,
    // Phase 9.1: bank_id dari input (kalau "" = "Semua bank" → simpan null).
    // Kalau matched cross-bank, simpan bank tujuan match (txBankId) supaya
    // /history Mutasi tab benar.
    bank_id:
      i.match?.status === "matched" && i.match.txBankId
        ? i.match.txBankId
        : i.bankId || args.bankId,
    nominal: i.nominal,
    jenis: args.jenis,
    match_status: i.match?.status ?? null,
    matched_tx_id: findMatchedTxId(i),
    match_rule_id: i.matchRuleId || null,
    conflict_count:
      i.match?.status === "all_taken" ? i.match.conflictCount : null,
    conflict_dates:
      i.match?.status === "all_taken" ? i.match.conflictDates : null,
  }));

  let carryoverClaimed = 0;

  if (inputRows.length > 0) {
    const { data: insertedInputs, error: inputsErr } = await supabase
      .from("cek_inputs")
      .insert(inputRows)
      .select("id, matched_tx_id");

    if (inputsErr) {
      // Don't fail entire save — session sudah terbuat
      console.error("Gagal save cek_inputs:", inputsErr.message);
    } else if (insertedInputs && insertedInputs.length > 0) {
      // Phase 4.3 + bugfix 2026-05-15:
      // Untuk setiap matched cek_input, set claimed_by_input_id pada parsed_transactions
      // yang bersangkutan. Dulu kita pakai for-loop sequential dengan satu UPDATE per row
      // — untuk session 276 match itu butuh ~93 detik dan kalau user navigate sebelum
      // selesai, sebagian transaksi tidak ter-claim → di /history Mutasi tab cuma sebagian
      // yang ter-highlight. Sekarang pakai RPC bulk (1 round-trip, 1 transaction atomic).
      const claimUpdates = insertedInputs
        .filter((row) => row.matched_tx_id)
        .map((row) => ({
          tx_id: row.matched_tx_id as string,
          input_id: row.id as string,
        }));

      if (claimUpdates.length > 0) {
        const { data: claimedCount, error: rpcErr } = await supabase.rpc(
          "claim_parsed_transactions",
          { claims: claimUpdates },
        );
        if (rpcErr) {
          // Fallback (mis. RPC belum di-deploy): jalankan loop lama supaya tetap robust.
          console.error("claim_parsed_transactions RPC failed, falling back to loop:", rpcErr.message);
          for (const u of claimUpdates) {
            const { error: updErr } = await supabase
              .from("parsed_transactions")
              .update({
                claimed_by_input_id: u.input_id,
                claimed_at: new Date().toISOString(),
              })
              .eq("id", u.tx_id)
              .is("claimed_by_input_id", null);
            if (!updErr) carryoverClaimed += 1;
          }
        } else {
          carryoverClaimed = typeof claimedCount === "number" ? claimedCount : claimUpdates.length;
        }
      }
    }
  }

  // Phase 6: tulis audit log untuk session save (untuk activity log staff)
  await supabase.from("audit_logs").insert({
    account_id: args.accountId,
    user_id: args.userId,
    action: "session.created",
    target_type: "cek_session",
    target_id: sessionId,
    metadata: {
      jenis: args.jenis,
      bank_id: args.bankId,
      total_input: args.inputs.length,
      total_matched: args.summary.matched,
      total_nominal_matched: totalNominalMatched,
      carry_over_used: args.carryOverUsed ?? false,
      carryover_claimed: carryoverClaimed,
    },
  });

  return { sessionId, carryoverClaimed };
}
