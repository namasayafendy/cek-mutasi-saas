# Cek Mutasi — Commercial SaaS Project Plan

> **Status**: Planning phase. Versi personal (non-komersial) sudah jalan dan dipakai owner sehari-hari. Versi komersial akan dibangun di folder/repo terpisah, copy dari versi personal sebagai starting point.

---

## 1. Vision & Target Market

**Produk**: Aplikasi web SaaS untuk rekonsiliasi mutasi rekening bank dengan tagihan/penjualan/cicilan customer.

**Pain point yang dipecahkan**: Owner UMKM rekonsiliasi transferan masuk/keluar secara manual — buang waktu 1-3 jam/minggu, rawan salah hitung.

**Target market** (siapa yang paling butuh):
- Pegadaian (gadai syariah & konvensional)
- Koperasi simpan-pinjam
- Sekolah/pesantren (penerimaan SPP via transfer)
- Kos-kosan, properti sewa (cicilan bulanan)
- Reseller online (verifikasi pembayaran customer)
- Leasing motor/mobil kecil
- Bisnis dengan multi-cabang yang setor harian ke pusat

**Differentiator vs kompetitor (Mekari, Accurate, Jurnal, dll)**:
- Fokus simple, satu fitur dikerjakan extremely well
- Harga terjangkau untuk UMKM
- **PDF processed client-side** — privacy by design (selling point besar)
- Bahasa Indonesia native
- Multi-bank + e-wallet support

---

## 2. Current State (Versi Personal)

Folder kerja: `D:\aplikasi cek mutasi bank\`. Dipakai owner sehari-hari, tidak akan diubah lagi (frozen).

Stack saat ini:
- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Supabase (Auth + Postgres + RLS)
- pdfjs-dist (parser, client-side)
- pdf-lib (output PDF dengan highlight, client-side)
- Hosted di Vercel (mutasi.acehgadaisyariah.com)

Fitur yang sudah ada:
- Login (Supabase Auth, manual user creation via dashboard)
- Outlet management (palette 20 warna otomatis)
- Upload PDF mutasi BSI → parse → tampil viewer
- Bulk input per outlet+tanggal
- Realtime highlight overlay
- Generate PDF terhighlight + lampiran rekap
- Catatan tanggal terakhir input

Parser sudah dynamic detect column dari header (adaptif ke variasi layout BSI).

---

## 3. Commercial Version — Decisions Locked

### 3.1 Business Model

| Aspek | Keputusan |
|---|---|
| Pricing structure | **Single tier flat**, harga TBD oleh owner |
| Trial period | 7 hari, full access |
| Payment gateway | **Midtrans** (QRIS, VA BCA/Mandiri/BRI/BNI, GoPay, OVO) |
| Billing model | Recurring monthly subscription |
| Bahasa default | Indonesia |
| Brand name | TBD (placeholder: pakai "Cek Mutasi" dulu) |
| Domain | Vercel subdomain dulu, domain custom belakangan |
| Payment method | Auto-debit (kalau bisa) atau manual VA dengan auto-reconcile |

### 3.2 Concept Model

**Account** (tenant): satu owner = satu account = satu subscription.

**Owner**: signup pertama jadi owner. Punya full access ke account.

**Staff**: di-invite owner via email. Akses terbatas (cek mutasi only, tidak bisa manage outlet/bank/billing). Aktivitasnya tercatat di log untuk owner verify.

**Outlets**: cabang/lokasi dalam bisnis owner. Tiap outlet punya warna highlight. Optional (bisnis 1 lokasi tidak wajib pakai).

**Banks**: rekening yang dipakai owner terima/kirim transfer. Tiap entry punya kode bank (BCA, BSI, dst) + label custom (default = nama bank). Bisa di-on/off di dashboard.

**Multi-rekening sama bank — 2 mode**:
- **Mode merge (default)**: owner tambah 1 entry saja "BCA" (tanpa label custom). Upload 2 PDF mutasi BCA → keduanya di-tag ke entry "BCA" yang sama → transaksi **digabung** jadi 1 pool. Dropdown saat input cuma tampil "BCA". Sistem dedup pakai `no_ref` supaya tidak duplikat antar PDF.
- **Mode separate**: owner tambah 2 entry dengan label custom: "BCA Pusat" dan "BCA Cabang". Upload tiap PDF di-tag ke entry yang spesifik → transaksi **terpisah** sebagai 2 source. Dropdown saat input tampil keduanya.

Mode dipilih di config bank di Settings, bukan di runtime — kalau owner mau ubah cara perlakuan, edit entry-nya.

**E-wallet**: diperlakukan sama seperti bank di model data. Konsep "bank" di kode = "sumber rekening", termasuk e-wallet (Dana, OVO, GoPay, ShopeePay, Seabank, Bank Jago, Allo Bank).

### 3.3 Matching Rules (configurable per account)

Setting di dashboard owner — terpisah untuk **kredit** dan **debet** (bisa beda):

- **Lookback period**: 0 (exact only) / 1 / 3 (default) / 7 / custom hari
- **Forward window**: off (default) / 1 / 3 / 7 / custom hari
- **Match mode**:
  - Exact (default): nominal harus sama persis
  - Tolerance rupiah: ± Rp X (untuk handle biaya admin transfer)
  - Tolerance percent: ± Y% (untuk QRIS yang potong %)
- **Duplicate handling**: First-claim-wins (current behavior, locked — tidak ada opsi lain)
- **Highlight color debet**: same as outlet color (default) atau custom warna terpisah

### 3.4 Multi-Bank Search Flow

**Default**: per-bank strict. User upload PDF dengan tag bank, input data juga tag bank, sistem cari di PDF bank yang match.

**Multi-bank cross-search (opt-in)**: setelah ada leftover (input yang tidak match), user bisa centang opsi "cari di semua bank". Saat dicentang, dropdown bank di-disable, sistem cari di semua leftover transaksi dari semua bank yang di-upload, dalam range tanggal sesuai rules.

### 3.5 Carryover Unclaimed

Default: setiap upload baru, sistem otomatis include unclaimed transactions dari history sebelumnya ke matching pool. Ada checkbox "Sertakan transaksi belum ter-claim dari periode sebelumnya" — default ON, user bisa uncheck.

### 3.6 Dedup Identifier (untuk overlap upload)

Primary key dedup: **No.Referensi**.
Fallback (kalau bank tidak punya no.ref): tuple `(tanggal, jam, nominal, saldo)`.

### 3.7 History Storage

- Parsed transactions + match results disimpan **maksimal 12 bulan** (configurable).
- PDF asli **tidak disimpan** di server (privacy + storage cost).
- Metadata upload (filename, page count, tx count, uploaded_at, uploaded_by) disimpan untuk audit.

### 3.8 Manual Claim with Reason

Di menu History, owner bisa klik transaksi unclaimed → "Claim manual" → form:
- Outlet
- Bank (auto-fill dari transaksi)
- Reason / catatan (text field wajib)

Manual claim ini ter-track di audit log, owner bisa filter transaksi yang di-claim manual.

### 3.9 Staff Activity Log

Setiap session cek mutasi tercatat dengan:
- Siapa yang melakukan (user_id staff)
- Kapan dilakukan (timestamp)
- Periode mutasi yang di-cek (date range PDF)
- Jumlah input
- Jumlah match / unmatched / conflict
- Total nominal input vs total nominal match

Owner buka menu **Activity Log** → filter by staff, by date → cocokkan dengan POS/buku catatan untuk verifikasi staff bekerja benar.

### 3.10 Auto-detect Bank — TIDAK dipakai

User selalu pilih bank manual dari dropdown sebelum upload. Lebih reliable, tidak ada risk salah detect.

---

## 4. Feature List (Commercial Version)

### 4.1 Owner-facing (User App)

**Dashboard**:
- Catatan tanggal terakhir input
- Statistik bulan ini: total input, total matched, total unmatched
- Quick action: mulai cek mutasi (kredit/debet)
- Reminder kalau ada unclaimed dari periode sebelumnya

**Pre-Cek Setup** (saat baru daftar atau di Settings):
- Atur banks yang aktif (on/off + tambah rekening dengan label, atau merge mode)
- Atur outlets (nama + warna)
- Atur matching rules (lookback, forward window, match mode, tolerance) per kredit & debet
- Atur warna highlight debet (same / custom)

**Menu: Cek Mutasi Kredit**:
- Step 1 — Upload mode: pilih bank → upload PDF → ulangi untuk bank lain → klik mulai cek
- Step 2 — Input mode: tabel form bulk input dengan kolom (tgl, outlet, bank, nominal). Bisa input multi-row dulu, baru klik "Cocokkan". Outlet & bank dari dropdown yang sudah di-config.
- Step 3 — Hasil: split view PDF dengan highlight + summary panel + tombol multi-bank cross-search untuk leftover
- Step 4 — Selesai: download PDF profesional + simpan ke history otomatis

**Menu: Cek Mutasi Debet**: identik struktur dengan Kredit, beda hanya filter (transaksi keluar).

**Menu: History**:
- List semua session cek (filter by tanggal, jenis, staff)
- Detail per session: input, matched, unmatched, conflict, manual claim
- Unclaimed transactions yang carry-over masih bisa di-claim manual
- Manual claim dengan reason

**Menu: Rekap**:
- Filter range tanggal, jenis (kredit/debet), bank, outlet, status (matched/unmatched/all)
- Total nominal claimed vs unclaimed
- Breakdown per bank, per outlet
- Export PDF / Excel

**Menu: Activity Log** (owner only):
- Aktivitas semua staff
- Filter by staff, by date range
- Detail per aktivitas: total input, hasil match, jumlah nominal

**Menu: Staff Management** (owner only):
- List staff
- Invite staff baru via email
- Hapus staff
- Reset password staff

**Menu: Settings**:
- Banks (CRUD, on/off, label, merge vs separate mode)
- Outlets (CRUD, warna)
- Matching rules (kredit + debet)
- Profile (nama bisnis, email, password)

**Menu: Akun & Tagihan**:
- Status subscription (trial/active/expired)
- Sisa hari trial
- Tanggal renewal
- List invoice
- Tombol bayar / upgrade / cancel
- Update payment method

**Menu: Bantuan**:
- Tombol kontak email
- Tombol kontak WA (deeplink ke wa.me)
- FAQ / docs link

### 4.2 Super-Admin Dashboard (untuk Anda — owner platform)

URL terpisah, hanya bisa diakses dengan role `superadmin`:

- List semua account
- Filter: status (trial/active/suspended/cancelled), tanggal daftar
- MRR (Monthly Recurring Revenue)
- Trial conversion rate
- Churn rate
- Per account: detail user, billing history, usage (jumlah cek, jumlah upload)
- Tools manual: extend trial, suspend, refund, ubah plan, reset password owner
- Lifecycle automation status (pending reminders, suspensions due)

**Lifecycle Automation** (background jobs, Supabase Edge Functions / Vercel Cron):
- H-2 sebelum trial habis → email reminder
- Trial habis tanpa upgrade → suspend (read-only mode)
- H-3 sebelum subscription expire → email reminder bayar
- Subscription expired → grace 3 hari → suspend → 30 hari → soft delete data
- Pembayaran masuk via Midtrans webhook → auto reactivate + invoice generated

---

## 5. Data Model (Supabase Postgres)

### 5.1 Tables

```
accounts
  id, owner_user_id, plan, status, trial_ends_at,
  current_period_start, current_period_end, cancelled_at,
  brand_name, support_email, support_wa, created_at

team_members
  id, account_id, user_id (auth.users), role (owner/staff),
  invited_at, joined_at, last_active_at

banks
  id, account_id, kode (BSI|BCA|MANDIRI|BRI|BNI|...|DANA|OVO|...),
  label, parser_id, is_active, created_at

outlets
  id, account_id, nama, warna_hex, urutan_palette, created_at

account_settings
  account_id (PK),
  lookback_days_kredit, lookback_days_debet,
  forward_window_days_kredit, forward_window_days_debet,
  match_mode_kredit (exact|tol_rp|tol_pct),
  match_mode_debet,
  match_tolerance_rp_kredit, match_tolerance_rp_debet,
  match_tolerance_pct_kredit, match_tolerance_pct_debet,
  debet_highlight_same_color (bool),
  last_input_date_kredit, last_input_date_debet

cek_sessions
  id, account_id, user_id, jenis (kredit|debet),
  period_mutasi_start, period_mutasi_end,
  total_input, total_matched, total_unmatched, total_conflict,
  total_nominal_input, total_nominal_matched,
  carry_over_used (bool), multi_bank_used (bool),
  created_at, completed_at

pdf_uploads
  id, session_id, bank_id, file_name, page_count,
  transaction_count, uploaded_at

parsed_transactions
  id, account_id, bank_id, no_ref (nullable),
  tanggal, jam, nominal_kredit, nominal_debet,
  nama_pengirim, nama_penerima, deskripsi, saldo,
  page, bbox_y_bottom, bbox_height,
  fingerprint (hash dari tgl+jam+nominal+saldo, fallback dedup),
  claimed_by_input_id (nullable), claimed_at,
  first_seen_session_id, created_at
  UNIQUE(account_id, bank_id, no_ref) WHERE no_ref IS NOT NULL
  UNIQUE(account_id, bank_id, fingerprint) WHERE no_ref IS NULL

cek_inputs
  id, session_id, tanggal_input, outlet_id, bank_id,
  nominal, jenis (kredit|debet),
  match_status (matched|no_candidate|all_taken|manual_claimed),
  matched_tx_id (FK parsed_transactions),
  conflict_count, conflict_dates (JSONB),
  manual_claim_reason (nullable), manual_claimed_at,
  created_at

audit_logs
  id, account_id, user_id, action, target_type, target_id,
  metadata (JSONB), created_at

subscription_invoices
  id, account_id, period_start, period_end, amount,
  status (pending|paid|failed|refunded),
  midtrans_order_id, midtrans_transaction_id,
  paid_at, due_date, created_at
```

### 5.2 RLS Strategy

- Helper function `current_account_id()` dari JWT custom claim atau lookup `team_members`.
- Semua tabel di-filter `account_id = current_account_id()`.
- Role staff: tabel `banks`, `outlets`, `account_settings`, `team_members`, `subscription_invoices` → read-only, write blocked. Owner role → full access.
- Service role key (server-side only) untuk admin dashboard + Midtrans webhook.

---

## 6. Roadmap / Phases

**Phase 0 — Setup commercial environment** (2-3 hari):
- New Supabase project + Vercel project + GitHub repo (commercial-cek-mutasi)
- Copy current code as starting point
- Setup new schema + migrations
- Auth refactor: account model dengan owner+staff
- Folder & repo separation

**Phase 1 — Core architecture refactor** (1 minggu):
- Banks management (CRUD + merge vs separate mode + parser routing)
- Refactor outlets per-account
- Matching rules configuration UI
- Multi-PDF upload flow (queue per bank)
- Update parser system: plugin per bank (BSI sudah ada)

**Phase 2 — Multi-bank parsers** (~2-3 hari per bank, paralel):
- BCA, Mandiri, BRI, BNI (top 4 conventional)
- Bank Aceh Syariah, CIMB Niaga
- Owner provide sample PDFs sebelum start
- E-wallet: Dana, OVO, GoPay, ShopeePay (~2 hari per platform)

**Phase 3 — Cek debet menu** (3-4 hari):
- Mirror struktur cek kredit
- Highlight handling untuk debet (same/custom color)
- Match rules debet terpisah

**Phase 4 — History & carry-over** (1 minggu):
- Persist parsed transactions + sessions
- Dedup logic (no_ref + fingerprint fallback)
- Carry-over toggle saat upload baru
- Manual claim with reason di History menu
- Multi-bank cross-search untuk leftover

**Phase 5 — Rekap & filter** (3-4 hari):
- Rekap menu dengan filter lengkap
- Export PDF (profesional layout) + Excel

**Phase 6 — Staff & activity log** (1 minggu):
- Multi-user dengan role (owner/staff)
- Invite staff via email
- Activity log per staff
- Permission gating

**Phase 7 — Subscription & billing** (1-2 minggu):
- Midtrans integration
- Subscription lifecycle (trial → active → expired → suspended)
- Auto-email reminders (Resend / Supabase Edge Functions)
- Customer self-service: invoice, payment method, cancel

**Phase 8 — Super admin dashboard** (1 minggu):
- Account list, MRR, churn, conversion
- Manual tools: extend trial, suspend, refund

**Phase 9 — Output PDF profesional** (3-4 hari):
- Redesign output PDF: header brand, page number, table style
- Lampiran rekap dengan layout report

**Phase 10 — Polish & launch prep**:
- Onboarding flow (welcome wizard, demo data)
- Customer support button (email + WA deeplink)
- Settings & profile page
- Soft launch ke 5-10 beta tester
- Bug fixes + performance tuning

---

## 7. Open Questions / Future Considerations

**Belum diputuskan, simpan untuk fase setelah MVP**:

- WhatsApp reminder proaktif ke customer (butuh customer database / recurring billing rules per customer)
- Smart column mapping import Excel (Phase setelah core jadi)
- Plugin per software POS (Moka, Pawoon, dst) — kalau ada permintaan
- Late payment detection / anomaly alerts
- Customer database lite (CRM mini)
- Bank API integration (BCA OpenAPI) untuk real-time data
- Email forwarding bank untuk real-time
- API public untuk integrasi pihak ketiga
- Multi-account user (1 user manage banyak biz) — currently 1 user = 1 account
- Multi-bahasa (English, dll)
- Mobile app native

**Dependency dari owner**:
- Sample PDF mutasi tiap bank + e-wallet (untuk pembuatan parser)
- Konfirmasi harga subscription final
- Brand name + domain saat siap launch
- Email + WA contact untuk customer support
- Logo brand untuk PDF output

---

## 8. Risk Log

| Risiko | Severity | Mitigation |
|---|---|---|
| Bank ubah format PDF | High (sudah terjadi 2x) | Dynamic column detection + monitoring (alert kalau parser return 0 tx) + cepat respond |
| Parser plugin per bank kompleks ter-maintain | Medium | Test suite per bank, automated regression tests dengan sample PDF |
| Customer dispute soal akurasi matching | Medium | Audit log lengkap, TOS yg jelas (manusia tetap perlu cross-check) |
| Privacy concern soal data mutasi | Low (PDF client-side) | Selling point: "PDF tidak pernah leave browser". Server hanya simpan parsed metadata, bukan PDF. |
| Midtrans payment failure | Medium | Retry logic, fallback manual transfer, grace period 3 hari sebelum suspend |
| Scaling 1000-10000 user | Low | Supabase + Vercel scale OK dengan proper indexing & RLS. Edge functions untuk lifecycle automation. |
| Staff abuse log (input asal) | Low | Owner cek log harian. Activity log sebagai accountability. |

---

## 9. Operating Notes

**Commercial vs Personal isolation**:
- Folder personal: `D:\aplikasi cek mutasi bank\` — frozen, tidak diubah lagi
- Folder commercial: TBD (saran: `D:\cek-mutasi-saas\`) — copy dari personal sebagai starting point
- Repo terpisah di GitHub
- Project Supabase terpisah (cek-mutasi-saas)
- Project Vercel terpisah

**Code conventions**:
- TypeScript strict
- Bahasa Indonesia di UI strings, English di code/comment
- Indonesian-friendly: format rupiah (titik separator), tanggal DD-MM-YYYY, timezone WIB
- File naming: kebab-case
- Component: PascalCase
- Function: camelCase

---

## 10. Definition of Done (per Phase)

Setiap fase dianggap selesai kalau:
1. Semua task di phase done dan ter-deploy ke staging
2. Manual end-to-end test pass
3. Build pass tanpa error
4. RLS policies tested (staff tidak bisa akses data outside their account)
5. Owner review & approve
6. Updated di file plan ini (mark phase as done)

---


*Last updated*: 2026-05-08 — Phase 5 (Rekap) + Phase 4.3 (Carry-over + Manual claim) + Tab Mutasi + Phase 6 (Staff + Activity Log) ready for testing.

**Phase 0 progress:**
- [x] Folder commercial dibuat: `D:\cek-mutasi-saas\` (copy dari personal)
- [x] Supabase project commercial dibuat: `cek-mutasi-saas` (ref: `rebalnxqisjxfhcvakmb`)
- [x] GitHub repo dibuat: `https://github.com/namasayafendy/cek-mutasi-saas.git`
- [x] `.env.local` updated dengan kredensial Supabase commercial
- [x] Schema commercial applied ke Supabase (12 tables + RLS + helpers + signup trigger). Lihat `supabase/migrations/0001_init.sql`.
- [ ] Wipe `.git` lama dari folder commercial (owner action via PowerShell — locked dari sandbox)
- [ ] Init git baru + push ke GitHub repo commercial (owner action)
- [ ] Buat Vercel project + link ke GitHub repo + set env vars (owner action)

**Status code**: existing code (copy dari personal) masih reference tabel lama (`user_settings` sudah tidak ada, `outlets` masih ada tapi schema beda — ada `account_id` baru). Build akan pass (TypeScript compile OK) tapi runtime akan error di `/dashboard` saat fetch `user_settings`. Itu normal — akan di-refactor di Phase 1 (auth multi-tenant + code update).

**Helper function rename**: `current_role()` (PostgreSQL reserved) → `current_team_role()`. Sudah konsisten di migration applied.
