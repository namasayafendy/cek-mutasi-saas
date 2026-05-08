// Parser registry — daftar semua bank/e-wallet yang akan di-support.
// Tiap entry punya parser_id unik. Kalau bank yang sama punya beberapa
// format export (BSI BSINet vs BYOND, BCA e-Statement vs KlikBCA), mereka
// jadi entry terpisah dengan parser_id berbeda.

export type ParserStatus = "ready" | "coming_soon";

export type ParserSpec = {
  /** Parser identifier — unique, dipakai di tabel banks.parser_id */
  parser_id: string;
  /** Kode bank — multiple parsers bisa share kode sama (misal BSI BSINet & BSI BYOND keduanya kode BSI) */
  kode: string;
  /** Display label di dropdown — biasanya "[Bank] — [Source/Format]" */
  label: string;
  /** Format file yang di-upload */
  format: "pdf" | "html";
  /** Apakah parser sudah ada implementasinya */
  status: ParserStatus;
  /** Apakah file di-protect password (Mandiri PDF protected) */
  password_required?: boolean;
  /** Catatan untuk user, contoh "Download dari KlikBCA web" */
  hint?: string;
  /** Kategori untuk grouping di dropdown */
  category: "bank" | "ewallet";
};

export const PARSER_REGISTRY: ParserSpec[] = [
  // ===== BSI =====
  {
    parser_id: "BSI_BSINET_PDF",
    kode: "BSI",
    label: "BSI — BSINet (web)",
    format: "pdf",
    status: "ready",
    hint: "PDF dari BSINet web. Default kebanyakan customer.",
    category: "bank",
  },
  {
    parser_id: "BSI_BYOND_PDF",
    kode: "BSI",
    label: "BSI — BYOND (mobile app)",
    format: "pdf",
    status: "ready",
    hint: "PDF dari aplikasi BYOND mobile. Format multi-page dengan summary saldo.",
    category: "bank",
  },

  // ===== BCA =====
  {
    parser_id: "BCA_KLIKBCA_HTML",
    kode: "BCA",
    label: "BCA — KlikBCA (web)",
    format: "html",
    status: "coming_soon",
    hint: "File HTML dari klikbca.com (custom date range, paling fleksibel).",
    category: "bank",
  },
  {
    parser_id: "BCA_ESTATEMENT_PDF",
    kode: "BCA",
    label: "BCA — e-Statement (PDF bulanan)",
    format: "pdf",
    status: "ready",
    hint: "PDF e-Statement bulanan dari email BCA. Year auto-detect dari header PERIODE.",
    category: "bank",
  },

  // ===== Mandiri =====
  {
    parser_id: "MANDIRI_PDF",
    kode: "MANDIRI",
    label: "Mandiri — e-Statement PDF",
    format: "pdf",
    status: "ready",
    password_required: true,
    hint: "PDF Mandiri e-Statement bulanan, password biasanya tanggal lahir format DDMMYYYY.",
    category: "bank",
  },

  // ===== BNI =====
  {
    parser_id: "BNI_PDF",
    kode: "BNI",
    label: "BNI — Mobile Banking PDF",
    format: "pdf",
    status: "ready",
    hint: "Export PDF dari BNI Mobile Banking (Histori Transaksi, range tanggal custom).",
    category: "bank",
  },

  // ===== BRI =====
  {
    parser_id: "BRI_PDF",
    kode: "BRI",
    label: "BRI — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Bank Aceh Syariah =====
  {
    parser_id: "BANK_ACEH_SYARIAH_PDF",
    kode: "BANK_ACEH_SYARIAH",
    label: "Bank Aceh Syariah — PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== CIMB Niaga =====
  {
    parser_id: "CIMB_NIAGA_PDF",
    kode: "CIMB_NIAGA",
    label: "CIMB Niaga — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Permata =====
  {
    parser_id: "PERMATA_PDF",
    kode: "PERMATA",
    label: "Permata — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Danamon =====
  {
    parser_id: "DANAMON_PDF",
    kode: "DANAMON",
    label: "Danamon — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Maybank =====
  {
    parser_id: "MAYBANK_PDF",
    kode: "MAYBANK",
    label: "Maybank — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Bank Jago =====
  {
    parser_id: "BANK_JAGO_PDF",
    kode: "BANK_JAGO",
    label: "Bank Jago — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Seabank =====
  {
    parser_id: "SEABANK_PDF",
    kode: "SEABANK",
    label: "SeaBank — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== Allo Bank =====
  {
    parser_id: "ALLO_BANK_PDF",
    kode: "ALLO_BANK",
    label: "Allo Bank — Mutasi PDF",
    format: "pdf",
    status: "coming_soon",
    category: "bank",
  },

  // ===== E-wallets =====
  {
    parser_id: "DANA_PDF",
    kode: "DANA",
    label: "Dana — Mutasi e-Wallet",
    format: "pdf",
    status: "coming_soon",
    category: "ewallet",
  },
  {
    parser_id: "OVO_PDF",
    kode: "OVO",
    label: "OVO — Mutasi e-Wallet",
    format: "pdf",
    status: "coming_soon",
    category: "ewallet",
  },
  {
    parser_id: "GOPAY_PDF",
    kode: "GOPAY",
    label: "GoPay — Mutasi e-Wallet",
    format: "pdf",
    status: "coming_soon",
    category: "ewallet",
  },
  {
    parser_id: "SHOPEEPAY_PDF",
    kode: "SHOPEEPAY",
    label: "ShopeePay — Mutasi e-Wallet",
    format: "pdf",
    status: "coming_soon",
    category: "ewallet",
  },
];

export function getParserSpec(parser_id: string): ParserSpec | undefined {
  return PARSER_REGISTRY.find((p) => p.parser_id === parser_id);
}

export function getReadyParsers(): ParserSpec[] {
  return PARSER_REGISTRY.filter((p) => p.status === "ready");
}

export function getKodeLabel(kode: string): string {
  const map: Record<string, string> = {
    BSI: "BSI",
    BCA: "BCA",
    MANDIRI: "Mandiri",
    BNI: "BNI",
    BRI: "BRI",
    BANK_ACEH_SYARIAH: "Bank Aceh Syariah",
    CIMB_NIAGA: "CIMB Niaga",
    PERMATA: "Permata",
    DANAMON: "Danamon",
    MAYBANK: "Maybank",
    BANK_JAGO: "Bank Jago",
    SEABANK: "SeaBank",
    ALLO_BANK: "Allo Bank",
    DANA: "Dana",
    OVO: "OVO",
    GOPAY: "GoPay",
    SHOPEEPAY: "ShopeePay",
  };
  return map[kode] ?? kode;
}
