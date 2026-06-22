-- Pelacak titik terakhir rekonsiliasi per bank (fitur B: deteksi bolong via saldo).
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS recon_last_saldo numeric,
  ADD COLUMN IF NOT EXISTS recon_last_date  date;

COMMENT ON COLUMN public.banks.recon_last_saldo IS
  'Saldo akhir (closing balance) dari mutasi terakhir yang diupload utk bank ini. Dipakai deteksi bolong: saldo awal upload berikutnya harus menyambung.';
COMMENT ON COLUMN public.banks.recon_last_date IS
  'Tanggal transaksi terakhir dari mutasi terakhir yang diupload utk bank ini.';
