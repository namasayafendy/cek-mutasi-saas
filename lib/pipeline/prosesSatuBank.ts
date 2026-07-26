// ============================================================
// KANAL MASUK MUTASI — Pipa "proses satu bank" (Fase 1)
// File: lib/pipeline/prosesSatuBank.ts
//
// ASALNYA: blok try/catch di dalam parseRow, app/(app)/check/upload-step.tsx
// (dulu baris 119-227). DIPINDAH APA ADANYA — ini refactor murni, dan itu
// disengaja supaya bisa dibuktikan lewat diff, bukan dipercaya begitu saja.
//
// KENAPA DIPINDAH: mulai Fase 1 ada DUA pemanggil —
//   1. upload-step.tsx  → alur manual lama (owner upload dari layar)
//   2. auto-runner.tsx  → alur Telegram baru (owner ketuk satu tombol)
// Kalau tidak diekstrak, dalam beberapa bulan akan ada dua jalur yang
// menyimpang tanpa ketahuan — dan menyimpangnya jalur pemeriksa uang adalah
// bentuk lain dari masalah yang justru ingin ditutup.
//
// URUTAN DI SINI TIDAK BOLEH DIACAK. Khususnya: analyzeIntegrity membaca
// bank.recon_last_saldo LAMA, jadi ia WAJIB jalan sebelum baris banks
// diperbarui. Kalau ditukar, `connected` selalu true dan deteksi mutasi
// bolong mati diam-diam — gagal yang paling berbahaya, karena kelihatan sehat.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAllPages } from "@/lib/pdf/renderer";
import { parsePdfByParserId, ParserNotImplementedError } from "@/lib/parsers";
import {
  persistTransactions,
  lookupParsedTxIds,
  rowLookupKey,
  type PersistResult,
} from "@/lib/parsers/persist";
import { analyzeIntegrity, type IntegrityResult } from "@/lib/parsers/integrity";
import type { ParsedPdf } from "@/lib/pdf/parser";
import type { RenderedPage } from "@/lib/pdf/renderer";
import type { Bank, Jenis, PdfTransaction } from "@/lib/types";

/**
 * Hasil satu berkas yang sudah diproses.
 *
 * Tipe ini DULU tinggal di dalam upload-step.tsx (komponen UI). Dipindah ke
 * sini supaya auto-runner tidak perlu meng-import komponen React + ikon hanya
 * untuk mendapat sebuah tipe. upload-step.tsx me-re-export-nya, jadi
 * check-client.tsx tidak perlu berubah sebaris pun.
 */
export type BankUpload = {
  bank: Bank;
  /** Active-jenis ParsedPdf — kept for backward compat with code that
   *  doesn't care about pass-1 vs pass-2 (mostly pdf-viewer + persistInfo
   *  display). check-client.tsx now uses parsedKredit/parsedDebet directly
   *  and picks based on current jenis state. */
  parsed: ParsedPdf;
  parsedKredit: ParsedPdf;
  parsedDebet: ParsedPdf;
  /** Halaman ter-render untuk PdfViewer. KOSONG di mode auto — lihat
   *  `renderHalaman` di bawah. */
  pages: RenderedPage[];
  persistInfo: PersistResult;
  parsedKreditCount: number;
  parsedDebetCount: number;
  integrity?: IntegrityResult;
};

export interface OpsiProsesBank {
  /** Klien Supabase browser (RLS + sesi owner). Dioper, bukan dibuat di sini,
   *  supaya modul ini tidak menarik modul ber-"use client". */
  supabase: SupabaseClient<any, any, any>;
  accountId: string;
  bank: Bank;
  file: File;
  /** String kosong SENGAJA menjadi undefined (perilaku lama, upload-step:121).
   *  Jangan diganti `?? undefined` — Mandiri akan menerima password kosong
   *  dan gagal dengan pesan yang berbeda. */
  password?: string;
  jenis: Jenis;

  /**
   * Render seluruh halaman PDF ke canvas untuk PdfViewer.
   * true  = alur manual (perilaku lama, wajib — layarnya butuh gambar)
   * false = alur Telegram (tidak ada yang melihat; menghemat ratusan MB di HP)
   *
   * Aman dilewati: hasilnya HANYA mengalir ke BankUpload.pages, yang satu-
   * satunya pembacanya adalah <PdfViewer> (check-client.tsx:801). Tidak ada
   * langkah parse/persist/matching yang menyentuhnya.
   */
  renderHalaman?: boolean;

  /**
   * Anggap "nol transaksi pada jenis aktif" sebagai kegagalan.
   * true  = alur manual (perilaku lama: baris jadi merah + pesan saran)
   * false = alur Telegram, yang memproses KREDIT dan DEBET dari satu berkas
   *         yang sama; PDF berisi kredit saja bukan kegagalan di sana.
   */
  gagalKalauJenisKosong?: boolean;

  /** Kabar kemajuan. WAJIB tidak pernah melempar — lemparannya akan
   *  tertangkap catch di bawah dan disalahartikan sebagai galat parse. */
  onLangkah?: (teks: string) => void;
}

export type HasilProsesBank =
  | { ok: true; upload: BankUpload }
  | { ok: false; alasan: string };

/**
 * Terjemahkan galat menjadi kalimat yang dilihat manusia.
 * Satu tempat saja, supaya alur manual dan alur Telegram tidak pernah memberi
 * dua kalimat berbeda untuk kegagalan yang sama.
 */
export function pesanGalatProses(err: unknown): string {
  if (err instanceof ParserNotImplementedError) return `Parser ${err.parserId} belum tersedia.`;
  if (err instanceof Error) return err.message;
  return "Gagal parse file";
}

export async function prosesSatuBank(opsi: OpsiProsesBank): Promise<HasilProsesBank> {
  const {
    supabase,
    accountId,
    bank,
    file,
    password,
    jenis,
    renderHalaman = true,
    gagalKalauJenisKosong = true,
    onLangkah,
  } = opsi;

  try {
    const doc = await parsePdfByParserId(file, bank.parser_id, {
      password: password || undefined,
    });

    // Cek kelengkapan (A) + kontinuitas/bolong (B) vs titik terakhir bank.
    // WAJIB sebelum update banks di bawah — lihat catatan kepala berkas.
    const integrity = analyzeIntegrity(doc, bank.recon_last_saldo ?? null);

    onLangkah?.("Menyimpan ke history (auto dedup)...");
    const persisted = await persistTransactions(supabase, accountId, bank.id, doc.rows);
    const idMap = await lookupParsedTxIds(supabase, accountId, bank.id, doc.rows);

    // Update "titik terakhir" rekonsiliasi bank (kalau statement ini lebih baru).
    const sm = doc.statementMeta;
    if (sm?.saldoAkhir != null && sm.lastDate) {
      const prev = bank.recon_last_date ?? null;
      if (!prev || sm.lastDate >= prev) {
        await supabase
          .from("banks")
          .update({ recon_last_saldo: sm.saldoAkhir, recon_last_date: sm.lastDate })
          .eq("id", bank.id);
      }
    }

    const parsedKreditCount = doc.rows.filter((r) => r.kredit > 0).length;
    const parsedDebetCount = doc.rows.filter((r) => r.debet > 0).length;
    const otherJenisCount = jenis === "kredit" ? parsedDebetCount : parsedKreditCount;
    const otherJenisLabel = jenis === "kredit" ? "debet (transaksi keluar)" : "kredit (transaksi masuk)";

    const bankIdLocal = bank.id;
    // Build PdfTransaction arrays for BOTH jenis upfront. This enables the
    // "Lanjut Cek Debet/Kredit" continuation flow in check-client without
    // requiring a re-upload or re-parse of the same PDF.
    //
    // CATATAN YANG MENYELAMATKAN: PdfTransaction TIDAK punya field `debet`.
    // Nominal debet sengaja dimasukkan ke field `kredit`. Jangan "dirapikan" —
    // seluruh pencocokan debet bergantung pada bentuk ini.
    function buildTx(j: Jenis): PdfTransaction[] {
      return doc.rows
        .filter((r) => (j === "kredit" ? r.kredit > 0 : r.debet > 0))
        .map((r) => ({
          no: r.no,
          page: r.page,
          tanggal: r.tanggal,
          tanggalDate: r.tanggalDate,
          waktu: r.waktu,
          namaPengirim: r.namaPengirim,
          deskripsi: r.deskripsi,
          kredit: j === "kredit" ? r.kredit : r.debet,
          bbox: r.bbox,
          parsedTxId: idMap.get(rowLookupKey(r)),
          source: "current",
          bankId: bankIdLocal,
          noRef: r.noRef,
        }));
    }
    const kreditTransactions = buildTx("kredit");
    const debetTransactions = buildTx("debet");
    const activeTransactions = jenis === "kredit" ? kreditTransactions : debetTransactions;

    if (activeTransactions.length === 0 && gagalKalauJenisKosong) {
      const hint =
        otherJenisCount > 0
          ? ` Tapi ada ${otherJenisCount} tx ${otherJenisLabel} — kalau yang ingin dicek itu, pilih sesi sebaliknya.`
          : "";
      return { ok: false, alasan: `Tidak ada transaksi ${jenis} di file ini.${hint}` };
    }

    let pages: RenderedPage[] = [];
    if (renderHalaman) {
      onLangkah?.(`Render ${doc.pages.length} halaman...`);
      pages = await renderAllPages(doc.fileBuffer, 1.4);
    }

    const parsedKredit: ParsedPdf = {
      transactions: kreditTransactions,
      pages: doc.pages,
      fileBuffer: doc.fileBuffer,
    };
    const parsedDebet: ParsedPdf = {
      transactions: debetTransactions,
      pages: doc.pages,
      fileBuffer: doc.fileBuffer,
    };

    return {
      ok: true,
      upload: {
        bank,
        parsed: jenis === "kredit" ? parsedKredit : parsedDebet,
        parsedKredit,
        parsedDebet,
        pages,
        persistInfo: persisted,
        parsedKreditCount,
        parsedDebetCount,
        integrity,
      },
    };
  } catch (err) {
    console.error(err);
    return { ok: false, alasan: pesanGalatProses(err) };
  }
}
