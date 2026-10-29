// Persist parsed transactions ke DB dengan auto-dedup.
//
// Sejak Tahap 1 (Okt 2026) SATU aturan memutuskan tiga hal sekaligus —
// baris mana yang baru, id database setiap baris PDF, dan apakah isi
// database sama dengan PDF: pasangkanBaris (lib/parsers/pasanganBaris.ts,
// baca catatan kepalanya). Dulu ketiganya memakai kunci berbeda-beda, dan
// di celah di antara kunci-kunci itulah baris hilang dan baris ganda lahir.
//
// Indeks unik database tetap menjadi jaring terakhir (unggahan bersamaan):
// 1. Rows yang punya no_ref → UNIQUE (account_id, bank_id, no_ref, arah,
//    nominal_debet, nominal_kredit). Arah + nominal wajib: bank memakai ref
//    yang SAMA untuk debet & kredit retur BI-FAST, dan kadang untuk transfer
//    + biaya admin 2.500-nya (21 Okt 2026: debet Rp 555.415 terbuang).
// 2. Rows tanpa no_ref → UNIQUE (account_id, bank_id, fingerprint).
// Format no_ref SENGAJA tidak diubah: unggahan harian bertumpang H-1, dan
// format baru akan menggandakan baris lama.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedTxRow } from "./types";
import {
  KOLOM_BARIS_DB,
  pasangkanBaris,
  sidikJariSemua,
  tanggalDb,
  type BarisDb,
} from "./pasanganBaris";

export { computeFingerprint } from "./pasanganBaris";

export type PersistResult = {
  total: number;
  newCount: number;
  dupCount: number;
  /** Baris yang pernah dihapus ("Hapus Data") lalu muncul lagi di PDF ini →
   *  dihidupkan kembali. Bukan milik unggahan ini (unggah_id tidak berubah). */
  revivedCount: number;
  errorCount: number;
  errors: string[];
  /** Sidik jari baris yang BENAR-BENAR baru masuk pada unggahan ini.
   *
   *  Laporan LAPIS 2 memakainya supaya "kredit/debet tanpa pemilik" disebut
   *  HANYA SEKALI. Unggahan berikutnya yang periodenya bertumpang tindih tidak
   *  menyebutnya lagi — sebagian memang wajar (cicilan orang, pengeluaran di
   *  luar aplikasi), dan peringatan berulang untuk hal yang sudah diketahui
   *  berhenti dibaca. Saat itu terjadi, ia juga berhenti melindungi. */
  baruFingerprints: string[];
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
  /** Unggahan yang PERTAMA kali memasukkan baris ini (mutasi_unggahan.id).
   *  Baris yang sudah ada (duplikat) tidak berubah pemiliknya. */
  unggah_id: string | null;
};

function rowToDb(
  row: ParsedTxRow,
  fingerprint: string | null,
  accountId: string,
  bankId: string,
  sessionId: string | null,
  unggahId: string | null,
): DBRow {
  return {
    account_id: accountId,
    bank_id: bankId,
    no_ref: row.noRef,
    tanggal: tanggalDb(row), // YYYY-MM-DD
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
    fingerprint: row.noRef ? null : fingerprint,
    first_seen_session_id: sessionId,
    unggah_id: unggahId,
  };
}

/**
 * Baris database yang mungkin menjadi pasangan baris-baris PDF ini:
 *   - semua baris (TERMASUK yang terhapus) ber-ref sama / fingerprint sama —
 *     indeks unik ikut baris terhapus, jadi mereka tetap menghalangi sisip;
 *   - semua baris AKTIF di rentang tanggal PDF — untuk pasangan isi & ganda.
 * Setiap kueri berhalaman (.order("id") + .range) — batas 1000 baris
 * PostgREST tidak boleh memotong diam-diam.
 */
export async function muatBarisDb(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  rows: ParsedTxRow[],
): Promise<BarisDb[]> {
  const hasil: BarisDb[] = [];
  if (rows.length === 0) return hasil;
  const HALAMAN = 1000;
  const CHUNK = 100;

  async function semuaHalaman(buat: () => any, keterangan: string) {
    for (let awal = 0; ; awal += HALAMAN) {
      const { data, error } = await buat().order("id", { ascending: true }).range(awal, awal + HALAMAN - 1);
      if (error) throw new Error(`Gagal membaca mutasi tersimpan (${keterangan}): ${error.message}`);
      const batch = (data ?? []) as BarisDb[];
      hasil.push(...batch);
      if (batch.length < HALAMAN) break;
    }
  }

  const refs = [...new Set(rows.filter((r) => r.noRef).map((r) => r.noRef as string))];
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    await semuaHalaman(
      () =>
        supabase
          .from("parsed_transactions")
          .select(KOLOM_BARIS_DB)
          .eq("account_id", accountId)
          .eq("bank_id", bankId)
          .in("no_ref", slice),
      "ref",
    );
  }

  const fps = [...new Set(sidikJariSemua(rows).filter((f): f is string => !!f))];
  for (let i = 0; i < fps.length; i += CHUNK) {
    const slice = fps.slice(i, i + CHUNK);
    await semuaHalaman(
      () =>
        supabase
          .from("parsed_transactions")
          .select(KOLOM_BARIS_DB)
          .eq("account_id", accountId)
          .eq("bank_id", bankId)
          .in("fingerprint", slice),
      "fingerprint",
    );
  }

  const tanggal = rows.map((r) => tanggalDb(r)).sort();
  const dari = tanggal[0];
  const sampai = tanggal[tanggal.length - 1];
  await semuaHalaman(
    () =>
      supabase
        .from("parsed_transactions")
        .select(KOLOM_BARIS_DB)
        .eq("account_id", accountId)
        .eq("bank_id", bankId)
        .is("deleted_at", null)
        .gte("tanggal", dari)
        .lte("tanggal", sampai),
    "rentang tanggal",
  );

  return hasil.map((b: any) => ({
    ...b,
    id: String(b.id),
    nominal_kredit: Number(b.nominal_kredit ?? 0),
    nominal_debet: Number(b.nominal_debet ?? 0),
    saldo: b.saldo == null ? null : Number(b.saldo),
    tanggal: String(b.tanggal),
  }));
}

/**
 * Simpan baris PDF yang BENAR-BENAR baru.
 *
 * Yang disisipkan hanya baris yang tidak punya pasangan sama sekali di
 * database (lihat pasangkanBaris). Transaksi yang sudah tersimpan dengan
 * identitas lain — tanpa ref dari parser lama, atau ref yang dulu terbaca
 * berbeda — TIDAK disisipkan lagi; itu yang dulu melahirkan 6 baris ganda
 * 5 Agu 2026.
 *
 * Kalau satu potongan 200 baris ditolak database, potongan itu diulang
 * BARIS PER BARIS: satu baris bermasalah tidak boleh ikut menggagalkan 199
 * baris sehat (dulu seluruh potongan hilang dari database).
 *
 * Baris yang identitasnya hanya ada sebagai baris TERHAPUS (soft-delete
 * "Hapus Data") dihidupkan kembali — indeks unik ikut baris terhapus, jadi
 * tanpa ini baris itu tidak akan pernah kembali dan setiap unggahan tanggal
 * tersebut tertahan sebagai "hilang". KLAIMNYA TIDAK PERNAH DILEPAS: vonis
 * klaim pemegangnya mungkin sudah terkirim ke Aceh Gadai, dan baris yang
 * hidup lagi dalam keadaan bebas bisa membuktikan klaim KEDUA dengan uang
 * yang sama. Baris yang ragu (pasangannya mungkin salinan ganda yang sengaja
 * dihapus — lihat terhapusRagu) tidak dihidupkan.
 */
export async function persistTransactions(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  rows: ParsedTxRow[],
  sessionId: string | null = null,
  unggahId: string | null = null,
): Promise<PersistResult> {
  const result: PersistResult = {
    total: rows.length,
    newCount: 0,
    dupCount: 0,
    revivedCount: 0,
    errorCount: 0,
    errors: [],
    // Sidik jari baris yang BENAR-BENAR baru masuk kali ini — lihat tipe.
    baruFingerprints: [] as string[],
  };
  if (rows.length === 0) return result;

  const pasangan = pasangkanBaris(rows, await muatBarisDb(supabase, accountId, bankId, rows));
  const fp = sidikJariSemua(rows);
  result.dupCount = rows.length - pasangan.baru.length - pasangan.terhapus.length;

  const ragu = new Set(pasangan.terhapusRagu);
  const dihidupkan = pasangan.terhapus.filter((i) => !ragu.has(i)).map((i) => pasangan.pasangan[i]!);
  if (dihidupkan.length > 0) await hidupkanKembali(supabase, accountId, bankId, dihidupkan, result);
  if (pasangan.baru.length === 0) return result;

  const dbRows = pasangan.baru.map((i) => rowToDb(rows[i], fp[i], accountId, bankId, sessionId, unggahId));
  const withNoRef = dbRows.filter((r) => r.no_ref !== null);
  const withoutNoRef = dbRows.filter((r) => r.no_ref === null);

  const CHUNK = 200;

  async function sisip(slice: DBRow[], onConflict: string) {
    // ignoreDuplicates=true → hanya baris yang benar-benar masuk yang kembali.
    // Bentrok di sini = unggahan lain baru saja menyisipkan baris yang sama.
    return supabase
      .from("parsed_transactions")
      .upsert(slice, { onConflict, ignoreDuplicates: true })
      .select("id, fingerprint");
  }
  function catatMasuk(slice: DBRow[], data: any[] | null) {
    const masuk = data?.length ?? 0;
    result.newCount += masuk;
    result.dupCount += slice.length - masuk;
    for (const r of data ?? []) {
      if (r?.fingerprint) result.baruFingerprints.push(String(r.fingerprint));
    }
  }

  async function processGroup(group: DBRow[], onConflict: string) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const slice = group.slice(i, i + CHUNK);
      const { data, error } = await sisip(slice, onConflict);
      if (!error) {
        catatMasuk(slice, data as any[]);
        continue;
      }
      for (const satu of slice) {
        const r1 = await sisip([satu], onConflict);
        if (r1.error) {
          result.errorCount += 1;
          if (result.errors.length < 5) result.errors.push(r1.error.message);
        } else {
          catatMasuk([satu], r1.data as any[]);
        }
      }
    }
  }

  if (withNoRef.length > 0) {
    await processGroup(withNoRef, "account_id,bank_id,no_ref,arah,nominal_debet,nominal_kredit");
  }
  if (withoutNoRef.length > 0) {
    await processGroup(withoutNoRef, "account_id,bank_id,fingerprint");
  }

  return result;
}

async function hidupkanKembali(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  baris: BarisDb[],
  result: PersistResult,
) {
  for (let i = 0; i < baris.length; i += 200) {
    const ids = baris.slice(i, i + 200).map((b) => b.id);
    // HANYA deleted_at. Kolom klaim tidak disentuh — lihat catatan di atas.
    const { data, error } = await supabase
      .from("parsed_transactions")
      .update({ deleted_at: null })
      .eq("account_id", accountId)
      .eq("bank_id", bankId)
      .in("id", ids)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) {
      result.errorCount += ids.length;
      if (result.errors.length < 5) result.errors.push(error.message);
      continue;
    }
    result.revivedCount += data?.length ?? 0;
  }
}

export type PetaDatabase = {
  /** Per baris PDF (urutan sama dengan `rows`): id parsed_transactions, atau
   *  null bila baris itu tidak ada (aktif) di database. */
  idPerBaris: (string | null)[];
  /** Baris PDF yang tidak punya pasangan aktif di database. */
  hilang: number;
  /** Baris database aktif yang isinya ada di PDF tapi berlebih. */
  ganda: number;
  /** Berapa yang berpasangan lewat ISI (identitas berbeda) — wajar untuk
   *  baris lama tanpa ref; bukan masalah, hanya dicatat. */
  lewatIsi: number;
  contohHilang: string[];
  contohGanda: string[];
};

/**
 * Sesudah persist: id database untuk setiap baris PDF + BUKTI bahwa isi
 * database sama dengan PDF.
 *
 * Kenapa bukti ini perlu: pemeriksaan keutuhan (analyzeIntegrity) membaca
 * hasil PARSE. Kalau database membuang sebuah baris — seperti debet retur
 * BI-FAST Rp 8.287.500 sebelum Tahap 1 — parse tetap utuh, rantai saldo
 * tetap nyambung, dan tidak ada satu pun peringatan. Yang kehilangan
 * barisnya hanya database, tempat pencocokan benar-benar dibaca.
 *
 * hilang > 0 atau ganda > 0 → Lapis 2 ditahan (ISI_DB_TIDAK_SAMA) dan
 * cakupan ditolak. Membaca dari database lagi, bukan dari hasil persist:
 * yang dibuktikan adalah isi database, bukan niat kode.
 */
export async function petakanKeDatabase(
  supabase: SupabaseClient,
  accountId: string,
  bankId: string,
  rows: ParsedTxRow[],
): Promise<PetaDatabase> {
  const peta: PetaDatabase = { idPerBaris: [], hilang: 0, ganda: 0, lewatIsi: 0, contohHilang: [], contohGanda: [] };
  if (rows.length === 0) return peta;
  const h = pasangkanBaris(rows, await muatBarisDb(supabase, accountId, bankId, rows));
  peta.idPerBaris = h.pasangan.map((b, i) => (b && h.cara[i] !== "terhapus" ? b.id : null));
  for (const i of [...h.baru, ...h.terhapus]) {
    peta.hilang++;
    if (peta.contohHilang.length < 5) {
      const r = rows[i];
      const nominal = r.debet > 0 ? `debet ${r.debet}` : `kredit ${r.kredit}`;
      peta.contohHilang.push(
        `${tanggalDb(r)} ${r.waktu || ""} ${nominal}${h.cara[i] === "terhapus" ? " (terhapus)" : ""}`.replace(/\s+/g, " "),
      );
    }
  }
  peta.ganda = h.gandaDb.length;
  for (const b of h.gandaDb.slice(0, 5)) {
    const nominal = b.nominal_debet > 0 ? `debet ${b.nominal_debet}` : `kredit ${b.nominal_kredit}`;
    peta.contohGanda.push(`${b.tanggal} ${b.jam ?? ""} ${nominal}`.replace(/\s+/g, " "));
  }
  peta.lewatIsi = h.cara.filter((c) => c === "isi").length;
  return peta;
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
