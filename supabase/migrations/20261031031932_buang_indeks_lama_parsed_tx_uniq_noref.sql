-- Tahap 1 rilis (31 Okt 2026, ±2 menit sesudah Vercel 8a8a78a READY):
-- indeks lama (account_id, bank_id, no_ref) diganti
-- parsed_tx_uniq_noref_arah_nominal (sudah terpasang 29 Okt). Selama indeks
-- lama ada, baris ber-ref sama tapi arah/nominal beda (retur BI-FAST, biaya
-- 2.500) ditolak.
--
-- ROLLBACK: membuat ulang indeks lama bisa GAGAL bila sudah ada baris ber-ref
-- sama dengan arah/nominal beda (justru baris yang sekarang boleh tersimpan).
drop index if exists public.parsed_tx_uniq_noref;
