// Fase B: lookup kredit mutasi by REF langsung ke parsed_transactions.
//
// Pool matching normal (PDF aktif + carry-over) hanya menjangkau beberapa hari
// ke belakang dan HANYA baris yang belum ter-claim. Pass-1 REF butuh lebih:
//  - kredit lama di luar jendela (nasabah transfer jauh hari sebelum datang), dan
//  - kredit yang SUDAH ter-claim (untuk alarm "ref menunjuk mutasi terpakai",
//    bukan diam-diam jatuh ke tebakan nominal).
// Baris hasil lookup di-tag source='carryover' (tidak ikut highlight PDF) dan
// claimedByOther=true kalau sudah dipakai input lain.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfTransaction } from "@/lib/types";

const REF_LOOKBACK_DAYS = 30;

type DbRefTx = {
  id: string;
  bank_id: string;
  no_ref: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nama_pengirim: string | null;
  deskripsi: string | null;
  claimed_by_input_id: string | null;
};

export async function loadRefPoolTxs(
  supabase: SupabaseClient,
  args: {
    accountId: string;
    refFts: string[];
    /** tanggal input paling awal (Date) — batas mundur lookup = minus 30 hari */
    earliestInput: Date;
  },
): Promise<PdfTransaction[]> {
  const refs = [...new Set(args.refFts.map((r) => String(r).trim().toUpperCase()).filter(Boolean))];
  if (refs.length === 0) return [];

  const from = new Date(args.earliestInput);
  from.setUTCDate(from.getUTCDate() - REF_LOOKBACK_DAYS);
  const fromISO = from.toISOString().slice(0, 10);

  // PostgREST or(): wildcard pakai '*'. Ref alfanumerik (hasil regex FT...) — aman inline.
  const orExpr = refs.map((r) => `no_ref.ilike.${r}*`).join(",");

  const { data, error } = await supabase
    .from("parsed_transactions")
    .select(
      "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nama_pengirim, deskripsi, claimed_by_input_id",
    )
    .eq("account_id", args.accountId)
    .is("deleted_at", null)
    .gt("nominal_kredit", 0)
    .gte("tanggal", fromISO)
    .or(orExpr);

  if (error) {
    console.error("loadRefPoolTxs error:", error.message);
    return [];
  }

  const rows = (data ?? []) as DbRefTx[];
  const result: PdfTransaction[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const m = r.tanggal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const tgl = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12));
    result.push({
      // Sentinel unik: jauh di bawah rentang carry-over -(i+1) supaya tak tabrakan key
      no: -(100000 + i),
      page: 0,
      tanggal: `${m[3]}-${m[2]}-${m[1]}`,
      tanggalDate: tgl,
      waktu: r.jam ?? "",
      namaPengirim: r.nama_pengirim ?? "",
      deskripsi: r.deskripsi ?? "",
      kredit: r.nominal_kredit,
      bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
      parsedTxId: r.id,
      source: "carryover",
      bankId: r.bank_id,
      noRef: r.no_ref,
      claimedByOther: r.claimed_by_input_id !== null,
    });
  }
  return result;
}
