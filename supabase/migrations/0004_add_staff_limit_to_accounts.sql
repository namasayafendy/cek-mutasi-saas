-- Phase 8.5: limit jumlah staff per akun (default 3, bisa di-override super-admin)

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS staff_limit INT NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.accounts.staff_limit IS 'Max jumlah staff (selain owner) yang bisa di-invite. Default 3, super-admin bisa override per akun.';
