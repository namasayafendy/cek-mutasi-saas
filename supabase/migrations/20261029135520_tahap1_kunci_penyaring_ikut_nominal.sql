-- TAHAP 1 (lanjutan): penyaring baris kembar ikut NOMINAL.
-- Diterapkan lewat MCP apply_migration 29 Okt 2026 (versi 20261029135520).
--
-- BSI kadang memberi transfer dan biaya admin 2.500-nya nomor referensi yang
-- SAMA, dua-duanya debet (21 Okt 2026: debet Rp 555.415 tidak pernah sampai ke
-- database). Kunci (no_ref, arah) tetap membuang baris kedua.
-- Indeks baru lebih halus dari indeks lama parsed_tx_uniq_noref, jadi kode
-- yang sedang tayang (ON CONFLICT (account_id, bank_id, no_ref)) tidak
-- terdampak: setiap bentrokan di indeks baru pasti juga bentrok di arbiternya.
create unique index if not exists parsed_tx_uniq_noref_arah_nominal
  on public.parsed_transactions (account_id, bank_id, no_ref, arah, nominal_debet, nominal_kredit);

-- Indeks (no_ref, arah) dari migrasi sebelumnya belum pernah dipakai kode
-- tayang dan akan menghalangi kode baru — dibuang sekarang.
drop index if exists public.parsed_tx_uniq_noref_arah;
