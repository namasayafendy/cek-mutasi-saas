-- Phase 4.3: manual claim with reason — cek_inputs bisa berdiri sendiri tanpa session
-- (untuk klaim manual transaksi unclaimed dari /history page)

ALTER TABLE public.cek_inputs ALTER COLUMN session_id DROP NOT NULL;

-- Index supaya filter by account + manual claim cepat
CREATE INDEX IF NOT EXISTS cek_inputs_manual_claim_idx
  ON public.cek_inputs(account_id, manual_claimed_at DESC)
  WHERE manual_claim_reason IS NOT NULL;
