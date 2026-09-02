// Tipe data shared antara client + server (commercial schema)

// ============================================================
// Subscription / Account
// ============================================================

export type SubscriptionStatus = "trial" | "active" | "suspended" | "cancelled";

export type Account = {
  id: string;
  owner_user_id: string;
  plan: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  brand_name: string | null;
  support_email: string | null;
  support_wa: string | null;
  staff_limit: number;
  created_at: string;
};

export type TeamRole = "owner" | "staff";

export type TeamMember = {
  id: string;
  account_id: string;
  user_id: string;
  role: TeamRole;
  invited_at: string | null;
  joined_at: string | null;
  last_active_at: string | null;
  created_at: string;
};

export type MatchMode = "exact" | "tol_rp" | "tol_pct";

/** Phase 9.1: Named Match Rules preset */
export type MatchRulePreset = {
  id: string;
  account_id: string;
  name: string;
  jenis: "kredit" | "debet" | "both";
  lookback_days: number;
  forward_window_days: number;
  match_mode: MatchMode;
  tolerance_rp: number;
  tolerance_pct: number;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountSettings = {
  account_id: string;
  lookback_days_kredit: number;
  forward_window_days_kredit: number;
  match_mode_kredit: MatchMode;
  match_tolerance_rp_kredit: number;
  match_tolerance_pct_kredit: number;
  last_input_date_kredit: string | null;
  lookback_days_debet: number;
  forward_window_days_debet: number;
  match_mode_debet: MatchMode;
  match_tolerance_rp_debet: number;
  match_tolerance_pct_debet: number;
  last_input_date_debet: string | null;
  debet_highlight_same_color: boolean;
  updated_at: string;
};

// ============================================================
// Domain
// ============================================================

export type Bank = {
  id: string;
  account_id: string;
  kode: string; // BSI, BCA, MANDIRI, BRI, BNI, DANA, OVO, etc.
  label: string | null;
  parser_id: string; // BSI_BSINET_PDF, BSI_BYOND_PDF, BCA_KLIKBCA_HTML, etc.
  is_active: boolean;
  urutan: number;
  created_at: string;
  recon_last_saldo?: number | null; // saldo akhir mutasi terakhir yg diupload (deteksi bolong)
  recon_last_date?: string | null;  // tanggal transaksi terakhir mutasi terakhir
};

export type Outlet = {
  id: string;
  account_id: string;
  nama: string;
  warna_hex: string;
  urutan_palette: number;
  created_at: string;
};

export type Jenis = "kredit" | "debet";

export type CekSession = {
  id: string;
  account_id: string;
  user_id: string;
  jenis: Jenis;
  period_mutasi_start: string | null;
  period_mutasi_end: string | null;
  total_input: number;
  total_matched: number;
  total_unmatched: number;
  total_conflict: number;
  total_nominal_input: number;
  total_nominal_matched: number;
  carry_over_used: boolean;
  multi_bank_used: boolean;
  created_at: string;
  completed_at: string | null;
};

export type ParsedTransaction = {
  id: string;
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
  claimed_by_input_id: string | null;
  claimed_at: string | null;
  manual_claim_reason: string | null;
  first_seen_session_id: string | null;
  created_at: string;
};

export type MatchStatus = "matched" | "no_candidate" | "all_taken" | "manual_claimed";

export type CekInput = {
  id: string;
  session_id: string;
  account_id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: Jenis;
  match_status: MatchStatus | null;
  matched_tx_id: string | null;
  conflict_count: number | null;
  conflict_dates: string[] | null;
  manual_claim_reason: string | null;
  manual_claimed_at: string | null;
  created_at: string;
};

// ============================================================
// Client-side runtime types (during cek mutasi flow, not persisted)
// ============================================================

/** PDF transaction parsed in browser, before persisting */
export type PdfTransaction = {
  no: number;
  page: number;
  tanggal: string;
  tanggalDate: Date;
  waktu: string;
  namaPengirim: string;
  deskripsi: string;
  kredit: number;
  bbox: {
    yBottom: number;
    height: number;
    xLeft: number;
    width: number;
  };
  /** Phase 4.3: parsed_transactions.id — set untuk carry-over txs supaya bisa di-link matched_tx_id */
  parsedTxId?: string;
  /** Phase 4.3: 'current' = dari PDF yang lagi dilihat, 'carryover' = dari history (highlight di-skip) */
  source?: "current" | "carryover";
  /** Phase 1E.2: bank yang punya tx ini — dipakai matching pool multi-bank */
  bankId?: string;
  /** Fase B rekonsiliasi: no referensi bank (kunci Pass-1 REF utk klaim gadai) */
  noRef?: string | null;
  /** Fase B: baris hasil lookup-ref yang SUDAH di-claim input lain (sesi lama/manual).
   *  Bukan kandidat matching — hanya utk deteksi "ref menunjuk mutasi terpakai". */
  claimedByOther?: boolean;
};

/** User input row during cek mutasi session */
export type UserInput = {
  id: string;
  tanggal: Date;
  outletId: string;
  /** Phase 1E.2: bank tujuan match (multi-bank). Empty string = "Semua bank" (cross-bank) */
  bankId: string;
  /** Phase 9.1: named rule preset yang dipakai untuk matching input ini */
  matchRuleId: string;
  nominal: number;
  match?: MatchResult;
  /** Fase B (klaim gadai): token ref FT BSI dari resi — kunci Pass-1 REF */
  refFt?: string | null;
  /** Fase B (klaim gadai): jam transfer di resi "HH:MM" — kunci Pass-2 */
  jamResi?: string | null;
  /** Fase B (klaim gadai): nama pengirim di resi (dibaca AI) — kunci Pass-2 */
  namaPengirimResi?: string | null;

  /** Identitas asal klaim — dibawa HANYA untuk laporan, tidak dipakai
   *  mencocokkan. Tanpa ini daftar "tidak ditemukan" cuma bisa menyebut
   *  nominal, dan pemiliknya tidak tahu kontrak mana yang harus dibuka. */
  noFaktur?: string | null;
  outletNama?: string | null;
};

/** Fase B: bagaimana sebuah input ter-match (label keyakinan) */
/** Cara MESIN mencocokkan, dari yang paling kuat ke yang paling lemah.
 *  NOMINAL_JAM ditambahkan 3 September 2026: nominal + jam pada HARI YANG SAMA,
 *  untuk resi yang jamnya terbaca tapi namanya tidak. NOMINAL tetap ada sebagai
 *  jaring terakhir — ia boleh salah kontrak, tapi nominalnya pasti sama. */
export type MatchedBy = "REF" | "NAMA_JAM" | "NOMINAL_JAM" | "NOMINAL";

/** Fase B: masalah ref yang perlu perhatian, apapun status akhirnya */
export type RefIssue = "REF_NOMINAL_BEDA" | "REF_SUDAH_DIKLAIM";

export type MatchResult = (
  | {
      status: "matched";
      txNo: number;
      txDate: Date;
      colorHex: string;
      txBankId?: string;
      matchedBy?: MatchedBy;
      /** Fase D: jumlah kandidat tersedia saat dipilih (>1 = tebakan ambigu) */
      ambiguous?: number;
    }
  | { status: "no_candidate" }
  | { status: "all_taken"; conflictCount: number; conflictDates: string[] }
) & { refIssue?: RefIssue };

export type MatchSummary = {
  totalInput: number;
  matched: number;
  noCandidate: UserInput[];
  allTaken: UserInput[];
  unclaimed: PdfTransaction[];
};
