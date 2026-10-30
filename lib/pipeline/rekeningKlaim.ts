// ============================================================
// REKENING PEMILIK KLAIM — klaim gadai dinilai HANYA terhadap rekeningnya
// File: lib/pipeline/rekeningKlaim.ts
//
// LAHIR DARI Tahap 2 "Dua Rekening + Gerbang Token" (Okt 2026). Sampai
// sekarang satu akun = satu rekening BSI, jadi tidak ada yang perlu tahu
// klaim mana milik rekening mana: setiap PDF dinilai terhadap SEMUA klaim
// arahnya. Begitu rekening KELUAR (rekening kirim admin) ikut diunggah:
//   - pass DEBET berkas MASUK menilai transfer keluar yang dibayar dari
//     KELUAR → semuanya "tidak ditemukan" (vonis terminal di gadai), atau
//     cocok palsu ke debet MASUK yang kebetulan sama tanggal + nominal;
//   - pass KREDIT berkas KELUAR menilai pembayaran nasabah yang masuk ke
//     MASUK → RECHECK palsu, atau cocok palsu ke kredit isi ulang KELUAR,
//     lalu baris MASUK yang sebenarnya tampak "uang tanpa pemilik".
// Hasilnya bergantung pada PDF mana yang kebetulan diproses lebih dulu.
//
// ATURAN (rencana §9; keputusan Fendy 12–13 Okt):
//   - KREDIT → rekening MASUK.
//   - DEBET  → rekening KELUAR bila tanggal transfernya ≥ tanggal mulai
//              rekening KELUAR (banks.mulai_tgl); sebelum itu → MASUK
//              ("permintaan sebelum garis: klaim DEBET ke MASUK").
//   - Rekening EKSPLISIT dari gadai (medan `rekening_nomor`, belum dikirim
//     gadai versi sekarang) mengalahkan aturan bawaan — untuk pengecualian
//     yang sudah direncanakan: Setor Cash Pusat ke KELUAR, retur, PINDAH,
//     bagi hasil, debet MASUK oleh Fendy. Nomor yang tidak terdaftar →
//     klaim itu tidak dimiliki rekening mana pun → TIDAK dinilai (tetap
//     menunggu di gadai), bukan ditebak.
//
// KAPAN AKTIF: hanya bila akun punya rekening berperan KELUAR. Tanpa itu
// (semua akun hari ini) aturan MATI dan semua jalur bekerja PERSIS seperti
// sebelum Tahap 2. Rekening KELUAR yang konfigurasinya belum lengkap (tanpa
// tanggal mulai, tanpa pasangan MASUK, ganda, nonaktif) → `masalah`: pass
// ditolak (gagal-tertutup) — menilai tanpa aturan justru melahirkan vonis
// palsu di atas.
//
// Fungsi murni: tanpa database (scripts/uji-rekening-klaim.mts).
// ============================================================

export type BankPeran = {
  id: string;
  peran?: "MASUK" | "KELUAR" | null;
  mulai_tgl?: string | null;
  nomor_rekening?: string | null;
  is_active?: boolean | null;
};

export type AturanRekening =
  | { aktif: false; masalah: string | null }
  | {
      aktif: true;
      masalah: null;
      masukId: string;
      keluarId: string;
      /** YYYY-MM-DD — DEBET bertanggal ≥ ini milik KELUAR. */
      keluarMulai: string;
      /** nomor rekening (digit) → id bank, untuk rekening eksplisit. */
      nomorKeId: Record<string, string>;
    };

/** Penanda "tidak dimiliki rekening mana pun" di medan bankId klaim. Bukan
 *  uuid, jadi tidak pernah sama dengan bank_id baris mutasi mana pun. */
export const TANPA_REKENING = "-";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const digit = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export function susunAturanRekening(banks: BankPeran[]): AturanRekening {
  const keluar = banks.filter((b) => b.peran === "KELUAR");
  if (keluar.length === 0) return { aktif: false, masalah: null };
  if (keluar.length > 1) return { aktif: false, masalah: "Lebih dari satu rekening berperan KELUAR." };
  const k = keluar[0];
  if (k.is_active === false) return { aktif: false, masalah: "Rekening KELUAR sedang nonaktif." };
  const masuk = banks.filter((b) => b.peran === "MASUK" && b.is_active !== false);
  if (masuk.length === 0) {
    return { aktif: false, masalah: "Rekening KELUAR terdaftar, tapi belum ada rekening aktif berperan MASUK." };
  }
  if (masuk.length > 1) return { aktif: false, masalah: "Lebih dari satu rekening aktif berperan MASUK." };
  const mulai = String(k.mulai_tgl ?? "").slice(0, 10);
  if (!ISO.test(mulai)) return { aktif: false, masalah: "Rekening KELUAR belum punya tanggal mulai." };
  // Nomor WAJIB di kedua rekening: tanpa nomor gerbang rekening tidak
  // memeriksa PDF, jadi tidak bisa dipastikan berkas mana milik rekening mana
  // (mutasi_jobs.bank_id hanya ditulis bila nomornya terbukti).
  if (!digit(k.nomor_rekening)) return { aktif: false, masalah: "Rekening KELUAR belum punya nomor rekening." };
  if (!digit(masuk[0].nomor_rekening)) return { aktif: false, masalah: "Rekening MASUK belum punya nomor rekening." };
  const nomorKeId: Record<string, string> = {};
  for (const b of banks) {
    const n = digit(b.nomor_rekening);
    if (n && b.is_active !== false) nomorKeId[n] = b.id;
  }
  return { aktif: true, masalah: null, masukId: masuk[0].id, keluarId: k.id, keluarMulai: mulai, nomorKeId };
}

/**
 * id rekening pemilik sebuah klaim, atau TANPA_REKENING bila tidak bisa
 * dipastikan (tanggal DEBET tak terbaca / nomor eksplisit tak terdaftar).
 * null = aturan tidak aktif → pemanggil memakai perilaku lama.
 */
export function pemilikKlaim(
  aturan: AturanRekening,
  arah: "kredit" | "debet",
  tanggalISO: string | null | undefined,
  rekeningEksplisit?: string | null,
): string | null {
  if (!aturan.aktif) return null;
  const eks = digit(rekeningEksplisit);
  if (eks) return aturan.nomorKeId[eks] ?? TANPA_REKENING;
  if (arah === "kredit") return aturan.masukId;
  const tgl = String(tanggalISO ?? "").slice(0, 10);
  if (!ISO.test(tgl)) return TANPA_REKENING;
  return tgl >= aturan.keluarMulai ? aturan.keluarId : aturan.masukId;
}
