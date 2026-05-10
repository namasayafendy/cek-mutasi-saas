-- Critical bug fix: ON CONFLICT in supabase-js upsert (without explicit WHERE)
-- did NOT match the partial unique indexes that had WHERE clauses. As a
-- result, every persistTransactions() call from real PDF uploads silently
-- failed — parsed_transactions never got rows inserted from user uploads,
-- and the /history mutasi tab always appeared empty.
--
-- Fix: drop the partial unique indexes, recreate as full unique indexes.
-- Default NULLS DISTINCT semantics keep things sane:
--   - rows with no_ref=NULL: not constrained by no_ref index, fingerprint
--     index handles dedup instead.
--   - rows with fingerprint=NULL: not constrained by fingerprint index;
--     no_ref index handles dedup instead.
--   - rows with non-NULL value: enforced unique within (account, bank).

DROP INDEX IF EXISTS public.parsed_tx_uniq_noref;
CREATE UNIQUE INDEX parsed_tx_uniq_noref
  ON public.parsed_transactions (account_id, bank_id, no_ref);

DROP INDEX IF EXISTS public.parsed_tx_uniq_fingerprint;
CREATE UNIQUE INDEX parsed_tx_uniq_fingerprint
  ON public.parsed_transactions (account_id, bank_id, fingerprint);
