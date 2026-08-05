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
      /** true = tanggal ini baru pertama kali dinilai (aliran hari ini). */
      pertamaKali?: boolean;
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
    ketinggalan: { no_faktur: string; outlet: string; arah: string; tgl: string; nominal: number }[];
    sisaKetinggalan?: number;
    tertahanPerSebab?: { sebab: string; teks: string; n: number; rp: number }[];
    gerbangError?: string | null;
  } | null;
  /** Sebab kenapa sandingan tidak bisa diambil. */
  sandinganGagal?: string | null;
  /** Resi yang sudah lama tidak ketemu dan belum dibereskan (dari sisi gadai). */
  tunggakan: {
    no_faktur: string; outlet: string; tgl: string; nominal: number; umur: number;
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
  if (Number(isi.ditahanKonflik ?? 0) > 0) awas.push(`${isi.ditahanKonflik} resi berebut baris mutasi yang sama`);
  if (awas.length) {
    L.push("");
    L.push(`🚨 JANGAN PAKAI LAPORAN INI MENUTUP HARI:`);
    awas.forEach((a) => L.push(`   • ${a}`));
  }

  // ── 1. RESI DITERIMA DARI LAPIS 1 ──
  //
  // Sumbernya angka gadai (baruDivonis), bukan hitungan sendiri. Dua sisi yang
  // menghitung sendiri-sendiri akan menyimpang, dan menyimpangnya justru
  // terlihat seperti kebocoran.
  const sd = isi.sandingan;
  const daftar = Array.isArray(sd?.baruDivonis) ? sd!.baruDivonis! : null;
  const arahKeluar = (a: string) => ["DEBET", "KELUAR"].includes(String(a).toUpperCase());

  L.push("");
  L.push(`RESI DITERIMA DARI LAPIS 1`);

  let totN = 0, totRp = 0, adaN = 0, adaRp = 0, takN = 0, takRp = 0;

  if (!daftar) {
    L.push(`   ➖ tidak dikabarkan Aceh Gadai (versi lama / tanpa patokan waktu).`);
    totN = Number(isi.nDiuji || 0); totRp = Number(isi.rpDiuji || 0);
  } else if (daftar.length === 0) {
    L.push(`   ➖ tidak ada resi baru sejak laporan sebelumnya.`);
  } else {
    // ALIRAN — per tanggal kontrak, dengan pecahan masuk/keluar. Bentuknya
    // sengaja sama dengan blok ALIRAN HARI INI di laporan LAPIS 1.
    const aliran = daftar.filter((d) => d.pertamaKali !== false);
    const lanjut = daftar.filter((d) => d.pertamaKali === false);
    const perTgl = new Map<string, { n: number; rp: number; mN: number; mRp: number; kN: number; kRp: number }>();
    for (const d of aliran) {
      const g = perTgl.get(d.tgl) ?? { n: 0, rp: 0, mN: 0, mRp: 0, kN: 0, kRp: 0 };
      const n = Number(d.baru?.n ?? 0), r = Number(d.baru?.rp ?? 0);
      g.n += n; g.rp += r;
      if (arahKeluar(d.arah)) { g.kN += n; g.kRp += r; } else { g.mN += n; g.mRp += r; }
      perTgl.set(d.tgl, g);
    }
    for (const [t, g] of [...perTgl.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      L.push(`   ${tgl(t)}   ${g.n} resi · ${rp(g.rp)}`);
      L.push(`      masuk  ${String(g.mN).padStart(3)} resi · ${rp(g.mRp)}`);
      L.push(`      keluar ${String(g.kN).padStart(3)} resi · ${rp(g.kRp)}`);
    }
    if (lanjut.length) {
      const n = lanjut.reduce((s, d) => s + Number(d.baru?.n ?? 0), 0);
      const r = lanjut.reduce((s, d) => s + Number(d.baru?.rp ?? 0), 0);
      L.push(`   tindak lanjut dari Lapis 1   ${n} resi · ${rp(r)}`);
    }
    for (const d of daftar) {
      totN += Number(d.baru?.n ?? 0); totRp += Number(d.baru?.rp ?? 0);
      adaN += Number(d.rinci?.MATCHED?.n ?? 0); adaRp += Number(d.rinci?.MATCHED?.rp ?? 0);
      takN += Number(d.rinci?.UNMATCHED?.n ?? 0); takRp += Number(d.rinci?.UNMATCHED?.rp ?? 0);
    }
    L.push(`   TOTAL DICOCOKKAN   ${totN} resi · ${rp(totRp)}`);
  }

  // ── 2. HASIL PENCOCOKAN KE MUTASI ──
  L.push("");
  L.push(`DICOCOKKAN DENGAN MUTASI`);
  if (!daftar) {
    const nGagal = isi.tidakKetemu.length;
    const rpGagal = isi.tidakKetemu.reduce((s, x) => s + (Number(x.nominal) || 0), 0);
    adaN = totN - nGagal; adaRp = totRp - rpGagal; takN = nGagal; takRp = rpGagal;
  }
  L.push(`   ✅ ada di rekening   ${String(adaN).padStart(3)} resi · ${rp(adaRp)}`);
  L.push(`   ${takN > 0 ? "⛔" : "✅"} tidak ada           ${String(takN).padStart(3)} resi · ${rp(takRp)}`);
  // Sisanya (dobel/dibatalkan) hanya disebut kalau memang ada — kalau tidak, ia
  // cuma memanjangkan halaman dengan nol.
  const sisa = totN - adaN - takN;
  if (sisa !== 0) L.push(`   ➖ dobel / dibatalkan  ${sisa} resi`);

  // Daftarnya diambil dari sumber yang SAMA dengan cacahnya. Memakai daftar
  // dari pass berkas ini sementara cacahnya dari gadai membuat keduanya bisa
  // berselisih — dan pernah: laporan mencetak "⛔ tidak ada 1 resi" dengan
  // daftar KOSONG, jadi kontraknya tidak bisa dikejar siapa pun.
  const namaTak = (daftar && Array.isArray(sd?.baruTakKetemu) && sd!.baruTakKetemu!.length)
    ? sd!.baruTakKetemu!.map((x) => ({ no_faktur: x.no_faktur, outlet: x.outlet, tgl: x.tgl, nominal: x.nominal }))
    : isi.tidakKetemu.map((x) => ({ no_faktur: x.no_faktur, outlet: x.outlet, tgl: x.tgl, nominal: x.nominal }));
  if (namaTak.length) {
    L.push("");
    L.push(`   yang TIDAK ada di rekening:`);
    namaTak.slice(0, 15).forEach((x) => {
      L.push(`   • ${x.no_faktur} · ${x.outlet} · ${tgl(x.tgl)} · ${rp(x.nominal)}`);
    });
    if (namaTak.length > 15) L.push(`   …dan ${namaTak.length - 15} lagi`);
    L.push(`   ↳ semuanya masuk /belum-cocok, diselesaikan manual.`);
  } else if (takN > 0) {
    // Cacahnya bilang ada, daftarnya kosong. Itu keadaan yang harus berbunyi,
    // bukan didiamkan — kalau tidak, ada resi gagal yang tak punya nama.
    L.push(`   🚨 ${takN} resi tidak ketemu TAPI kontraknya tidak terbawa —`);
    L.push(`      buka /belum-cocok untuk melihatnya.`);
  }

  // Tunggakan lama disebut SATU BARIS. Daftar lengkapnya sudah ada di
  // /belum-cocok; mengulangnya penuh tiap hari persis yang membuat laporan ini
  // berhenti dibaca. Tapi menghapusnya sama sekali membuat yang lama terlupakan.
  if (isi.tunggakan.length) {
    const r = isi.tunggakan.reduce((s, x) => s + (Number(x.nominal) || 0), 0);
    const bisa = isi.tunggakan.filter((x) => Number(x.calonBebas ?? 0) > 0).length;
    L.push(`   🔁 belum beres dari hari sebelumnya: ${isi.tunggakan.length} resi · ${rp(r)}` +
           (bisa > 0 ? ` — ${bisa} punya calon baris di mutasi ini` : ""));
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
  if (isi.nganggurBatas) {
    L.push(`   ℹ️ diperiksa sampai ${tgl(isi.nganggurBatas)} saja — sesudah itu klaimnya belum lahir.`);
  }

  return L.join("\n");
}
