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
  /** SIAPA yang memegang baris ini (kalau claimedByOther). Dibutuhkan aturan
   *  "bukti kuat mengusir bukti lemah": klaim ber-REF boleh mengambil baris
   *  yang dipegang klaim yang cocoknya cuma lewat nominal — dan TIDAK boleh
   *  menyentuh yang manual atau yang juga ber-REF. Tanpa identitas pemegang,
   *  aturan itu tidak bisa membedakan keduanya. */
  pemegang?: {
    inputId: string;
    matchedBy: string | null;
    manual: boolean;
    gadaiKlaimId: string | null;
    /** Nomor kontrak pemegang (cek_inputs.gadai_no_faktur). Hanya untuk
     *  KALIMAT: alarm REF_SUDAH_DIKLAIM harus bisa menyebut "baris ini sudah
     *  dipegang SJB-1-0250", bukan cuma "sudah dipakai input lain" — pemilik
     *  perlu tahu kontrak mana yang dibuka untuk menilai resi bekas atau bukan
     *  (uji resi bekas, 1 Okt 2026). Tidak dipakai mencocokkan. */
    noFaktur?: string | null;
  };
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
  /** true = klaim ini SUDAH memegang satu baris mutasi dari sesi sebelumnya.
   *  Klaim seperti ini tidak boleh ikut mengusir pemegang lain: hasilnya satu
   *  klaim memegang DUA baris — indeks unik tidak mencegahnya (ia menjaga
   *  satu baris satu klaim, bukan sebaliknya). */
  sudahMemegang?: boolean;
  /** 'MANUAL' = resi diketik owner di Lapis 1 (bukan bacaan AI). Dibawa ke
   *  pencocokan supaya korban sepak yang manual dikenali dari SUMBERNYA,
   *  bukan hanya dari pola id-nya. */
  sumber?: string | null;
  /** true = klaim ini sudah memegang baris di cek-mutasi (sesi lama) tapi di
   *  gadai masih PENDING (vonisnya gagal terkirim). Ia tidak boleh mengusir
   *  dan tidak dicocokkan ulang, TAPI tetap dilaporkan lewat jalur SESI_LAMA
   *  supaya vonisnya akhirnya sampai. Berbeda dari sudahMemegang (dari daftar
   *  `pemegang` gadai) yang tidak dilaporkan sama sekali. */
  tidakBolehMengusir?: boolean;

  /** Identitas asal klaim — dibawa HANYA untuk laporan, tidak dipakai
   *  mencocokkan. Tanpa ini daftar "tidak ditemukan" cuma bisa menyebut
   *  nominal, dan pemiliknya tidak tahu kontrak mana yang harus dibuka. */
  noFaktur?: string | null;
  outletNama?: string | null;

  /** Tanggal TRANSAKSI gadai (bukan tanggal resi), UTC-noon. `tanggal` di
   *  atas adalah tanggal RESI (tgl_transfer) — kunci jendela pencocokan.
   *  Yang ini dipakai untuk satu pertanyaan saja: "apakah baris mutasi yang
   *  dipakai klaim ini JAUH lebih tua daripada transaksinya?" — tanda resi
   *  bekas. Kejadian nyata: SJB-10-1386 (LHOKSEUMAWE, transaksi 1 Sep 2026,
   *  Rp 80.000) memakai resi Junaidi 29 Jun FT261805QY44 dan cocok lewat REF
   *  ke baris 29 Juni tanpa satu peringatan pun (uji resi bekas, 1 Okt 2026).
   *  undefined = tidak diketahui (layar /check lama tidak membawanya) —
   *  pagar yang memakainya DIAM, bukan menganggap "baru". */
  tanggalTransaksi?: Date | null;
};

/** Fase B: bagaimana sebuah input ter-match (label keyakinan) */
/** Cara MESIN mencocokkan, dari yang paling kuat ke yang paling lemah.
 *  NOMINAL_JAM ditambahkan 3 September 2026: nominal + jam pada HARI YANG SAMA,
 *  untuk resi yang jamnya terbaca tapi namanya tidak. NOMINAL tetap ada sebagai
 *  jaring terakhir — ia boleh salah kontrak, tapi nominalnya pasti sama.
 *  NAMA ditambahkan 27 September 2026: nama pengirim SAMA PERSIS + nominal,
 *  ±1 hari, untuk resi yang namanya terbaca tapi jamnya tidak (resi DANA).
 *  Urutan kekuatan: REF > NAMA_JAM > NAMA ≈ NOMINAL_JAM > NOMINAL. NAMA
 *  termasuk yang LEMAH: klaim ber-REF yang menunjuk barisnya boleh
 *  mengusirnya (lihat LEMAH di lib/matching.ts). */
export type MatchedBy = "REF" | "NAMA_JAM" | "NAMA" | "NOMINAL_JAM" | "NOMINAL";

/** Fase B: masalah ref yang perlu perhatian, apapun status akhirnya */
export type RefIssue = "REF_NOMINAL_BEDA" | "REF_SUDAH_DIKLAIM"
  /** Klaim ini DISEPAK dari barisnya oleh klaim ber-REF, lalu pencocokan
   *  ulangnya TIDAK ketemu. Bukan "uang tidak ada" — uangnya ada, cuma bukan
   *  milik klaim ini. Harus dicocokkan manusia. */
  | "DISEPAK";

/** Nilai ref_issue yang DIKIRIM ke gadai (/api/transfer-klaim/result).
 *  MUTASI_LAMA SENGAJA bukan anggota RefIssue: ia tidak lahir di pencocokan
 *  dan tidak mengubah vonis — ia PERINGATAN yang ditempel jalankanPass pada
 *  klaim yang tetap MATCHED (dikirim matched:true), karena baris mutasinya
 *  lebih dari 3 hari lebih tua daripada transaksinya. Bayar di muka sampai
 *  ±44 hari memang terjadi, jadi ini minta konfirmasi, bukan menolak. */
export type RefIssueKirim = RefIssue | "MUTASI_LAMA";

/** Pemegang baris yang ditunjuk REF klaim yang kalah (REF_SUDAH_DIKLAIM).
 *  Dibawa supaya alarmnya bisa berkata "REF menunjuk baris yang sudah
 *  dipegang <kontrak> — kemungkinan resi bekas", bukan "nomor resi
 *  bermasalah" / "tidak ada di rekening" yang mengirim orang mencari uang
 *  yang tidak hilang (uji resi bekas, 1 Okt 2026). */
export type PemegangRef = {
  /** Tanggal baris mutasi, YYYY-MM-DD. */
  tanggal: string;
  kredit: number;
  parsedTxId: string | null;
  /** cek_inputs.id pemegang dari sesi lama; null kalau pemegangnya klaim
   *  lain di jalan INI atau identitasnya tidak terbaca. */
  inputId: string | null;
  gadaiKlaimId: string | null;
  noFaktur: string | null;
  /** Cara pemegang dulu mencocokkan baris ini (REF / NAMA_JAM / NOMINAL /
   *  NAMA / MANUAL…), kalau diketahui. Pemegang yang cuma menebak lewat
   *  nominal bisa saja yang keliru — alarmnya harus menyebut dua kemungkinan. */
  caraPemegang?: string | null;
  /** true = baris diambil klaim lain pada jalan yang sama (dua resi ber-REF
   *  sama dalam satu sapuan). */
  diJalanIni: boolean;
};

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
  | {
      status: "all_taken"; conflictCount: number; conflictDates: string[];
      /** true = mesin MENOLAK MENEBAK lintas hari: baris bernominal sama ADA
       *  dan MASIH BEBAS pada `conflictDates`, tapi harinya beda dan nominal
       *  itu sedang diperebutkan / baris hari sendiri sudah diambil. Ini BUKAN
       *  "sudah ke-claim input lain" — `conflictCount` di sini menghitung
       *  baris BEBAS. Sengaja tidak memakai refIssue: refIssue membuat klaim
       *  dikirim ke gadai sebagai UNMATCHED + alarm (jalankanPass). Disimpan
       *  ke kolom cek_inputs.ref_issue sebagai 'BEDA_HARI_BEBAS' (save.ts). */
      barisBebas?: boolean;
      /** true = baris bernominal sama di HARI RESI SENDIRI sudah dipegang
       *  klaim lain. Tanda yang sama dengan resi kembar SJB-1-0186 (kasir
       *  mencatat satu pembayaran dua kali): baris bebas di hari lain bisa
       *  saja uang nasabah lain. Layar WAJIB menyebutnya, bukan hanya
       *  "baris bebas" (temuan peninjau 27 Sep 2026). */
      hariSendiriDipegang?: boolean;
      /** true = SEMUA baris bebas bernominal sama dibantah resinya sendiri:
       *  jam resi meleset >5 menit DAN nama pengirim resi tidak cocok dengan
       *  nama baris (resiBertentangan, lib/matching.ts). Selalu bersama
       *  barisBebas — barisnya bebas, mesin menolak menebaknya. Dicatat
       *  jalankanPass sebagai DITAHAN (bukan UNMATCHED) dan disimpan ke
       *  cek_inputs.ref_issue sebagai 'BERTENTANGAN…' (save.ts). Asal:
       *  SJB-2-0056 (11 Agu 2026) — resi ANDINI SAHPUTRI 12:03 mengambil baris
       *  MUHAMMAD SIDDIQ 12.15 lewat tebakan nominal. */
      bertentangan?: boolean;
      /** Hanya untuk refIssue REF_SUDAH_DIKLAIM dari PASS 1: siapa yang
       *  memegang baris yang ditunjuk REF klaim ini, terdekat tanggalnya lebih
       *  dulu. Tidak mengubah arti refIssue; hanya bahan kalimat alarm. */
      dipegang?: PemegangRef[];
    }
) & { refIssue?: RefIssue };

export type MatchSummary = {
  totalInput: number;
  matched: number;
  noCandidate: UserInput[];
  allTaken: UserInput[];
  unclaimed: PdfTransaction[];
  /** Pengusiran yang terjadi pada jalan ini: baris X pindah dari klaim lemah
   *  ke klaim ber-REF. Pemanggil WAJIB mempersistenkan pelepasan pemegang lama
   *  SEBELUM menyimpan sesi — kalau tidak, indeks unik di database menolak
   *  pemegang baru dan RPC klaim diam-diam melewatinya. */
  disepak?: {
    txKey: string;
    parsedTxId: string | null;
    noRef: string | null;
    tanggal: string;
    kredit: number;
    pemegangInputId: string;
    pemegangKlaimId: string;
    pemegangMatchedBy: string | null;
    olehKlaimId: string;
    olehNoFaktur: string | null;
  }[];
};
