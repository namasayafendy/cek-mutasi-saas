"use server";

// ============================================================
// CATATAN UNGGAHAN + "Batalkan unggahan" (Tahap 1, Okt 2026)
// File: lib/unggahan/actions.ts
//
// Setiap PDF yang lolos gerbang rekening dicatat di mutasi_unggahan, dan
// setiap baris BARU membawa unggah_id-nya. Dengan itu sebuah unggahan yang
// salah bisa ditarik kembali tanpa menyentuh baris dari unggahan lain.
//
// Pembatalannya sendiri dikerjakan fungsi database batalkan_unggahan dalam
// SATU transaksi (lihat migrasi 20261029134255). Di sini hanya: memastikan
// pemanggilnya PEMILIK akun, lalu memanggilnya dengan account_id eksplisit.
// "use server" TIDAK memberi otorisasi — service_role mem-bypass RLS, jadi
// setiap query di sini wajib menyertakan account_id sendiri.
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RingkasUnggahan {
  id: string;
  createdAt: string;
  sumber: "telegram" | "manual";
  fileName: string | null;
  periodeAwal: string | null;
  periodeAkhir: string | null;
  barisTerbaca: number;
  barisBaru: number;
  dibatalkanAt: string | null;
  catatanBatal: { baris_dihapus?: number; cakupan_dihapus?: number; recon?: string } | null;
  /** null = masih diproses (atau prosesnya mati di tengah). */
  selesaiAt: string | null;
  /** berjalan = belum selesai & < 15 menit; terhenti = belum selesai & lebih tua. */
  status: "selesai" | "berjalan" | "terhenti";
  /** Jumlah baris di database yang MILIK unggahan ini sekarang — dihitung,
   *  bukan dibaca dari catatan. Hanya diisi untuk unggahan yang boleh dibatalkan. */
  barisMilik: number | null;
  /** true hanya untuk unggahan TERAKHIR yang belum dibatalkan dan sudah
   *  selesai diproses (atau basi > 15 menit), dan hanya bagi pemilik. */
  bolehBatal: boolean;
}

/** Sama dengan batas di fungsi database batalkan_unggahan / pemicu sisip. */
const BASI_MS = 15 * 60 * 1000;

const UUID = /^[0-9a-f-]{36}$/i;

export async function daftarUnggahan(
  bankId: string,
  batas = 8,
): Promise<{ ok: true; daftar: RingkasUnggahan[]; pemilik: boolean } | { ok: false; error: string }> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid." };
  if (!UUID.test(String(bankId))) return { ok: false, error: "Bank tidak sah." };
  const pemilik = ctx.member.role === "owner";

  const db = createAdminClient();
  const { data, error } = await db
    .from("mutasi_unggahan")
    .select(
      "id, created_at, sumber, file_name, periode_awal, periode_akhir, baris_terbaca, baris_baru, dibatalkan_at, catatan_batal, selesai_at",
    )
    .eq("account_id", ctx.account.id)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.max(1, Math.min(50, Math.trunc(batas) || 8)));
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as any[];
  // Unggahan terakhir yang BELUM dibatalkan bisa berada di luar jendela di
  // atas (mis. sesudah membatalkan 8 unggahan berturut-turut) — dicari sendiri
  // supaya tombol batal tidak hilang sementara fungsi database masih menerimanya.
  if (!rows.some((r) => !r.dibatalkan_at)) {
    const { data: aktif, error: errAktif } = await db
      .from("mutasi_unggahan")
      .select(
        "id, created_at, sumber, file_name, periode_awal, periode_akhir, baris_terbaca, baris_baru, dibatalkan_at, catatan_batal, selesai_at",
      )
      .eq("account_id", ctx.account.id)
      .eq("bank_id", bankId)
      .is("dibatalkan_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (errAktif) return { ok: false, error: errAktif.message };
    if (aktif?.[0]) rows.push(aktif[0]);
  }
  const terakhir = rows.find((r) => !r.dibatalkan_at) ?? null;
  const sudahBisa = (r: any) => !!r.selesai_at || Date.now() - Date.parse(String(r.created_at)) > BASI_MS;
  let barisMilik: number | null = null;
  if (pemilik && terakhir && sudahBisa(terakhir)) {
    // Fungsi batal menghapus SEMUA baris ber-unggah_id ini — angkanya harus
    // dihitung dari sana, bukan dari baris_baru di catatan.
    const { count, error: errHitung } = await db
      .from("parsed_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.account.id)
      .eq("bank_id", bankId)
      .eq("unggah_id", terakhir.id);
    if (errHitung) return { ok: false, error: errHitung.message };
    barisMilik = count ?? 0;
  }
  return {
    ok: true,
    pemilik,
    daftar: rows.map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at),
      sumber: r.sumber === "telegram" ? "telegram" : "manual",
      fileName: r.file_name ?? null,
      periodeAwal: r.periode_awal ?? null,
      periodeAkhir: r.periode_akhir ?? null,
      barisTerbaca: Number(r.baris_terbaca ?? 0),
      barisBaru: Number(r.baris_baru ?? 0),
      dibatalkanAt: r.dibatalkan_at ?? null,
      catatanBatal: r.catatan_batal ?? null,
      selesaiAt: r.selesai_at ?? null,
      status: r.selesai_at ? "selesai" : sudahBisa(r) ? "terhenti" : "berjalan",
      barisMilik: r.id === terakhir?.id ? barisMilik : null,
      bolehBatal: pemilik && !r.dibatalkan_at && r.id === terakhir?.id && sudahBisa(r),
    })),
  };
}

export async function batalkanUnggahan(
  unggahId: string,
): Promise<
  | { ok: true; barisDihapus: number; cakupanDihapus: number; recon: string }
  | { ok: false; error: string; terpakai?: number }
> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid. Silakan login ulang." };
  if (ctx.member.role !== "owner") return { ok: false, error: "Hanya pemilik yang boleh membatalkan unggahan." };
  if (!UUID.test(String(unggahId))) return { ok: false, error: "Unggahan tidak sah." };

  const db = createAdminClient();
  const { data, error } = await db.rpc("batalkan_unggahan", {
    p_unggah_id: unggahId,
    p_account_id: ctx.account.id,
    p_oleh: ctx.user.id,
  });
  if (error) return { ok: false, error: error.message };
  const h = (data ?? {}) as any;
  if (!h.ok) {
    return {
      ok: false,
      error: String(h.error ?? "Gagal membatalkan unggahan."),
      terpakai: h.terpakai != null ? Number(h.terpakai) : undefined,
    };
  }
  return {
    ok: true,
    barisDihapus: Number(h.baris_dihapus ?? 0),
    cakupanDihapus: Number(h.cakupan_dihapus ?? 0),
    recon: String(h.recon ?? "tidak_diubah"),
  };
}
