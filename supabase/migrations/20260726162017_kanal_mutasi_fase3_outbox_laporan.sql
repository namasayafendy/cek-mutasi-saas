-- ============================================================
-- KANAL MASUK MUTASI — Fase 3: antrean laporan Telegram
--
-- MASALAH YANG DITUTUP:
--   Laporan dikirim langsung ke Telegram. Kalau panggilan itu gagal —
--   jaringan, rate limit, Telegram sedang gangguan — laporannya HILANG
--   PERMANEN dan tidak ada yang tahu. Ini bukan kekhawatiran teoretis:
--   12 Juli lalu di aplikasi gadai, 10 alert RAGU lenyap persis begini.
--
-- POLANYA: CATAT DULU, BARU KIRIM. Kalau kirimnya gagal, barisnya tetap
--   PENDING dan cron berikutnya mencobanya lagi. Sesudah 6 percobaan ia
--   ditandai GAGAL — supaya kegagalan yang menetap tetap kelihatan, bukan
--   diam-diam dicoba selamanya.
--
-- Murni aditif.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mutasi_laporan_outbox (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  chat_id     text NOT NULL,
  teks        text NOT NULL,
  balas_ke    bigint,
  status      text NOT NULL DEFAULT 'PENDING',
  percobaan   integer NOT NULL DEFAULT 0,
  error_text  text,
  job_id      uuid REFERENCES public.mutasi_jobs(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  terkirim_at timestamptz,
  CONSTRAINT mutasi_outbox_status_sah CHECK (status IN ('PENDING','TERKIRIM','GAGAL'))
);

CREATE INDEX IF NOT EXISTS mutasi_outbox_antre
  ON public.mutasi_laporan_outbox (status, created_at)
  WHERE status = 'PENDING';

ALTER TABLE public.mutasi_laporan_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mutasi_laporan_outbox FROM PUBLIC;
REVOKE ALL ON TABLE public.mutasi_laporan_outbox FROM anon;
REVOKE ALL ON TABLE public.mutasi_laporan_outbox FROM authenticated;
REVOKE ALL ON SEQUENCE public.mutasi_laporan_outbox_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.mutasi_laporan_outbox_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.mutasi_laporan_outbox_id_seq FROM authenticated;

-- SENGAJA tanpa GRANT apa pun ke authenticated: isi antrean ini adalah teks
-- laporan yang akan dikirim ke chat pribadi pemilik. Tidak ada satu pun layar
-- yang perlu membacanya, jadi jangan dibuka sedikit pun.

COMMENT ON TABLE public.mutasi_laporan_outbox IS
  'Antrean laporan Telegram: dicatat dulu baru dikirim, supaya kegagalan kirim tidak menghilangkan laporan.';
