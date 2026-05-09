-- Phase 8.6: indexes untuk scale 1000-10000 user

-- /history Mutasi tab + carry-over query: account_id + bank_id + tanggal range
CREATE INDEX IF NOT EXISTS parsed_transactions_account_bank_tanggal_idx
  ON public.parsed_transactions(account_id, bank_id, tanggal);

-- /history Belum Match tab + carry-over: WHERE claimed_by_input_id IS NULL
-- partial index lebih efficient karena kebanyakan tx udah claimed
CREATE INDEX IF NOT EXISTS parsed_transactions_unclaimed_idx
  ON public.parsed_transactions(account_id, tanggal DESC)
  WHERE claimed_by_input_id IS NULL;

-- /rekap query: account_id + tanggal_input range
CREATE INDEX IF NOT EXISTS cek_inputs_account_tanggal_idx
  ON public.cek_inputs(account_id, tanggal_input);

-- /rekap filter status: account_id + match_status
CREATE INDEX IF NOT EXISTS cek_inputs_account_status_idx
  ON public.cek_inputs(account_id, match_status);

-- /activity filter by action: account_id + action + created_at
CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON public.audit_logs(account_id, action, created_at DESC);

-- Lookup matched_tx_id (FK): cek_inputs.matched_tx_id
CREATE INDEX IF NOT EXISTS cek_inputs_matched_tx_idx
  ON public.cek_inputs(matched_tx_id)
  WHERE matched_tx_id IS NOT NULL;
