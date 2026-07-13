// Carry-over: load unclaimed parsed_transactions dari history sebelumnya
// untuk di-merge ke matching pool saat upload baru.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Jenis, PdfTransaction } from "@/lib/types";

type DbParsedTx = {
  id: string;
  bank_id: string;
  no_ref: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  nama_pengirim: string | null;
  nama_penerima: string | null;
  deskripsi: string | null;
  saldo: number | null;
  page: number | null;
  bbox_y_bottom: number | null;
  bbox_height: number | null;
};

/**
 * Load carry-over PdfTransaction[] untuk bank tertentu, jenis tertentu,
 * yang belum di-claim, di rentang lookback hari sebelum upload baru.
 *
 * @param fromDate YYYY-MM-DD — earliest tanggal carryover (e.g. periodStart - lookback)
 * @param beforeDate YYYY-MM-DD — exclusive upper bound (e.g. periodStart of current upload)
 *                                supaya tidak overlap dengan PDF yang baru di-upload
 */
export async function loadCarryoverPdfTxs(
  supabase: SupabaseClient,
  args: {
    accountId: string;
    bankId: string;
    jenis: Jenis;
    fromDate: string;
    beforeDate: string;
  },
): Promise<PdfTransaction[]> {
  const { data, error } = await supabase
    .from("parsed_transactions")
    .select(
      "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi, saldo, page, bbox_y_bottom, bbox_height",
    )
    .eq("account_id", args.accountId)
    .eq("bank_id", args.bankId)
    .is("claimed_by_input_id", null)
    .gte("tanggal", args.fromDate)
    .lt("tanggal", args.beforeDate)
    .order("tanggal", { ascending: true });

  if (error) {
    console.error("loadCarryoverPdfTxs error:", error.message);
    return [];
  }

  const rows = (data ?? []) as DbParsedTx[];
  const result: PdfTransaction[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const amount = args.jenis === "kredit" ? r.nominal_kredit : r.nominal_debet;
    if (!amount || amount <= 0) continue;

    // Parse YYYY-MM-DD ke Date UTC noon supaya konsisten dengan parser
    const m = r.tanggal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const tgl = new Date(
      Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12),
    );
    const dd = m[3];
    const mm = m[2];
    const yyyy = m[1];

    result.push({
      // Sentinel no value untuk carry-over: -1 * (i+1) supaya tidak collide dengan current PDF (no >= 1)
      no: -(i + 1),
      // Sentinel page = 0 untuk carry-over (current PDF page mulai 1)
      page: 0,
      tanggal: `${dd}-${mm}-${yyyy}`,
      tanggalDate: tgl,
      waktu: r.jam ?? "",
      namaPengirim: r.nama_pengirim ?? "",
      deskripsi: r.deskripsi ?? "",
      kredit: amount,
      bbox: {
        yBottom: r.bbox_y_bottom ?? 0,
        height: r.bbox_height ?? 0,
        xLeft: 0,
        width: 0,
      },
      parsedTxId: r.id,
      source: "carryover",
      noRef: r.no_ref,
    });
  }

  return result;
}
