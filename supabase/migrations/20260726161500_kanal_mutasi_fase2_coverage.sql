-- ============================================================
-- KANAL MASUK MUTASI — Fase 2: cakupan mutasi (deteksi bolong)
--
-- MASALAH YANG DITUTUP:
--   Sampai sekarang tidak ada satu pun yang bisa menjawab "apakah SEMUA
--   tanggal sudah pernah diperiksa". Laporan bisa berbunyi bersih padahal
--   ada rentang tanggal yang tidak pernah sekali pun masuk mutasi. Itu
--   kesenyapan yang paling menipu: tidak ada temuan, karena tidak ada data.
--
-- YANG DIJAGA ADALAH CAKUPAN, BUKAN KEBERADAAN BARIS.
--   Memeriksa "tanggal mana yang tidak punya baris di parsed_transactions"
--   TIDAK sah: hari libur yang memang nihil transaksi akan tertuduh palsu.
--   Karena itu tiap berkas menyimpan RENTANG-nya sendiri di sini.
--
-- KENAPA SALDO IKUT DISIMPAN — dan ini bagian terpentingnya:
--   Parser menurunkan firstDate/lastDate dari tanggal BARIS, bukan dari
--   periode tercetak di header (lib/parsers/bsi-bsinet.ts:283-284). Akibatnya
--   hari tanpa transaksi di UJUNG sebuah berkas tidak ikut tercatat, dan
--   kalender akan menudingnya sebagai bolong padahal tidak ada yang hilang.
--   Yang menengahi adalah UANG: kalau saldo_akhir berkas sebelumnya sama
--   persis dengan saldo_awal berkas berikutnya, celah di antara keduanya
--   TERBUKTI kosong dan haram dilaporkan sebagai masalah. Kalender bisa
--   bohong; rantai saldo tidak.
--
-- Murni aditif. Tidak menyentuh tabel lama mana pun.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mutasi_coverage (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  bank_id      uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  tgl_awal     date NOT NULL,
  tgl_akhir    date NOT NULL,

  -- Bahan uji "celah terbukti kosong". NULL kalau parser bank ini tidak
  -- memberi meta saldo (hanya BSI BSINet yang mengisinya hari ini).
  saldo_awal   numeric,
  saldo_akhir  numeric,

  -- NULL = total tercetak tak terbaca. BUKAN berarti "tidak lengkap".
  complete     boolean,
  chain_breaks integer NOT NULL DEFAULT 0,
  connected    boolean,

  job_id       uuid REFERENCES public.mutasi_jobs(id) ON DELETE SET NULL,
  -- 'telegram' atau 'manual' — supaya jelas jalur mana yang menyumbang cakupan.
  sumber       text NOT NULL DEFAULT 'telegram',
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mutasi_coverage_rentang_masuk_akal CHECK (tgl_awal <= tgl_akhir)
);

-- Satu berkas yang sama tidak perlu tercatat dua kali (alur manual memanggil
-- ini sekali per berkas, tapi pengulangan tetap mungkin).
CREATE UNIQUE INDEX IF NOT EXISTS mutasi_coverage_unik
  ON public.mutasi_coverage (account_id, bank_id, tgl_awal, tgl_akhir);
CREATE INDEX IF NOT EXISTS mutasi_coverage_urut
  ON public.mutasi_coverage (account_id, bank_id, tgl_awal);

-- ============================================================
-- KEAMANAN — REVOKE ditulis LEBIH DULU, baru GRANT seminimal mungkin.
-- Peran anon memegang kunci yang ada di dalam bundel JS publik; migrasi yang
-- hanya menulis GRANT pernah membuat data keuangan terbuka di repo saudara.
-- ============================================================

ALTER TABLE public.mutasi_coverage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mutasi_coverage FROM PUBLIC;
REVOKE ALL ON TABLE public.mutasi_coverage FROM anon;
REVOKE ALL ON TABLE public.mutasi_coverage FROM authenticated;
REVOKE ALL ON SEQUENCE public.mutasi_coverage_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.mutasi_coverage_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.mutasi_coverage_id_seq FROM authenticated;

GRANT SELECT ON public.mutasi_coverage TO authenticated;

DROP POLICY IF EXISTS "mutasi_coverage_select_own" ON public.mutasi_coverage;
CREATE POLICY "mutasi_coverage_select_own" ON public.mutasi_coverage FOR SELECT
  TO authenticated
  USING (account_id = public.current_account_id());

COMMENT ON TABLE public.mutasi_coverage IS
  'Rentang tanggal yang benar-benar tercakup tiap berkas mutasi. Dipakai mencari tanggal yang tidak pernah diperiksa. Celah yang saldo batasnya bertemu = terbukti kosong, bukan bolong.';
