-- ============================================================
-- 0013: Add from_history flag to cek_sessions
-- ============================================================
--
-- Background: introducing a new flow "Cek Mutasi Kredit/Debet History"
-- where users do bulk-claim against already-uploaded parsed_transactions
-- (no fresh PDF). Sessions saved from that flow are flagged with
-- from_history = true so /history page can render them differently.
-- ============================================================

ALTER TABLE public.cek_sessions
  ADD COLUMN IF NOT EXISTS from_history boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cek_sessions.from_history IS
  'TRUE when this session was created via Cek Mutasi History flow (no fresh PDF upload, matched against existing parsed_transactions). FALSE for normal cek flow.';
