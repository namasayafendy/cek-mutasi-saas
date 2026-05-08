// Common types untuk semua parser bank.

export type ParsedTxRow = {
  /** Nomor urut dari mutasi PDF (kalau ada) */
  no: number;
  /** Halaman PDF (1-based) */
  page: number;
  /** Tanggal transaksi (DD-MM-YYYY) */
  tanggal: string;
  tanggalDate: Date;
  /** Waktu transaksi (HH.MM atau kosong) */
  waktu: string;
  /** Nama pengirim (kalau ada) */
  namaPengirim: string;
  /** Nama penerima (kalau ada) */
  namaPenerima: string;
  /** Deskripsi/keterangan */
  deskripsi: string;
  /** Nomor referensi unik dari bank (kalau ada). Dipakai untuk dedup antar upload. */
  noRef: string | null;
  /** Saldo setelah transaksi (kalau ada). Dipakai untuk fingerprint dedup. */
  saldo: number | null;
  /** Nominal kredit (rupiah). 0 kalau bukan kredit. */
  kredit: number;
  /** Nominal debet (rupiah). 0 kalau bukan debet. */
  debet: number;
  /** Bounding box pada halaman PDF (untuk highlight overlay) */
  bbox: {
    yBottom: number;
    height: number;
    xLeft: number;
    width: number;
  };
};

export type ParsedDocument = {
  /** All rows (kredit + debet) */
  rows: ParsedTxRow[];
  /** Page dimensions */
  pages: { width: number; height: number }[];
  /** Original file bytes (Uint8Array). Stable, consumers must clone before passing to pdfjs/pdf-lib. */
  fileBuffer: Uint8Array;
};

export type ParseOptions = {
  /** Password buat PDF protected (Mandiri) */
  password?: string;
};

export type ParserFn = (file: File, opts?: ParseOptions) => Promise<ParsedDocument>;
