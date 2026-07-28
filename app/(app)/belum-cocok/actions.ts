"use server";

// ============================================================
// CEKTRANSFER - Resi yang belum ketemu di mutasi (Lapis 2)
// File: app/(app)/belum-cocok/actions.ts
//
// Daftar resi yang SUDAH divonis tidak ada di mutasi rekening, beserta dua
// jalan menyelesaikannya.
//
// KENAPA DAFTARNYA DATANG DARI GADAI, bukan dari sini:
// cektransfer hanya menarik klaim berstatus PENDING. Begitu sebuah klaim
// divonis UNMATCHED, ia tidak pernah ditarik lagi — jadi dari sisi sini ia
// lenyap dari pandangan TEPAT pada saat ia mulai jadi masalah.
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

const LANTAI = "2026-07-22";

async function konfigGadai() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  const db = await createClient();
  const { data } = await db
    .from("account_settings")
    .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  const c = data as any;
  if (!c?.gadai_sync_enabled || !c.gadai_api_url || !c.gadai_api_key) return null;
  return { base: String(c.gadai_api_url).replace(/\/+$/, ""), key: String(c.gadai_api_key), ctx };
}

export interface BarisBelumCocok {
  klaim_id: string;
  no_faktur: string;
  outlet: string;
  tgl: string;
  nominal: number;
  umur: number;
}

export async function ambilBelumCocok(): Promise<
  { ok: true; items: BarisBelumCocok[] } | { ok: false; msg: string }
> {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi Aceh Gadai belum dikonfigurasi." };
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/tunggakan?sejak=${LANTAI}`, {
      headers: { Authorization: `Bearer ${k.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // 404 hampir selalu berarti gadai belum di-promote. Menyebutnya apa
      // adanya menghemat satu jam penelusuran.
      return {
        ok: false,
        msg: res.status === 404
          ? "Endpoint tunggakan belum ada di Aceh Gadai (HTTP 404) — kemungkinan besar belum di-promote."
          : `Tidak bisa menghubungi Aceh Gadai (HTTP ${res.status}).`,
      };
    }
    const j = await res.json();
    if (!j?.ok) return { ok: false, msg: j?.msg ?? "Jawaban tidak dikenali." };
    return { ok: true, items: (j.items ?? []) as BarisBelumCocok[] };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nyatakan sebuah resi SUDAH dicocokkan manual ke baris mutasi.
 *
 * Ini menutup dengan BUKTI — pemilik menunjuk baris mutasi yang mesin
 * lewatkan (nama beda, jam meleset, resi tersensor). Karena itu ia menandai
 * klaimnya cocok di sisi gadai.
 */
export async function cocokkanManual(klaimId: string, catatan: string) {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (catatan.trim().length < 10) {
    return { ok: false, msg: "Catatan wajib diisi minimal 10 huruf — sebutkan baris mutasi mana yang cocok." };
  }
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/manual`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ klaimId, catatan: catatan.trim() }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    return { ok: true, msg: j.msg ?? "Ditandai cocok di Aceh Gadai." };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}
