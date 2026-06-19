"use server";

// ============================================================
// Phase 2-D: Tarik klaim transfer dari Aceh Gadai
// Server action: ambil klaim PENDING dari API Aceh Gadai (read-only),
// petakan ke UserInput[] siap pre-fill di Step 2 "Input Pembayaran".
//
// Konfigurasi (url + key + toggle) per-account di account_settings.
// Dormant: kalau gadai_sync_enabled=false → tolak.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/lib/supabase/context";

export interface GadaiPullInput {
  id: string; // id klaim dari Aceh Gadai (utk referensi/dedup)
  tanggalISO: string; // YYYY-MM-DD (tanggal transfer)
  outletId: string; // outlet cek-mutasi hasil mapping ("" kalau tak ketemu)
  bankId: string; // bank default ("" = cross-bank)
  matchRuleId: string;
  nominal: number;
}

export type GadaiPullResult =
  | { ok: true; inputs: GadaiPullInput[]; unmappedOutlets: string[]; total: number }
  | { ok: false; error: string };

// Normalisasi nama outlet: trim + rapikan spasi + UPPERCASE (case-insensitive match)
function normName(s: string): string {
  return String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export async function pullGadaiClaims(): Promise<GadaiPullResult> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid. Silakan login ulang." };

  const supabase = await createClient();
  const accountId = ctx.account.id;

  // 1) Konfigurasi koneksi Aceh Gadai
  const { data: cfg } = await supabase
    .from("account_settings")
    .select("gadai_api_url, gadai_api_key, gadai_sync_enabled")
    .eq("account_id", accountId)
    .maybeSingle();
  const c = cfg as
    | { gadai_api_url: string | null; gadai_api_key: string | null; gadai_sync_enabled: boolean }
    | null;
  if (!c?.gadai_sync_enabled || !c.gadai_api_url || !c.gadai_api_key) {
    return { ok: false, error: "Integrasi Aceh Gadai belum diaktifkan." };
  }

  // 2) Tarik klaim PENDING dari Aceh Gadai (read-only)
  let claims: any[] = [];
  try {
    const base = c.gadai_api_url.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/transfer-klaim?days=60`, {
      method: "GET",
      headers: { Authorization: `Bearer ${c.gadai_api_key}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Gagal hubungi Aceh Gadai (HTTP ${res.status}).` };
    const json = await res.json();
    if (!json?.ok) return { ok: false, error: json?.msg || "Aceh Gadai menolak permintaan." };
    claims = Array.isArray(json.claims) ? json.claims : [];
  } catch (err) {
    return { ok: false, error: "Gagal terhubung ke Aceh Gadai: " + String(err) };
  }

  // 3) Peta outlet (by nama, case-insensitive + abaikan spasi)
  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, nama")
    .eq("account_id", accountId);
  const outletMap = new Map<string, string>();
  (outlets ?? []).forEach((o: any) => outletMap.set(normName(o.nama), o.id));

  // 4) Bank default (1 rekening → id-nya; >1 → "" cross-bank)
  const { data: banks } = await supabase
    .from("banks")
    .select("id")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .order("urutan");
  const defaultBankId = banks && banks.length === 1 ? (banks[0] as any).id : "";

  // 5) Match rule default (kredit/both)
  const { data: rules } = await supabase
    .from("match_rules")
    .select("id, is_default")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .or("jenis.eq.kredit,jenis.eq.both")
    .order("is_default", { ascending: false });
  const defaultRuleId = rules && rules.length > 0 ? (rules[0] as any).id : "";

  // 6) Map klaim → input
  const unmapped = new Set<string>();
  const inputs: GadaiPullInput[] = [];
  for (const cl of claims) {
    const outId = outletMap.get(normName(cl.outlet)) ?? "";
    if (!outId && cl.outlet) unmapped.add(String(cl.outlet));
    const tgl = String(cl.tgl_transfer || cl.tgl_transaksi || "").slice(0, 10);
    inputs.push({
      id: String(cl.id),
      tanggalISO: tgl,
      outletId: outId,
      bankId: defaultBankId,
      matchRuleId: defaultRuleId,
      nominal: Number(cl.nominal || 0),
    });
  }

  return { ok: true, inputs, unmappedOutlets: [...unmapped], total: inputs.length };
}

// ============================================================
// Phase 2-E: Kirim hasil match balik ke Aceh Gadai
// Setelah Pak "Cocokkan", kirim status match tiap klaim (matched/tidak)
// ke Aceh Gadai -> update status klaim + trigger alert pagi.
// ============================================================

export type GadaiPushResult =
  | { ok: true; updated: number; unmatched: number; alertSent: boolean }
  | { ok: false; error: string };

export async function pushGadaiResults(
  results: { id: string; matched: boolean }[],
): Promise<GadaiPushResult> {
  const ctx = await getAccountContext();
  if (!ctx) return { ok: false, error: "Sesi tidak valid." };

  const supabase = await createClient();
  const { data: cfg } = await supabase
    .from("account_settings")
    .select("gadai_api_url, gadai_api_key, gadai_sync_enabled")
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  const c = cfg as
    | { gadai_api_url: string | null; gadai_api_key: string | null; gadai_sync_enabled: boolean }
    | null;
  if (!c?.gadai_sync_enabled || !c.gadai_api_url || !c.gadai_api_key) {
    return { ok: false, error: "Integrasi Aceh Gadai belum diaktifkan." };
  }

  const clean = (results || [])
    .filter((r) => r && r.id)
    .map((r) => ({ id: String(r.id), matched: !!r.matched }));
  if (clean.length === 0) return { ok: false, error: "Tidak ada hasil untuk dikirim." };

  try {
    const base = c.gadai_api_url.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/transfer-klaim/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.gadai_api_key}` },
      body: JSON.stringify({ results: clean }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Aceh Gadai HTTP ${res.status}` };
    const j = await res.json();
    if (!j?.ok) return { ok: false, error: j?.msg || "ditolak Aceh Gadai" };
    return {
      ok: true,
      updated: Number(j.updated || 0),
      unmatched: Number(j.unmatched || 0),
      alertSent: !!j.alertSent,
    };
  } catch (e) {
    return { ok: false, error: "Gagal kirim ke Aceh Gadai: " + String(e) };
  }
}
