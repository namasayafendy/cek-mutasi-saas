"use server";

// ============================================================
// KANAL MASUK MUTASI — Pencatat cakupan (Fase 2)
// File: lib/coverage/actions.ts
//
// Dipanggil dari DUA jalur: alur Telegram (auto-runner) dan alur manual
// (upload-step). Dua-duanya wajib, dan itu bukan kelebihan kerja: kalau
// hanya jalur Telegram yang mencatat, berkas yang pernah diunggah manual
// akan tampak seperti tanggal yang tak pernah diperiksa — alarm palsu yang
// berulang, dan alarm palsu yang berulang membuat laporan berhenti dibaca.
//
// "use server" TIDAK memberi otorisasi. Tiap fungsi memverifikasi sesi
// sendiri, dan tiap query service_role menyertakan account_id eksplisit —
// service_role mem-bypass RLS, jadi lupa satu baris berarti kebocoran
// lintas-akun.
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitungCakupan, type BarisCakupan, type HasilCakupan } from "@/lib/coverage/celah";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface CatatCakupanInput {
  bankId: string;
  tglAwal: string;
  tglAkhir: string;
  saldoAwal?: number | null;
  saldoAkhir?: number | null;
  complete?: boolean | null;
  chainBreaks?: number;
  connected?: boolean | null;
  jobId?: string | null;
  sumber?: "telegram" | "manual";
}

function angkaAtauNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function catatCakupan(input: CatatCakupanInput): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid." };

  const bankId = String(input?.bankId ?? "");
  const tglAwal = String(input?.tglAwal ?? "");
  const tglAkhir = String(input?.tglAkhir ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(bankId)) return { ok: false, error: "Bank tidak sah." };
  if (!ISO.test(tglAwal) || !ISO.test(tglAkhir)) return { ok: false, error: "Tanggal tidak sah." };
  if (tglAwal > tglAkhir) return { ok: false, error: "Rentang terbalik." };

  const db = createAdminClient();

  // Bank WAJIB milik akun pemanggil. Tanpa cek ini, siapa pun yang login bisa
  // menyuntikkan cakupan palsu ke rekening akun lain — dan cakupan palsu
  // membuat tanggal yang belum diperiksa terlihat sudah diperiksa.
  const { data: bank } = await db
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  if (!bank) return { ok: false, error: "Bank tidak ditemukan di akun ini." };

  const { error } = await db.from("mutasi_coverage").upsert(
    {
      account_id: ctx.account.id,
      bank_id: bankId,
      tgl_awal: tglAwal,
      tgl_akhir: tglAkhir,
      saldo_awal: angkaAtauNull(input.saldoAwal),
      saldo_akhir: angkaAtauNull(input.saldoAkhir),
      complete: typeof input.complete === "boolean" ? input.complete : null,
      chain_breaks: Math.max(0, Math.trunc(Number(input.chainBreaks ?? 0)) || 0),
      connected: typeof input.connected === "boolean" ? input.connected : null,
      job_id: input.jobId && /^[0-9a-f-]{36}$/i.test(input.jobId) ? input.jobId : null,
      sumber: input.sumber === "manual" ? "manual" : "telegram",
    },
    { onConflict: "account_id,bank_id,tgl_awal,tgl_akhir", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[cakupan] gagal mencatat:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Baca cakupan satu rekening untuk N hari terakhir, lalu hitung celahnya. */
export async function bacaCakupan(
  bankId: string,
  hariKeBelakang = 60,
): Promise<{ ok: true; hasil: HasilCakupan } | { ok: false; error: string }> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid." };
  if (!/^[0-9a-f-]{36}$/i.test(String(bankId))) return { ok: false, error: "Bank tidak sah." };

  const db = createAdminClient();
  const batasBawah = new Date(Date.now() - hariKeBelakang * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await db
    .from("mutasi_coverage")
    .select("tgl_awal, tgl_akhir, saldo_awal, saldo_akhir")
    .eq("account_id", ctx.account.id)
    .eq("bank_id", bankId)
    .gte("tgl_akhir", batasBawah)
    .order("tgl_awal", { ascending: true })
    .limit(500);
  if (error) return { ok: false, error: error.message };

  return { ok: true, hasil: hitungCakupan((data ?? []) as BarisCakupan[]) };
}
