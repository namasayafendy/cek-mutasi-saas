// Save cek session: cek_session row + cek_inputs rows + update parsed_transactions.claimed_by_input_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UserInput,
  MatchSummary,
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
  const inputRows = args.inputs.map((i) => ({
    session_id: sessionId,
    account_id: args.accountId,
    tanggal_input: toDateISO(i.tanggal),
    outlet_id: i.outletId || null,
    bank_id: args.bankId,
    nominal: i.nominal,
    jenis: args.jenis,
    match_status: i.match?.status ?? null,
    matched_tx_id: null, // akan di-link di round 2 (need lookup parsed_tx by no+date)
    conflict_count:
      i.match?.status === "all_taken" ? i.match.conflictCount : null,
    conflict_dates:
      i.match?.status === "all_taken" ? i.match.conflictDates : null,
  }));

  if (inputRows.length > 0) {
    const { error: inputsErr } = await supabase.from("cek_inputs").insert(inputRows);
    if (inputsErr) {
      // Don't fail entire save — session sudah terbuat
      console.error("Gagal save cek_inputs:", inputsErr.message);
    }
  }

  return { sessionId };
}
