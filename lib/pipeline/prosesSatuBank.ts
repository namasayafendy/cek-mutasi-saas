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
//
// TAHAP 1 (Okt 2026) menambah tiga langkah, urutannya juga mengikat:
//   1. GERBANG REKENING — sebelum APA PUN (integritas, catatan unggahan,
//      persist, banks). PDF rekening lain ditolak tanpa satu efek pun.
//   2. CATATAN UNGGAHAN — sebelum persist, supaya setiap baris baru membawa
//      unggah_id (dasar tombol "Batalkan unggahan"). Gagal mencatat = gagal
//      total: unggahan tanpa catatan tidak bisa dibatalkan.
//   3. VERIFIKASI ISI DATABASE — sesudah persist. Hasilnya masuk ke
//      integrity.barisHilang / barisGanda; jalankanPass dan catatCakupan
//      menolak berkas yang tidak lolos.
// Dan: rekening dibaca SEGAR dari database di awal (prop `bank` diambil saat
// halaman dibuka — titik saldo & nomor bisa sudah berubah sejak itu), dan
// catatan unggahan SELALU ditandai selesai (finally), supaya tombol batal
// tidak pernah bekerja dengan catatan setengah jadi.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAllPages } from "@/lib/pdf/renderer";
import { parsePdfByParserId, ParserNotImplementedError } from "@/lib/parsers";
import { persistTransactions, petakanKeDatabase, type PersistResult } from "@/lib/parsers/persist";
import { analyzeIntegrity, type IntegrityResult } from "@/lib/parsers/integrity";
import { periksaRekeningPdf, type KodeTolakRekening } from "@/lib/pipeline/gerbangRekening";
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
  /** mutasi_unggahan.id unggahan ini — diteruskan ke catatCakupan supaya
   *  cakupannya ikut terhapus kalau unggahan dibatalkan. */
  unggahId: string | null;
  /** true HANYA bila nomor rekening di kepala PDF benar-benar dibandingkan
   *  dan sama dengan nomor rekening ini. false = tidak diperiksa (rekening
   *  tanpa nomor / parser tak membaca nomor) — bukan bukti apa pun. */
  rekeningTerbukti: boolean;
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

  /** Jalur asal unggahan, untuk catatan mutasi_unggahan. */
  sumber?: "telegram" | "manual";
  /** mutasi_jobs.id — hanya alur Telegram. */
  jobId?: string | null;
}

export type HasilProsesBank =
  | { ok: true; upload: BankUpload }
  | {
      ok: false;
      alasan: string;
      /** Terisi bila ditolak GERBANG REKENING — sebelum satu efek pun lahir. */
      kodeTolak?: KodeTolakRekening;
      /** REKENING_BEDA: id rekening terdaftar yang memiliki PDF ini. */
      pemilikId?: string;
      /**
       * Terisi HANYA pada kegagalan "tidak ada transaksi jenis ini" — kegagalan
       * yang terjadi SESUDAH baris berhasil masuk database.
       *
       * Ini penting dan mudah terlewat: berkasnya sah, barisnya tersimpan, dan
       * periodenya nyata — yang tidak ada cuma transaksi pada jenis yang sedang
       * dilihat. Kalau cakupannya ikut hangus bersama pesan galat ini, tanggal
       * yang sudah benar-benar diperiksa akan muncul sebagai BOLONG besok, dan
       * alarm palsu yang berulang membuat seluruh laporan berhenti dibaca.
       */
      integrity?: IntegrityResult;
      persistInfo?: PersistResult;
      /** Terisi bersama integrity — barisnya sudah tersimpan atas nama unggahan ini. */
      unggahId?: string | null;
    };

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
    sumber = "manual",
    jobId = null,
  } = opsi;

  try {
    const doc = await parsePdfByParserId(file, bank.parser_id, {
      password: password || undefined,
    });

    // ── 0. REKENING SEGAR DARI DATABASE ──
    // Seluruh rekening akun: untuk gerbang (PDF milik rekening lain?) dan
    // untuk keadaan rekening ini SEKARANG (nomor, titik saldo terakhir).
    const { data: daftar, error: errDaftar } = await supabase
      .from("banks")
      .select("id, account_id, kode, label, parser_id, nomor_rekening, peran, recon_last_saldo, recon_last_date, is_active")
      .eq("account_id", accountId);
    if (errDaftar) throw new Error(`Gagal membaca daftar rekening: ${errDaftar.message}`);
    const semuaBank = (daftar ?? []) as Bank[];
    const segar = semuaBank.find((b) => b.id === bank.id);
    if (!segar) throw new Error("Rekening tidak ditemukan di akun ini. Muat ulang halaman.");
    const bankLain = semuaBank.filter((b) => b.id !== bank.id);
    const reconSaldoSegar = segar.recon_last_saldo == null ? null : Number(segar.recon_last_saldo);

    // ── 1. GERBANG REKENING ──
    // Sebelum integritas, catatan, persist, dan banks. Ditolak di sini =
    // tidak ada baris tersimpan, tidak ada titik saldo yang tertimpa, tidak
    // ada cakupan (pemanggil tidak menerima `integrity`), tidak ada vonis.
    const gerbang = periksaRekeningPdf({ ...bank, ...segar }, doc.statementMeta, bankLain);
    if (!gerbang.ok) {
      // Tautan "proses ulang sebagai rekening pemilik" hanya ditawarkan bila
      // rekening itu aktif — selain itu tautannya buntu.
      const pemilikAktif = gerbang.pemilikId
        ? semuaBank.some((b) => b.id === gerbang.pemilikId && b.is_active !== false)
        : false;
      const alasan = gerbang.pemilikId && !pemilikAktif
        ? `${gerbang.pesan} Rekening itu sedang nonaktif — aktifkan dulu di menu Bank.`
        : gerbang.pesan;
      return { ok: false, alasan, kodeTolak: gerbang.kode, pemilikId: pemilikAktif ? gerbang.pemilikId : undefined };
    }

    // Cek kelengkapan (A) + kontinuitas/bolong (B) vs titik terakhir bank.
    // WAJIB sebelum update banks di bawah — lihat catatan kepala berkas.
    const integrity = analyzeIntegrity(doc, reconSaldoSegar);
    const sm = doc.statementMeta;

    // ── 2. CATATAN UNGGAHAN ──
    // Titik saldo SEBELUM/SESUDAH, waktu, dan pembuat diisi DATABASE sendiri
    // (pemicu mutasi_unggahan_sebelum_sisip / _sebelum_ubah) — tidak dikirim
    // dari sini, dan anggota tim memang tidak punya hak menulisnya. Pemicu
    // yang sama menolak unggahan kedua untuk rekening ini selagi yang pertama
    // belum selesai: pemilik baris (unggah_id) harus mengikuti urutan catatan.
    const { data: unggah, error: errUnggah } = await supabase
      .from("mutasi_unggahan")
      .insert({
        account_id: accountId,
        bank_id: bank.id,
        job_id: jobId && /^[0-9a-f-]{36}$/i.test(jobId) ? jobId : null,
        sumber,
        file_name: String(file.name ?? "").slice(0, 200) || null,
        nomor_rekening_pdf: gerbang.nomorPdf,
        periode_awal: sm?.periodeAwal ?? null,
        periode_akhir: sm?.periodeAkhir ?? null,
        tgl_baris_awal: sm?.firstDate ?? null,
        tgl_baris_akhir: sm?.lastDate ?? null,
        baris_terbaca: doc.rows.length,
        // Titik penutup PDF ini — dipakai fungsi batal HANYA bila prosesnya
        // mati sebelum tanda selesai (lihat migrasi 20261029151428).
        target_saldo: sm?.saldoAkhir ?? null,
        target_tgl: sm?.lastDate ?? null,
      })
      .select("id")
      .single();
    if (errUnggah || !unggah?.id) {
      const pesan = errUnggah?.message ?? "tanpa id";
      if (pesan.includes("UNGGAHAN_BERJALAN")) {
        return {
          ok: false,
          alasan:
            "Unggahan lain untuk rekening ini masih diproses. Tunggu sampai selesai " +
            "(paling lama 15 menit), lalu ulangi. Tidak ada yang disimpan.",
        };
      }
      throw new Error(`Gagal mencatat unggahan: ${pesan}. Tidak ada yang disimpan.`);
    }
    const unggahId = String(unggah.id);

    let simpanan: PersistResult | null = null;
    let idPerBaris: (string | null)[] = [];
    try {
      onLangkah?.("Menyimpan ke history (auto dedup)...");
      simpanan = await persistTransactions(supabase, accountId, bank.id, doc.rows, null, unggahId);

      // ── 3. PETA + VERIFIKASI ISI DATABASE ──
      // Aturan pasangan yang SAMA dengan persist (lib/parsers/pasanganBaris.ts),
      // tapi membaca database lagi: yang dibuktikan isi database, bukan niat kode.
      onLangkah?.("Memeriksa isi database...");
      const peta = await petakanKeDatabase(supabase, accountId, bank.id, doc.rows);
      idPerBaris = peta.idPerBaris;
      integrity.barisHilang = peta.hilang;
      integrity.barisGanda = peta.ganda;
      integrity.contohDb = [
        ...peta.contohHilang.map((s) => `tidak tersimpan: ${s}`),
        ...peta.contohGanda.map((s) => `ganda: ${s}`),
      ].slice(0, 4);
      if (peta.hilang > 0 || peta.ganda > 0) {
        console.error("[prosesSatuBank] isi database tidak sama dengan PDF", {
          hilang: peta.hilang,
          ganda: peta.ganda,
          contohHilang: peta.contohHilang,
          contohGanda: peta.contohGanda,
        });
      }

      // Update "titik terakhir" rekonsiliasi bank (kalau statement ini lebih
      // baru). COMPARE-AND-SET di database — bukan dibandingkan dengan nilai
      // di halaman, yang bisa sudah basi (titik saldo pernah mundur begitu).
      if (sm?.saldoAkhir != null && sm.lastDate) {
        const { error: errRecon } = await supabase
          .from("banks")
          .update({ recon_last_saldo: sm.saldoAkhir, recon_last_date: sm.lastDate })
          .eq("id", bank.id)
          .eq("account_id", accountId)
          .or(`recon_last_date.is.null,recon_last_date.lte.${sm.lastDate}`);
        if (errRecon) console.error("[prosesSatuBank] gagal memperbarui titik saldo:", errRecon.message);
      }
    } finally {
      // Tandai catatan unggahan SELESAI apa pun yang terjadi di atas — titik
      // saldo sesudahnya dibaca database dari banks saat ini (pemicu). Tanpa
      // tanda ini unggahan dianggap masih berjalan: tidak bisa dibatalkan,
      // dan unggahan berikutnya rekening ini tertahan 15 menit.
      const { error: errSelesai } = await supabase
        .from("mutasi_unggahan")
        .update({ selesai_at: new Date().toISOString(), baris_baru: simpanan?.newCount ?? 0 })
        .eq("id", unggahId);
      if (errSelesai) console.error("[prosesSatuBank] gagal menandai unggahan selesai:", errSelesai.message);
    }
    const persisted: PersistResult = simpanan!;
    const idBaris = new Map(doc.rows.map((r, i) => [r, idPerBaris[i]] as const));

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
          parsedTxId: idBaris.get(r) ?? undefined,
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
      // integrity + persistInfo sengaja ikut dikembalikan — lihat catatan di
      // tipe HasilProsesBank. Barisnya SUDAH masuk DB di atas.
      return {
        ok: false,
        alasan: `Tidak ada transaksi ${jenis} di file ini.${hint}`,
        integrity,
        persistInfo: persisted,
        unggahId,
      };
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
        unggahId,
        rekeningTerbukti: gerbang.diperiksa,
      },
    };
  } catch (err) {
    console.error(err);
    return { ok: false, alasan: pesanGalatProses(err) };
  }
}
