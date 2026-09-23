-- ============================================================
-- KUNCI KIRIM DIPISAH DARI TANDA "SUDAH TERKIRIM", DAN BISA KADALUARSA
--
-- Kejadian 22 September 2026: berkas mutasi 21 Sep diproses, 39 hasil uang
-- masuk (Rp 36.623.000) dicocokkan dengan benar, lalu sinyal pemilik putus
-- tepat saat hasilnya dikirim ke Aceh Gadai. Hasilnya tidak pernah sampai, dan
-- 39 klaim itu menggantung di Lapis 1 selama dua hari padahal uangnya sudah
-- terbukti mendarat di rekening.
--
-- Sebabnya bukan timeout melainkan KUNCI YANG TERTINGGAL. `kunciKirim()`
-- menstempel `dikirim_<arah>_at` SEBELUM mengirim, dan pelepasnya berjalan di
-- browser yang sama. Kalau browsernya mati di tengah, pelepas itu tidak pernah
-- jalan; kuncinya tinggal terpasang selamanya. Percobaan berikutnya membaca
-- stempel itu sebagai "sudah pernah dikirim" lalu menyerah, padahal belum
-- pernah benar-benar terkirim. Kode di jalankanPass.ts sudah memperingatkan
-- keadaan ini kata per kata jauh sebelum ia terjadi:
--
--   "Kunci yang diambil lalu ditinggalkan karena satu lemparan di tengah
--    membuat berkas itu tidak akan pernah bisa dikirim lagi — dan tidak ada
--    layar mana pun untuk membukanya kembali tanpa SQL."
--
-- Satu kolom dipakai untuk DUA arti yang berbeda: "saya mulai mengirim" dan
-- "sudah terkirim". Migrasi ini memisahkannya.
--
--   kunci_<arah>_at    diambil SEBELUM kirim, dilepas saat gagal ATAU saat
--                      pengiriman dikonfirmasi. Boleh direbut kalau sudah basi
--                      (5 menit, lihat KUNCI_BASI_MENIT di actions.ts).
--   dikirim_<arah>_at  dipasang HANYA sesudah Aceh Gadai mengonfirmasi. Inilah
--                      satu-satunya yang berhak berkata "sudah pernah dikirim".
--
-- Dengan begitu sambungan yang putus berbiaya beberapa menit, bukan selamanya.
--
-- Baris LAMA tidak perlu disentuh: `dikirim_*_at` yang sudah terisi memang
-- berarti "sudah terkirim" pada data yang ada, dan kolom kunci yang baru
-- bernilai NULL yang artinya "tidak sedang dikirim". Keduanya benar apa adanya.
-- ============================================================

alter table public.mutasi_jobs
  add column if not exists kunci_kredit_at timestamptz,
  add column if not exists kunci_debet_at  timestamptz;

comment on column public.mutasi_jobs.kunci_kredit_at is
  'Kunci sementara saat hasil KREDIT sedang dikirim ke Aceh Gadai. Diisi sebelum kirim, dikosongkan saat gagal atau saat terkonfirmasi. Kunci lebih tua dari 5 menit dianggap basi dan boleh direbut.';
comment on column public.mutasi_jobs.kunci_debet_at is
  'Kunci sementara saat hasil DEBET sedang dikirim ke Aceh Gadai. Lihat kunci_kredit_at.';
comment on column public.mutasi_jobs.dikirim_kredit_at is
  'HANYA diisi sesudah Aceh Gadai mengonfirmasi penerimaan hasil KREDIT. Satu-satunya dasar yang sah untuk menolak pengiriman ulang.';
comment on column public.mutasi_jobs.dikirim_debet_at is
  'HANYA diisi sesudah Aceh Gadai mengonfirmasi penerimaan hasil DEBET. Lihat dikirim_kredit_at.';
