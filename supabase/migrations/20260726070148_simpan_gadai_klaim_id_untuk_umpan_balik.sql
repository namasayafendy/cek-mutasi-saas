-- ============================================================
-- CEKTRANSFER - Simpan id klaim Aceh Gadai di cek_inputs
--
-- ADDITIVE, 1 kolom. Tidak mengubah perilaku apa pun yang sudah jalan.
--
-- MASALAH: hasil "Cocokkan manual" TIDAK PERNAH kembali ke aplikasi gadai,
--   sehingga di sana klaimnya beku UNMATCHED selamanya dan laporan rekonsiliasi
--   terus menampilkan selisih yang sebenarnya sudah owner bereskan.
--   Akarnya sederhana: id klaim gadai dibawa saat menarik data (GadaiPullInput.id)
--   tapi TIDAK PERNAH DISIMPAN — ia hidup di browser lalu hilang begitu halaman
--   ditutup. Tanpa id itu, mustahil memberi tahu gadai baris mana yang beres.
--
-- Dua database terpisah, jadi tidak ada foreign key — ini rujukan longgar.
-- ============================================================

ALTER TABLE public.cek_inputs
  ADD COLUMN IF NOT EXISTS gadai_klaim_id text;

CREATE INDEX IF NOT EXISTS idx_cek_inputs_gadai_klaim
  ON public.cek_inputs (gadai_klaim_id)
  WHERE gadai_klaim_id IS NOT NULL;

COMMENT ON COLUMN public.cek_inputs.gadai_klaim_id IS
  'id transfer_klaim di aplikasi Aceh Gadai (rujukan longgar lintas project). Dipakai mengirim balik hasil cocok-manual supaya statusnya di sana ikut beres.';
