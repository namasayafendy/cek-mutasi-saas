-- Fase B overhaul rekonsiliasi: label keyakinan match + penanda masalah ref per input.
-- (Sudah diapply via Supabase MCP 2026-07-13; versi file = schema_migrations.version.)
ALTER TABLE cek_inputs
  ADD COLUMN IF NOT EXISTS matched_by text,
  ADD COLUMN IF NOT EXISTS ref_issue text;

COMMENT ON COLUMN cek_inputs.matched_by IS 'Cara input ter-match: REF (token FT resi vs no_ref, terkuat) / NAMA_JAM (nama pengirim resi + jam ±5mnt) / NOMINAL (tebakan nominal+jendela, terlemah). NULL utk input lama / tidak matched.';
COMMENT ON COLUMN cek_inputs.ref_issue IS 'REF_NOMINAL_BEDA = ref ketemu tapi nominal beda (resi diedit / salah baca AI); REF_SUDAH_DIKLAIM = ref menunjuk kredit yang sudah dipakai input lain.';
