// ============================================================
// GERBANG REKENING — PDF rekening lain ditolak SEBELUM disimpan
// File: lib/pipeline/gerbangRekening.ts
//
// LAHIR DARI rencana "Dua Rekening + Gerbang Token" (Tahap 1, Okt 2026).
// Sampai sekarang PDF apa pun yang dikirim ke cektransfer diproses sebagai
// rekening yang dipilih — tidak pernah ada yang memeriksa apakah PDF itu
// memang milik rekening tersebut. Selama akun hanya punya satu rekening hal
// itu tidak terasa; begitu rekening KELUAR (rekening kirim admin) ikut
// diunggah, satu kali salah tekan berakibat:
//   - baris tersimpan permanen di bank yang salah (dan tercatat dua kali
//     saat diunggah ulang ke bank yang benar);
//   - titik saldo terakhir (recon_last_*) bank yang dipilih tertimpa;
//   - cakupan mencatat tanggal-tanggal itu "sudah diperiksa";
//   - vonis Lapis 2 terkirim ke Aceh Gadai dan tidak bisa ditarik.
// Karena itu pemeriksaan ini WAJIB jalan sebelum analyzeIntegrity, sebelum
// persist, dan sebelum banks diperbarui — tidak satu pun efek boleh lahir.
//
// Fungsi murni: tidak menyentuh database, supaya bisa diuji tanpa apa pun
// (scripts/uji-gerbang-rekening.mts).
//
// ATURAN
// - Bank TANPA nomor_rekening → lewat (perilaku lama), KECUALI nomor di
//   PDF adalah nomor rekening LAIN yang terdaftar di akun yang sama — itu
//   pasti salah pilih rekening (mis. PDF rekening MASUK diproses sebagai
//   KELUAR yang nomornya belum diisi). Akun yang tidak pernah mengisi nomor
//   tidak terdampak sama sekali.
// - Parser yang TIDAK mendukung pembacaan nomor (statementMeta tanpa kunci
//   nomorRekening) → lewat, tapi dikatakan apa adanya (diperiksa=false).
//   Menolaknya akan mengunci bank non-BSI selamanya.
// - Parser yang mendukung (BSINet) tapi nomornya tidak terbaca → TOLAK.
//   "Tidak terbaca" BUKAN "aman": justru PDF yang kepalanya tak terbaca itulah
//   yang paling tidak bisa dibuktikan milik siapa.
// - Nomor terbaca tapi beda → TOLAK, sebutkan rekening pemiliknya bila
//   terdaftar di akun yang sama.
// - BSINet: total & saldo di kepala wajib terbaca — tanpa itu keutuhan
//   mutasi tidak bisa dibuktikan (dulu complete === null dibiarkan lewat).
// ============================================================

import type { StatementMeta } from "@/lib/parsers/types";
import type { Bank } from "@/lib/types";

export type KodeTolakRekening = "NOMOR_TAK_TERBACA" | "REKENING_BEDA" | "KEPALA_TAK_TERBACA";

export type HasilGerbangRekening =
  | { ok: true; diperiksa: boolean; nomorPdf: string | null }
  | {
      ok: false;
      kode: KodeTolakRekening;
      pesan: string;
      nomorPdf: string | null;
      /** id rekening TERDAFTAR yang memiliki nomor di PDF (bila ada) — supaya
       *  pemanggil bisa menawarkan "proses sebagai rekening itu". */
      pemilikId?: string;
    };

type BankRingkas = Pick<Bank, "label" | "kode" | "nomor_rekening" | "parser_id"> & {
  peran?: Bank["peran"];
};
type BankLain = Pick<Bank, "id" | "label" | "kode" | "nomor_rekening"> & { peran?: Bank["peran"] };

export function hanyaDigit(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** "…1994" — cukup untuk membedakan rekening, tanpa menulis nomor penuh. */
export function samarkanNomor(no: string): string {
  return no.length > 4 ? `…${no.slice(-4)}` : no;
}

function namaBank(b: { label?: string | null; kode?: string | null; peran?: string | null }): string {
  const nama = b.label || b.kode || "rekening";
  return b.peran ? `${nama} (${b.peran})` : nama;
}

export function periksaRekeningPdf(
  bank: BankRingkas,
  meta: StatementMeta | undefined,
  bankLain: BankLain[] = [],
): HasilGerbangRekening {
  const noBank = hanyaDigit(bank.nomor_rekening);
  const didukung = !!meta && Object.prototype.hasOwnProperty.call(meta, "nomorRekening");
  const noPdf = didukung ? hanyaDigit(meta!.nomorRekening) || null : null;

  if (!noBank) {
    const pemilik = noPdf ? bankLain.find((b) => hanyaDigit(b.nomor_rekening) === noPdf) : undefined;
    if (pemilik) {
      return {
        ok: false,
        kode: "REKENING_BEDA",
        nomorPdf: noPdf,
        pemilikId: pemilik.id,
        pesan:
          `PDF ini milik rekening ${namaBank(pemilik)} ${samarkanNomor(noPdf!)}, bukan ${namaBank(bank)}. ` +
          `Tidak ada yang disimpan — unggah ulang ke rekening ${namaBank(pemilik)}.`,
      };
    }
    return { ok: true, diperiksa: false, nomorPdf: noPdf };
  }
  if (!didukung) return { ok: true, diperiksa: false, nomorPdf: null };

  const label = `${namaBank(bank)} ${samarkanNomor(noBank)}`;

  if (!noPdf) {
    return {
      ok: false,
      kode: "NOMOR_TAK_TERBACA",
      nomorPdf: null,
      pesan:
        `Nomor rekening di kepala PDF tidak terbaca, jadi tidak bisa dipastikan PDF ini milik ${label}. ` +
        `Tidak ada yang disimpan. Unduh ulang mutasi dari BSINet (format PDF).`,
    };
  }

  if (noPdf !== noBank) {
    const pemilik = bankLain.find((b) => hanyaDigit(b.nomor_rekening) === noPdf);
    const milik = pemilik
      ? `rekening ${namaBank(pemilik)} ${samarkanNomor(noPdf)}`
      : `rekening ${samarkanNomor(noPdf)} yang tidak terdaftar di cektransfer`;
    return {
      ok: false,
      kode: "REKENING_BEDA",
      nomorPdf: noPdf,
      pemilikId: pemilik?.id,
      pesan:
        `PDF ini milik ${milik}, bukan ${label}. Tidak ada yang disimpan` +
        (pemilik ? ` — unggah ulang ke rekening ${namaBank(pemilik)}.` : "."),
    };
  }

  if (
    bank.parser_id === "BSI_BSINET_PDF" &&
    (meta!.printedKredit == null || meta!.printedDebet == null || meta!.saldoAwal == null || meta!.saldoAkhir == null)
  ) {
    return {
      ok: false,
      kode: "KEPALA_TAK_TERBACA",
      nomorPdf: noPdf,
      pesan:
        `Total atau saldo di kepala PDF tidak terbaca, jadi keutuhan mutasi tidak bisa dibuktikan. ` +
        `Tidak ada yang disimpan. Unduh ulang mutasi dari BSINet (format PDF).`,
    };
  }

  return { ok: true, diperiksa: true, nomorPdf: noPdf };
}
