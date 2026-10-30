"use server";

// ============================================================
// JANGKAR SALDO REKENING KIRIM → Aceh Gadai (Tahap 3 "Dua Rekening", Okt 2026)
// File: lib/rekeningKirim/actions.ts
//
// Sesudah PDF mutasi rekening berperan KELUAR (rekening kirim BSI 1999881919)
// diproses DAN nomornya terbukti oleh gerbang rekening, titik saldo
// terakhirnya dikirim ke gadai (POST /api/rekening-kirim/jangkar). Gadai
// menampilkannya di akun admin pusat & owner — mode bayangan, tidak memblok.
//
// Semua angka DIBACA ULANG dari database (banks.recon_last_* = saldo penutup
// PDF terbaru, jam baris terakhir di tanggal itu) — bukan dari peramban.
// Gagal mengirim TIDAK menggagalkan unggahan: dikembalikan sebagai {ok:false}
// supaya pemanggil bisa menyebutnya, dan gadai hanya menyimpan yang lebih baru.
// "use server" TIDAK memberi otorisasi — sesi diperiksa di sini, dan setiap
// query menyertakan account_id sendiri (klien admin mem-bypass RLS).
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f-]{36}$/i;

export async function kirimJangkarKeluar(
  bankId: string,
  unggahId: string | null,
): Promise<{ ok: boolean; lewat?: boolean; msg?: string }> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, msg: "Sesi tidak valid." };
  if (!UUID.test(String(bankId))) return { ok: false, msg: "Bank tidak sah." };
  const db = createAdminClient();

  const { data: bank, error: errBank } = await db
    .from("banks")
    .select("id, peran, nomor_rekening, recon_last_saldo, recon_last_date")
    .eq("id", bankId)
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  if (errBank) return { ok: false, msg: errBank.message };
  // Hanya rekening KELUAR — rekening lain tidak pernah dikirim.
  if (!bank || (bank as any).peran !== "KELUAR") return { ok: true, lewat: true };
  const saldo = (bank as any).recon_last_saldo;
  const tgl = String((bank as any).recon_last_date ?? "").slice(0, 10);
  if (saldo == null || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, msg: "Titik saldo rekening KELUAR belum ada." };

  const { data: cfg } = await db
    .from("account_settings")
    .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  const c = cfg as { gadai_sync_enabled?: boolean; gadai_api_url?: string | null; gadai_api_key?: string | null } | null;
  if (!c?.gadai_sync_enabled || !c.gadai_api_url || !c.gadai_api_key) return { ok: true, lewat: true };

  const { data: akhir } = await db
    .from("parsed_transactions")
    .select("jam")
    .eq("account_id", ctx.account.id)
    .eq("bank_id", bankId)
    .eq("tanggal", tgl)
    .is("deleted_at", null)
    .order("jam", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const jamMentah = String((akhir as any)?.jam ?? "").trim();
  const jam = /^([01]\d|2[0-3])[.:][0-5]\d$/.test(jamMentah) ? jamMentah.replace(":", ".") : null;

  try {
    const res = await fetch(`${String(c.gadai_api_url).replace(/\/+$/, "")}/api/rekening-kirim/jangkar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.gadai_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        nomor_rekening: String((bank as any).nomor_rekening ?? ""),
        saldo: Number(saldo),
        tgl,
        jam,
        job_ref: unggahId && UUID.test(unggahId) ? unggahId : `bank:${bankId}:${tgl}:${jam ?? ""}`,
      }),
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, msg: "Aceh Gadai belum punya penerima saldo rekening kirim (belum di-promote)." };
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) return { ok: false, msg: String(j?.msg ?? `HTTP ${res.status}`) };
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}
