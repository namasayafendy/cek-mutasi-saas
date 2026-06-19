-- ============================================================
-- 0014: Integrasi Aceh Gadai — tarik klaim transfer (Phase 2-D)
-- Tambah konfigurasi koneksi ke API Aceh Gadai di account_settings.
-- 100% ADDITIVE (ADD COLUMN IF NOT EXISTS). Default OFF = dormant.
-- Tidak menyentuh data/tabel yang ada.
-- ============================================================

ALTER TABLE public.account_settings
  ADD COLUMN IF NOT EXISTS gadai_api_url      text,
  ADD COLUMN IF NOT EXISTS gadai_api_key      text,
  ADD COLUMN IF NOT EXISTS gadai_sync_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.account_settings.gadai_api_url IS 'Base URL API Aceh Gadai utk tarik klaim transfer (integrasi cektransfer.com). NULL = belum dikonfigurasi.';
COMMENT ON COLUMN public.account_settings.gadai_sync_enabled IS 'Toggle sinkronisasi tarik klaim dari Aceh Gadai. false = fitur OFF (dormant).';
