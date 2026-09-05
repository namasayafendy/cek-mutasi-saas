// ============================================================
// CEKTRANSFER - Penyusun laporan LAPIS 2
// File: lib/laporan/lapis2.ts
//
// LAPIS 2 menjawab SATU pertanyaan: apakah resi yang lolos Lapis 1 benar-benar
// ADA di mutasi rekening?
//
// Ia TIDAK menilai ulang apakah angka kontrak sama dengan angka slip — itu
// sudah selesai di Lapis 1. Menjaga dua pertanyaan ini terpisah adalah
// keputusan pemilik 27 Juli 2026, dan justru pemisahan itu yang membuat
// keduanya berarti: sebuah kontrak bisa LULUS Lapis 1 (slipnya ada, angkanya
// pas) lalu GAGAL Lapis 2 (uangnya tidak pernah masuk rekening).
//
// REKAP PER TANGGAL ADALAH ALAT ANTI-BOCOR, BUKAN HIASAN.
// Pemilik membaca laporan Lapis 1 setiap hari. Kalau jumlah resi tanggal X di
// sini tidak sama dengan yang dinyatakan cocok di Lapis 1 tanggal X, ada resi
// yang lolos di antara dua lapisan. Tanpa rekap ini, kebocoran semacam itu
// tidak punya satu tempat pun untuk terlihat.
//
// DUA ARAH, BUKAN SATU. Selain "resi tanpa uang", laporan ini juga menyebut
// "uang tanpa resi" — termasuk uang KELUAR yang tidak diminta siapa pun.
// Arah itu tidak pernah dilaporkan sistem ini sebelumnya.
// ============================================================

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

/** Tanggal kalender diperlakukan sebagai tanggal polos — diurai UTC, dibaca
 *  UTC. Menguraikannya sebagai tengah malam WIB lalu membaca komponen UTC
 *  membuatnya mundur sehari (pelajaran dari laporan Lapis 1 #1, 28 Jul 2026). */
function tgl(iso: string): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`;
}

export interface KepalaLapis2 {
  nomor: number | null;
  sebelumNomor: number | null;
  sebelumKapan: string | null;
}

export interface IsiLapis2 {
  bankLabel: string;
  namaFile: string;
  /** Rentang tanggal yang ADA DI BERKAS. */
  berkasDari: string | null;
  berkasSampai: string | null;
  /** Rentang yang BENAR-BENAR direkonsiliasi (ada resi diuji di dalamnya). */
  nilaiDari: string | null;
  nilaiSampai: string | null;
  utuh: boolean | null;
  rantaiPutus: number;
  nyambung: boolean | null;
  selisihSambungan: number;
  /** Per tanggal, MASUK dan KELUAR dipisah.
   *  Digabung, angkanya tidak bisa disandingkan dengan Lapis 1 — di sana
   *  keduanya memang dilaporkan terpisah. */
  perTanggal: {
    tgl: string; jml: number; rp: number;
    masukJml?: number; masukRp?: number; keluarJml?: number; keluarRp?: number;
  }[];
  nDiuji: number;
  rpDiuji: number;
  nCocok: number;
  /** BAGIAN DARI nDiuji/nCocok — resi yang diketik OWNER sendiri di Lapis 1,
   *  bukan bacaan AI dari foto. Dipisah atas keputusan pemilik 29 Juli 2026:
   *  "berapa yang normal, berapa yang hasil penanganan manual". Menyatukannya
   *  membuat baris yang paling perlu diawasi jadi tidak bisa dikenali. */
  nManual?: number;
  nManualCocok?: number;
  /** Yang DITAHAN gerbang Lapis 1 dan memang tidak diuji di sini.
   *  null/undefined = sisi gadai tidak mengabarkannya (versi lama) —
   *  "tidak diketahui", BUKAN nol. */
  tertahanGerbang?: {
    jml: number; rp: number;
    perSebab: { sebab: string; teks: string; n: number; rp: number }[];
    gerbangError: string | null;
  } | null;
  tidakKetemu: { no_faktur: string; outlet: string; tgl: string; nominal: number; sebab: string }[];
  ditahanLuarPeriode: number;
  ditahanKonflik: number;
  kreditNganggur: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];
  rpKreditNganggur: number;
  /** Sisa yang belum pernah dilaporkan tapi tidak muat di daftar ini. */
  sisaKreditNganggur?: number;
  debetNganggur: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];
  rpDebetNganggur: number;
  sisaDebetNganggur?: number;
  /** Potongan admin bank (Rp 2.500 / Rp 6.500) yang SENGAJA tidak dirinci.
   *  Keputusan pemilik 3 September 2026. Tetap dicetak satu baris: angka yang
   *  lenyap tanpa keterangan sama menakutkannya dengan angka yang salah, dan
   *  kalau bank menaikkan tarifnya, baris inilah yang memperlihatkannya. */
  nBiayaAdmin?: number;
  rpBiayaAdmin?: number;
  /** Tanggal terakhir yang benar-benar diuji untuk "tanpa pemilik". Terisi =
   *  ada ekor tanggal yang SENGAJA dilewati karena klaim gadai untuk hari itu
   *  belum lahir (cron malam belum menyapunya). */
  nganggurBatas?: string | null;
  /** false = pemeriksaan "tanpa pemilik" TIDAK jalan. Nol baris bukan "bersih". */
  nganggurDiperiksa?: boolean;

  /** ── SANDINGAN LAPIS 1 ↔ LAPIS 2, dihitung MESIN ──
   *  Angkanya datang langsung dari Aceh Gadai (endpoint /transfer-klaim/sandingan),
   *  bukan dihitung ulang di sini — dua sisi yang menghitung sendiri-sendiri
   *  akan menyimpang, dan menyimpangnya justru terlihat seperti kebocoran.
   *  null = tidak bisa diambil; itu HARUS dikatakan, bukan didiamkan. */
  sandingan?: {
    total: {
      lahir: { n: number; rp: number };
      tertahan: { n: number; rp: number };
      dilepas: { n: number; rp: number };
      divonis: { n: number; rp: number };
      menggantung: { n: number; rp: number };
    };
    tanggal: { tgl: string; arah: string;
               /** SEMUA klaim hidup tanggal itu (dilepas + tertahan) — inilah
                *  angka "total" yang dicetak Lapis 1, dan yang HARUS sama di sini. */
               lahir?: { n: number; rp: number };
               dilepas: { n: number; rp: number };
               divonis: { n: number; rp: number };
               menggantung: { n: number; rp: number };
               tertahan: { n: number; rp: number };
               /** Pecahan vonis per tanggal — sudah lama dikirim gadai, baru
                *  sekarang dipakai. Inilah yang membuat "berapa yang ada dan
                *  berapa yang tidak" bisa dijabarkan per asal. */
               rinci?: { MATCHED?: { n: number; rp: number };
                         UNMATCHED?: { n: number; rp: number };
                         DUPLIKAT?: { n: number; rp: number };
                         DIBATALKAN?: { n: number; rp: number } } }[];
    /** Waktu laporan LAPIS 2 sebelumnya, patokan kata "baru". null = tidak ada
     *  patokan (belum pernah ada laporan) — dan itu HARUS terbaca berbeda dari
     *  "tidak ada yang baru". */
    sejak?: string | null;
    /** Hanya yang vonisnya lahir SETELAH `sejak`, ditarik dari LANTAI sehingga
     *  tindak lanjut tanggal lama (di luar periode berkas) ikut terlihat.
     *  undefined = gadai versi lama (belum di-promote); null = tanpa patokan. */
    baruDivonis?: {
      tgl: string; arah: string;
      baru: { n: number; rp: number };
      /** Seluruh vonis yang pernah jatuh untuk tanggal+arah itu — pembanding
       *  yang membuat "7 dari 24" bisa dibaca tanpa membuka laporan lama. */
      divonisTgl: { n: number; rp: number };
      /** true = tidak ada satu pun anggotanya yang pernah tertahan gerbang.
       *  DIPERTAHANKAN untuk gadai versi lama; yang dipakai `susulan`. */
      pertamaKali?: boolean;
      /** Bagian dari `baru` yang PERNAH tertahan gerbang lalu dibereskan
       *  tangan — inilah TINDAK LANJUT yang sesungguhnya. Sisanya (baru −
       *  susulan) adalah ALIRAN.
       *
       *  Dasar lama memakai TANGGAL KONTRAK, dan itu patah pada kejadian yang
       *  paling biasa: resi yang tertahan pagi lalu dibereskan siang hari
       *  bertanggal SAMA dengan aliran normalnya, jadi mustahil dipisah lewat
       *  tanggal. 8 Agustus 2026 seluruh 32 resi jatuh ke satu keranjang dan
       *  ALIRAN tercetak "0 resi". */
      susulan?: { n: number; rp: number };
      /** Diputus MANUSIA di /belum-cocok, bukan mesin. Inilah yang menjelaskan
       *  kenapa cacah di sini bisa LEBIH BESAR daripada "SUSULAN" di LAPIS 1:
       *  yang ditutup tangan pada sela dua laporan tidak pernah terlihat di
       *  potret pagi Lapis 1. Tanpa angka ini, selisihnya terbaca kebocoran. */
      ditutupTangan?: { n: number; rp: number };
      /** Resinya diketik sendiri di Lapis 1, bukan dibaca dari foto. */
      diketikTangan?: { n: number; rp: number };
      rinci?: { MATCHED?: { n: number; rp: number };
                UNMATCHED?: { n: number; rp: number };
                DUPLIKAT?: { n: number; rp: number };
                DIBATALKAN?: { n: number; rp: number } };
    }[] | null;
    baruTotal?: { n: number; rp: number };
    /** Kontrak yang vonisnya BARU jatuh sebagai "tidak ada di rekening".
     *  Datang dari sumber yang SAMA dengan cacahnya (rinci.UNMATCHED), supaya
     *  angka dan daftarnya tidak akan pernah berselisih. */
    baruTakKetemu?: { no_faktur: string; outlet: string; arah: string; tgl: string; nominal: number }[];
    /** Vonis tanpa `matched_at` — tidak bisa dipilah baru/lama. Disebut, bukan
     *  dihilangkan diam-diam. */
    tanpaWaktuVonis?: { n: number; rp: number };
    ketinggalan: { klaim_id?: string; no_faktur: string; outlet: string; arah: string; tgl: string; nominal: number }[];
    sisaKetinggalan?: number;
    tertahanPerSebab?: { sebab: string; teks: string; n: number; rp: number }[];
    gerbangError?: string | null;
  } | null;
  /** Sebab kenapa sandingan tidak bisa diambil. */
  sandinganGagal?: string | null;
  /** Klaim yang pass berkas ini TAHAN (berebut baris / di luar periode).
   *  Sisi gadai tahu SIAPA yang belum dijawab (`sandingan.ketinggalan`); sisi
   *  ini tahu KENAPA. Dipasangkan lewat klaim_id supaya tiap resi yang belum
   *  cocok punya alasannya — permintaan pemilik 5 September 2026. */
  alasanKlaim?: { id: string; no_faktur: string; outlet: string; tgl: string; nominal: number;
                  sebab: "BEREBUT" | "LUAR_PERIODE" }[];
  /** Resi yang sudah lama tidak ketemu dan belum dibereskan (dari sisi gadai). */
  tunggakan: {
    no_faktur: string; outlet: string; tgl: string; nominal: number; umur: number;
    /** Kenapa ia masih di daftar. Gadai SUDAH lama mengirimnya; laporan yang
     *  membuangnya, lalu mencetak "masih TIDAK ADA di mutasi" untuk semua —
     *  termasuk untuk resi yang uangnya SUDAH terbukti masuk rekening dan yang
     *  bermasalah cuma fotonya. Kabar palsu tentang uang hilang. */
    sebab?: string;
    /** `BUKTI_BEDA` = fotonya yang membantah, bukan uangnya yang tidak ada. */
    status?: string;
    /** Vonis Lapis 2 yang sesungguhnya. MATCHED = uangnya ADA di rekening. */
    status_asli?: string;
    /** Hasil penelusuran ulang ke mutasi yang BARU diunggah:
     *  jumlah baris bernominal sama yang masih BEBAS. null = tidak ditelusuri. */
    calonBebas?: number | null;
  }[];
  gagal: string[];
}

/**
 * Susun laporan LAPIS 2.
 *
 * DIPERPENDEK TOTAL 5 Agustus 2026 atas perintah pemilik: "ini masih sangat
 * panjang dan complicated dan membuat bingung. Coba kamu buat jadi simple saja."
 *
 * Laporan sebelumnya memuat sembilan blok — vonis, resi yang diuji, normal vs
 * manual, tertahan gerbang, resi yang baru divonis, sandingan mesin, tidak
 * ditemukan, tunggakan, uang tanpa pemilik, cakupan berkas. Tiap blok lahir dari
 * satu kejadian nyata, dan tiap blok masuk akal sendiri-sendiri. Gabungannya
 * yang tidak: laporan yang terlalu panjang berhenti dibaca, dan blok yang tidak
 * dibaca sama saja dengan blok yang tidak ada — hanya lebih mahal, karena ia
 * memberi rasa aman yang palsu.
 *
 * Bentuknya sekarang mengikuti tiga pertanyaan pemilik, berurutan:
 *   1. berapa resi yang saya terima dari Lapis 1, per tanggal, masuk dan keluar
 *   2. dari situ, berapa yang ADA di rekening dan berapa yang TIDAK
 *   3. lalu, uang mana di rekening yang tidak diklaim siapa pun
 *
 * Bagian 1 memakai angka yang SAMA PERSIS dengan blok DIKIRIM KE LAPIS 2 di
 * laporan LAPIS 1 — itu yang membuat dua laporan bisa ditempel bersisian.
 *
 * Yang dibuang bukan pemeriksaannya, hanya cetakannya saat NORMAL. Keadaan yang
 * membuat laporan ini tidak boleh dipercaya tetap dicetak, di satu tempat, di
 * paling atas — supaya yang hilang dari halaman berarti "tidak ada masalah",
 * bukan "tidak diperiksa".
 */
export function susunLapis2(isi: IsiLapis2, kepala: KepalaLapis2): string {
  const L: string[] = [];
  const periode = isi.berkasDari && isi.berkasSampai
    ? `${tgl(isi.berkasDari)}-${tgl(isi.berkasSampai)}`
    : "periode tidak terbaca";

  L.push(`🟢 LAPIS 2 · cek mutasi ${periode}` + (kepala.nomor ? ` · #${kepala.nomor}` : ""));
  L.push(`resi ↔ mutasi rekening · ${isi.bankLabel}`);

  // ── PERINGATAN, HANYA KALAU ADA ──
  // Satu tempat, paling atas. Kalau tidak ada, tidak dicetak sama sekali —
  // supaya halaman yang bersih berarti "tidak ada masalah", bukan "tidak
  // diperiksa".
  const awas: string[] = [];
  isi.gagal.forEach((g) => awas.push(g));
  if (isi.sandingan === null) awas.push("angka dari Aceh Gadai tidak bisa diambil — daftar di bawah mungkin tidak lengkap");
  if (isi.sandingan?.gerbangError) awas.push("gerbang Lapis 1 tidak bisa menilai");
  if (isi.nganggurDiperiksa === false) awas.push("pemeriksaan uang tanpa pemilik tidak jalan");
  if (isi.utuh === false) awas.push("berkas mutasi TIDAK utuh — ada baris yang hilang");
  if (isi.nyambung === false) awas.push(`berkas tidak nyambung dengan unggahan sebelumnya (beda ${rp(isi.selisihSambungan)})`);
  // Dulu berbunyi "N resi berebut baris mutasi yang sama" tanpa nama, dan
  // pemilik membacanya sebagai "N resi kehilangan uangnya". Sekarang namanya
  // ada di blok pertama, jadi kalimat ini cukup menunjuk ke sana.
  if (Number(isi.ditahanKonflik ?? 0) > 0) awas.push(`${isi.ditahanKonflik} resi belum bisa dinilai (berebut baris mutasi) — lihat "belum dijawab" di bawah`);
  if (awas.length) {
    L.push("");
    L.push(`🚨 JANGAN PAKAI LAPORAN INI MENUTUP HARI:`);
    awas.forEach((a) => L.push(`   • ${a}`));
  }

  // ── 1. DITERIMA DARI LAPIS 1 → COCOK / TIDAK COCOK / BELUM DIJAWAB ──
  //
  // Dibentuk ULANG 5 September 2026 atas permintaan pemilik, dan bentuknya
  // sengaja MENIRU LAPIS 1: sebut dulu berapa yang diterima (harus sama dengan
  // "DIKIRIM KE LAPIS 2" di Lapis 1 untuk tanggal yang sama), baru berapa yang
  // cocok, berapa yang tidak — dan yang belum dijawab disebut satu per satu
  // beserta SEBABNYA.
  //
  // Bentuk lama mencetak "4 Sep 37 resi · Rp 38.269.000" yang bukan hitungan
  // melainkan SISA: total 39 dikurangi 2 resi "tindak lanjut" (Rp 271.000).
  // Angka sisa tidak bisa dijumlahkan dari daftar mana pun. Pemilik
  // menyandingkannya dengan Lapis 1 (39 · Rp 38.510.000) dan bertanya "di mana
  // selisihnya" — padahal tidak ada yang hilang: satu resi masih tertahan
  // gerbang saat Lapis 1 memotret (07:30) dan dilepas sebelum Lapis 2
  // menghitung (09:14); satu lagi diparkir karena berebut baris dan disebut di
  // blok lain. Dua laporan yang memakai DASAR berbeda (tanggal resi vs tanggal
  // transaksi; "diuji sesi ini" vs "dikirim") memang tidak akan pernah sama,
  // dan selisihnya terbaca seperti kebocoran.
  //
  // Sumber angkanya SATU: `sandingan.tanggal` dari Aceh Gadai, dikelompokkan
  // per TANGGAL TRANSAKSI — dasar yang sama dengan Lapis 1. Yang dikerjakan di
  // sini hanya penjumlahan, dan pemeriksaan bahwa jumlahnya tutup.
  //
  // Klaim yang sudah MATI (dobel / dibatalkan) dikeluarkan dari "total" persis
  // seperti Lapis 1 mengeluarkannya dari "dikirim", lalu disebut terpisah.
  const sd = isi.sandingan;
  const arahKeluar = (a: string) => ["DEBET", "KELUAR"].includes(String(a).toUpperCase());
  const daftar = Array.isArray(sd?.baruDivonis) ? sd!.baruDivonis! : null;
  const sel0 = { n: 0, rp: 0 };
  const alasanOleh = new Map<string, "BEREBUT" | "LUAR_PERIODE">();
  for (const a of (isi.alasanKlaim ?? [])) alasanOleh.set(String(a.id), a.sebab);
  const teksSebab = (sebab?: string) =>
    sebab === "BEREBUT" ? "berebut baris mutasi — baris bernominal sama sudah dipegang klaim lain"
    : sebab === "LUAR_PERIODE" ? "di luar periode berkas — menunggu mutasi berikutnya"
    : "belum dijawab Lapis 2";

  L.push("");
  L.push(`DITERIMA DARI LAPIS 1`);

  if (!sd || !Array.isArray(sd.tanggal)) {
    // Tanpa angka gadai, yang bisa dikatakan hanya hitungan sisi ini — dan itu
    // dikatakan apa adanya, bukan disamarkan sebagai sandingan.
    L.push(`   ➖ angka dari Aceh Gadai tidak bisa diambil — di bawah ini hitungan Lapis 2 saja.`);
    const nGagal = isi.tidakKetemu.length;
    const rpGagal = isi.tidakKetemu.reduce((s, x) => s + (Number(x.nominal) || 0), 0);
    L.push(`   diuji ${isi.nDiuji} resi · ${rp(isi.rpDiuji)}`);
    L.push(`   ✅ cocok di rekening   ${isi.nDiuji - nGagal} · ${rp(isi.rpDiuji - rpGagal)}`);
    L.push(`   ${nGagal > 0 ? "⛔" : "✅"} tidak ada di rekening ${nGagal} · ${rp(rpGagal)}`);
    isi.tidakKetemu.slice(0, 15).forEach((x) =>
      L.push(`      • ${x.no_faktur} · ${x.outlet} · ${tgl(x.tgl)} · ${rp(x.nominal)}`));
  } else {
    // Satu tanggal = dua arah. Digabung per tanggal supaya dibaca sekali duduk.
    type Sisi = { total: { n: number; rp: number }; cocok: { n: number; rp: number };
                  tak: { n: number; rp: number }; gantung: { n: number; rp: number };
                  tahan: { n: number; rp: number }; mati: { n: number; rp: number };
                  susulan: { n: number; rp: number }; ada: boolean };
    const kosong = (): Sisi => ({ total: { ...sel0 }, cocok: { ...sel0 }, tak: { ...sel0 },
      gantung: { ...sel0 }, tahan: { ...sel0 }, mati: { ...sel0 }, susulan: { ...sel0 }, ada: false });
    const perTgl = new Map<string, { masuk: Sisi; keluar: Sisi; baru: boolean }>();
    for (const t of sd.tanggal) {
      const g = perTgl.get(t.tgl) ?? { masuk: kosong(), keluar: kosong(), baru: false };
      const x = arahKeluar(t.arah) ? g.keluar : g.masuk;
      const r = t.rinci ?? {};
      const M = r.MATCHED ?? sel0, U = r.UNMATCHED ?? sel0;
      const D = r.DUPLIKAT ?? sel0, Bt = r.DIBATALKAN ?? sel0;
      const lahir = t.lahir ?? { n: t.dilepas.n + t.tertahan.n, rp: t.dilepas.rp + t.tertahan.rp };
      x.ada = true;
      x.total = { n: lahir.n - D.n - Bt.n, rp: lahir.rp - D.rp - Bt.rp };
      x.cocok = { n: M.n, rp: M.rp };
      x.tak = { n: U.n, rp: U.rp };
      x.gantung = { n: t.menggantung.n, rp: t.menggantung.rp };
      x.tahan = { n: t.tertahan.n, rp: t.tertahan.rp };
      x.mati = { n: D.n + Bt.n, rp: D.rp + Bt.rp };
      const bd = daftar?.find((d) => d.tgl === t.tgl && arahKeluar(d.arah) === arahKeluar(t.arah));
      if (bd) { g.baru = true; x.susulan = { n: bd.susulan?.n ?? 0, rp: bd.susulan?.rp ?? 0 }; }
      perTgl.set(t.tgl, g);
    }

    // Yang dicetak penuh: tanggal yang vonisnya BERUBAH di sesi ini, atau yang
    // masih punya pertanyaan (belum dijawab / tidak ketemu / tertahan). Sisanya
    // sudah pernah dibaca pemilik di laporan sebelumnya — cukup satu baris.
    const semuaTgl = [...perTgl.keys()].sort((a, b) => (a < b ? 1 : -1));
    const perlu = (g: { masuk: Sisi; keluar: Sisi; baru: boolean }) =>
      g.baru || [g.masuk, g.keluar].some((x) => x.gantung.n > 0 || x.tak.n > 0 || x.tahan.n > 0);
    const penting = semuaTgl.filter((t) => perlu(perTgl.get(t)!));
    const tenang = semuaTgl.filter((t) => !perlu(perTgl.get(t)!));

    const cetakSisi = (label: string, x: Sisi, t: string, keluar: boolean) => {
      if (!x.ada || (x.total.n === 0 && x.mati.n === 0)) return;
      L.push(`   ${label.padEnd(7)}${String(x.total.n).padStart(3)} resi · ${rp(x.total.rp)}`);
      const semuaCocok = x.tak.n === 0 && x.gantung.n === 0 && x.tahan.n === 0;
      L.push(`      ✅ cocok di rekening  ${String(x.cocok.n).padStart(3)} · ${rp(x.cocok.rp)}` + (semuaCocok ? " — semua cocok" : ""));
      if (x.tak.n > 0) {
        L.push(`      ⛔ tidak ada di rekening ${String(x.tak.n).padStart(2)} · ${rp(x.tak.rp)}`);
        const nama = (sd.baruTakKetemu ?? []).filter((k) => k.tgl === t && arahKeluar(k.arah) === keluar);
        nama.slice(0, 10).forEach((k) =>
          L.push(`         • ${k.no_faktur} · ${k.outlet} · ${rp(k.nominal)} — tidak ada di rekening`));
        if (x.tak.n > nama.length) L.push(`         …${x.tak.n - nama.length} dari laporan sebelumnya, lihat /belum-cocok`);
      }
      if (x.gantung.n > 0) {
        L.push(`      ⏳ belum dijawab        ${String(x.gantung.n).padStart(2)} · ${rp(x.gantung.rp)}`);
        const nama = (sd.ketinggalan ?? []).filter((k) => k.tgl === t && arahKeluar(k.arah) === keluar);
        nama.slice(0, 10).forEach((k) =>
          L.push(`         • ${k.no_faktur} · ${k.outlet} · ${rp(k.nominal)} — ${teksSebab(k.klaim_id ? alasanOleh.get(String(k.klaim_id)) : undefined)}`));
        if (x.gantung.n > nama.length) L.push(`         …dan ${x.gantung.n - nama.length} lagi`);
      }
      if (x.tahan.n > 0) L.push(`      🚧 tertahan gerbang Lapis 1 ${x.tahan.n} · ${rp(x.tahan.rp)} — belum dikirim ke sini`);
      if (x.susulan.n > 0) L.push(`      (termasuk ${x.susulan.n} resi · ${rp(x.susulan.rp)} yang tadinya tertahan lalu dibereskan)`);
      if (x.mati.n > 0) L.push(`      ➖ dobel / dibatalkan ${x.mati.n} · ${rp(x.mati.rp)} — tidak dihitung, sama seperti Lapis 1`);
      // Penjumlahan ditutup di depan mata. Kalau tidak tutup, itu cacat laporan
      // ini sendiri dan harus berbunyi — bukan didiamkan.
      const bagian = x.cocok.n + x.tak.n + x.gantung.n + x.tahan.n;
      if (bagian !== x.total.n) {
        L.push(`      🚨 jumlahnya TIDAK tutup: ${x.cocok.n}+${x.tak.n}+${x.gantung.n}+${x.tahan.n} = ${bagian}, bukan ${x.total.n}`);
      }
    };

    for (const t of penting.slice(0, 6)) {
      const g = perTgl.get(t)!;
      L.push(`   ${tgl(t)}`);
      cetakSisi("masuk", g.masuk, t, false);
      cetakSisi("keluar", g.keluar, t, true);
    }
    if (penting.length > 6) L.push(`   …dan ${penting.length - 6} tanggal lagi yang masih punya pertanyaan`);
    if (tenang.length) {
      const jml = tenang.reduce((s, t) => {
        const g = perTgl.get(t)!;
        return { n: s.n + g.masuk.total.n + g.keluar.total.n, rp: s.rp + g.masuk.total.rp + g.keluar.total.rp };
      }, { ...sel0 });
      L.push(`   ${tenang.length} tanggal lain (${jml.n} resi · ${rp(jml.rp)}) — semua cocok, tidak berubah sejak laporan sebelumnya.`);
    }
    if (penting.length === 0 && tenang.length === 0) L.push(`   ➖ tidak ada resi dalam periode ini.`);
  }

  // ── BELUM BERES DARI SEBELUMNYA ──
  //
  // Disebut satu per satu BESERTA SEBABNYA. Versi pertama blok pendek ini cuma
  // mencetak satu baris jumlah, dan pemilik langsung menemukan lubangnya:
  // layar /belum-cocok menampilkan 3 perkara, laporan hanya menamai 1, jadi
  // dua sisanya "tidak ada notifikasinya".
  //
  // Dan sebabnya WAJIB ikut. Laporan lama mencetak "masih TIDAK ADA di mutasi"
  // untuk semua isi daftar ini — termasuk untuk SBR-4-0335, yang kedua resinya
  // sudah TERBUKTI masuk rekening dan yang bermasalah cuma fotonya (foto
  // terbaca Rp 1.000.000, permintaannya Rp 5.000.000 karena dibayar dua kali).
  // Mengabarkan "uangnya tidak ada" atas uang yang jelas-jelas ada bukan
  // sekadar tidak rapi — ia mengirim orang mencari sesuatu yang tidak hilang.
  if (isi.tunggakan.length) {
    const r = isi.tunggakan.reduce((s, x) => s + (Number(x.nominal) || 0), 0);
    L.push("");
    L.push(`🔁 BELUM BERES DARI SEBELUMNYA (${isi.tunggakan.length}) · ${rp(r)}`);
    isi.tunggakan.slice(0, 10).forEach((x) => {
      const uangAda = String(x.status_asli ?? "").toUpperCase() === "MATCHED";
      L.push(`   • ${x.no_faktur} · ${x.outlet} · ${tgl(x.tgl)} · ${rp(x.nominal)} · ${x.umur} hari`);
      L.push(`     ${x.sebab ?? "belum diselesaikan"}`);
      if (uangAda) {
        L.push(`     ↳ uangnya SUDAH terbukti di rekening — yang perlu diperiksa fotonya.`);
      } else if (Number(x.calonBebas ?? 0) > 0) {
        L.push(`     ↳ ADA ${x.calonBebas} baris mutasi bernominal sama yang masih bebas.`);
      }
    });
    if (isi.tunggakan.length > 10) L.push(`   …dan ${isi.tunggakan.length - 10} lagi`);
    L.push(`   ↳ semuanya menunggu di /belum-cocok.`);
  }

  // ── 3. UANG DI MUTASI YANG TIDAK DIKLAIM SIAPA PUN ──
  const nK = Math.max(isi.kreditNganggur.length, Number(isi.sisaKreditNganggur ?? 0) + isi.kreditNganggur.length);
  const nD = Math.max(isi.debetNganggur.length, Number(isi.sisaDebetNganggur ?? 0) + isi.debetNganggur.length);
  L.push("");
  L.push(`UANG DI MUTASI TANPA PEMILIK`);
  if (nK + nD === 0) {
    L.push(`   ✅ tidak ada.`);
  } else {
    if (nK > 0) {
      L.push(`   masuk  ${nK} · ${rp(isi.rpKreditNganggur)}`);
      isi.kreditNganggur.slice(0, 8).forEach((x) =>
        L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)} · ${x.pihak}`));
      const sisaK = nK - Math.min(8, isi.kreditNganggur.length);
      if (sisaK > 0) L.push(`   …dan ${sisaK} lagi`);
    }
    if (nD > 0) {
      L.push(`   keluar ${nD} · ${rp(isi.rpDebetNganggur)}`);
      isi.debetNganggur.slice(0, 8).forEach((x) =>
        L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)} · ${x.pihak}`));
      const sisaD = nD - Math.min(8, isi.debetNganggur.length);
      if (sisaD > 0) L.push(`   …dan ${sisaD} lagi`);
    }
  }
  // Disebut DI LUAR cacah di atas, bukan dijumlahkan ke dalamnya: ini bukan
  // uang tanpa pemilik, ini potongan bank yang pemiliknya sudah jelas.
  if (Number(isi.nBiayaAdmin ?? 0) > 0) {
    L.push(`   ℹ️ ${isi.nBiayaAdmin} potongan admin bank · ${rp(Number(isi.rpBiayaAdmin ?? 0))} — tidak dirinci.`);
  }
  if (isi.nganggurBatas) {
    L.push(`   ℹ️ diperiksa sampai ${tgl(isi.nganggurBatas)} saja — sesudah itu klaimnya belum lahir.`);
  }

  return L.join("\n");
}
