-- Phase 9.4: cek_inputs claim category (customer/bunga/admin/lain) + soft delete

ALTER TABLE public.cek_inputs
  ADD COLUMN IF NOT EXISTS claim_category text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.cek_inputs
  ADD CONSTRAINT valid_claim_category
  CHECK (claim_category IS NULL OR claim_category IN ('customer', 'bunga', 'admin', 'lain'));

CREATE INDEX IF NOT EXISTS cek_inputs_active_idx
  ON public.cek_inputs(account_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.cek_inputs.claim_category IS 'Kategori claim: customer (default), bunga, admin, lain.';
COMMENT ON COLUMN public.cek_inputs.deleted_at IS 'Soft delete untuk input yang owner tandai abaikan.';
