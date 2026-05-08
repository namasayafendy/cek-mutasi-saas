# Design Brief — Cek Mutasi (Commercial SaaS)

## 1. Konteks Produk

**Apa**: Aplikasi web SaaS untuk rekonsiliasi mutasi rekening bank dengan tagihan/pembayaran customer. Owner UMKM upload PDF mutasi bank, sistem cocokkan otomatis dengan input pembayaran yang owner catat, output PDF terhighlight + laporan.

**Target user**: Owner & staff UMKM Indonesia — pegadaian, koperasi, kos-kosan, sekolah/pesantren, reseller online, leasing kecil. Usia 25-55 tahun. Tech-literate dasar (bisa pakai Excel, WhatsApp Business). **Bukan** developer atau profesional tech.

**Tone**: profesional tapi ramah, simple, **fokus efisiensi**. Hindari jargon. Bahasa Indonesia natural — ramah seperti ngobrol, bukan formal-kaku.

---

## 2. Visual Direction

**Mood**: Clean, modern, terpercaya. Minimal tapi tidak dingin. Mirip Notion/Linear/Stripe yang disesuaikan untuk UMKM Indonesia.

**Palette utama**:
- Primary: dark slate (#0f172a) — buat tombol utama, header
- Background: off-white (#f8fafc atau #f1f5f9)
- Card: putih murni (#ffffff) dengan border tipis (#e2e8f0)
- Text primary: slate-900 (#0f172a)
- Text secondary: slate-600 (#475569)
- Success: emerald (#10b981)
- Warning: amber (#f59e0b)
- Error: red (#ef4444)
- Info: blue (#3b82f6)

**Outlet palette** (20 warna highlight pastel — owner pilih per outlet):
Kuning, Pink, Hijau Muda, Biru Muda, Oranye, Ungu Muda, Cyan, Lime, Amber, Teal, Salmon, Indigo Muda, Langit, Magenta, Coklat Muda, Lavender, Peach, Sky, Mint, Krem Hijau. Semua pastel — bukan saturated colors — supaya tetap kontras tapi enak dilihat.

**Typography**: Sans-serif sistem (Inter, atau system-ui native). Heading: 600-700 weight, body: 400-500.

**Iconography**: Line icons style Lucide (ringan, modern). Bukan filled atau colored icons.

**Border-radius**: 6-8px untuk cards/buttons, 4px untuk inputs. Jangan terlalu rounded (avoid pill/blob).

**Spacing**: generous whitespace. Compact tapi tidak crammed.

**Empty states**: penting untuk UMKM yang baru mulai. Setiap menu yang masih kosong (belum ada outlet, belum ada history, dst) wajib punya empty state friendly dengan ikon + 1-2 kalimat petunjuk + tombol CTA.

---

## 3. Sitemap / Information Architecture

```
PUBLIC (sebelum login)
├─ / (Landing page)
├─ /login
├─ /daftar (signup, trial 7 hari)
└─ /lupa-password

OWNER (login dengan role=owner)
├─ /dashboard
├─ /cek/kredit (3-step wizard: upload → input → hasil)
├─ /cek/debet (3-step wizard: upload → input → hasil)
├─ /history (list session, drill-down)
├─ /rekap (filter + export)
├─ /activity (log aktivitas staff — owner only)
├─ /outlets (CRUD outlet)
├─ /banks (CRUD bank/rekening + on/off + merge mode)
├─ /aturan (matching rules: lookback, match mode, forward window)
├─ /staff (invite & manage staff — owner only)
├─ /akun (status subscription, invoice, payment)
├─ /profil (nama bisnis, password, kontak)
└─ /bantuan (FAQ, contact)

STAFF (login dengan role=staff)
├─ /dashboard (limited view)
├─ /cek/kredit
├─ /cek/debet
├─ /history (only own sessions)
└─ /profil

SUPER ADMIN (Fendy sebagai platform owner — URL terpisah, mungkin /admin)
├─ /admin/dashboard (MRR, account count, churn)
├─ /admin/accounts (list semua customer)
├─ /admin/accounts/[id] (detail per account + manual tools)
├─ /admin/invoices
└─ /admin/jobs (lifecycle automation status)
```

---

## 4. Page-by-Page Brief

### 4.1 Landing Page (`/`)

Tujuan: convert visitor jadi trial user.

Sections (top-to-bottom):

1. **Hero**
   - Headline: "Cek mutasi bank Anda dalam hitungan menit, bukan jam."
   - Subheadline: "Upload PDF mutasi BSI/BCA/Mandiri/dst, sistem cocokkan otomatis dengan tagihan customer Anda. Tidak perlu lagi bandingkan manual."
   - CTA primary: "Coba Gratis 7 Hari" (besar, kontras)
   - CTA secondary: "Lihat Demo" (text link)
   - Visual: screenshot UI app dengan PDF terhighlight (mockup boleh)

2. **Trust signals strip** (3-4 logo bank yang di-support: BSI, BCA, Mandiri, BRI, BNI logo dalam bentuk monochrome kecil).

3. **Pain points** — 3 card horizontal:
   - "Habis berjam-jam cocokkan transferan vs tagihan secara manual"
   - "Sering kelewat transferan customer yang sudah masuk tapi belum tercatat"
   - "Bingung kalau ada nominal sama dari beberapa customer"

4. **Solution / How it works** — 3 step dengan ilustrasi:
   - Step 1: Upload PDF mutasi bank Anda
   - Step 2: Input tagihan/pembayaran yang seharusnya masuk
   - Step 3: Sistem otomatis cocokkan + highlight di PDF + laporan rekap

5. **Features grid** — 6-8 feature cards dengan icon + 1 kalimat:
   - Multi-bank (BSI, BCA, Mandiri, BRI, BNI, e-wallet)
   - Cek transaksi masuk + transaksi keluar
   - Multi-outlet dengan warna highlight beda
   - History 12 bulan terakhir
   - Tracking staff (kalau ada karyawan)
   - PDF tidak pernah di-upload ke server (privacy)
   - Aturan custom (toleransi nominal, range tanggal)
   - Export PDF profesional + Excel rekap

6. **Privacy callout box** — emphasized: "PDF mutasi Anda tidak pernah meninggalkan browser. Sistem proses lokal, kami tidak menyimpan data perbankan Anda."

7. **Pricing** — single card, simple:
   - Harga: Rp [TBD]/bulan
   - Trial: 7 hari, gratis tanpa kartu kredit
   - Apa yang dapat: unlimited cek, multi-bank, multi-outlet, multi-staff, history 12 bulan, customer support
   - CTA: "Mulai Trial Gratis"

8. **Testimoni** (placeholder dulu, isi nanti dengan customer pertama):
   - 1-2 quote dengan nama + bisnis + foto

9. **FAQ** — accordion 5-7 pertanyaan:
   - Bank apa saja yang di-support?
   - Bisakah pakai untuk e-wallet (Dana, OVO)?
   - Apakah PDF saya disimpan di server?
   - Bagaimana kalau bank ubah format PDF?
   - Apakah trial benar-benar gratis tanpa kartu kredit?
   - Bagaimana cara cancel subscription?
   - Berapa user/staff yang bisa diundang?

10. **Footer**: link login, harga, FAQ, kontak, TOS, Privacy Policy, alamat bisnis (opsional).

### 4.2 Login (`/login`)

Single column, max-width 400px, di tengah halaman.

- Brand logo di atas
- Card berisi form:
  - Input email
  - Input password
  - Link "Lupa password?" (kanan atas password input)
  - Tombol "Login" (full-width primary)
- Di bawah card: "Belum punya akun? **Daftar gratis 7 hari**" (link ke /daftar)
- Di paling bawah: "Butuh bantuan login? Hubungi support" (text link)

### 4.3 Daftar / Signup (`/daftar`)

Sama layout dengan login (single column 400px).

- Brand logo
- Card form:
  - Input nama bisnis
  - Input email
  - Input password (min 8 karakter, ada strength indicator)
  - Konfirmasi password
  - Checkbox: "Saya setuju dengan **Syarat Layanan** dan **Kebijakan Privasi**"
  - Tombol "Daftar — Mulai Trial 7 Hari" (full-width primary)
- Di bawah: "Sudah punya akun? **Login**"
- Trust note kecil: "Tidak perlu kartu kredit. Bebas cancel kapan saja."

### 4.4 App Layout (untuk semua halaman setelah login)

**Topbar fixed** (height 56px):
- Kiri: brand logo + nama produk
- Tengah: navigasi utama (Dashboard | Cek Mutasi | History | Rekap | Outlet | Bank) — desktop only, di mobile jadi hamburger menu
- Kanan: indicator status trial ("Trial: sisa 4 hari" — kalau trial), notification bell (untuk reminders), avatar user dengan dropdown (Profil, Logout)

**Sidebar (opsi alternatif)** atau topbar saja — lebih saran topbar karena lebih banyak ruang vertikal untuk content.

**Main area**: max-width 7xl (1280px), padding 24-32px.

### 4.5 Dashboard (`/dashboard`)

Top-most card: **trial status banner** (kalau trial) atau **renewal reminder** (kalau dekat renewal). Big and visible.

3-4 stat cards (grid):
- "Terakhir input: 3 hari lalu" + tanggal
- "Total cek bulan ini: 142 transaksi"
- "Total nominal ter-match: Rp 87.500.000"
- "Unclaimed: 8 transaksi" (warning kalau ada)

2 quick action cards (lebar penuh, side-by-side):
- "Mulai Cek Mutasi Kredit" → tombol besar dengan ikon arrow ke /cek/kredit
- "Mulai Cek Mutasi Debet" → tombol besar dengan ikon arrow ke /cek/debet

**Recent activity** (table):
- 5 session terakhir: tanggal, jenis (kredit/debet), staff, total input, % match. Click row → ke /history/[id].

**Reminders section** (kalau ada):
- "8 transaksi belum di-claim" → button "Lihat di History"
- "Bayar tagihan minggu ini Rp 99.000" (kalau dekat renewal)

### 4.6 Cek Mutasi (`/cek/kredit` dan `/cek/debet`)

3-step wizard, dengan progress stepper di atas (Step 1: Upload, Step 2: Input, Step 3: Hasil).

**Step 1: Upload PDF**
- Description text: "Pilih bank, lalu upload PDF mutasi. Bisa upload beberapa bank sekaligus."
- Form per bank: dropdown bank → drag-drop area atau pilih file → daftar PDF yang sudah di-upload (dengan thumbnail/icon, nama file, jumlah halaman, jumlah transaksi parsed)
- Tombol "+ Tambah PDF lain" untuk multi-upload
- Tombol "Lanjut ke Input" (primary, kanan bawah) — disabled kalau belum ada PDF

**Step 2: Input Pembayaran**
- Description text: "Ketik tanggal, outlet, bank, dan nominal pembayaran yang seharusnya masuk."
- Tabel form: 4 kolom (Tanggal | Outlet | Bank | Nominal) dengan 1 baris kosong di bawah row terakhir untuk tambah cepat
- Tombol "+ Tambah baris" atau enter di row terakhir auto-add baris baru
- Tombol "Cocokkan" di kanan bawah (primary)

**Step 3: Hasil (Split view)**
- Kiri: PDF viewer dengan highlight overlay (sama seperti versi sekarang, scroll vertical)
- Kanan: panel hasil
  - Tabs atau sections: Match, Tidak Match, Bentrok, Tidak Di-claim
  - Each section: list item dengan info (tanggal, outlet, nominal, status icon)
  - Bottom: tombol "Cek di Bank Lain" (multi-bank cross-search opt-in untuk leftover) dan "Selesai & Download PDF" (primary)

### 4.7 History (`/history`)

Table list semua session:
- Kolom: Tanggal cek | Jenis (badge kredit/debet) | Staff | Periode mutasi | Input | Match | Unmatch | Conflict
- Filter di atas: date range picker, jenis (kredit/debet/all), staff (all/specific)
- Pagination: 20 per page

Click row → halaman detail `/history/[id]`:
- Summary card di atas
- Tabs: Input, Tidak Match, Bentrok, Tidak Di-claim, Manual Claim
- Tombol "Download PDF rekap" (download lagi)
- Tombol "Claim manual" di setiap unclaimed (open modal: pilih outlet, alasan, simpan)

### 4.8 Rekap (`/rekap`)

Mirip dashboard finansial:
- Filter di atas: date range, jenis, bank, outlet, status
- Big number cards: Total claimed Rp X, Total unclaimed Rp Y, Match rate Z%
- Chart: bar chart per outlet, atau pie chart per bank
- Tabel breakdown per outlet/per bank (toggle)
- Tombol "Export Excel" dan "Export PDF" (kanan atas)

### 4.9 Activity Log (`/activity`) — Owner only

Tabel activity:
- Kolom: Tanggal | Staff | Aksi (cek mutasi kredit/debet, manual claim, dst) | Detail (jumlah input, hasil match)
- Filter: staff, date range, action type
- Pagination

### 4.10 Outlet Management (`/outlets`)

- Tombol "+ Tambah Outlet" kanan atas
- List card outlet: warna swatch + nama + tombol edit + delete
- Drag handle untuk re-order (opsional)
- Card "Palette warna tersedia" di bawah dengan grid 20 swatch (warna terpakai vs available)

### 4.11 Bank Management (`/banks`)

- Tombol "+ Tambah Rekening" kanan atas
- Table list bank: kode (logo/icon) | label | parser | status (toggle on/off) | aksi (edit, delete)
- Tombol "+ Tambah Rekening" buka modal:
  - Kode bank: dropdown (BSI, BCA, Mandiri, BRI, BNI, Bank Aceh Syariah, CIMB, Permata, Danamon, Maybank, Dana, OVO, GoPay, ShopeePay, Seabank, Bank Jago, Allo Bank)
  - Label custom: text input optional (placeholder: "Misal: BCA Pusat. Kosongkan kalau cuma 1 rekening BCA.")
  - Info text: "Punya 2 rekening BCA? Tambah 2 entry dengan label berbeda untuk dipisah, atau tambah 1 entry tanpa label kalau mau digabung."
  - Tombol Simpan/Batal

### 4.12 Aturan Matching (`/aturan`)

Form 2 kolom (Kredit | Debet) — bisa di-set beda:

Untuk masing-masing:
- Lookback period: radio (0/1/3/7/custom hari)
- Forward window: radio (off/1/3/7/custom)
- Match mode: radio (Exact | Toleransi Rupiah Rp X | Toleransi Persen Y%)

Plus:
- Highlight color debet: radio (Sama dengan outlet | Custom warna lain)

Tombol "Simpan" di bawah.

### 4.13 Staff Management (`/staff`) — Owner only

- Tombol "+ Undang Staff" kanan atas
- Table list staff: nama | email | role badge | status (active/pending invite) | terakhir aktif | aksi (reset password, delete)
- Modal undang: input email, klik "Kirim Undangan" → email magic link

### 4.14 Akun & Tagihan (`/akun`)

Card "Status Subscription":
- Big text: "Trial Aktif — Sisa 4 hari" atau "Aktif — Renewal 23 Mei"
- Detail: plan, harga, payment method
- Tombol "Upgrade ke Pro" atau "Update Pembayaran" atau "Cancel Subscription"

Section "Riwayat Invoice":
- Table: tanggal, periode, nominal, status (paid/pending/failed), tombol download invoice PDF

### 4.15 Bantuan (`/bantuan`)

- Tombol besar "Hubungi Support via WhatsApp" (deeplink ke wa.me/...)
- Tombol "Email Support" → mailto:
- Section FAQ (accordion 8-10 pertanyaan)
- Link ke video tutorial (kalau ada)

### 4.16 Super Admin Dashboard (`/admin/dashboard`)

Khusus untuk Fendy. Berbeda visual dari user app — lebih dense dengan data.

- 4-6 stat cards: Total accounts | Trial | Active | Suspended | MRR | Churn last month
- Chart: MRR growth (line chart per bulan)
- Table: 10 account terbaru (signup date, plan, status, MRR contribution)
- Quick actions: search account, manual extend trial, etc.

---

## 5. Common Components yang dipakai berulang

- **Button variants**: primary (slate-900 fill), secondary (white border), danger (red), ghost (text only)
- **Input**: rounded 4px, border slate-300, focus ring slate-600
- **Card**: white bg, border slate-200, rounded 8px, shadow-sm
- **Badge**: pill shape, color-coded berdasarkan status (success/warning/error/info)
- **Modal**: centered overlay, max-width 500px untuk form, 800px untuk content
- **Toast**: top-right, 4 variants (success, error, info, warning), auto-dismiss 5 detik
- **Empty state**: ikon big (lucide), heading + 1 kalimat helper text + tombol CTA
- **Loading**: skeleton untuk tables, spinner untuk button states

---

## 6. Responsive

- Desktop: target 1280-1920px width — full features
- Tablet: 768-1280px — sidebar collapse, table scroll horizontal
- Mobile: < 768px — single column, hamburger menu, table jadi card stack

Mobile khususnya: target staff yang akses dari HP saat di lapangan. Cek mutasi flow harus tetap usable di HP.

---

## 7. Accessibility

- WCAG AA contrast minimum
- Keyboard navigable (tab order benar)
- Screen reader labels untuk icon-only buttons
- Form errors dengan aria-describedby

---

## 8. Asset & Brand TBD

Belum ditentukan dan akan provide nanti:
- Brand name
- Logo
- Domain
- Tagline final
- Hero illustration / screenshot mockup

Untuk awal pakai placeholder: brand "Cek Mutasi", text-only logo, domain Vercel subdomain.

---

*Brief ini ditulis 2026-05-08. Update kalau ada perubahan scope.*
