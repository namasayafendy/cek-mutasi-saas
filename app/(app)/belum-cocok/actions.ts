"use server";

// ============================================================
// CEKTRANSFER - Resi yang belum ketemu di mutasi (Lapis 2)
// File: app/(app)/belum-cocok/actions.ts
//
// Daftar resi yang SUDAH divonis tidak ada di mutasi rekening, beserta tiga
// hal yang bisa dilakukan padanya.
//
// KENAPA DAFTARNYA DATANG DARI GADAI, bukan dari sini:
// cektransfer hanya menarik klaim berstatus PENDING. Begitu sebuah klaim
// divonis UNMATCHED, ia tidak pernah ditarik lagi — jadi dari sisi sini ia
// lenyap dari pandangan TEPAT pada saat ia mulai jadi masalah.
//
// KENAPA ADA PENCARI BARIS CALON:
// sebab paling sering sebuah klaim gadai tidak ketemu BUKAN karena uangnya
// tidak ada, melainkan karena baris mutasinya sudah diklaim lebih dulu oleh
// input yang diketik tangan di menu /check. Dua pembukuan memperebutkan kolam
// yang sama, dan yang kalah selalu klaim gadai karena ia datang belakangan.
// Tanpa pencari ini, pemilik melihat "tidak ditemukan" padahal di layar
// riwayat barisnya jelas-jelas ada dan bertanda cocok — persis kebingungan
// yang melahirkan halaman ini (SJB-1-0053 dan SBR-4-0197, 28 Juli 2026).
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";

/** Keputusan pemilik 28 Juli 2026: apa pun sebelum tanggal ini sudah beres. */
const LANTAI = "2026-07-22";

/** Jendela pencarian baris calon, dalam hari, ke dua arah dari tanggal klaim.
 *  Cukup lebar untuk menangkap transaksi yang dicatat besoknya (kasus nyata:
 *  slip 24 Juli 22:09 tercatat sebagai transaksi 25 Juli), cukup sempit supaya
 *  daftarnya tetap bisa dibaca. */
const JENDELA_HARI = 4;

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
  return { base: String(c.gadai_api_url).replace(/\/+$/, ""), key: String(c.gadai_api_key), ctx, db };
}

export interface BarisBelumCocok {
  klaim_id: string;
  no_faktur: string;
  outlet: string;
  tgl: string;
  nominal: number;
  umur: number;
  arah?: string;
  jenis?: string;
}

export interface KandidatMutasi {
  id: string;
  tgl: string;
  jam: string;
  nominal: number;
  pihak: string;
  no_ref: string;
  /** null = masih bebas. Kalau terisi, baris ini sudah dipegang sesuatu. */
  dipegang: null | {
    /** true = klaim gadai lain; false = input ketikan tangan di menu /check. */
    dariGadai: boolean;
    tanggalInput: string;
    nominalInput: number;
    caraCocok: string;
  };
}

export async function ambilBelumCocok(): Promise<
  { ok: true; items: BarisBelumCocok[]; salahArah: number } | { ok: false; msg: string }
> {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi Aceh Gadai belum dikonfigurasi." };
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/tunggakan?sejak=${LANTAI}`, {
      headers: { Authorization: `Bearer ${k.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
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
    return {
      ok: true,
      items: (j.items ?? []) as BarisBelumCocok[],
      salahArah: Number(j.salahArah ?? 0),
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cari baris mutasi yang MUNGKIN milik klaim ini, beserta siapa pemegangnya.
 *
 * Nominal sengaja TIDAK dipaksa sama persis: selisih biaya admin (mis. resi
 * 776.500 sedangkan yang mendarat 774.000) justru salah satu sebab paling
 * sering klaim tidak ketemu otomatis. Toleransinya sempit — cukup untuk biaya
 * bank, tidak cukup untuk menyamakan dua transaksi yang berbeda.
 */
export async function cariKandidat(
  tgl: string,
  nominal: number,
  arah: string,
): Promise<{ ok: true; items: KandidatMutasi[] } | { ok: false; msg: string }> {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, msg: "Tanggal tidak dikenali." };

  const geser = (n: number) => {
    const d = new Date(`${tgl}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const kolom = String(arah).toUpperCase() === "DEBET" ? "nominal_debet" : "nominal_kredit";
  const TOLERANSI = 50_000; // sama dengan batas biaya bank di sisi gadai

  try {
    const { data, error } = await k.db
      .from("parsed_transactions")
      .select(`id, tanggal, jam, ${kolom}, nama_pengirim, nama_penerima, no_ref, claimed_by_input_id`)
      .eq("account_id", k.ctx.account.id)
      .gte("tanggal", geser(-JENDELA_HARI))
      .lte("tanggal", geser(JENDELA_HARI))
      .gte(kolom, Math.max(1, nominal - TOLERANSI))
      .lte(kolom, nominal + TOLERANSI)
      .order("tanggal", { ascending: true })
      .limit(40);
    if (error) return { ok: false, msg: error.message };

    const rows = (data ?? []) as any[];
    const idPemegang = rows.map((r) => r.claimed_by_input_id).filter(Boolean);
    const peta = new Map<string, any>();
    if (idPemegang.length > 0) {
      const { data: inp } = await k.db
        .from("cek_inputs")
        .select("id, tanggal_input, nominal, matched_by, gadai_klaim_id, manual_claim_reason")
        .in("id", idPemegang);
      (inp ?? []).forEach((x: any) => peta.set(String(x.id), x));
    }

    return {
      ok: true,
      items: rows.map((r) => {
        const p = r.claimed_by_input_id ? peta.get(String(r.claimed_by_input_id)) : null;
        return {
          id: String(r.id),
          tgl: String(r.tanggal ?? "").slice(0, 10),
          jam: String(r.jam ?? ""),
          nominal: Number(r[kolom] ?? 0),
          pihak: String(r.nama_pengirim || r.nama_penerima || ""),
          no_ref: String(r.no_ref ?? ""),
          dipegang: p
            ? {
                dariGadai: !!p.gadai_klaim_id,
                tanggalInput: String(p.tanggal_input ?? "").slice(0, 10),
                nominalInput: Number(p.nominal ?? 0),
                caraCocok: String(p.matched_by ?? (p.manual_claim_reason ? "COCOK MANUAL" : "-")),
              }
            : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nyatakan sebuah resi SUDAH dicocokkan manual ke baris mutasi.
 *
 * Ini menutup dengan BUKTI — pemilik menunjuk baris mutasi yang mesin
 * lewatkan (nama beda, jam meleset, resi tersensor, atau barisnya sudah
 * dipegang input ketikan tangan). Karena itu ia menandai klaimnya cocok di
 * sisi gadai.
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
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    return { ok: true, msg: j.msg ?? "Ditandai cocok di Aceh Gadai." };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nyatakan sebuah resi TIDAK PERNAH ADA — salah catat.
 *
 * BUKAN untuk "resinya ada tapi tidak ketemu di rekening". Itu tuduhan uang
 * hilang, dan membatalkannya berarti menghapus pertanyaannya, bukan
 * menjawabnya. Sisi gadai menolak membatalkan klaim yang sudah MATCHED.
 */
export async function batalkanKlaim(klaimId: string, alasan: string) {
  const k = await konfigGadai();
  if (!k) return { ok: false, msg: "Sinkronisasi belum dikonfigurasi." };
  if (alasan.trim().length < 10) {
    return { ok: false, msg: "Alasan wajib diisi minimal 10 huruf — sebutkan kenapa resi ini dianggap tidak pernah ada." };
  }
  try {
    const res = await fetch(`${k.base}/api/transfer-klaim/batal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ klaimId, alasan: alasan.trim() }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg ?? `Gagal (HTTP ${res.status}).` };
    return { ok: true, msg: j.msg ?? "Klaim dibatalkan di Aceh Gadai." };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}
