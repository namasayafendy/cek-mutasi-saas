-- ============================================================
-- SATU BARIS MUTASI = SATU BUKTI, dijamin DATABASE
--
-- Sampai sekarang aturan itu hanya hidup di kode aplikasi: tiap penulis
-- diharapkan memakai compare-and-set `.is('claimed_by_input_id', null)`.
-- Empat penulis mencatat pasangannya LEBIH DULU lalu mencoba mengunci, dan
-- kalau penguncian gagal tidak ada galat sama sekali — layarnya tetap berkata
-- sukses. Sudah pernah tembus sungguhan (dua klaim satu baris, berselang 10
-- detik). Selama pagarnya cuma di aplikasi, ia kembali terbuka tiap kali ada
-- kode baru yang lupa memeriksa.
--
-- KENAPA BUKAN SEKADAR INDEKS UNIK PADA matched_tx_id:
-- karena itu akan MEMATIKAN Group Claim, fitur yang sengaja memasang satu
-- matched_tx_id yang sama ke banyak input untuk merekonsiliasi N input lawan
-- M baris (app/(app)/history/[id]/group-claim-modal.tsx:183-192). 31 kelompok
-- memakainya. Pagar yang mematikan fitur sah bukan pagar, melainkan kerusakan
-- kedua.
--
-- Jadi dipasang DUA pagar yang sempit dan tepat sasaran.
-- ============================================================

-- ── PAGAR 1: kepemilikan tidak bisa DIPINDAH diam-diam ──
--
-- Melepas (X -> NULL) tetap boleh — itu pembatalan yang sah, dan dipakai
-- rollback penutupan manual di /belum-cocok. Mengambil yang kosong
-- (NULL -> X) tetap boleh. Yang dilarang HANYA merebut: X -> Y. Tanpa ini,
-- satu UPDATE yang lupa menyaring bisa memindahkan uang milik satu bukti ke
-- bukti lain tanpa jejak.
CREATE OR REPLACE FUNCTION public.jaga_pemilik_baris_mutasi()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.claimed_by_input_id IS NOT NULL
     AND NEW.claimed_by_input_id IS NOT NULL
     AND NEW.claimed_by_input_id <> OLD.claimed_by_input_id THEN
    RAISE EXCEPTION
      'Baris mutasi % sudah dipegang bukti %; tidak boleh langsung dipindahkan ke %. Lepaskan dulu (set NULL) kalau memang mau dialihkan.',
      OLD.id, OLD.claimed_by_input_id, NEW.claimed_by_input_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jaga_pemilik_baris_mutasi ON public.parsed_transactions;
CREATE TRIGGER trg_jaga_pemilik_baris_mutasi
  BEFORE UPDATE OF claimed_by_input_id ON public.parsed_transactions
  FOR EACH ROW EXECUTE FUNCTION public.jaga_pemilik_baris_mutasi();

COMMENT ON FUNCTION public.jaga_pemilik_baris_mutasi() IS
  'Melarang kepemilikan baris mutasi berpindah langsung dari satu bukti ke bukti lain (X->Y). Melepas dan mengambil yang kosong tetap boleh. Pagar terakhir terhadap satu uang membuktikan dua transaksi.';

-- ── PAGAR 2: satu baris mutasi menopang paling banyak SATU klaim gadai ──
--
-- Dibatasi pada baris ber-gadai_klaim_id supaya Group Claim (semuanya ketikan
-- tangan, gadai_klaim_id NULL) tidak tersentuh sama sekali. Diperiksa dulu ke
-- data hidup: nol pelanggaran, jadi indeks ini tidak menolak apa pun yang
-- sudah ada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cek_inputs_satu_baris_satu_klaim_gadai
  ON public.cek_inputs (matched_tx_id)
  WHERE matched_tx_id IS NOT NULL
    AND gadai_klaim_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON INDEX public.uq_cek_inputs_satu_baris_satu_klaim_gadai IS
  'Satu baris mutasi hanya boleh menopang satu klaim gadai. Sengaja TIDAK berlaku untuk input ketikan tangan, supaya Group Claim (N input : M baris) tetap hidup.';

-- DIUJI KE DATA HIDUP 3 Agustus 2026, di dalam transaksi yang digagalkan
-- sendiri: merebut X -> Y DITOLAK dengan pesan yang menyebut kedua bukti;
-- melepas lalu mengambil (X -> NULL -> Y) TETAP BERHASIL.
