// Persist parsed transactions ke DB dengan auto-dedup.
// Strategi:
// 1. Rows yang punya no_ref → dedup via UNIQUE INDEX (account_id, bank_id, no_ref)
// 2. Rows tanpa no_ref → dedup via UNIQUE INDEX (account_id, bank_id, fingerprint)
//
// Fingerprint = hash dari (tgl + jam + nominal + saldo). Reasonable proxy untuk
// identify transaksi yang sama tanpa no_ref.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedTxRow } from "./types";

/**
 * Compute fingerprint untuk row tanpa no_ref. Format: "tgl|jam|kredit|debet|saldo".
 * Pakai concatenation simple string — bukan crypto hash (string panjang OK,
 * jadi tetap unique enough kalau saldo presisi 2 desimal).
 */
export function computeFingerprint(row: ParsedTxRow): string {
  return [
    row.tanggal,
    row.waktu,
    row.kredit,
    row.debet,
    row.saldo ?? "",
  ].join("|");
}

export type PersistResult = {
  total: number;
  newCount: number;
  dupCount: number;
  errorCount: number;
  errors: string[];
};

type DBRow = {
  account_id: string;
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
  fingerprint: string | null;
  first_seen_session_id: string | null;
};

function rowToDb(
  row: ParsedTxRow,
  accountId: string,
  bankId: string,
  sessionId: string | null,
): DBRow {
  return {
    account_id: accountId,
    bank_id: bankId,
    no_ref: row.noRef,
    tanggal: row.tanggalDate.toISOString().split("T")[0], // YYYY-MM-DD
    jam: row.waktu || null,
    nominal_kredit: row.kredit,
    nominal_debet: row.debet,
    nama_pengirim: row.namaPengirim || null,
    nama_penerima: row.namaPenerima || null,
    deskripsi: row.deskripsi || null,
    saldo: row.saldo,
    page: row.page,
    bbox_y_bottom: row.bbox.yBottom,
    bbox_height: row.bbox.height,
    fingerprint: row.noRef ? null : computeFingerprint(row),
    first_seen_session_id: sessionId,
  };
}

/**
 * Upsert parsed transactions dengan dedup via no_ref + fingerprint.
 * Returns count: total / new / duplicate / error.
 */
export async function persistTransactions(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  rows: ParsedTxRow[],
  sessionId: string | null = null,
): Promise<PersistResult> {
  const result: PersistResult = {
    total: rows.length,
    newCount: 0,
    dupCount: 0,
    errorCount: 0,
    errors: [],
  };
  if (rows.length === 0) return result;

  const dbRows = rows.map((r) => rowToDb(r, accountId, bankId, sessionId));
  const withNoRef = dbRows.filter((r) => r.no_ref !== null);
  const withoutNoRef = dbRows.filter((r) => r.no_ref === null);

  // Process in chunks to avoid large payloads
  const CHUNK = 200;

  async function processGroup(group: DBRow[], onConflict: string) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const slice = group.slice(i, i + CHUNK);
      // ignoreDuplicates=true → returns rows yang berhasil di-insert (yang baru).
      // Yang duplicate akan di-skip silently dan tidak masuk return.
      const { data, error } = await supabase
        .from("parsed_transactions")
        .upsert(slice, { onConflict, ignoreDuplicates: true })
        .select("id");

      if (error) {
        result.errorCount += slice.length;
        result.errors.push(error.message);
        continue;
      }
      const insertedCount = data?.length ?? 0;
      result.newCount += insertedCount;
      result.dupCount += slice.length - insertedCount;
    }
  }

  if (withNoRef.length > 0) {
    await processGroup(withNoRef, "account_id,bank_id,no_ref");
  }
  if (withoutNoRef.length > 0) {
    await processGroup(withoutNoRef, "account_id,bank_id,fingerprint");
  }

  return result;
}

/**
 * Lookup parsed_transactions.id untuk rows yang baru di-persist (atau duplicate).
 * Returns Map<key, id> di mana key = no_ref atau fingerprint.
 *
 * Dipakai supaya saat matching, current-PDF tx bisa di-link ke parsed_tx_id-nya
 * (untuk update claimed_by_input_id saat session di-save).
 */
export async function lookupParsedTxIds(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  rows: ParsedTxRow[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (rows.length === 0) return map;

  const noRefs = rows
    .filter((r) => r.noRef)
    .map((r) => r.noRef as string);
  const fingerprints = rows
    .filter((r) => !r.noRef)
    .map((r) => computeFingerprint(r));

  // Query in chunks supaya URL tidak kepanjangan (Supabase IN clause limit)
  const CHUNK = 100;

  if (noRefs.length > 0) {
    for (let i = 0; i < noRefs.length; i += CHUNK) {
      const slice = noRefs.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("parsed_transactions")
        .select("id, no_ref")
        .eq("account_id", accountId)
        .eq("bank_id", bankId)
        .in("no_ref", slice);
      if (error) continue;
      for (const row of data ?? []) {
        if (row.no_ref) map.set(`ref:${row.no_ref}`, row.id);
      }
    }
  }

  if (fingerprints.length > 0) {
    for (let i = 0; i < fingerprints.length; i += CHUNK) {
      const slice = fingerprints.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("parsed_transactions")
        .select("id, fingerprint")
        .eq("account_id", accountId)
        .eq("bank_id", bankId)
        .in("fingerprint", slice);
      if (error) continue;
      for (const row of data ?? []) {
        if (row.fingerprint) map.set(`fp:${row.fingerprint}`, row.id);
      }
    }
  }

  return map;
}

/**
 * Helper: build the lookup key untuk row (sama logic dengan lookupParsedTxIds).
 */
export function rowLookupKey(row: ParsedTxRow): string {
  return row.noRef ? `ref:${row.noRef}` : `fp:${computeFingerprint(row)}`;
}

/**
 * Load existing parsed transactions (claimed atau unclaimed) untuk bank tertentu
 * dalam rentang tanggal. Dipakai untuk carry-over feature.
 */
export async function loadExistingTransactions(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  options?: {
    fromDate?: string; // YYYY-MM-DD
    toDate?: string;
    onlyUnclaimed?: boolean;
  },
) {
  let query = supabase
    .from("parsed_transactions")
    .select("*")
    .eq("account_id", accountId)
    .eq("bank_id", bankId);

  if (options?.fromDate) query = query.gte("tanggal", options.fromDate);
  if (options?.toDate) query = query.lte("tanggal", options.toDate);
  if (options?.onlyUnclaimed) query = query.is("claimed_by_input_id", null);

  const { data, error } = await query.order("tanggal", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
