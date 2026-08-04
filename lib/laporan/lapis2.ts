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

export function susunLapis2(isi: IsiLapis2, kepala: KepalaLapis2): string {
  const L: string[] = [];
  const nGagal = isi.tidakKetemu.length;
  const nTunggak = isi.tunggakan.length;

  // ── Kepala: vonis lebih dulu, sebelum angka apa pun ──
  const periode = isi.berkasDari && isi.berkasSampai
    ? `${tgl(isi.berkasDari)}–${tgl(isi.berkasSampai)}`
    : "periode tidak terbaca";
  L.push(`🟢 LAPIS 2 · cek mutasi ${periode}` + (kepala.nomor ? ` · Laporan #${kepala.nomor}` : ""));
  L.push(`resi ↔ mutasi rekening · ${isi.bankLabel}`);
  if (kepala.sebelumNomor && kepala.sebelumKapan) {
    const t = new Date(kepala.sebelumKapan);
    const jam = t.toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const lompat = (kepala.nomor ?? 0) - kepala.sebelumNomor - 1;
    L.push(`sebelumnya #${kepala.sebelumNomor} · ${jam}` +
           (lompat > 0 ? `  ⚠️ ${lompat} laporan tidak terkirim` : ""));
  }
  L.push("");

  // ── VONIS, DIPERKETAT 1 Agustus 2026 ──
  //
  // Sampai hari ini "BERSIH" dihitung HANYA dari (tidakKetemu==0 && tunggakan==0).
  // Akibatnya laporan 31 Juli mencetak "✅ BERSIH — semua resi ditemukan di
  // rekening" pada saat yang sama dengan "🚧 5 resi DITAHAN Lapis 1" dan
  // "⚠️ 1 resi berebut baris mutasi yang sama". Itu bukan salah tulis — vonisnya
  // memang tidak pernah melihat kedua hal itu.
  //
  // Sebuah laporan yang berkata BERSIH sementara ada yang menggantung merusak
  // arti kata BERSIH untuk seterusnya: sekali pembacanya tahu kata itu tidak
  // bisa dipercaya, ia berhenti dibaca. Berlaku juga sebaliknya — kalau BERSIH
  // jadi mustahil muncul, ia sama tidak bergunanya. Jadi yang dipakai:
  //
  //   BERSIH  = tidak ada satu pun resi yang menggantung DI SINI
  //   TERTAHAN Lapis 1 TIDAK membatalkan BERSIH — itu keputusan sadar gerbang,
  //   bukan kegagalan Lapis 2 — tapi ia WAJIB disebut di baris yang sama,
  //   supaya "bersih" tidak pernah terbaca sebagai "semuanya sudah diuji".
  const nKonflik = Number(isi.ditahanKonflik ?? 0);
  const nGantung = Number(isi.sandingan?.total?.menggantung?.n ?? 0);
  const nTahan = Number(isi.sandingan?.total?.tertahan?.n ?? isi.tertahanGerbang?.jml ?? 0);
  // Keadaan yang membuat vonis apa pun tidak sah untuk diucapkan.
  const takPasti: string[] = [];
  if (isi.nganggurDiperiksa === false) takPasti.push("pemeriksaan uang tanpa pemilik tidak jalan");
  if (isi.sandingan === null) takPasti.push("sandingan dengan Lapis 1 tidak bisa diambil");
  if (isi.sandingan?.gerbangError) takPasti.push("gerbang Lapis 1 tidak bisa menilai");

  const ekorTahan = nTahan > 0
    ? ` (${nTahan} resi ditahan Lapis 1 — sengaja belum diuji di sini)`
    : "";

  if (isi.gagal.length) {
    L.push(`🚨 VONIS: PEMERIKSAAN TIDAK TUNTAS`);
    isi.gagal.forEach((g) => L.push(`• ${g}`));
    L.push(`Jangan anggap periode ini bersih.`);
    L.push("");
  } else if (takPasti.length) {
    // Nol temuan pada pemeriksaan yang tidak jalan bukan "bersih" — itu
    // "tidak diketahui", dan keduanya tidak boleh berbunyi sama.
    L.push(`🚨 VONIS: TIDAK BISA DIPASTIKAN`);
    takPasti.forEach((t) => L.push(`• ${t}`));
    L.push(`Angka di bawah mungkin lengkap, mungkin tidak. Jangan dipakai menutup hari ini.`);
    L.push("");
  } else if (nGagal === 0 && nTunggak === 0 && nKonflik === 0 && nGantung === 0) {
    L.push(`✅ VONIS: BERSIH — semua resi ditemukan di rekening.${ekorTahan}`);
    L.push("");
  } else {
    const bagian = [
      nGagal > 0 ? `${nGagal} resi tidak ditemukan` : "",
      nTunggak > 0 ? `${nTunggak} tunggakan lama` : "",
      // Dua sebab yang DULU tidak pernah ikut menentukan vonis, padahal
      // dua-duanya berarti ada resi yang tidak dijawab siapa pun.
      nKonflik > 0 ? `${nKonflik} resi berebut baris mutasi` : "",
      nGantung > 0 ? `${nGantung} resi belum divonis` : "",
    ].filter(Boolean).join(" + ");
    L.push(`⚠️ VONIS: ${bagian}${ekorTahan}`);
    L.push("");
  }

  // ── Rekap per tanggal: alat sanding-menyanding dengan Lapis 1 ──
  const totMasuk = isi.perTanggal.reduce((s, x) => s + Number(x.masukRp ?? 0), 0);
  const totKeluar = isi.perTanggal.reduce((s, x) => s + Number(x.keluarRp ?? 0), 0);
  const nMasuk = isi.perTanggal.reduce((s, x) => s + Number(x.masukJml ?? 0), 0);
  const nKeluar = isi.perTanggal.reduce((s, x) => s + Number(x.keluarJml ?? 0), 0);

  L.push(`RESI YANG DIUJI  ${isi.nDiuji} · ${rp(isi.rpDiuji)}`);
  // Diam BUKAN jawaban. Sebelum ini, "semua ketemu" hanya bisa disimpulkan
  // dari TIDAK ADANYA blok "tidak ditemukan" — pembaca harus menebak dari
  // sesuatu yang tidak tertulis. Sekarang keduanya selalu disebut, termasuk
  // saat nol, supaya "lengkap" jadi pernyataan dan bukan dugaan.
  // ── RUPIAH DI KEDUA SISI, DAN JUMLAHNYA DITUTUP ──
  //
  // Pemilik, 4 Agustus 2026: "total xxx yang dicocokkan dan berapa yang ada dan
  // berapa yang tidak ada". Sebelum ini kedua baris hanya membawa CACAH, jadi
  // pertanyaan yang sebenarnya ditanyakan — berapa RUPIAH yang belum terbukti
  // masuk rekening — tidak terjawab tanpa membuka blok lain dan menjumlah sendiri.
  // Yang dijaga sistem ini uang, jadi uangnya yang harus tertulis.
  const rpGagal = isi.tidakKetemu.reduce((t, x) => t + (Number(x.nominal) || 0), 0);
  const rpKetemu = Number(isi.rpDiuji || 0) - rpGagal;
  L.push(`   ✅ ketemu di rekening  ${String(isi.nDiuji - nGagal).padStart(3)} · ${rp(rpKetemu)}`);
  L.push(`   ${nGagal > 0 ? '⛔' : '✅'} tidak ketemu          ${String(nGagal).padStart(3)} · ${rp(rpGagal)}`);
  // Penutupan disebut di depan mata supaya double-checking tidak perlu kalkulator,
  // dan supaya laporan yang angkanya sendiri tidak tutup BERTERIAK, bukan diam.
  L.push(`   ↳ ${isi.nDiuji - nGagal} + ${nGagal} = ${isi.nDiuji} resi · ${rp(rpKetemu)} + ${rp(rpGagal)} = ${rp(Number(isi.rpDiuji || 0))}`);
  L.push(`   MASUK  ${String(nMasuk).padStart(3)} resi · ${rp(totMasuk)}`);
  L.push(`   KELUAR ${String(nKeluar).padStart(3)} resi · ${rp(totKeluar)}`);

  // ── NORMAL vs HASIL PENANGANAN MANUAL ──
  //
  // Resi yang diketik OWNER sendiri dibaca mesin dengan cara yang sama persis,
  // jadi tanpa baris ini ia tidak bisa dibedakan dari resi yang dibaca AI dari
  // foto. Bedanya penting: yang satu punya foto sebagai lawan, yang satu hanya
  // punya ingatan orang. Yang diketik tangan LALU tidak ketemu di rekening
  // adalah kombinasi yang paling perlu dilihat, dan ia tak akan pernah menonjol
  // kalau angkanya berbaur.
  const nMan = Number(isi.nManual ?? 0);
  if (nMan > 0) {
    const manCocok = Number(isi.nManualCocok ?? 0);
    L.push(`   ── dari jumlah di atas ──`);
    L.push(`   normal              ${isi.nDiuji - nMan} · ketemu ${isi.nCocok - manCocok}`);
    L.push(`   penanganan manual   ${nMan} · ketemu ${manCocok}` +
           (nMan - manCocok > 0 ? `  ⚠️ ${nMan - manCocok} TIDAK ketemu` : ''));
    L.push(`   (manual = resi yang diketik sendiri di Lapis 1, bukan bacaan foto)`);
  }

  // ── APA YANG TIDAK SAMPAI KE SINI ──
  //
  // Gerbang Lapis 1 menahan sebagian resi, dan yang tertahan tidak akan pernah
  // muncul di laporan ini. Kalau itu tidak dikatakan, "RESI YANG DIUJI" terbaca
  // sebagai "seluruh resi hari itu" — dan selisihnya dengan Lapis 1 akan
  // terlihat seperti uang hilang, persis salah baca yang blok per-tanggal ini
  // dibuat untuk menghentikannya.
  const tg = isi.tertahanGerbang;
  if (tg?.gerbangError) {
    L.push(`   🚨 GERBANG LAPIS 1 TIDAK BISA MENILAI — semua resi dilepas apa adanya.`);
    L.push(`      Jangan anggap yang diuji di sini sudah lulus Lapis 1.`);
  } else if (tg && tg.jml > 0) {
    L.push(`   🚧 ${tg.jml} resi · ${rp(tg.rp)} DITAHAN Lapis 1 — sengaja tidak diuji di sini`);
    tg.perSebab.slice(0, 6).forEach((s) => L.push(`      • ${s.teks} — ${s.n} · ${rp(s.rp)}`));
    L.push(`      rinciannya di laporan LAPIS 1 (blok TERTAHAN DI GERBANG).`);
  } else if (tg == null) {
    L.push(`   ➖ jumlah yang ditahan Lapis 1 tidak dikabarkan — tidak bisa dipastikan`);
    L.push(`      bahwa seluruh resi hari itu sudah sampai ke sini.`);
  }
  // ── DIJABARKAN PER ASAL, BUKAN PER TANGGAL TRANSFER ──
  //
  // Pemilik, 4 Agustus 2026: "di Lapis 1 ditulis dilepas ke Lapis 2 35 resi
  // Rp 40.935.000, tapi laporan Lapis 2 dibagi per hari: 3 Agu 33 resi
  // Rp 40.630.000, sehingga saya bingung bacanya."
  //
  // Kebingungannya beralasan, dan sebabnya bukan salah hitung: LAPIS 1
  // mengelompokkan per TANGGAL KONTRAK, sedangkan blok lama ini per TANGGAL
  // TRANSFER. Dua sumbu yang berbeda, jadi keduanya benar dan TIDAK AKAN PERNAH
  // sama. Untuk 3 Agustus 2026 selisihnya persis dua resi yang uangnya ditransfer
  // lebih dulu: Rp 190.000 (1 Agu) dan Rp 115.000 (2 Agu).
  //   33 + 1 + 1 = 35   ·   40.630.000 + 115.000 + 190.000 = 40.935.000
  //
  // Sekarang dijabarkan memakai sumbu yang SAMA dengan Lapis 1 (tgl_transaksi,
  // ditegaskan sendiri oleh gadai lewat `dasarTanggal`), jadi tiap baris di sini
  // punya kembaran yang angkanya sama persis di laporan Lapis 1 hari itu.
  // Mencocokkan dua laporan tinggal menempelkan baris bernomor tanggal sama —
  // tanpa hitungan di kepala, yang selama ini jadi sumber salah baca.
  //
  // Baris bertanggal LAMA sekaligus menjawab "yang perlu ditangani kemarin
  // bagaimana": susulan jatuh di barisnya sendiri, jadi satu pengelompokan
  // mengerjakan dua pertanyaan.
  //
  // ── HANYA YANG BARU DIVONIS, DAN DIPISAH ALIRAN vs TINDAK LANJUT ──
  //
  // Pemilik, 4 Agustus 2026: "kalau saya unggah 1–16 Agustus padahal sudah
  // pernah unggah sampai 14, tanggal lama yang sudah beres muncul lagi." Blok
  // ini dulu menjabarkan SELURUH tanggal dalam periode berkas dengan angka
  // penuhnya — pada sapuan 4 Agustus itu berarti 13 tanggal × 2 arah, padahal
  // yang benar-benar berubah cuma 6 baris. Keluhan yang sama ia ulang dengan
  // kalimat lain berkali-kali: "sudah saya selesaikan, kenapa muncul lagi".
  //
  // Dua sub-judul, karena bagi pembacanya dua hal ini beda pekerjaan:
  //   ALIRAN HARI INI    — tanggal yang BARU PERTAMA KALI dinilai.
  //   TINDAK LANJUT      — tanggal lama, sebagian kasusnya baru sekarang tuntas.
  //                        Inilah jawaban atas "yang perlu ditangani kemarin
  //                        bagaimana", dan ia hanya berarti kalau tertulis
  //                        berapa dari berapa.
  {
    const sd = isi.sandingan;
    const label = (a: string) =>
      (['DEBET', 'KELUAR'].includes(String(a).toUpperCase()) ? 'KELUAR' : 'MASUK');
    type Baris = { tgl: string; arah: string; n: number; rp: number;
                   ada: { n: number; rp: number }; tak: { n: number; rp: number };
                   /** DOBEL + DIBATALKAN. Tanpa medan ini, tanggal yang punya
                    *  vonis semacam itu akan mencetak "35 resi" lalu memerinci
                    *  34 — jumlah yang tidak tutup, persis yang dilarang. */
                   lain: { n: number; rp: number };
                   tangan: { n: number; rp: number }; ketik: { n: number; rp: number };
                   dariN: number; dariRp: number; pertamaKali: boolean };
    const gab = (a?: { n: number; rp: number }, b?: { n: number; rp: number }) => ({
      n: Number(a?.n ?? 0) + Number(b?.n ?? 0), rp: Number(a?.rp ?? 0) + Number(b?.rp ?? 0) });

    // Dua sumber, satu bentuk. `baruDivonis` undefined = gadai belum di-promote;
    // itu TIDAK boleh membuat blok ini hilang — laporan yang diam terbaca sama
    // dengan laporan yang berkata "tidak ada apa-apa".
    //
    // Medan yang ADA tapi null berarti hal yang sama sekali lain: gadai-nya
    // sudah baru, cuma belum ada laporan sebelumnya untuk dijadikan patokan.
    // Dua sebab itu menuntun ke tindakan berbeda (promote vs tidak perlu
    // apa-apa), jadi tidak boleh dicetak dengan kalimat yang sama.
    const adaMedan = !!sd && "baruDivonis" in (sd as Record<string, unknown>);
    const punyaSaringan = Array.isArray(sd?.baruDivonis);
    const baris: Baris[] = punyaSaringan
      ? (sd!.baruDivonis ?? []).map((d) => ({
          tgl: d.tgl, arah: d.arah,
          n: Number(d.baru?.n ?? 0), rp: Number(d.baru?.rp ?? 0),
          ada: d.rinci?.MATCHED ?? { n: 0, rp: 0 },
          tak: d.rinci?.UNMATCHED ?? { n: 0, rp: 0 },
          lain: gab(d.rinci?.DUPLIKAT, d.rinci?.DIBATALKAN),
          tangan: d.ditutupTangan ?? { n: 0, rp: 0 },
          ketik: d.diketikTangan ?? { n: 0, rp: 0 },
          dariN: Number(d.divonisTgl?.n ?? 0), dariRp: Number(d.divonisTgl?.rp ?? 0),
          pertamaKali: d.pertamaKali !== false,
        }))
      : (sd?.tanggal ?? []).filter((d) => Number(d.divonis?.n ?? 0) > 0).map((d) => ({
          tgl: d.tgl, arah: d.arah,
          n: Number(d.divonis?.n ?? 0), rp: Number(d.divonis?.rp ?? 0),
          ada: d.rinci?.MATCHED ?? { n: 0, rp: 0 },
          tak: d.rinci?.UNMATCHED ?? { n: 0, rp: 0 },
          lain: gab(d.rinci?.DUPLIKAT, d.rinci?.DIBATALKAN),
          tangan: { n: 0, rp: 0 }, ketik: { n: 0, rp: 0 },
          dariN: Number(d.divonis?.n ?? 0), dariRp: Number(d.divonis?.rp ?? 0),
          pertamaKali: true,
        }));

    if (sd && (baris.length || punyaSaringan)) {
      // Patokannya dicetak. Kalau tidak, "baru" adalah kata tanpa titik acuan,
      // dan pembacanya tidak punya cara tahu rentang mana yang sedang diringkas.
      if (punyaSaringan && sd.sejak) {
        const t = new Date(sd.sejak);
        const jam = Number.isNaN(t.getTime()) ? sd.sejak : t.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        L.push("");
        L.push(`RESI YANG BARU DIVONIS  (sejak laporan sebelumnya, ${jam} WIB)`);
        // Dua angka mirip di satu pesan sudah pernah salah dibaca dua kali
        // (27 & 31 Juli). Bedanya dikatakan di tempatnya, bukan diserahkan
        // pada ingatan pembaca.
        L.push(`   bukan angka yang sama dengan "RESI YANG DIUJI" di atas: yang itu isi`);
        L.push(`   berkas ini, yang ini vonis yang BARU lahir — termasuk yang ditutup`);
        L.push(`   tangan lewat /belum-cocok di antara dua unggahan.`);
      } else {
        L.push("");
        L.push(`RESI YANG DIUJI — SELURUH PERIODE BERKAS`);
        L.push(`   ⚠️ ${adaMedan
          ? "belum ada laporan sebelumnya sebagai patokan"
          : "Aceh Gadai belum mengirim penanda waktu vonis (belum di-promote?)"} —`);
        L.push(`      tanggal yang sudah pernah dilaporkan ikut dijabarkan lagi.`);
      }

      if (punyaSaringan && baris.length === 0) {
        // Pintu keluar. Daftar kosong TIDAK boleh berarti bloknya hilang.
        L.push(`   ➖ tidak ada satu pun vonis baru sejak laporan sebelumnya.`);
      }

      for (const arah of ['KREDIT', 'DEBET']) {
        const grup = baris.filter((d) => label(d.arah) === label(arah))
                          .sort((a, b) => (a.tgl < b.tgl ? 1 : -1));
        if (!grup.length) continue;
        const tot = grup.reduce((s2, d) => ({ n: s2.n + d.n, rp: s2.rp + d.rp }), { n: 0, rp: 0 });
        L.push("");
        L.push(`   ── ${label(arah)}  ${tot.n} resi · ${rp(tot.rp)} ──`);

        const cetak = (d: Baris, susulan: boolean) => {
          L.push(`   ${tgl(d.tgl).padEnd(6)} ${String(d.n).padStart(3)} resi · ${rp(d.rp)}` +
                 (susulan ? `   (dari ${d.dariN} · ${rp(d.dariRp)} tanggal itu)` : ""));
          L.push(`      ✅ ketemu ${String(d.ada.n).padStart(3)} · ${rp(d.ada.rp)}` +
                 (d.tak.n > 0 ? `   ⛔ TIDAK ${d.tak.n} · ${rp(d.tak.rp)}` : `   ⛔ tidak ada 0`) +
                 (d.lain.n > 0 ? `   ➖ dobel/dibatalkan ${d.lain.n} · ${rp(d.lain.rp)}` : ""));
          // Pecahannya WAJIB menutup barisnya sendiri. Kalau tidak, laporan
          // berteriak di tempat kejadian — bukan diam lalu membuat pembacanya
          // menghitung ulang dengan tangan untuk menemukan selisihnya.
          const sisa = d.n - d.ada.n - d.tak.n - d.lain.n;
          if (sisa !== 0) {
            L.push(`      🚨 pecahan tidak menutup: ${d.ada.n} + ${d.tak.n} + ${d.lain.n}` +
                   ` ≠ ${d.n}. Jangan pakai baris ini menutup hari.`);
          }
          // Siapa yang memutuskan, dan resi mana yang tak punya foto sebagai
          // lawan. Dua-duanya baris "dari jumlah di atas", bukan tambahan.
          const cap: string[] = [];
          if (d.tangan.n > 0) cap.push(`🖐 ${d.tangan.n} ditutup tangan · ${rp(d.tangan.rp)}`);
          if (d.ketik.n > 0) cap.push(`✍️ ${d.ketik.n} resi diketik tangan · ${rp(d.ketik.rp)}`);
          if (cap.length) L.push(`      ${cap.join("   ")}`);
        };

        if (!punyaSaringan) {
          // Tanpa penanda waktu vonis, ALIRAN dan TINDAK LANJUT tidak bisa
          // dibedakan. Mencetak sub-judulnya tetap akan menamai semua tanggal
          // "baru pertama kali dinilai" — sebuah pernyataan yang tidak dijamin
          // apa pun. Lebih baik daftar polos daripada label yang bisa salah.
          grup.slice(0, 14).forEach((d) => cetak(d, false));
          if (grup.length > 14) L.push(`   …dan ${grup.length - 14} tanggal lagi`);
        } else {
          const aliran = grup.filter((d) => d.pertamaKali);
          const lanjut = grup.filter((d) => !d.pertamaKali);
          if (aliran.length) {
            L.push(`   ALIRAN HARI INI — baru pertama kali dinilai`);
            aliran.slice(0, 8).forEach((d) => cetak(d, false));
            if (aliran.length > 8) L.push(`   …dan ${aliran.length - 8} tanggal lagi`);
          }
          if (lanjut.length) {
            L.push(`   TINDAK LANJUT laporan sebelumnya — kasus lama yang baru tuntas`);
            lanjut.slice(0, 10).forEach((d) => cetak(d, true));
            if (lanjut.length > 10) L.push(`   …dan ${lanjut.length - 10} tanggal lagi`);
          }
        }
        // Penutupan dicetak dari SELURUH baris, termasuk yang tidak muat di
        // daftar — kalau tidak, potongan daftar akan terbaca sebagai selisih.
        L.push(`   ↳ ${grup.map((d) => d.n).join(" + ")} = ${tot.n} resi · ${rp(tot.rp)}`);
      }

      const tw = sd.tanpaWaktuVonis;
      if (punyaSaringan && Number(tw?.n ?? 0) > 0) {
        L.push("");
        L.push(`   ➖ ${tw!.n} resi · ${rp(tw!.rp)} punya vonis tapi TANPA waktu vonis —`);
        L.push(`      tidak bisa dipilah baru/lama, jadi tidak ikut dihitung di atas.`);
      }

      L.push("");
      L.push(`   ↳ tanggal di atas TANGGAL KONTRAK, sumbu yang sama dengan LAPIS 1.`);
      if (punyaSaringan) {
        // Cara membacanya ditulis sebagai LANGKAH, bukan penjelasan. Yang
        // memeriksa manusia, dan manusia butuh tahu baris mana ditempel ke
        // baris mana — bukan diberi tahu bahwa keduanya "sebanding".
        L.push(`     Cara memeriksanya — buka laporan LAPIS 1, tempel bersisian:`);
        L.push(`       ALIRAN HARI INI  ↔  ALIRAN HARI INI di LAPIS 1 (tgl sama)`);
        L.push(`       TINDAK LANJUT    ↔  SUSULAN di LAPIS 1 (tgl sama)`);
        L.push(`     Kalau ada baris yang tidak punya pasangan, ada resi NYASAR`);
        L.push(`     di antara dua lapisan — itu yang harus dikejar.`);
        L.push(`     Baris 🖐 ditutup tangan BOLEH membuat angka di sini lebih besar`);
        L.push(`     daripada SUSULAN di LAPIS 1: kasus itu ditutup sendiri di`);
        L.push(`     /belum-cocok pada sela dua laporan, jadi belum terlihat waktu`);
        L.push(`     laporan LAPIS 1 pagi disusun. SUSULAN + 🖐 = angka di sini.`);
      } else {
        L.push(`     Tiap baris HARUS sama dengan "dilepas ke Lapis 2" di laporan`);
        L.push(`     LAPIS 1 tanggal itu. Kalau beda, ada resi yang lolos di antara`);
        L.push(`     dua lapisan.`);
      }
      L.push(`     Yang ⛔ TIDAK ketemu masuk /belum-cocok dan akan muncul lagi`);
      L.push(`     setiap hari sampai diselesaikan.`);
    }
  }
  L.push("");

  // ── SANDINGAN LAPIS 1 ↔ LAPIS 2, dikerjakan MESIN ──
  //
  // Sampai 1 Agustus 2026 ini pekerjaan MATA: buka laporan Lapis 1, buka
  // laporan Lapis 2, bandingkan dua angka dari dua pesan. Gagal dua kali
  // (27 dan 31 Juli), dua-duanya dengan cara yang sama — yang dibandingkan
  // baris "Cocok dgn slip" (nilai KONTRAK, cacah KONTRAK) melawan "resi yang
  // diuji" (nilai RESI, cacah RESI). Dua besaran yang memang tidak akan pernah
  // sama, dan pada 30 Juli rupiahnya KEBETULAN sama persis (Rp 36.226.000)
  // sehingga jebakannya makin meyakinkan.
  //
  // Peringatan tertulis sudah ada sejak 28 Juli dan tidak menolong. Pemeriksaan
  // yang hanya benar kalau pembacanya ingat sebuah kalimat bukan pemeriksaan —
  // ia ujian ingatan. Jadi mesin yang membandingkan, dan yang KETINGGALAN
  // disebut namanya.
  {
    const s = isi.sandingan;
    L.push(`🔗 SANDINGAN LAPIS 1 ↔ LAPIS 2`);
    if (!s) {
      L.push(`   🚨 TIDAK BISA DIAMBIL dari Aceh Gadai${isi.sandinganGagal ? ` — ${isi.sandinganGagal}` : ""}.`);
      L.push(`   Tidak ada yang menjamin seluruh resi yang dilepas sampai ke sini.`);
    } else if (s.gerbangError) {
      L.push(`   🚨 Gerbang Lapis 1 tidak bisa menilai — angka "dilepas" tidak dapat dipercaya.`);
    } else {
      const t = s.total;
      L.push(`   dilepas Lapis 1   ${String(t.dilepas.n).padStart(3)} · ${rp(t.dilepas.rp)}`);
      L.push(`   sudah divonis     ${String(t.divonis.n).padStart(3)} · ${rp(t.divonis.rp)}`);
      if (t.menggantung.n === 0) {
        L.push(`   ✅ COCOK — tidak ada resi yang ketinggalan.`);
      } else {
        L.push(`   ⛔ KETINGGALAN    ${String(t.menggantung.n).padStart(3)} · ${rp(t.menggantung.rp)}`);
        L.push(`      dilepas ke sini tapi belum pernah divonis:`);
        s.ketinggalan.slice(0, 12).forEach((x) => {
          L.push(`      • ${tgl(x.tgl)} ${x.arah} · ${x.no_faktur} · ${x.outlet} · ${rp(x.nominal)}`);
        });
        if (Number(s.sisaKetinggalan ?? 0) > 0) {
          L.push(`      …dan ${s.sisaKetinggalan} lagi`);
        }
        // Per tanggal, HANYA yang berselisih. Tanggal yang cocok tidak perlu
        // dicetak — ia cuma memanjangkan pesan dan menenggelamkan yang penting.
        const bocor = s.tanggal.filter((d) => d.menggantung.n > 0);
        if (bocor.length) {
          L.push(`      per tanggal:`);
          bocor.slice(0, 10).forEach((d) => {
            L.push(`      ${tgl(d.tgl)} ${d.arah}: dilepas ${d.dilepas.n} · divonis ${d.divonis.n}` +
                   ` · ⛔ ${d.menggantung.n}`);
          });
        }
      }
      if (t.tertahan.n > 0) {
        L.push(`   🚧 tertahan Lapis 1 ${String(t.tertahan.n).padStart(3)} · ${rp(t.tertahan.rp)}` +
               `  (sengaja — BUKAN ketinggalan)`);
        (s.tertahanPerSebab ?? []).slice(0, 4).forEach((x) =>
          L.push(`      • ${x.teks} — ${x.n} · ${rp(x.rp)}`));
      }
      L.push(`   ↳ angka "dilepas" datang langsung dari Aceh Gadai, bukan dihitung`);
      L.push(`     di sini. Tidak perlu lagi menyandingkan sendiri dengan LAPIS 1 —`);
      L.push(`     dan JANGAN memakai baris "Cocok dgn slip" untuk itu; yang itu`);
      L.push(`     nilai KONTRAK, bukan nilai resi.`);
    }
    L.push("");
  }

  // ── Yang tidak ketemu: nomor kontrak + outlet, bukan cacah ──
  if (nGagal > 0) {
    L.push(`⛔ TIDAK DITEMUKAN DI REKENING (${nGagal})`);
    isi.tidakKetemu.slice(0, 20).forEach((x, i) => {
      L.push(`${i + 1}. ${x.no_faktur} · ${x.outlet}`);
      L.push(`    ${tgl(x.tgl)} · ${rp(x.nominal)} · ${x.sebab}`);
    });
    if (nGagal > 20) L.push(`   …dan ${nGagal - 20} lagi`);
    L.push("");
  }

  if (nTunggak > 0) {
    L.push(`🔁 BELUM BERES DARI SEBELUMNYA (${nTunggak})`);
    L.push(`   ditelusuri ULANG ke mutasi yang baru diunggah:`);
    isi.tunggakan.slice(0, 15).forEach((x) => {
      L.push(`• ${x.no_faktur} · ${x.outlet} · ${tgl(x.tgl)} · ${rp(x.nominal)} · ${x.umur} hari`);
      // Menyebut daftar tunggakan tanpa menelusurinya ulang berarti menyuruh
      // pemilik membuka /belum-cocok satu per satu hanya untuk tahu apakah ada
      // yang berubah. Kabari hasilnya di sini.
      const c = x.calonBebas;
      if (c == null) L.push(`   ↳ belum ditelusuri`);
      else if (c > 0) L.push(`   ↳ ADA ${c} baris mutasi bernominal sama yang masih bebas — buka /belum-cocok`);
      else L.push(`   ↳ masih TIDAK ADA di mutasi. Tetap dibawa ke besok sampai ditutup.`);
    });
    if (nTunggak > 15) L.push(`   …dan ${nTunggak - 15} lagi`);
    L.push("");
  }

  // ── ARAH SEBALIKNYA: uang yang tidak diklaim siapa pun ──
  //
  // Dua blok ini menjawab pertanyaan yang tidak pernah ditanyakan sistem ini
  // sebelumnya. Arah debet khususnya: uang KELUAR dari rekening yang tidak
  // diminta permintaan transfer mana pun. Selama ini laporan berbunyi "semua
  // transfer keluar ketemu di mutasi" — kalimat yang hanya menguji arah
  // sebaliknya dan tidak pernah arah ini.
  // ── (0) TIDAK BOLEH BERBUNYI SEPERTI "BERSIH" KALAU MEMANG BELUM DIPERIKSA ──
  //
  // Sampai 30 Juli 2026 dua blok di bawah dibangun dari kueri yang dijalankan
  // SEBELUM pemilik barisnya tertulis, sehingga 26 dari 41 barisnya adalah
  // baris yang justru baru saja dicocokkan. Sesudah dibetulkan, kueri itu bisa
  // GAGAL atau TIDAK DIJALANKAN — dan kalau itu terjadi, "(0)" adalah bunyi
  // paling berbahaya di seluruh laporan ini karena ia terbaca sebagai kabar
  // baik. Jadi keadaannya dikatakan lebih dulu.
  if (isi.nganggurDiperiksa === false) {
    L.push(`🚨 UANG TANPA PEMILIK: BELUM DIPERIKSA pada kiriman ini.`);
    L.push(`   Angka (0) di dua baris berikut BUKAN berarti bersih.`);
  } else if (isi.nganggurBatas) {
    L.push(`ℹ️ Uang tanpa pemilik diperiksa sampai ${tgl(isi.nganggurBatas)} saja —`);
    L.push(`   sesudah itu klaimnya belum lahir (cron malam gadai belum menyapunya),`);
    L.push(`   jadi belum bisa dinilai. Akan ikut pada kiriman berikutnya.`);
  }

  L.push(`💰 KREDIT TANPA KONTRAK (${isi.kreditNganggur.length})` +
         (isi.kreditNganggur.length ? ` · ${rp(isi.rpKreditNganggur)}` : ""));
  if (isi.kreditNganggur.length) {
    L.push(`   uang MASUK yang tidak diklaim transaksi mana pun`);
    // SEMUA ditampilkan, tidak dipotong.
    //
    // Versi pertama menampilkan 10 lalu menulis "… N lagi tidak ditampilkan" —
    // padahal N baris itu SUDAH distempel "pernah dilaporkan" di pipeline, jadi
    // mereka tidak akan pernah muncul lagi. Dipotong DAN dianggap sudah
    // diberitahukan adalah cara paling rapi menghilangkan sesuatu tanpa
    // seorang pun menyadarinya. Yang ditampilkan harus SAMA PERSIS dengan yang
    // distempel; batas 25 per arah sudah dijaga di pipeline.
    isi.kreditNganggur.forEach((x) => {
      L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)}${x.pihak ? ` · ${x.pihak}` : ""}`);
    });
    // Sisa yang belum pernah dilaporkan SAMA SEKALI harus disebut, bukan
    // didiamkan sampai kiriman berikutnya. Daftar yang dipotong diam-diam
    // berbunyi persis seperti daftar yang lengkap.
    if (Number(isi.sisaKreditNganggur ?? 0) > 0) {
      L.push(`   ↳ masih ada ${isi.sisaKreditNganggur} baris lagi yang belum pernah`);
      L.push(`     dilaporkan — akan disebut pada kiriman mutasi berikutnya.`);
    }
  }

  L.push(`💸 DEBET TANPA PERMINTAAN (${isi.debetNganggur.length})` +
         (isi.debetNganggur.length ? ` · ${rp(isi.rpDebetNganggur)}` : ""));
  if (isi.debetNganggur.length) {
    L.push(`   ⚠️ uang KELUAR yang tidak diminta permintaan transfer mana pun`);
    isi.debetNganggur.forEach((x) => {
      L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)}${x.pihak ? ` · ${x.pihak}` : ""}`);
    });
    if (Number(isi.sisaDebetNganggur ?? 0) > 0) {
      L.push(`   ↳ masih ada ${isi.sisaDebetNganggur} baris lagi yang belum pernah`);
      L.push(`     dilaporkan — akan disebut pada kiriman mutasi berikutnya.`);
    }
  }
  L.push("");

  // ── Cakupan: DUA rentang, dan bedanya disebut ──
  //
  // Rentang berkas dan rentang yang benar-benar direkonsiliasi TIDAK SAMA
  // kalau ada hari yang nol transfer. Menyebut satu angka saja membuat hari
  // yang tidak pernah diuji terhitung "sudah diperiksa" — kesenyapan yang
  // berbunyi seperti kabar baik.
  L.push(`CAKUPAN`);
  L.push(`   Berkas          ${periode}`);
  const dinilai = isi.nilaiDari && isi.nilaiSampai
    ? `${tgl(isi.nilaiDari)}–${tgl(isi.nilaiSampai)}`
    : "tidak ada resi yang bisa dinilai";
  L.push(`   Direkonsiliasi  ${dinilai}`);
  if (isi.berkasDari && isi.nilaiDari &&
      (isi.berkasDari !== isi.nilaiDari || isi.berkasSampai !== isi.nilaiSampai)) {
    L.push(`   ⚠️ selisihnya BUKAN "sudah diperiksa" — hari tanpa resi memang tak diuji`);
  }
  if (isi.ditahanLuarPeriode > 0) {
    L.push(`   ${isi.ditahanLuarPeriode} resi di luar jangkauan berkas ini — menunggu mutasi lain`);
  }
  if (isi.ditahanKonflik > 0) {
    L.push(`   ⚠️ ${isi.ditahanKonflik} resi berebut baris mutasi yang sama — perlu diputuskan`);
  }

  const keutuhan =
    isi.utuh === true ? "✅ utuh" : isi.utuh === false ? "⛔ TIDAK UTUH" : "➖ tak bisa dibuktikan";
  const sambung =
    isi.nyambung === true ? "✅ nyambung"
    : isi.nyambung === false ? `⛔ TIDAK NYAMBUNG (selisih ${rp(isi.selisihSambungan)})`
    : "➖ belum ada titik banding";
  L.push(`   Keutuhan  ${keutuhan} · ${sambung}` +
         (isi.rantaiPutus > 0 ? ` · ⛔ rantai putus ${isi.rantaiPutus} tempat` : ""));

  return L.join("\n");
}
