-- Migration: add deleted_at to cek_sessions and parsed_transactions for soft-delete
-- (privacy "Hapus Data" feature in /history). 30-day purge handled separately.

ALTER TABLE public.cek_sessions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.parsed_transactions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Indexes for fast filtering of active rows
CREATE INDEX IF NOT EXISTS cek_sessions_active_idx
  ON public.cek_sessions(account_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS parsed_transactions_active_idx
  ON public.parsed_transactions(bank_id, tanggal)
  WHERE deleted_at IS NULL;

-- Index for the future 30-day cleanup job
CREATE INDEX IF NOT EXISTS cek_sessions_purge_idx
  ON public.cek_sessions(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS parsed_transactions_purge_idx
  ON public.parsed_transactions(deleted_at)
  WHERE deleted_at IS NOT NULL;
