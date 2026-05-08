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
