// ============================================================
// CEKTRANSFER - Patokan "sampai tanggal berapa mutasi sudah ada di sini"
// File: lib/coverage/tercakup.ts
//
// SATU sumber untuk `tercakup` + `tercakup_at` yang dikirim ke gadai
// (/api/transfer-klaim/tunggakan dan POST /api/lembar/lapis2). Dipakai menu
// /belum-cocok, laporan Lapis 2 (tandaiSelesai), dan skrip kirim ulang.
//
// KENAPA SATU SUMBER (5 Okt 2026): dulu laporan Lapis 2 memakai tanggal akhir
// BERKAS-nya sendiri, sedangkan /belum-cocok memakai MAX seluruh cakupan.
// Keduanya berselisih tepat pada kejadian yang biasa — berkas yang diunggah
// ulang dengan rentang identik (upsert cakupan mengabaikan duplikat), berkas
// rentang LEBIH TUA, berkas tak utuh yang memang tidak dicatat — dan yang
// berselisih adalah isi daftar "menggantung": pesan Telegram, halaman web, dan
// layar /belum-cocok menyebut angka yang berbeda untuk saat yang sama.
//
// `tercakup`    = tgl_akhir terbesar yang PERNAH tercatat (unggahan sah saja —
//                 berkas tak utuh / rantai putus ditolak catatCakupan).
// `tercakup_at` = jam baris itu dicatat. Di antara baris bertanggal akhir sama
//                 yang TERBARU dipakai: ia yang paling banyak melihat hari itu.
//
// Diambil MAX seluruh rekening — tepat untuk satu rekening. TAHAP 2 (Okt
// 2026): akun dengan rekening KELUAR memakai MIN dari (MAX MASUK, MAX KELUAR):
// gadai memakai SATU patokan untuk kedua arah, dan hanya tanggal sampai batas
// itu yang sudah pasti tercakup di KEDUA rekening. Salah satu belum punya
// cakupan / konfigurasi rekening belum lengkap → null (aturan lama gadai).
//
// TIDAK PERNAH MELEMPAR. null = tidak diketahui → pemanggil TIDAK mengirim
// `tercakup` (perilaku lama gadai: hanya UNMATCHED + DUPLIKAT — aman, bukan
// diam).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { susunAturanRekening } from "@/lib/pipeline/rekeningKlaim";

export interface Tercakup {
  /** YYYY-MM-DD */
  tercakup: string;
  /** ISO; null kalau kolomnya tak terbaca (gadai lalu memakai aturan lama). */
  tercakupAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- klien admin & klien sesi sama-sama tanpa tipe Database
export async function bacaTercakupAkun(db: SupabaseClient<any, any, any>, accountId: string): Promise<Tercakup | null> {
  try {
    const { data: banks, error: errBank } = await db
      .from("banks")
      .select("id, peran, mulai_tgl, nomor_rekening, is_active")
      .eq("account_id", accountId);
    if (errBank) throw new Error(errBank.message);
    const aturan = susunAturanRekening((banks ?? []) as any[]);
    if (aturan.masalah) return null;
    if (!aturan.aktif) return await terakhir(db, accountId, null);
    const [m, k] = await Promise.all([
      terakhir(db, accountId, aturan.masukId),
      terakhir(db, accountId, aturan.keluarId),
    ]);
    if (!m || !k) return null;
    return m.tercakup <= k.tercakup ? m : k;
  } catch (e) {
    console.error("[tercakup] gagal membaca cakupan mutasi:", e);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lihat atas
async function terakhir(db: SupabaseClient<any, any, any>, accountId: string, bankId: string | null): Promise<Tercakup | null> {
  let q = db.from("mutasi_coverage").select("tgl_akhir, created_at").eq("account_id", accountId);
  if (bankId) q = q.eq("bank_id", bankId);
  const { data, error } = await q
    .order("tgl_akhir", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const baris = data as { tgl_akhir?: string | null; created_at?: string | null } | null;
  const t = String(baris?.tgl_akhir ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const at = String(baris?.created_at ?? "");
  return { tercakup: t, tercakupAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null };
}

/** Ekor query `/tunggakan` — kosong kalau patokannya tidak diketahui. */
export function paramTercakup(t: Tercakup | null): string {
  if (!t) return "";
  return `&tercakup=${t.tercakup}` + (t.tercakupAt ? `&tercakup_at=${encodeURIComponent(t.tercakupAt)}` : "");
}
