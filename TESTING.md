# Testing Checklist

> Akumulasi test scenarios per phase. Siap untuk dites saat owner ready.
> Format: ✅ pass / ❌ fail / ⏳ pending

---

## Phase 0 — Setup Environment

- ✅ Login + signup verified working
- ✅ Multi-tenant trigger creates account + owner team_member + settings
- ✅ Trial 7 hari otomatis ter-set

---

## Phase 1A — Auth & Data Layer Refactor

- ✅ Halaman /daftar tampil dengan link dari /login
- ✅ Signup flow buat user baru, auto-create account, redirect ke dashboard
- ✅ Dashboard tampil dengan brand_name kalau ada
- ✅ Subscription banner: trial countdown muncul kalau ≤3 hari
- ✅ Tambah outlet jalan (multi-tenant via account_id)
- ⏳ Multi-account isolation: bikin 2 akun beda email, masing-masing tidak boleh lihat data satu sama lain (test di Supabase dashboard, query outlets dari user lain via auth context)

---

## Phase 1C — Bank Management

Test scenarios untuk `/banks`:

- ⏳ Halaman tampil dengan kosong state "Belum ada rekening"
- ⏳ Klik "Tambah Rekening" → form muncul dengan dropdown grouped (Bank vs E-Wallet)
- ⏳ Pilih BSI BSINet → status "Ready" muncul, hint terlihat
- ⏳ Pilih Mandiri → status "Coming Soon" + warning password required
- ⏳ Tambah BSI BSINet tanpa label → ter-create
- ⏳ Tambah BSI BSINet kedua tanpa label → error "Sudah ada bank BSI..."
- ⏳ Tambah BSI BSINet kedua dengan label "BSI Pusat" → ter-create, multi-rekening separate mode
- ⏳ Edit label inline → save berhasil
- ⏳ Toggle on/off → reflect di UI dan database
- ⏳ Delete bank → confirm dialog muncul, delete success
- ⏳ Tips section tampil di bawah dengan penjelasan merge vs separate

---

## Phase 1D — Matching Rules

Test scenarios untuk `/aturan`:

- ⏳ Halaman tampil dengan default values: kredit/debet keduanya lookback 3, forward 0, exact mode
- ⏳ Ubah lookback kredit ke 7 (preset button) → button highlight
- ⏳ Ubah lookback custom (misal 5) → input number muncul, save
- ⏳ Ubah match mode kredit ke "Toleransi Rp" → field tolerance Rp muncul
- ⏳ Ubah match mode kredit ke "Toleransi %" → field tolerance % muncul
- ⏳ Ubah aturan debet beda dari kredit → save
- ⏳ Toggle "warna highlight sama untuk kredit & debet"
- ⏳ Klik Simpan → message "Tersimpan" muncul, refresh halaman → settings persist
- ⏳ Cek di Supabase dashboard tabel `account_settings` → row Anda update sesuai

---

## Phase 1E Round 1 — Cek Mutasi Flow Refactor

Test scenarios untuk `/check?jenis=kredit` dan `/check?jenis=debet`:

- ⏳ URL `/check` default ke jenis=kredit
- ⏳ URL `/check?jenis=debet` ke debet mode
- ⏳ Title page sesuai jenis: "Cek Mutasi Kredit (Transaksi Masuk)" / "Cek Mutasi Debet (Transaksi Keluar)"
- ⏳ Bank dropdown muncul, hanya bank ready+active yang listed
- ⏳ Pilih bank "BSI BSINet", upload PDF sample → parse berhasil, ada count transaksi
- ⏳ Header check page tampil rules summary: "Aturan: lookback Xh, forward Yh, mode"
- ⏳ Aturan dari /aturan reflect di matching (test: ubah lookback ke 7, upload, input dengan tanggal yg lebih jauh, harusnya match)
- ⏳ Forward window: ubah forward window ke 3, input dengan tanggal H-2 dari tx PDF, harusnya match
- ⏳ Match mode Toleransi Rp: ubah toleransi 1000, input nominal beda Rp 500 dari tx → match
- ⏳ Match mode Toleransi %: input QRIS-like nominal beda 0.7% → match
- ⏳ Pilih bank yg "Coming Soon" (Mandiri/BCA) → warning + refuse upload
- ⏳ Switch jenis ke debet, upload PDF yang sama → tampil rows debet (TRF Ke / biaya)
- ⏳ Download PDF terhighlight → file ter-download dengan nama `mutasi-kredit-YYYY-MM-DD.pdf` atau `mutasi-debet-...`
- ⏳ Last input date_kredit / date_debet update sesuai jenis

---

## Phase 4 Round 1 — Persist Transactions + Dedup

Test scenarios untuk auto-dedup history:

- ⏳ Upload PDF mutasi pertama kali → banner muncul "X transaksi baru, 0 sudah ada"
- ⏳ Cek di Supabase tabel `parsed_transactions` → row sesuai jumlah X
- ⏳ Upload PDF YANG SAMA persis → banner "0 transaksi baru, X sudah ada (auto dedup)"
- ⏳ Tabel parsed_transactions tetap X row, tidak bertambah jadi 2X
- ⏳ Upload PDF dengan periode partial overlap (mutasi 1-3 April, lalu 3-5 April) → tgl 3 yang overlap auto-dedup
- ⏳ Test rows tanpa No.Referensi (kalau ada di sample) → fingerprint dedup juga jalan
- ⏳ Verify total kredit di Supabase = total kredit di header PDF asli (no doubles)

---

## Cross-Phase Tests (E2E)

- ⏳ Sign up new account → invite staff (kalau Phase 1B sudah) → staff login bisa cek mutasi tapi tidak bisa kelola outlet/bank
- ⏳ RLS isolation: bikin 2 akun dengan email beda, akun A tambah outlet "Lhokseumawe", akun B tidak boleh lihat outlet A
- ⏳ Subscription expired: ubah trial_ends_at di Supabase ke past date, refresh app → red banner muncul, tidak bisa upload, hanya bisa lihat /akun

---

## Cara test cepat:

1. Buka URL Vercel `cek-mutasi-saas.vercel.app`
2. Logout dari akun lama (kalau masih login)
3. Akun lama (`bos@acehgadaisyariah.com`) sudah ada outlet (dari test sebelumnya), bisa langsung test dari Phase 1C onwards

---

## Test Data Files

Sample PDFs di folder `samples/`:
- `Mutasi_Rekening_1999881994 (46)-1.pdf` — BSI BSINet (35 halaman, 593 transaksi, total kredit Rp 973.094.000)
- `Mutasi_Rekening_1999881994 (48).pdf` — BSI BSINet (kolom kredit X-shifted, test parser robustness)
- `Mutasi_Rekening_1999881994 (51).pdf` — BSI BSINet
- `bca e statment 1 bulan.pdf` — BCA e-Statement (parser belum ada, test dropdown Coming Soon)
- `bni.pdf` — BNI (parser belum ada)
- `bsi dengan byond 1 bulan.pdf` — BSI BYOND (parser belum ada)
- `klikbca.html` — BCA KlikBCA HTML (parser belum ada, format HTML)
- `mandiri password 15071984.pdf` — Mandiri (password protected, password: 15071984, parser belum ada)

---

*Update tiap selesai phase baru. Owner test in batch saat ready.*

---

## Phase 2 — Multi-Bank Parsers (Round 1: BNI, BSI BYOND, Mandiri)

Test scenarios untuk parser bank tambahan:

### BNI
- ⏳ Tambah bank "BNI — Mobile Banking PDF" di /banks (status Ready)
- ⏳ Upload `samples/bni.pdf` → parse 3 transaksi (1 Cr, 2 Db) total kredit Rp 10.000, debet Rp 21.000
- ⏳ Switch ke jenis=debet, upload sama, lihat 2 row debet (biaya admin)

### BSI BYOND
- ⏳ Tambah bank "BSI — BYOND (mobile app)" di /banks (status Ready)
- ⏳ Upload `samples/bsi dengan byond 1 bulan.pdf` → 81 transaksi parsed, 11 halaman
- ⏳ Format split number (`13.405.000` + `,00`) di-handle dengan benar

### Mandiri
- ⏳ Tambah bank "Mandiri — e-Statement PDF" di /banks (status Ready, password_required: true)
- ⏳ Upload `samples/mandiri password 15071984.pdf` dengan password `15071984` → 14 transaksi parsed
- ⏳ Total kredit Rp 300.000, total debet Rp 337.550 (match header)
- ⏳ Coba upload tanpa password → error message
- ⏳ Coba upload dengan password salah → error message dari pdfjs

### Multi-bank di /banks
- ⏳ Tambah ketiga bank di atas. Dropdown di /check menampilkan ketiganya
- ⏳ Dedup history tetap jalan per bank (BNI tx tidak dianggap duplicate dengan BSI BYOND tx walau tanggal+nominal sama)

---

## Phase 4.2 — Save Sessions + History Page

Test scenarios untuk persistensi sesi dan halaman history:

- ⏳ Setelah selesai cek mutasi + klik "Selesai & Download PDF", session ter-save ke `cek_sessions`
- ⏳ Cek_inputs ter-save dengan match_status (matched / no_candidate / all_taken)
- ⏳ Buka menu **History** di nav → list sesi tampil dengan: Tgl Cek, Jenis (Kredit/Debet badge), Periode Mutasi, count Input/Match/Tidak Match, total nominal match
- ⏳ Klik "Detail" pada salah satu session → halaman /history/[id] tampil
- ⏳ Detail page tampil 4 stat cards (Total Input, Match, Tidak Match, Bentrok) + table input lengkap
- ⏳ Status badge per input row: Match (green), Tidak Match (red), Bentrok (amber dengan list tanggal)
- ⏳ Cek di Supabase tabel `cek_sessions` dan `cek_inputs` → row sesuai
- ⏳ Multi-tenant isolation: bikin akun beda, masing-masing tidak bisa lihat session yg lain
- ⏳ Empty state /history saat belum ada session

---

## Phase 2.2 — BCA e-Statement Parser

- ⏳ Tambah bank "BCA — e-Statement (PDF bulanan)" di /banks (status Ready)
- ⏳ Upload `samples/bca e statment 1 bulan.pdf` → 28 rows parsed
- ⏳ Total kredit Rp 52.863.000, total debet Rp 50.699.382
- ⏳ Year (2026) otomatis di-detect dari header PERIODE "APRIL 2026"
- ⏳ Format US (1,020,000.00) di-handle dengan benar
- ⏳ "TRANSAKSI DEBIT" rows + "TRSF E-BANKING CR" rows + "BI-FAST DB" rows semua ke-detect kredit/debet dengan benar dari keterangan

### Parser BCA KlikBCA HTML — DEFER
Parser HTML ditunda ke Phase 2.3 karena butuh refactor viewer/highlight (HTML beda dari PDF, tidak bisa dipakai langsung dengan pdfjs/pdf-lib).

---

## Phase 2.3 — KlikBCA HTML Parser (with synthetic PDF)

KlikBCA download dalam format HTML, di-convert ke synthetic PDF supaya pipeline viewer/highlight/output existing tetap work.

- ⏳ Tambah bank "BCA — KlikBCA (web)" di /banks (status Ready)
- ⏳ Upload `samples/klikbca.html` → 3 rows parsed (1 CR Rp 1.020.000, 2 DB total Rp 30.750)
- ⏳ Match dengan summary HTML: "Mutasi Kredit 1.020.000,00", "Mutasi Debet 30.750,00"
- ⏳ Synthetic PDF di-generate dengan layout table rapi (header brand, account info, table dengan alternate row, badge CR hijau/DB merah)
- ⏳ Highlight overlay jalan di synthetic PDF (saat input + match)
- ⏳ Download hasil = synthetic PDF + lampiran rekap
- ⏳ Account info tersaji di header PDF: "BCA KlikBCA — Mutasi Rekening", No Rek, Nama, Periode

---

## Phase 5 — Rekap dengan filter

Halaman rekap untuk analisa hasil cek mutasi lintas sesi.

### Akses & navigasi
- ⏳ Link **Rekap** muncul di nav (samping History)
- ⏳ Klik link → halaman /rekap terbuka
- ⏳ Default filter: 30 hari terakhir, semua jenis/bank/outlet/status
- ⏳ Loading state saat fetch pertama kali

### Filter
- ⏳ Ubah tanggal Dari/Sampai → data otomatis re-fetch
- ⏳ Pilih jenis Kredit / Debet → data ter-filter
- ⏳ Pilih bank tertentu → data ter-filter ke bank itu saja
- ⏳ Pilih outlet tertentu → data ter-filter ke outlet itu saja
- ⏳ Pilih status Match → hanya tampil yang matched + manual_claimed
- ⏳ Pilih status Tidak Ditemukan → hanya tampil no_candidate
- ⏳ Pilih status Bentrok → hanya tampil all_taken
- ⏳ Tombol cepat 7 hari / 30 hari / 90 hari / Bulan ini / Bulan lalu set range
- ⏳ Tombol Reset balik ke default

### Big number cards
- ⏳ Total Input: count + nominal sum
- ⏳ Match: count + nominal sum (warna hijau)
- ⏳ Tidak Ditemukan: count + nominal sum (warna merah)
- ⏳ Bentrok: count + nominal sum (warna amber)
- ⏳ Match Rate: % match / total, info manual claim count

### Breakdown per Outlet
- ⏳ Tampil semua outlet yang punya input di periode filter
- ⏳ Sorted by nominal match desc
- ⏳ Color dot sesuai outlet warna_hex
- ⏳ Outlet "(tanpa outlet)" muncul kalau ada input tanpa outlet_id

### Breakdown per Bank
- ⏳ Tampil semua bank yang punya input di periode filter
- ⏳ Sorted by nominal match desc
- ⏳ Bank "(tanpa bank)" muncul kalau ada input tanpa bank_id

### Detail table
- ⏳ List semua input sesuai filter, sort by tgl_input desc
- ⏳ Sticky header table
- ⏳ Max-height 600px dengan scroll
- ⏳ Status badge per row (Match/Manual claim/Tidak ada/Bentrok)
- ⏳ Warning kalau hasil terpotong di 5000 baris

### Export CSV
- ⏳ Klik Export CSV → file `rekap-YYYY-MM-DD-sd-YYYY-MM-DD.csv` ter-download
- ⏳ Buka di Excel → kolom utf-8 (BOM) tampil rapih, kolom: Tanggal Input, Jenis, Outlet, Bank, Nominal, Status, Catatan Manual
- ⏳ Tombol disabled saat loading / data kosong / sedang export

### Export PDF
- ⏳ Klik Export PDF → file `rekap-YYYY-MM-DD-sd-YYYY-MM-DD.pdf` ter-download
- ⏳ Header brand_name + tanggal generate
- ⏳ Filter description: periode, jenis, bank, outlet, status
- ⏳ 5 summary cards (Total/Match/Tidak/Bentrok/Match Rate)
- ⏳ Tabel breakdown per outlet & per bank
- ⏳ Tabel detail input dengan auto-pagination + page number
- ⏳ Tombol disabled saat loading / data kosong / sedang export

### Multi-tenant isolation
- ⏳ Akun A tidak melihat data akun B (RLS via cek_inputs.account_id)

---

## Phase 4.3 — Carry-over toggle

Sertakan transaksi belum ter-claim dari upload sebelumnya ke matching pool.

### Setup test
- ⏳ Upload mutasi BSI periode 1-15 April → input beberapa nominal yang ada di mutasi → match → download
- ⏳ Sebagian input sengaja TIDAK di-input (ex: ada 5 transaksi tapi hanya input 3)
- ⏳ Sisa 2 transaksi jadi "unclaimed" di parsed_transactions

### Carry-over flow
- ⏳ Upload mutasi BSI periode 16-30 April → setelah PDF parse, banner muncul: "Sertakan X transaksi belum ter-claim dari upload sebelumnya"
- ⏳ Default ON, tampil count + total nominal
- ⏳ Input nominal yang nyangkut dari periode lalu (misal Rp 1.020.000) → status Match (carry-over tx ke-claim)
- ⏳ Klik download → session ter-save dengan carry_over_used=true
- ⏳ Cek di Supabase: parsed_transactions.claimed_by_input_id terisi untuk tx carry-over

### Skip carry-over
- ⏳ Uncheck banner → carryover txs tidak masuk matching pool → input lama jadi no_candidate
- ⏳ Re-check banner → matching pool langsung update

### Highlight di PDF
- ⏳ Carry-over match TIDAK di-highlight di PDF current (page-nya bukan di PDF ini)
- ⏳ Hanya match dari current PDF yang di-highlight
- ⏳ Lampiran rekap PDF tetap list semua match (carry-over + current)

---

## Phase 4.3 — Manual claim with reason

Klaim manual transaksi belum-match dari /history page tab "Belum Match".

### Tab "Belum Match"
- ⏳ Buka /history → tab "Belum Match" tampil dengan badge count
- ⏳ List parsed_transactions WHERE claimed_by_input_id IS NULL, di rentang 12 bulan
- ⏳ Filter Jenis (kredit/debet/all) + Bank (specific/all) jalan
- ⏳ Tampil: tanggal, jam, bank, jenis badge, pengirim/keterangan, nominal, no_ref
- ⏳ Tombol "Claim manual" per row

### Modal claim
- ⏳ Klik claim → modal terbuka dengan info tx (tgl, bank, jenis, nominal, pengirim)
- ⏳ Default tanggal_input = tanggal transaksi
- ⏳ Outlet dropdown wajib (default: outlet pertama)
- ⏳ Reason textarea wajib
- ⏳ Validasi: kosongin reason → error "Alasan wajib diisi"
- ⏳ Submit → cek_inputs ter-insert dengan session_id NULL, manual_claim_reason terisi
- ⏳ parsed_transactions.claimed_by_input_id ter-update
- ⏳ Modal close + page refresh → tx tidak muncul di tab Belum Match lagi

### Empty state
- ⏳ Kalau semua transaksi sudah claimed → empty state "Semua transaksi sudah ke-match 🎉"

### Tab "Sesi"
- ⏳ Tab Sesi tetap jalan seperti semula
- ⏳ Session yang carry-over_used=true ada badge "⏳"

---

## Tab "Mutasi" — re-konstruksi bank statement

Tab ke-3 di /history. Tampil semua parsed_transactions (claimed + unclaimed) seperti rekening koran tapi dengan highlight per outlet.

### Filter
- ⏳ Default tab "Mutasi" terbuka pertama saat /history dibuka
- ⏳ Bank wajib pilih (auto-pick bank pertama)
- ⏳ Range tanggal default 30 hari terakhir
- ⏳ Filter Jenis (kredit/debet/all) jalan
- ⏳ Filter Status (matched/unmatched/all) jalan
- ⏳ Tombol cepat 7d/30d/90d/Bulan ini/Bulan lalu set range
- ⏳ Reset balik ke default

### Summary cards
- ⏳ Total Transaksi
- ⏳ Total Kredit + nominal yang sudah match
- ⏳ Total Debet + nominal yang sudah match
- ⏳ Match / Belum count + match rate %

### Breakdown per Outlet
- ⏳ Pills berisi semua outlet yang punya match di filter aktif
- ⏳ Color dot + nama + total nominal + count
- ⏳ Sorted by nominal desc

### Tabel Mutasi
- ⏳ Sorted by tanggal asc, jam asc (urut seperti rekening koran asli)
- ⏳ Kolom: Tgl/Jam, Pengirim/Keterangan, Kredit, Debet, Saldo, Outlet
- ⏳ Matched rows: background tinted dengan warna outlet (alpha 18%)
- ⏳ Unmatched rows: background plain
- ⏳ Outlet column: color dot + nama outlet untuk matched, "belum match" italic untuk unmatched
- ⏳ Manual claim ada icon Hand biru
- ⏳ Hover row: tooltip "Outlet · Input tgl · Manual reason"
- ⏳ No.Ref tampil kalau ada
- ⏳ Sticky header
- ⏳ Max 5000 baris dengan warning kalau dipotong

### Multi-tenant isolation
- ⏳ Akun A tidak melihat parsed_transactions akun B (RLS)

### Edge cases
- ⏳ Bank yang belum punya tx: empty state "Tidak ada transaksi"
- ⏳ Belum ada bank sama sekali: arahkan ke menu Bank

---

## Phase 6 — Staff Management

### /staff page (owner only)
- ⏳ Link "Staff" muncul di nav untuk owner, hilang untuk staff
- ⏳ Buka /staff → tampil section Owner + section Staff
- ⏳ Owner row: email + (Anda) badge + role Owner

### Invite staff — email baru
- ⏳ Owner masuk email baru (belum pernah pakai aplikasi) → klik Kirim Invite
- ⏳ Loading → success message "Invite terkirim"
- ⏳ Staff dapat email dari Supabase dengan magic-link
- ⏳ Klik link → redirect ke /set-password
- ⏳ Set password (min 8 char) + konfirmasi → success → auto-redirect ke /dashboard
- ⏳ Login dengan email + password baru → dashboard normal
- ⏳ Cek di Supabase: team_members ada entry role=staff, account_id sama dengan owner

### Invite staff — email yang sudah pakai aplikasi (other account)
- ⏳ Error: "Email ini sudah pakai aplikasi di akun lain. Multi-account belum di-support."

### Invite staff — email yang sudah anggota
- ⏳ Error: "Email ini sudah jadi anggota tim Anda"

### Resend invite (untuk pending staff)
- ⏳ Klik "Resend invite" → email magic-link baru terkirim
- ⏳ Status badge tetap "Pending" sampai staff klik link

### Reset password (untuk staff aktif)
- ⏳ Klik "Reset password" → email recovery terkirim
- ⏳ Staff klik link → /set-password → bisa ubah password

### Remove staff
- ⏳ Klik "Remove" → konfirmasi → staff dihapus dari team_members
- ⏳ Staff yang di-remove tidak bisa lagi login (atau login dapat error account)

### Permission gating
- ⏳ Login sebagai staff → nav cuma tampil Dashboard, Cek Mutasi, History, Rekap
- ⏳ Staff tidak lihat link Outlet, Bank, Aturan, Akun, Staff, Activity
- ⏳ Staff coba akses /banks via URL → ada UI banner "Hanya owner yang bisa kelola bank"
- ⏳ Staff coba akses /staff via URL → redirect ke /dashboard
- ⏳ Staff bisa upload mutasi + cek + download PDF + manual claim (sama seperti owner)

### Multi-tenant
- ⏳ Staff di akun A tidak melihat data akun B (RLS via account_id)

---

## Phase 6 — Activity Log

### Akses
- ⏳ Link "Activity" muncul di nav untuk owner saja
- ⏳ Buka /activity → halaman Activity Log tampil

### Filter
- ⏳ Filter user (semua / specific user)
- ⏳ Filter aktivitas (session.created / tx.manual_claimed / staff.invited / staff.removed)
- ⏳ Range tanggal (default 30 hari)
- ⏳ Reset balik ke default

### Stats summary
- ⏳ 4 cards: count session create, manual claim, invite, remove
- ⏳ Update real-time saat filter berubah

### Detail table
- ⏳ Sorted by created_at desc
- ⏳ Kolom: Waktu, User (email + role badge), Aktivitas (icon + label), Detail
- ⏳ Detail per action:
  - session.created: jenis · bank · matched/total · nominal · carry-over indicator
  - tx.manual_claimed: jenis · nominal · outlet · alasan italic
  - staff.invited: email + mode (existing/new)
  - staff.removed: confirmation
- ⏳ Sticky header
- ⏳ Max 1000 rows dengan warning kalau dipotong

### Audit log writes
- ⏳ Selesai cek mutasi → audit_logs ada entry "session.created" dengan metadata lengkap
- ⏳ Manual claim transaksi → audit_logs ada entry "tx.manual_claimed" dengan metadata
- ⏳ Invite staff → audit_logs ada entry "staff.invited"
- ⏳ Remove staff → audit_logs ada entry "staff.removed"

---

## Phase 8 — Super-admin Dashboard

Akses platform-wide untuk Anda monitor semua tenant.

### Setup
- ⏳ Set ENV `SUPERADMIN_EMAILS=namasayafendy@gmail.com` di Vercel
- ⏳ Set ENV `SUBSCRIPTION_PRICE_RP=50000` di Vercel (untuk hitung MRR)
- ⏳ Login pakai email yang ada di list → muncul tombol "Admin" (icon Shield ungu) di nav kanan atas
- ⏳ Login pakai email lain → tombol Admin tidak muncul, akses /superadmin → redirect ke /dashboard

### /superadmin (Dashboard)
- ⏳ 4 cards utama: Total Account, MRR, Conversion %, Churn %
- ⏳ 5 status cards: Trial aktif, Trial expired, Active, Suspended, Cancelled
- ⏳ Engagement minggu ini: account aktif + total sesi
- ⏳ Trial habis dalam 3 hari (preview 8 row + link ke detail)
- ⏳ Recent signups (30 hari) tabel

### /superadmin/accounts (List)
- ⏳ Tabel semua account dengan: Brand+Owner email, Status badge, Daftar, Staff count, Sesi 30d, Last activity
- ⏳ Filter status (all / trial aktif / trial expired / active / suspended / cancelled)
- ⏳ Search box (brand, email owner, ID)
- ⏳ Klik row → /superadmin/accounts/[id]

### /superadmin/accounts/[id] (Detail)
- ⏳ Header: brand, status badge, ID, tanggal daftar
- ⏳ Admin Tools panel: Extend trial / Activate (manual) / Suspend / Cancel / Reset password owner
- ⏳ Subscription card: status, trial/period dates, cancelled_at
- ⏳ Meta card: brand_name, support_email, support_wa — bisa edit inline
- ⏳ Stats: Owner email, Staff count, Banks, Outlets, Parsed Tx
- ⏳ Members table: owner + staff dengan email, joined, last_active
- ⏳ Sesi terbaru (20 row) dengan jenis + match/total + nominal
- ⏳ Audit log (50 row) dengan timestamp + user + action + metadata

### Tools (cek di Supabase)
- ⏳ Extend trial → status='trial', trial_ends_at = today+N days, audit log entry
- ⏳ Activate → status='active', current_period_start/end set, audit log
- ⏳ Suspend → status='suspended', audit log dengan reason
- ⏳ Cancel → status='cancelled', cancelled_at set, audit log dengan reason
- ⏳ Reset password → owner dapat email recovery, audit log
- ⏳ Update meta → accounts.brand_name/support_email/support_wa updated, audit log

### Multi-tenant safety
- ⏳ Pakai service role client → bypass RLS (intentional, scoped ke superadmin email check)
- ⏳ Action server selalu re-verify isSuperadminEmail sebelum execute

---

## Phase 8.5 — Staff Limit 3 + Auto-Logout Idle 1 Jam

### Staff limit
- ⏳ Migration applied: `accounts.staff_limit DEFAULT 3`
- ⏳ Buka /staff sebagai owner → header "X / 3 staff" tampil
- ⏳ Sudah ada 3 staff → warning amber "Sudah mencapai batas 3 staff"
- ⏳ Form invite di-disable (input + button)
- ⏳ Coba invite via API langsung (bypass UI) → error "Sudah mencapai batas 3 staff"
- ⏳ Remove 1 staff → form jadi enable lagi, badge update ke "2 / 3 staff"
- ⏳ Super-admin /superadmin/accounts/[id] → klik Edit Meta → ubah Staff limit ke 5 → save
- ⏳ Owner /staff sekarang bisa invite sampai 5 staff

### Auto-logout idle
- ⏳ Login → tunggu 55 menit tanpa aktivitas → modal warning muncul: "Sesi akan berakhir dalam 5:00"
- ⏳ Countdown ticking realtime (5:00 → 4:59 → ...)
- ⏳ Klik "Tetap login" → modal hilang, timer reset
- ⏳ Tunggu 60 menit total tanpa klik → auto-logout, redirect ke /login?reason=idle
- ⏳ /login tampil banner amber: "Sesi Anda berakhir karena tidak ada aktivitas..."
- ⏳ Activity events (klik, scroll, keydown, touchstart) reset timer
- ⏳ Login lagi → kerja normal
