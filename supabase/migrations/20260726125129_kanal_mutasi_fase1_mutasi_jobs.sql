-- ============================================================
-- KANAL MASUK MUTASI — Fase 1: tabel tugas + bucket berkas
--
-- MASALAH YANG DITUTUP:
--   Rekonsiliasi (Lapis 2) hanya jalan kalau owner sempat membuka laptop,
--   login, upload, cocokkan, kirim — 11 langkah. Akibatnya dalam 25 hari
--   hanya 3 kali upload, dan klaim menumpuk tanpa pernah dinilai.
--
-- RANCANGAN: Telegram jadi KURIR BERKAS saja. Owner share PDF ke chat
--   pribadi bot; server menyimpannya dan membuat satu "tugas" di sini;
--   bot membalas dengan tombol. Yang MEMBACA dan MENULIS mutasi tetap
--   browser owner yang login (RLS + account_id).
--
-- PRINSIP KEAMANAN INTI:
--   Server TIDAK PERNAH menulis ke parsed_transactions. Kalau seluruh
--   gerbang webhook jebol sekalipun, yang didapat penyerang hanyalah
--   sebuah baris tugas yang tidak akan pernah dieksekusi tanpa owner
--   login dan menekan tombol — dan tombolnya menampilkan nama berkas,
--   rekening, serta periode sebelum jalan.
--
-- TIDAK menyentuh tabel/kolom lama mana pun. Murni aditif.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mutasi_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Tebakan rekening saat berkas diterima. NULL = ambigu, owner yang memilih.
  bank_id           uuid REFERENCES public.banks(id) ON DELETE SET NULL,
  sumber            text NOT NULL DEFAULT 'telegram',

  -- Jejak asal pesan Telegram (untuk membalas di utas yang sama).
  tg_chat_id        bigint,
  tg_message_id     bigint,
  tg_file_id        text,

  file_name         text NOT NULL,
  file_size         integer NOT NULL DEFAULT 0,
  -- sha256 isi berkas: kunci anti kirim-ulang berkas yang sama.
  sha256            text NOT NULL,
  storage_path      text NOT NULL,

  -- Token tautan: yang disimpan HANYA sha256-nya, berlaku 24 jam.
  -- Ini BUKAN kredensial login — halaman /proses tetap butuh sesi.
  -- token_dipakai_at adalah JEJAK, bukan kunci: halaman sengaja masih bisa
  -- dibuka ulang (HP terkunci di tengah jalan, layar ter-refresh). Yang
  -- menahan pengiriman ganda adalah dikirim_kredit_at/dikirim_debet_at
  -- di bawah, lewat UPDATE bersyarat yang hanya berhasil sekali.
  token_hash        text NOT NULL,
  token_exp         timestamptz NOT NULL,
  token_dipakai_at  timestamptz,

  status            text NOT NULL DEFAULT 'ANTRI',
  -- Penanda tahap terakhir, supaya job yang mati di tengah bisa dijemput
  -- dan supaya "setengah jadi" tidak terlihat seperti "selesai".
  langkah           text,

  -- Kunci sekali-kirim: mencegah laporan dobel kalau halaman diulang.
  dikirim_kredit_at timestamptz,
  dikirim_debet_at  timestamptz,

  ringkasan         jsonb,
  error_text        text,
  dibuka_at         timestamptz,
  selesai_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mutasi_jobs_status_sah CHECK (status IN (
    'ANTRI','DIBUKA','PARSE_OK','SELESAI','SELESAI_RAGU','GAGAL','KEDALUWARSA'
  )),
  CONSTRAINT mutasi_jobs_sha256_bentuk CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mutasi_jobs_ukuran_wajar CHECK (file_size >= 0 AND file_size <= 20971520)
);

-- Berkas yang sama tidak boleh melahirkan dua tugas.
CREATE UNIQUE INDEX IF NOT EXISTS mutasi_jobs_account_sha
  ON public.mutasi_jobs (account_id, sha256);
CREATE INDEX IF NOT EXISTS mutasi_jobs_antrean
  ON public.mutasi_jobs (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS mutasi_jobs_token
  ON public.mutasi_jobs (token_hash);

-- ============================================================
-- KEAMANAN — ditulis EKSPLISIT, tidak diasumsikan mewarisi.
--
-- Pernah terjadi regresi kritis di repo saudara (aceh-gadai): migrasi yang
-- hanya menulis GRANT tanpa REVOKE membuat 5 fungsi + 1 view bisa diakses
-- peran `anon` — dan kunci anon ada di dalam bundel JS publik. Karena itu
-- di sini REVOKE ditulis lebih dulu, baru GRANT yang seminimal mungkin.
--
-- authenticated hanya boleh MEMBACA tugas miliknya sendiri. SEMUA penulisan
-- (status, langkah, penanda sekali-kirim) lewat service_role di server
-- action yang sudah memverifikasi sesi — supaya klien nakal tidak bisa
-- menandai job "SELESAI" atau memalsukan dikirim_kredit_at.
-- ============================================================

ALTER TABLE public.mutasi_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mutasi_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.mutasi_jobs FROM anon;
REVOKE ALL ON TABLE public.mutasi_jobs FROM authenticated;

GRANT SELECT ON public.mutasi_jobs TO authenticated;

DROP POLICY IF EXISTS "mutasi_jobs_select_own" ON public.mutasi_jobs;
CREATE POLICY "mutasi_jobs_select_own" ON public.mutasi_jobs FOR SELECT
  USING (account_id = public.current_account_id());

COMMENT ON TABLE public.mutasi_jobs IS
  'Tugas pemrosesan mutasi yang masuk lewat Telegram. Server hanya menyimpan berkas dan membuat baris ini; yang mem-parse dan menulis parsed_transactions tetap browser owner yang login.';

-- ============================================================
-- BUCKET BERKAS — privat total. Tidak ada policy untuk anon maupun
-- authenticated, jadi satu-satunya jalan baca adalah signed URL yang
-- dibuat service_role SETELAH sesi diverifikasi.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mutasi-inbox', 'mutasi-inbox', false, 20971520,
  ARRAY['application/pdf','text/html','application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
