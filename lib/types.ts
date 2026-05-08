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
};

/** User input row during cek mutasi session */
export type UserInput = {
  id: string;
  tanggal: Date;
  outletId: string;
  nominal: number;
  match?: MatchResult;
};

export type MatchResult =
  | { status: "matched"; txNo: number; txDate: Date; colorHex: string }
  | { status: "no_candidate" }
  | { status: "all_taken"; conflictCount: number; conflictDates: string[] };

export type MatchSummary = {
  totalInput: number;
  matched: number;
  noCandidate: UserInput[];
  allTaken: UserInput[];
  unclaimed: PdfTransaction[];
};
